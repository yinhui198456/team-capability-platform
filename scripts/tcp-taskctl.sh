#!/usr/bin/env bash
# tcp-taskctl.sh — minimal TCP task completion notification
#
# Usage:
#   bash tcp-taskctl.sh start --task KEY --command-file FILE
#   bash tcp-taskctl.sh status
#
# Note: single state file supports only one active task at a time.
#       Upgrade to per-task state files when parallel tasks are needed.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RUNTIME_DIR="${TCP_RUNTIME_DIR:-$SCRIPT_DIR/../runtime}"
STATE_FILE="$RUNTIME_DIR/tcp-task-state.json"
RUNS_DIR="$RUNTIME_DIR/tcp-runs"
DEFAULT_NOTIFY_SCRIPT="/opt/personal-agent-workspace/scripts/heartbeat-notify.sh"

iso_now() {
    date '+%Y-%m-%dT%H:%M:%S%z'
}

# Atomic write: create temp file next to target, then mv.
atomic_write() {
    local target="$1"
    local tmp
    tmp="$(mktemp "${target}.XXXXXX")"
    cat > "$tmp"
    mv -f "$tmp" "$target"
}

write_state() {
    atomic_write "$STATE_FILE"
}

lock_state() {
    while ! mkdir "${STATE_FILE}.lock" 2>/dev/null; do
        sleep 0.05
    done
}

unlock_state() {
    rmdir "${STATE_FILE}.lock" 2>/dev/null || true
}

update_state_field() {
    local key="$1"
    local value="$2"
    local tmp
    tmp="$(mktemp "${STATE_FILE}.XXXXXX")"
    lock_state
    jq --arg key "$key" --arg value "$value" '.[$key]=$value' "$STATE_FILE" > "$tmp"
    mv -f "$tmp" "$STATE_FILE"
    unlock_state
}

cmd_start() {
    local task=""
    local command_file=""

    while [[ $# -gt 0 ]]; do
        case "$1" in
            --task)
                task="$2"
                shift 2
                ;;
            --command-file)
                command_file="$2"
                shift 2
                ;;
            *)
                echo "Unknown option: $1" >&2
                exit 1
                ;;
        esac
    done

    if [[ -z "$task" || -z "$command_file" ]]; then
        echo "Usage: tcp-taskctl.sh start --task KEY --command-file FILE" >&2
        exit 1
    fi

    if [[ ! -f "$command_file" ]]; then
        echo "Command file not found: $command_file" >&2
        exit 1
    fi

    mkdir -p "$RUNS_DIR"

    if [[ -f "$STATE_FILE" ]]; then
        local state
        state="$(jq -r '.state // empty' "$STATE_FILE" 2>/dev/null || true)"
        if [[ "$state" == "running" ]]; then
            echo "Another task is already running" >&2
            exit 1
        fi
    fi

    local prompt
    prompt="$(cat "$command_file")"

    local started_at started_epoch run_log
    started_at="$(iso_now)"
    started_epoch="$(date '+%s')"
    run_log="$RUNS_DIR/$(date '+%Y%m%d%H%M%S')-$task.log"

    jq -n \
        --arg task "$task" \
        --arg started_at "$started_at" \
        --arg started_epoch "$started_epoch" \
        --arg run_log "$run_log" \
        --arg state "running" \
        '{
            task: $task,
            monitor_pid: null,
            cc_pid: null,
            started_at: $started_at,
            started_epoch: ($started_epoch | tonumber),
            completed_at: null,
            exit_code: null,
            state: $state,
            run_log: $run_log
        }' | write_state

    # Export runtime/notify paths so the detached monitor session inherits them.
    export TCP_RUNTIME_DIR="$RUNTIME_DIR"
    export TCP_NOTIFY_SCRIPT="${TCP_NOTIFY_SCRIPT:-$DEFAULT_NOTIFY_SCRIPT}"

    # Start the monitor in its own session so it survives cleanup of the
    # start command's process group (e.g. Codex non-interactive exec exit).
    /usr/bin/setsid "$0" __monitor "$task" "$prompt" "$run_log" "$started_epoch" >/dev/null 2>&1 &
    local monitor_pid=$!

    update_state_field monitor_pid "$monitor_pid"
    echo "Started task $task (monitor_pid=$monitor_pid)"
}

cmd_monitor() {
    local task="$1"
    local prompt="$2"
    local run_log="$3"
    local started_epoch="$4"
    monitor_task "$task" "$prompt" "$run_log" "$started_epoch"
}

monitor_task() {
    local task="$1"
    local prompt="$2"
    local run_log="$3"
    local started_epoch="$4"

    # Launch CC via claude -p
    claude -p -- "$prompt" >"$run_log" 2>&1 &
    local cc_pid=$!
    update_state_field cc_pid "$cc_pid"

    set +e
    wait $cc_pid
    local exit_code=$?
    set -e

    local completed_at state
    completed_at="$(iso_now)"
    if [[ "$exit_code" -eq 0 ]]; then
        state="completed"
    else
        state="failed"
    fi

    local tmp
    tmp="$(mktemp "${STATE_FILE}.XXXXXX")"
    lock_state
    jq \
        --arg completed_at "$completed_at" \
        --arg exit_code "$exit_code" \
        --arg state "$state" \
        '.completed_at=$completed_at |
         .exit_code=($exit_code | tonumber) |
         .state=$state' \
        "$STATE_FILE" > "$tmp"
    mv -f "$tmp" "$STATE_FILE"
    unlock_state

    local completed_epoch elapsed
    completed_epoch="$(date '+%s')"
    elapsed=$((completed_epoch - started_epoch))

    local notify_script="${TCP_NOTIFY_SCRIPT:-$DEFAULT_NOTIFY_SCRIPT}"
    local title="TCP Task [$task]"
    local reason="state=$state exit_code=$exit_code"
    local template="green"
    if [[ "$state" == "failed" ]]; then
        template="red"
    fi

    if [[ -f "$notify_script" ]]; then
        "$notify_script" "$task" "$title" "$template" "$reason" "${elapsed}s" "" || true
    fi
}

cmd_status() {
    if [[ ! -f "$STATE_FILE" ]]; then
        echo "{}"
        return 0
    fi
    cat "$STATE_FILE"
}

main() {
    local cmd="${1:-}"
    shift || true

    case "$cmd" in
        __monitor)
            cmd_monitor "$@"
            ;;
        start)
            cmd_start "$@"
            ;;
        status)
            cmd_status
            ;;
        *)
            echo "Usage: tcp-taskctl.sh {start --task KEY --command-file FILE | status}" >&2
            exit 1
            ;;
    esac
}

main "$@"

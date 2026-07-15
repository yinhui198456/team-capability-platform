#!/usr/bin/env bash
# Minimal TDD test for scripts/tcp-taskctl.sh
# Covers: successful CC run (green notification), failed CC run (red notification),
# and status command does not trigger new notifications.
# All external commands are mocked; no real claude, gh, or Feishu calls.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TCP_TASKCTL="$SCRIPT_DIR/../tcp-taskctl.sh"
HEARTBEAT_NOTIFY="/opt/personal-agent-workspace/scripts/heartbeat-notify.sh"

RED='\033[0;31m'
GREEN='\033[0;32m'
NC='\033[0m'

failures=0
passed=0

fail() {
  echo -e "${RED}FAIL${NC}: $1"
  failures=$((failures + 1))
}

pass() {
  echo -e "${GREEN}PASS${NC}: $1"
  passed=$((passed + 1))
}

setup_test() {
  TMP_DIR="$(mktemp -d)"
  cd "$TMP_DIR"
  mkdir -p "$TMP_DIR/bin"
  export PATH="$TMP_DIR/bin:$PATH"

  # Mock claude: records args, optionally fails/sleeps based on MOCK_CLAUDE_EXIT
  cat > "$TMP_DIR/bin/claude" <<'EOF'
#!/usr/bin/env bash
printf '%s\n' "$@" >> "$MOCK_CLAUDE_ARGS_LOG"
if [[ "${MOCK_CLAUDE_EXIT:-0}" != "0" ]]; then
  exit "${MOCK_CLAUDE_EXIT}"
fi
exit 0
EOF
  chmod +x "$TMP_DIR/bin/claude"

  # Mock heartbeat-notify.sh: records all calls so we can inspect color/title
  cat > "$TMP_DIR/bin/notify-mock.sh" <<'EOF'
#!/usr/bin/env bash
# Args: label title template reason elapsed config_file
printf '%s\t%s\t%s\t%s\t%s\n' "$1" "$2" "$3" "$4" "$5" >> "$NOTIFY_LOG"
EOF
  chmod +x "$TMP_DIR/bin/notify-mock.sh"

  export TCP_NOTIFY_SCRIPT="$TMP_DIR/bin/notify-mock.sh"
  export MOCK_CLAUDE_ARGS_LOG="$TMP_DIR/claude_args.log"
  export NOTIFY_LOG="$TMP_DIR/notify.log"
  export MOCK_CLAUDE_EXIT=0

  mkdir -p runtime
  # Point tcp-taskctl at our tmp runtime
  export TCP_RUNTIME_DIR="$TMP_DIR/runtime"
}

teardown_test() {
  cd /
  rm -rf "$TMP_DIR"
}

state_key() {
  jq -r ".${1} // empty" "${TCP_RUNTIME_DIR}/tcp-task-state.json" 2>/dev/null || true
}

wait_for_state() {
  local key="$1"
  local expected="$2"
  local timeout_ms="${3:-5000}"
  local waited=0
  while (( waited < timeout_ms )); do
    local actual
    actual="$(state_key "$key")"
    if [[ "$actual" == "$expected" ]]; then
      return 0
    fi
    sleep 0.1
    waited=$((waited + 100))
  done
  return 1
}

wait_for_state_nonempty() {
  local key="$1"
  local timeout_ms="${2:-5000}"
  local waited=0
  while (( waited < timeout_ms )); do
    local actual
    actual="$(state_key "$key")"
    if [[ -n "$actual" && "$actual" != "null" ]]; then
      return 0
    fi
    sleep 0.1
    waited=$((waited + 100))
  done
  return 1
}

test_success_notifies_green() {
  setup_test
  echo "complete some task" > command.txt

  "$TCP_TASKCTL" start --task "TEST-OK" --command-file command.txt

  if ! wait_for_state state completed 5000; then
    fail "success: state did not become completed (got $(state_key state))"
    teardown_test
    return
  fi

  local exit_code task state
  exit_code="$(state_key exit_code)"
  task="$(state_key task)"
  state="$(state_key state)"

  local ok=1
  [[ "$state" == "completed" ]] || { fail "success: state=$state"; ok=0; }
  [[ "$exit_code" == "0" ]] || { fail "success: exit_code=$exit_code"; ok=0; }
  [[ "$task" == "TEST-OK" ]] || { fail "success: task=$task"; ok=0; }

  if [[ ! -f "$NOTIFY_LOG" ]]; then
    fail "success: notification mock not called"
    ok=0
  else
    local template
    template="$(awk -F'\t' 'NR==1 {print $3}' "$NOTIFY_LOG")"
    [[ "$template" == "green" ]] || { fail "success: template=$template (expected green)"; ok=0; }
  fi

  if (( ok )); then
    pass "success_notifies_green"
  fi
  teardown_test
}

test_monitor_invokes_claude_with_auto_permissions() {
  setup_test
  printf 'do the thing\n' > command.txt

  "$TCP_TASKCTL" start --task "TEST-AUTO" --command-file command.txt

  if ! wait_for_state state completed 5000; then
    fail "auto: state did not become completed (got $(state_key state))"
    teardown_test
    return
  fi

  if [[ ! -f "$MOCK_CLAUDE_ARGS_LOG" ]]; then
    fail "auto: claude mock was not invoked"
    teardown_test
    return
  fi

  local ok=1
  if ! grep -qx -- '--safe-mode' "$MOCK_CLAUDE_ARGS_LOG"; then
    fail "auto: --safe-mode not found in claude args"
    ok=0
  fi
  if ! grep -qx -- '--permission-mode' "$MOCK_CLAUDE_ARGS_LOG"; then
    fail "auto: --permission-mode not found in claude args"
    ok=0
  fi
  if ! grep -qx -- 'auto' "$MOCK_CLAUDE_ARGS_LOG"; then
    fail "auto: permission-mode value 'auto' not found in claude args"
    ok=0
  fi

  # Verify the prompt is passed as a single argument after '--'.
  local after_dash
  after_dash="$(awk '/^--$/ { seen=1; next } seen { print; seen=0 }' "$MOCK_CLAUDE_ARGS_LOG")"
  if [[ "$after_dash" != "do the thing" ]]; then
    fail "auto: prompt after -- was not a single argument: $(printf '%q' "$after_dash")"
    ok=0
  fi

  if (( ok )); then
    pass "monitor_invokes_claude_with_auto_permissions"
  fi
  teardown_test
}

test_failure_notifies_red() {
  setup_test
  echo "fail some task" > command.txt
  export MOCK_CLAUDE_EXIT=1

  "$TCP_TASKCTL" start --task "TEST-FAIL" --command-file command.txt

  if ! wait_for_state state failed 5000; then
    fail "failure: state did not become failed (got $(state_key state))"
    teardown_test
    return
  fi

  local exit_code task state
  exit_code="$(state_key exit_code)"
  task="$(state_key task)"
  state="$(state_key state)"

  local ok=1
  [[ "$state" == "failed" ]] || { fail "failure: state=$state"; ok=0; }
  [[ "$exit_code" == "1" ]] || { fail "failure: exit_code=$exit_code"; ok=0; }
  [[ "$task" == "TEST-FAIL" ]] || { fail "failure: task=$task"; ok=0; }

  if [[ ! -f "$NOTIFY_LOG" ]]; then
    fail "failure: notification mock not called"
    ok=0
  else
    local template
    template="$(awk -F'\t' 'NR==1 {print $3}' "$NOTIFY_LOG")"
    [[ "$template" == "red" ]] || { fail "failure: template=$template (expected red)"; ok=0; }
  fi

  if (( ok )); then
    pass "failure_notifies_red"
  fi
  teardown_test
}

test_status_does_not_notify() {
  setup_test
  echo "status test" > command.txt

  "$TCP_TASKCTL" start --task "TEST-STATUS" --command-file command.txt
  wait_for_state state completed 5000

  local notify_before notify_after
  notify_before="$(wc -l < "$NOTIFY_LOG" | tr -d ' ')"
  "$TCP_TASKCTL" status > /dev/null
  notify_after="$(wc -l < "$NOTIFY_LOG" | tr -d ' ')"

  local ok=1
  [[ "$notify_before" == "$notify_after" ]] || { fail "status: notification count changed $notify_before -> $notify_after"; ok=0; }

  if (( ok )); then
    pass "status_does_not_notify"
  fi
  teardown_test
}

test_monitor_survives_start_session_cleanup() {
  setup_test

  # Mock claude sleeps briefly so the monitor is still active when we
  # simulate the Codex exec host cleaning up the start command's session.
  cat > "$TMP_DIR/bin/claude" <<'EOF'
#!/usr/bin/env bash
printf '%s\n' "$@" >> "$MOCK_CLAUDE_ARGS_LOG"
sleep 1
exit 0
EOF
  chmod +x "$TMP_DIR/bin/claude"

  echo "survive session cleanup" > command.txt

  # Start taskctl in its own session.  $! is the PID and PGID of that
  # launcher session; simulates the Codex non-interactive exec process group.
  setsid "$TCP_TASKCTL" start --task "TEST-SURVIVE" --command-file command.txt &
  local launcher_pid=$!

  if ! wait_for_state state running 2000; then
    fail "survive: state did not become running (got $(state_key state))"
    kill -- -$launcher_pid 2>/dev/null || true
    kill "$launcher_pid" 2>/dev/null || true
    teardown_test
    return
  fi

  if ! wait_for_state_nonempty cc_pid 2000; then
    fail "survive: cc_pid was not set (monitor may not have started claude)"
    kill -- -$launcher_pid 2>/dev/null || true
    kill "$launcher_pid" 2>/dev/null || true
    teardown_test
    return
  fi

  local monitor_pid monitor_pgid
  monitor_pid="$(state_key monitor_pid)"
  monitor_pgid="$(ps -o pgid= -p "$monitor_pid" 2>/dev/null | tr -d ' ' || true)"

  if [[ -z "$monitor_pid" || "$monitor_pid" == "null" ]]; then
    fail "survive: monitor_pid missing from state"
    kill -- -$launcher_pid 2>/dev/null || true
    kill "$launcher_pid" 2>/dev/null || true
    teardown_test
    return
  fi

  if [[ "$monitor_pgid" == "$launcher_pid" ]]; then
    fail "survive: monitor ($monitor_pid) shares process group ($monitor_pgid) with launcher session ($launcher_pid)"
    kill -- -$launcher_pid 2>/dev/null || true
    kill "$launcher_pid" 2>/dev/null || true
    teardown_test
    return
  fi

  # Simulate Codex exec host cleaning up the start command's process group.
  kill -- -$launcher_pid 2>/dev/null || true
  sleep 0.1
  kill "$launcher_pid" 2>/dev/null || true

  if ! wait_for_state state completed 5000; then
    fail "survive: state did not become completed after launcher session cleanup (got $(state_key state))"
    teardown_test
    return
  fi

  if [[ ! -f "$NOTIFY_LOG" ]]; then
    fail "survive: notification mock not called after launcher session cleanup"
  else
    local template
    template="$(awk -F'\t' 'NR==1 {print $3}' "$NOTIFY_LOG")"
    if [[ "$template" != "green" ]]; then
      fail "survive: expected green notification, got template=$template"
    else
      pass "monitor_survives_start_session_cleanup"
    fi
  fi

  teardown_test
}

test_runtime_ignores_state_and_runs() {
  setup_test

  local repo_root
  repo_root="$(cd "$SCRIPT_DIR/../.." && pwd)"

  git init -q "$TMP_DIR"
  cp "$repo_root/.gitignore" "$TMP_DIR/.gitignore"
  mkdir -p "$TMP_DIR/runtime"
  cp "$repo_root/runtime/.gitignore" "$TMP_DIR/runtime/.gitignore"

  mkdir -p "$TMP_DIR/runtime/tcp-runs"
  touch "$TMP_DIR/runtime/tcp-task-state.json"
  touch "$TMP_DIR/runtime/tcp-runs/x"

  local ok=1
  (cd "$TMP_DIR" && git check-ignore -q runtime/tcp-task-state.json) || { fail "ignore: tcp-task-state.json should be ignored"; ok=0; }
  (cd "$TMP_DIR" && git check-ignore -q runtime/tcp-runs/x) || { fail "ignore: tcp-runs/x should be ignored"; ok=0; }
  if (cd "$TMP_DIR" && git check-ignore -q runtime/.gitignore); then
    fail "ignore: runtime/.gitignore should NOT be ignored"
    ok=0
  fi

  if (( ok )); then
    pass "runtime_ignores_state_and_runs"
  fi
  teardown_test
}

main() {
  if [[ ! -f "$TCP_TASKCTL" ]]; then
    echo "RED: $TCP_TASKCTL is missing (expected for TDD RED phase)"
    exit 1
  fi

  if [[ ! -f "$HEARTBEAT_NOTIFY" ]]; then
    echo "RED: $HEARTBEAT_NOTIFY is missing"
    exit 1
  fi

  test_success_notifies_green
  test_monitor_invokes_claude_with_auto_permissions
  test_failure_notifies_red
  test_status_does_not_notify
  test_monitor_survives_start_session_cleanup
  test_runtime_ignores_state_and_runs

  echo
  echo "Results: $passed passed, $failures failed"
  if (( failures > 0 )); then
    exit 1
  fi
  exit 0
}

main "$@"

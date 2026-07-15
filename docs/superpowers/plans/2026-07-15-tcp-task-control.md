# TCP Task-Control Mechanism Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prevent drift between a GitHub Project task, the Claude Code (CC) subprocess that owns it, the Git commit that records the work, the Codex audit outcome, and the next task dispatch. This is a project-operations mechanism only; it adds no business feature, API, database table, or page.

**Architecture:** A single tracked Bash script `scripts/tcp-taskctl.sh` provides four subcommands (`start`, `status`, `recover`, `sync-audit`). It keeps one authoritative state file at `runtime/tcp-task-state.json` and one exclusive writer lock at `runtime/tcp-task-state.lock`. Per-run logs live under `runtime/tcp-runs/`.

`start` launches exactly one `claude` child process from a required `--command-file`. The child's PID is recorded as `child_pid`, and its `stdout`/`stderr` are redirected to the per-run log. `start` updates GitHub Project fields **only** when passed `--sync-board`; otherwise it records only local state. `status` and `recover` detect child completion by polling the recorded `child_pid` but never transition board status on process exit. The script updates the board only through explicit `sync-audit` calls.

Read-only workers (e.g. `status`) may run in parallel; any mutation holds the writer lock and logs every change.

**Tech Stack:** Bash, `jq`, `gh` (already available), Git. No new runtime dependencies, no Python/Node packages, no Docker changes.

**Baseline Read:** `AGENTS.md` does not exist in this repository; `CLAUDE.md` and `docs/01_Product.md`–`docs/06_Roadmap.md` are the working baseline. `scripts/`, `runtime/`, `docs/07_Task_Control.md`, and a `runtime/` exception in `.gitignore` do not exist yet.

---

## Global Constraints

- **No business code.** This mechanism must not create, modify, or depend on any business API, database schema, frontend page, or catalog/auth/growth feature.
- **No new dependencies.** Use only Bash, `git`, `jq`, and the existing `gh` CLI. Do not add packages to `backend/requirements*.txt`, `frontend/package.json`, or `compose.yaml`.
- **No automatic state transitions.** A process exit must never trigger `git merge`, `git reset`, `git checkout --force`, any GitHub Project field update, or any next-task dispatch. Those actions require an explicit subcommand and explicit arguments.
- **`start` mutates the board only with `--sync-board`.** Without `--sync-board`, `start` records local state only. With `--sync-board`, it resolves live field metadata and updates only the three single-select fields (`Status`, `阶段状态`, `当前实施方`) for "CC now owns this task."
- **Track the real CC subprocess, not the launcher shell.** The state file stores the PID of the background `claude` child, not the PID of `tcp-taskctl.sh` itself.
- **One active writer only.** At most one CC subprocess may own the board state for a task at a time. Read-only preparation workers may run concurrently but must not hold the writer lock or update board state.
- **Safe defaults, explicit overrides.** Staleness threshold is configurable per command with a safe default (3600 s). Any mutation is appended to a per-run log under `runtime/tcp-runs/`.
- **No real GitHub changes during tests.** All automated tests use temporary directories and mocked `gh`/`claude` binaries in `PATH`. Tests never call the real GitHub API or modify the actual project board.
- **No task-specific assumptions in code.** The script resolves GitHub Project fields, item IDs, and single-select option IDs from the live project metadata rather than embedding hardcoded IDs or mapping tables.

---

## Exact File Inventory

### New files

| Path | Responsibility |
|------|----------------|
| `scripts/tcp-taskctl.sh` | Tracked executable shell script with `start`, `status`, `recover`, and `sync-audit` subcommands. |
| `scripts/tests/test_tcp_taskctl.sh` | Deterministic shell-test suite using temp dirs and mocked `gh`/`claude` commands. |
| `runtime/.gitignore` | Ignores `tcp-task-state.json`, `tcp-task-state.lock`, and `tcp-runs/` while keeping the `runtime/` directory tracked. |
| `docs/07_Task_Control.md` | Operator manual: subcommands, state file schema, field mapping, and recovery playbook. Created only after tool tests pass. |

### Modified files

| Path | Change |
|------|--------|
| `.gitignore` | Add a narrow exception after the existing `runtime/` rule: `!runtime/.gitignore`. This lets `runtime/.gitignore` be tracked while all other `runtime/` contents remain ignored. |
| `docs/06_Roadmap.md` | Targeted update reflecting iteration 3 as "进行中" with task-control evidence and the new `docs/07_Task_Control.md` link. Updated only after tool tests pass and only if the user has authorized iteration 3 to start. |

### Not changed

- `README.md`, `CLAUDE.md`, `docs/01_Product.md`–`docs/05_Development.md` (frozen baseline docs).
- Any business code under `backend/app/`, `frontend/src/`, `capability-model/`.
- `compose.yaml`, backend/frontend dependencies, or GitHub Project structure.

---

## State File and Lock Contract

`runtime/tcp-task-state.json` (ignored) has this schema:

```json
{
  "version": 1,
  "project_owner": "myorg",
  "project_number": 5,
  "project_item_id": "PVTI_lADO...",
  "task_key": "3A-1",
  "command_file": "/abs/path/to/prompt.txt",
  "child_pid": 12345,
  "owner": "CC",
  "started_at": "2026-07-15T09:30:00Z",
  "base_head": "a1b2c3d...",
  "allowed_files": ["docs/06_Roadmap.md", "scripts/tcp-taskctl.sh"],
  "stale_after_seconds": 3600,
  "run_log": "runtime/tcp-runs/2026-07-15T09:30:00Z-start.log",
  "board_synced_at_start": false
}
```

`runtime/tcp-task-state.lock` is an empty lock file used with `flock(1)`. Mutations acquire an exclusive non-blocking lock; read-only `status` acquires a shared non-blocking lock. All writes are atomic (`tmpfile` + `mv`).

---

## Subcommand Specification

### `start`

```bash
./scripts/tcp-taskctl.sh start \
  --project-owner <owner> \
  --project-number <number> \
  --project-item <project-item-id> \
  --task <task-key> \
  --command-file <path> \
  [--allowed-files <comma-separated-paths>] \
  [--stale-after <seconds>] \
  [--sync-board]
```

- `--command-file` is required. The file contains the literal CC prompt text. The script rejects shell command strings and any attempt to bypass `--command-file`; there is no `--command` flag and no `eval`/`bash -c` path.
- `--project-owner` and `--project-number` are required for `--sync-board` (either as flags or via `TCP_PROJECT_OWNER` / `TCP_PROJECT_NUMBER` environment variables). They are ignored when `--sync-board` is absent.
- Reads the current Git HEAD as `base_head` if not supplied.
- Checks the writer lock. If an active writer exists (state present, child PID alive, and not stale), exits non-zero with the existing task key and child PID.
- Launches exactly one background `claude` child with this controlled command, redirecting both streams to the per-run log:

  ```bash
  prompt=$(<"$command_file")
  claude -p -- "$prompt" >>"$run_log" 2>&1 &
  child_pid=$!
  ```

- Records the project owner/number, project item ID, task key, `command_file`, `child_pid`, start time, allowed file list, base HEAD, stale threshold, run-log path, and whether `--sync-board` was used.
- If `--sync-board` is passed, resolves live field IDs and single-select option IDs and updates `Status` → `In Progress`, `阶段状态` → `进行中`, `当前实施方` → `CC`. Without `--sync-board`, the board is not touched.
- The `tcp-taskctl.sh` process exits immediately after launching and recording the child; it does not wait for the child.

### `status`

```bash
./scripts/tcp-taskctl.sh status [--stale-after <seconds>]
```

Reports, in machine-parseable lines plus a human summary:

- state present / absent
- project item ID, task key, recorded `child_pid`, owner
- process state: `alive`, `completed` (child PID is gone), `stale` (child PID gone unexpectedly), or `overdue` (elapsed > threshold)
- last file change among `allowed_files` (UTC ISO timestamp, or repo-wide if no list)
- dirty paths from `git status --porcelain`
- latest commit from `git log -1 --oneline`
- run-log path

`status` is read-only and may run concurrently with other readers. Detecting that the child has exited does **not** update any GitHub Project field; it only reports the state.

### `recover`

```bash
./scripts/tcp-taskctl.sh recover [--stale-after <seconds>]
```

- Acquires the writer lock.
- If no state exists, exits 0 with an informational message.
- If a process is recorded and still alive, sends `SIGTERM` to **only** that `child_pid`. Waits up to 10 s; if still alive, sends `SIGKILL` to **only** that `child_pid`.
- If the recorded child has already exited, no signal is sent.
- Preserves the worktree: no `git reset`, `git checkout --force`, `git clean`, or merge is run.
- Moves the state file to `runtime/tcp-runs/<timestamp>-recovered.json` and appends a recovery entry to the run log.
- Does not update GitHub Project fields.

### `sync-audit`

```bash
./scripts/tcp-taskctl.sh sync-audit \
  --project-owner <owner> \
  --project-number <number> \
  --result accepted|rejected \
  --commit <sha> \
  [--project-item <id>] \
  [--notes <text>]
```

- `--project-owner` and `--project-number` are required (flags or `TCP_PROJECT_OWNER` / `TCP_PROJECT_NUMBER` environment variables).
- Requires explicit `--result accepted` or `--result rejected`; any other value exits non-zero.
- Requires `--commit <sha>` and validates it with `git cat-file -e <sha>`.
- Uses the project item ID from state if `--project-item` is omitted; fails if neither is available.
- **Atomicity boundary:** before the first `gh project item-edit`, validate the commit, resolve the project item ID, resolve the live field IDs, and resolve the live single-select option IDs for `Status`, `阶段状态`, and `当前实施方`. If any required ID or option is missing, exit non-zero before mutating the board.
- Accepted audit: `Status` → `Done`, `阶段状态` → `已完成`, `当前实施方` → `Codex`, `输出与验收` → `<commit> accepted`.
- Rejected audit: `Status` → `Todo` (standard `Status` has no `Blocked` option), `阶段状态` → `已阻塞`, `当前实施方` → `Codex`, `实施过程` appends rejection notes.
- If an external `gh` call fails after edits have begun, log the partial failure to the run log and exit non-zero. Do not write a fake success value to any board text field.
- Does **not** merge, reset, or dispatch the next task.
- Appends the audit result and commit to the run log.

---

## GitHub Project Field Mapping

The script resolves field metadata dynamically from the live project:

1. `TCP_PROJECT_OWNER` and `TCP_PROJECT_NUMBER` environment variables (or `--project-owner` / `--project-number` flags) identify the project.
2. `gh project field-list --owner "$owner" "$number" --format json` resolves field IDs and single-select option IDs by name.
3. `gh project item-list --owner "$owner" "$number" --format json` resolves the item node ID from the recorded `project_item_id`.
4. `gh project item-edit` updates the fields below.

| Field name | Type | Updated when | Value mapping |
|---|---|---|---|
| `Status` | single_select | `start --sync-board`, `sync-audit` | `start --sync-board` → `In Progress`; `sync-audit accepted` → `Done`; `sync-audit rejected` → `Todo` |
| `阶段状态` | single_select | `start --sync-board`, `sync-audit` | `start --sync-board` → `进行中`; `sync-audit accepted` → `已完成`; `sync-audit rejected` → `已阻塞` |
| `当前实施方` | single_select | `start --sync-board`, `sync-audit` | `start --sync-board` → `CC`; `sync-audit` → `Codex` |
| `实施过程` | text | `start --sync-board`, `sync-audit` | Append run-log path or audit notes; never overwrite previous entries |
| `输出与验收` | text | `sync-audit` | `<commit> <result>` (e.g. `a1b2c3d accepted`) |
| `执行顺序` | number | never | Read-only for the tool; updated only by human project maintainers |

All single-select updates use `gh project item-edit --single-select-option-id ...` with the option ID resolved by name from the live `field-list` output. Text fields use `--text ...`. No single-select field is ever represented or updated as text.

---

## Security and Failure Cases

| Threat / failure | Mitigation |
|---|---|
| Two CC processes try to own the same task | Exclusive writer lock on `runtime/tcp-task-state.lock`; second `start` fails with existing task key and child PID. |
| Stale state from a crashed process blocks a new start | `status` reports `stale`/`overdue`; `recover` clears it without touching the worktree. No implicit recovery in `start`. |
| `start` mutates the board unexpectedly | `start` updates board fields only when `--sync-board` is passed; default behavior is local-state only. |
| Wrong PID is recorded or signaled | `start` stores the PID returned by the `claude` background launch (`$!`), not its own shell PID. `recover` sends signals only to the recorded `child_pid`, never to a PID discovered from `ps`. |
| Recover kills the wrong process | `recover` sends signals only to the `child_pid` recorded in the state file. |
| Audit result updates board before commit exists | `sync-audit` runs `git cat-file -e <sha>` before any `gh project item-edit` call. |
| Audit result is misspelled | `sync-audit` accepts only `accepted` or `rejected`; anything else exits non-zero before any board mutation. |
| Process exit triggers an automatic state change | The script has no `trap` that calls `sync-audit`, `recover`, or board updates on `EXIT`. Child completion is reported by `status`/`recover` but never transitions board fields. |
| Read-only worker mutates board state | `status` and future read-only helpers use shared lock or no lock and call no `gh project item-edit`. |
| `gh` CLI is unavailable or unauthenticated | Each `gh` call is wrapped; on non-zero exit the script logs stderr and exits without partial board updates. `sync-audit` does not fall back to cached IDs if live resolution fails. |
| Stale threshold is set dangerously low | Values below 60 s are rejected; default is 3600 s. |
| Allowed-file list leaks or drifts | Recorded in state at `start`; `status` checks only those paths. If empty, it reports repo-wide last change. |
| State file corruption | `start` validates JSON schema with `jq`; malformed state causes `status`/`recover` to report the error and exit safely. |
| Worktree is destroyed during recovery | `recover` performs no `git` destructive operations. Tests assert absence of `git reset`/`git checkout --force`/`git clean` in the script body. |
| Missing command file | `start` exits non-zero before launching any child if `--command-file` is missing or unreadable. |
| Shell command injection | `start` rejects any flag that would pass a raw shell command; the prompt is read from file and passed as a single argument to `claude -p -- "$prompt"`. |

---

## Deterministic Test Inventory

`scripts/tests/test_tcp_taskctl.sh` creates a temp directory, initializes a Git repo, builds mocked `gh` and `claude` binaries on `PATH`, and runs the following cases:

| # | Test | Pass criteria |
|---|---|---|
| 1 | `start` records state | State file exists with correct project owner/number, project item ID, task key, `child_pid`, `command_file`, base HEAD, allowed files, and default stale threshold. |
| 2 | `start` rejects missing `--command-file` | Exits non-zero before launching `claude` and does not create state. |
| 3 | `start` records mock child PID and run log | Mock `claude` writes its PID to a known file; `tcp-taskctl.sh start` records that same PID and redirects output to a log under `runtime/tcp-runs/`. |
| 4 | `start` rejects shell command bypass | Passing a raw command string flag (e.g. `--command`) is not accepted; the script exits non-zero. |
| 5 | Active writer guard | Second `start` while the first child process is alive exits non-zero and does not overwrite state. |
| 6 | `status` alive/completed/stale | `status` reports `alive` for a running child PID and `completed`/`stale` after the child exits. |
| 7 | `status` dirty paths | After touching an untracked file, `status` lists the dirty path. |
| 8 | `recover` terminates only recorded PID | `recover` kills the recorded `child_pid`, preserves tracked and untracked files, and moves state to `runtime/tcp-runs/*-recovered.json`. |
| 9 | `recover` no-op when idle or child already exited | `recover` with no state exits 0 and logs "no active task"; if the child already exited, it archives state without sending signals. |
| 10 | `start --sync-board` updates board | Mock `gh` receives the correct owner/number, item ID, field IDs, and single-select option IDs for `Status=In Progress`, `阶段状态=进行中`, `当前实施方=CC`. |
| 11 | `sync-audit accepted` updates board | Mock `gh` receives the correct item ID, field IDs, and single-select option ID for `Done`; output contains the commit and `accepted`. |
| 12 | `sync-audit rejected` updates board | Mock `gh` receives `Status=Todo`, `阶段状态=已阻塞`, `当前实施方=Codex`, and appended rejection notes. |
| 13 | `sync-audit` rejects invalid result | `--result maybe` exits non-zero before calling `gh`. |
| 14 | `sync-audit` rejects missing commit | Exits non-zero before any `gh project item-edit` if commit SHA does not exist. |
| 15 | No forbidden commands | The script source does not contain `git merge`, `git reset`, `git checkout --force`, `git clean -f`, or any dispatch of a next task. |
| 16 | Stale threshold safe default | Calling `start` without `--stale-after` sets 3600 s; `--stale-after 30` is rejected. |

Run the suite with:

```bash
bash scripts/tests/test_tcp_taskctl.sh
```

The suite exits 0 only when all cases pass and leaves no temp directories behind.

---

## TDD Steps and Commands

### Task 1: Scaffold script, state contract, writer guard, and command-file child launch

**Files:**
- Create: `scripts/tcp-taskctl.sh`, `runtime/.gitignore`
- Modify: `.gitignore`

**Interfaces:**
- Produces: `start` and `status` subcommands with state-file schema, lock-file handling, safe default `--stale-after 3600`, required `--command-file`, controlled `claude` child launch, and optional `--sync-board` board mutation.

**Concrete snippets for this task:**

`scripts/tcp-taskctl.sh` helper to launch the CC child:

```bash
launch_child() {
  local command_file="$1"
  local run_log="$2"
  local prompt

  if [[ ! -f "$command_file" ]]; then
    log_error "command-file not found: $command_file"
    return 1
  fi
  if [[ ! -r "$command_file" ]]; then
    log_error "command-file not readable: $command_file"
    return 1
  fi

  prompt=$(<"$command_file")

  # Exact controlled interface: one claude process, no shell evaluation.
  claude -p -- "$prompt" >>"$run_log" 2>&1 &
  echo $!
}
```

`start` argument parsing:

```bash
project_owner="${TCP_PROJECT_OWNER:-}"
project_number="${TCP_PROJECT_NUMBER:-}"
sync_board=0
while [[ $# -gt 0 ]]; do
  case "$1" in
    --project-owner)   project_owner="$2"; shift 2 ;;
    --project-number)  project_number="$2"; shift 2 ;;
    --project-item)    project_item_id="$2"; shift 2 ;;
    --task)            task_key="$2"; shift 2 ;;
    --command-file)    command_file="$2"; shift 2 ;;
    --allowed-files)   allowed_files="$2"; shift 2 ;;
    --stale-after)     stale_after="$2"; shift 2 ;;
    --sync-board)      sync_board=1; shift ;;
    --command)         log_error "use --command-file; raw shell commands are rejected"; exit 2 ;;
    *)                 log_error "unknown argument: $1"; exit 2 ;;
  esac
done
```

Mock `claude` binary used in tests:

```bash
cat > "$tmp/bin/claude" <<'EOF'
#!/usr/bin/env bash
printf '%s\n' "MOCK_CLAUDE_PID=$$" >> "$MOCK_CLAUDE_PID_FILE"
printf '%s\n' "$*" >> "$MOCK_CLAUDE_LOG"
if [[ "${MOCK_CLAUDE_EXIT:-}" == "1" ]]; then
  exit 0
fi
sleep 30
EOF
chmod +x "$tmp/bin/claude"
```

`.gitignore` change:

```diff
 runtime/
+!runtime/.gitignore
```

`runtime/.gitignore` contents:

```gitignore
tcp-task-state.json
tcp-task-state.lock
tcp-runs/
```

- [ ] **RED:** Add `scripts/tests/test_tcp_taskctl.sh` with tests 1–4, 6–7, 10, 15–16. Run `bash scripts/tests/test_tcp_taskctl.sh`; expect failures because the script is missing.
- [ ] **Implement:** Create `scripts/tcp-taskctl.sh` with argument parsing, `flock`-based writer guard, state-file write/read, `start` (command-file child launch and optional `--sync-board`), and read-only `status`. Add `runtime/.gitignore`. Modify root `.gitignore` with `!runtime/.gitignore`.
- [ ] **GREEN:** Run `bash scripts/tests/test_tcp_taskctl.sh`; expect tests 1–4, 6–7, 10, 15–16 to pass.
- [ ] **Commit:** `git add scripts/tcp-taskctl.sh scripts/tests/test_tcp_taskctl.sh runtime/.gitignore .gitignore && git commit -m "feat: tcp task control start/status with command-file child and optional board sync"`.

### Task 2: Recover and sync-audit

**Files:**
- Modify: `scripts/tcp-taskctl.sh`
- Modify: `scripts/tests/test_tcp_taskctl.sh`

**Interfaces:**
- Produces: `recover` (PID-only termination, worktree preservation, no-op when child already gone) and `sync-audit` (explicit accepted/rejected + commit validation + live single-select option resolution + atomic pre-edit validation).

**Concrete snippets for this task:**

Resolve single-select option ID by name:

```bash
field_id_by_name() {
  local field_list_json="$1"
  local name="$2"
  jq -r --arg n "$name" '.fields[] | select(.name == $n) | .id' <<<"$field_list_json"
}

option_id_by_name() {
  local field_list_json="$1"
  local field_name="$2"
  local option_name="$3"
  jq -r --arg f "$field_name" --arg o "$option_name" '
    .fields[] | select(.name == $f) | .options[] | select(.name == $o) | .id
  ' <<<"$field_list_json"
}
```

`sync-audit` atomic pre-edit validation:

```bash
sync_audit() {
  local project_owner="$1"
  local project_number="$2"
  local result="$3"
  local commit_sha="$4"
  local project_item_id="$5"
  local notes="$6"

  [[ "$result" == "accepted" || "$result" == "rejected" ]] || { log_error "result must be accepted or rejected"; return 1; }
  git cat-file -e "$commit_sha"^{commit} || { log_error "commit not found: $commit_sha"; return 1; }

  local field_list
  field_list=$(gh project field-list --owner "$project_owner" "$project_number" --format json) || { log_error "failed to list project fields"; return 1; }

  local status_field_id phase_field_id owner_field_id
  status_field_id=$(field_id_by_name "$field_list" "Status")
  phase_field_id=$(field_id_by_name "$field_list" "阶段状态")
  owner_field_id=$(field_id_by_name "$field_list" "当前实施方")

  local status_option_id phase_option_id owner_option_id
  if [[ "$result" == "accepted" ]]; then
    status_option_id=$(option_id_by_name "$field_list" "Status" "Done")
    phase_option_id=$(option_id_by_name "$field_list" "阶段状态" "已完成")
    owner_option_id=$(option_id_by_name "$field_list" "当前实施方" "Codex")
  else
    status_option_id=$(option_id_by_name "$field_list" "Status" "Todo")
    phase_option_id=$(option_id_by_name "$field_list" "阶段状态" "已阻塞")
    owner_option_id=$(option_id_by_name "$field_list" "当前实施方" "Codex")
  fi

  [[ -n "$status_option_id" && -n "$phase_option_id" && -n "$owner_option_id" ]] || {
    log_error "missing single-select option IDs"
    return 1
  }

  # Atomic boundary: all IDs validated before the first edit.
  edit_single_select "$project_owner" "$project_number" "$project_item_id" "$status_field_id" "$status_option_id" || { log_partial_failure "status edit failed"; return 1; }
  edit_single_select "$project_owner" "$project_number" "$project_item_id" "$phase_field_id" "$phase_option_id" || { log_partial_failure "phase edit failed"; return 1; }
  edit_single_select "$project_owner" "$project_number" "$project_item_id" "$owner_field_id" "$owner_option_id" || { log_partial_failure "owner edit failed"; return 1; }

  if [[ "$result" == "accepted" ]]; then
    edit_text "$project_owner" "$project_number" "$project_item_id" "输出与验收" "$commit_sha accepted"
  else
    edit_text "$project_owner" "$project_number" "$project_item_id" "实施过程" "rejected: $notes"
  fi
}
```

Mock `gh project field-list` for tests (excerpt):

```bash
cat > "$tmp/bin/gh" <<'EOF'
#!/usr/bin/env bash
if [[ "$1" == "project" && "$2" == "field-list" ]]; then
  cat <<'JSON'
{
  "fields": [
    {"id": "fld_status", "name": "Status", "type": "single_select", "options": [{"id": "opt_todo", "name": "Todo"}, {"id": "opt_ip", "name": "In Progress"}, {"id": "opt_done", "name": "Done"}]},
    {"id": "fld_phase", "name": "阶段状态", "type": "single_select", "options": [{"id": "opt_jinxing", "name": "进行中"}, {"id": "opt_yiwancheng", "name": "已完成"}, {"id": "opt_yizuse", "name": "已阻塞"}]},
    {"id": "fld_owner", "name": "当前实施方", "type": "single_select", "options": [{"id": "opt_cc", "name": "CC"}, {"id": "opt_codex", "name": "Codex"}]},
    {"id": "fld_log", "name": "实施过程", "type": "text"},
    {"id": "fld_accept", "name": "输出与验收", "type": "text"}
  ]
}
JSON
  exit 0
fi
# ... item-edit and other mocks ...
EOF
chmod +x "$tmp/bin/gh"
```

- [ ] **RED:** Add tests 5, 8–9, 11–14 to the test file. Run `bash scripts/tests/test_tcp_taskctl.sh`; expect `recover`/`sync-audit` assertions to fail.
- [ ] **Implement:** Add `recover` with `SIGTERM`/`SIGKILL` only to recorded `child_pid`; add `sync-audit` with result/commit validation, live field/option ID resolution, atomic pre-edit validation, and partial-failure logging; add helper functions to call mocked/real `gh project item-edit`.
- [ ] **GREEN:** Run `bash scripts/tests/test_tcp_taskctl.sh`; expect all 16 tests to pass.
- [ ] **Commit:** `git add scripts/tcp-taskctl.sh scripts/tests/test_tcp_taskctl.sh && git commit -m "feat: tcp task control recover and sync-audit"`.

### Task 3: Hardening and operator manual

**Files:**
- Create: `docs/07_Task_Control.md`
- Modify: `docs/06_Roadmap.md`

**Interfaces:**
- Produces: operator manual and targeted roadmap update reflecting iteration 3 in progress.

**Concrete snippets for this task:**

Doc-existence lint in test file:

```bash
if [[ ! -f "docs/07_Task_Control.md" ]]; then
  echo "FAIL: docs/07_Task_Control.md is missing"
  exit 1
fi
if ! grep -q "tcp-taskctl.sh" "docs/07_Task_Control.md"; then
  echo "FAIL: manual does not reference tcp-taskctl.sh"
  exit 1
fi
```

- [ ] **RED:** Add a test-level lint that verifies `docs/07_Task_Control.md` exists and references the script. Run the suite; expect failure.
- [ ] **Implement:** Write `docs/07_Task_Control.md` covering subcommands, state schema, field mapping, recovery playbook, and mock-based test instructions. Update `docs/06_Roadmap.md` §2/§3 to set iteration 3 status to `进行中`, record the task-control commit range, and link to `docs/07_Task_Control.md`. Update only if the user has explicitly authorized iteration 3 to start.
- [ ] **GREEN:** Re-run `bash scripts/tests/test_tcp_taskctl.sh`; expect the doc-existence assertion to pass.
- [ ] **Commit:** `git add docs/07_Task_Control.md docs/06_Roadmap.md && git commit -m "docs: task control manual and iteration 3 progress"`.

---

## Self-Review Checklist

- [x] Smallest workable design: one shell script, one state file, one lock file, one log directory.
- [x] Active writer guard implemented with exclusive `flock`; read-only `status` uses shared lock.
- [x] `start` records project owner/number, project item ID, task key, `command_file`, `child_pid`, start time, allowed files, base HEAD, and `--sync-board` flag.
- [x] `start` mutates GitHub Project fields only when `--sync-board` is supplied.
- [x] `status` reports child `alive`/`completed`/`stale`/`overdue`, last file change, dirty paths, and latest commit without touching board fields.
- [x] `recover` terminates only the recorded `child_pid` and preserves the worktree.
- [x] `sync-audit` requires explicit `accepted`/`rejected`, project owner/number, and a validated commit before board updates.
- [x] `sync-audit` resolves `Status`, `阶段状态`, and `当前实施方` as single-select fields by name and never uses a nonexistent `Blocked` option.
- [x] `sync-audit` validates all required IDs/options/commit before the first project edit and logs partial external failures without pretending success.
- [x] No automatic merge, reset, status change, or next-task dispatch on process exit.
- [x] Stale threshold is a command argument with a 3600 s safe default and a 60 s floor.
- [x] Every mutation is logged under `runtime/tcp-runs/`.
- [x] GitHub Project fields (`Status`, `阶段状态`, `当前实施方`, `实施过程`, `输出与验收`, `执行顺序`) are resolved dynamically; no task-specific IDs are embedded.
- [x] Deterministic shell tests use temp directories and mocked `gh`/`claude`; no real GitHub changes.
- [x] Only Bash, `jq`, `gh`, and Git are used; no dependency additions.
- [x] `docs/07_Task_Control.md` and the `docs/06_Roadmap.md` update are sequenced after tool tests pass.

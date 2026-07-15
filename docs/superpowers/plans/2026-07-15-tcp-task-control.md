# TCP Task-Control Mechanism Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prevent drift between a GitHub Project task, the Claude Code (CC) subprocess that owns it, the Git commit that records the work, the Codex audit outcome, and the next task dispatch. This is a project-operations mechanism only; it adds no business feature, API, database table, or page.

**Architecture:** A single tracked Bash script `scripts/tcp-taskctl.sh` provides four subcommands (`start`, `status`, `recover`, `sync-audit`). It keeps one authoritative state file at `runtime/tcp-task-state.json` and one exclusive writer lock at `runtime/tcp-task-state.lock`. Per-run logs live under `runtime/tcp-runs/`. The script reads the current GitHub Project item and field state via `gh` and updates it only through explicit `sync-audit` calls. Read-only workers (e.g. `status`) may run in parallel; any mutation holds the writer lock and logs every change.

**Tech Stack:** Bash, `jq`, `gh` (already available), Git. No new runtime dependencies, no Python/Node packages, no Docker changes.

**Baseline Read:** `AGENTS.md` does not exist in this repository; `CLAUDE.md` and `docs/01_Product.md`–`docs/06_Roadmap.md` are the working baseline. `scripts/`, `runtime/`, and `docs/07_Task_Control.md` do not exist yet.

---

## Global Constraints

- **No business code.** This mechanism must not create, modify, or depend on any business API, database schema, frontend page, or catalog/auth/growth feature.
- **No new dependencies.** Use only Bash, `git`, `jq`, and the existing `gh` CLI. Do not add packages to `backend/requirements*.txt`, `frontend/package.json`, or `compose.yaml`.
- **No automatic state transitions.** A process exit must never trigger `git merge`, `git reset`, `git checkout --force`, any GitHub Project field update, or any next-task dispatch. Those actions require an explicit subcommand and explicit arguments.
- **One active writer only.** At most one CC subprocess may own the board state for a task at a time. Read-only preparation workers may run concurrently but must not hold the writer lock or update board state.
- **Safe defaults, explicit overrides.** Staleness threshold is configurable per command with a safe default (3600 s). Any mutation is appended to a per-run log under `runtime/tcp-runs/`.
- **No real GitHub changes during tests.** All automated tests use temporary directories and mocked `gh`/`claude` binaries in `PATH`. Tests never call the real GitHub API or modify the actual project board.
- **No task-specific assumptions in code.** The script resolves GitHub Project fields and item IDs from the live project metadata rather than embedding hardcoded IDs or mapping tables.

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
  "project_item_id": "PVTI_lADO...",
  "task_key": "3A-1",
  "pid": 12345,
  "owner": "CC",
  "started_at": "2026-07-15T09:30:00Z",
  "base_head": "a1b2c3d...",
  "allowed_files": ["docs/06_Roadmap.md", "scripts/tcp-taskctl.sh"],
  "stale_after_seconds": 3600,
  "run_log": "runtime/tcp-runs/2026-07-15T09:30:00Z-start.log"
}
```

`runtime/tcp-task-state.lock` is an empty lock file used with `flock(1)`. Mutations acquire an exclusive non-blocking lock; read-only `status` acquires a shared non-blocking lock. All writes are atomic (`tmpfile` + `mv`).

---

## Subcommand Specification

### `start`

```bash
./scripts/tcp-taskctl.sh start \
  --project-item <project-item-id> \
  --task <task-key> \
  [--allowed-files <comma-separated-paths>] \
  [--stale-after <seconds>]
```

- Reads the current Git HEAD as `base_head` if not supplied.
- Checks the writer lock. If an active writer exists (state present, PID alive, and not stale), exits non-zero with the existing task key and PID.
- Records the project item ID, task key, current shell PID, start time, allowed file list, base HEAD, stale threshold, and run-log path.
- Does **not** change GitHub Project fields; it only records local state.

### `status`

```bash
./scripts/tcp-taskctl.sh status [--stale-after <seconds>]
```

Reports, in machine-parseable lines plus a human summary:

- state present / absent
- project item ID, task key, recorded PID, owner
- process state: `alive`, `stale` (PID dead), or `overdue` (elapsed > threshold)
- last file change among `allowed_files` (UTC ISO timestamp, or repo-wide if no list)
- dirty paths from `git status --porcelain`
- latest commit from `git log -1 --oneline`
- run-log path

`status` is read-only and may run concurrently with other readers.

### `recover`

```bash
./scripts/tcp-taskctl.sh recover [--stale-after <seconds>]
```

- Acquires the writer lock.
- If no state exists, exits 0 with an informational message.
- If a process is recorded, sends `SIGTERM` to **only** that PID. Waits up to 10 s; if still alive, sends `SIGKILL` to **only** that PID.
- Preserves the worktree: no `git reset`, `git checkout --force`, `git clean`, or merge is run.
- Moves the state file to `runtime/tcp-runs/<timestamp>-recovered.json` and appends a recovery entry to the run log.

### `sync-audit`

```bash
./scripts/tcp-taskctl.sh sync-audit \
  --result accepted|rejected \
  --commit <sha> \
  [--project-item <id>] \
  [--notes <text>]
```

- Requires explicit `--result accepted` or `--result rejected`; any other value exits non-zero.
- Requires `--commit <sha>` and validates it with `git cat-file -e <sha>`.
- Uses the project item ID from state if `--project-item` is omitted; fails if neither is available.
- Updates GitHub Project fields only after the commit is validated. Does **not** merge, reset, or dispatch the next task.
- Appends the audit result and commit to the run log.

---

## GitHub Project Field Mapping

The script resolves field metadata dynamically from the live project:

1. `TCP_PROJECT_OWNER` and `TCP_PROJECT_NUMBER` environment variables (or `--project-owner` / `--project-number` flags) identify the project.
2. `gh project field-list --owner "$owner" "$number" --format json` resolves field IDs by name.
3. `gh project item-list --owner "$owner" "$number" --format json` resolves the item node ID from the recorded `project_item_id`.
4. `gh project item-edit` updates the fields below.

| Field name | Type | Updated when | Value mapping |
|---|---|---|---|
| `Status` | single_select | `start`, `sync-audit` | `start` → `In Progress`; `sync-audit accepted` → `Done`; `sync-audit rejected` → `Blocked` |
| `阶段状态` | text | `start`, `sync-audit` | `start` → `进行中`; `sync-audit accepted` → `已完成`; `sync-audit rejected` → `已阻塞` |
| `当前实施方` | text | `start`, `sync-audit` | `start` → `CC`; `sync-audit` → `Codex` |
| `实施过程` | text | `start`, `sync-audit` | Append run-log path or audit notes; never overwrite previous entries |
| `输出与验收` | text | `sync-audit` | `<commit> <result>` (e.g. `a1b2c3d accepted`) |
| `执行顺序` | number | never | Read-only for the tool; updated only by human project maintainers |

The script obtains the option IDs for `Status` from `field-list` output and uses them in `gh project item-edit --single-select-option-id ...`. Text fields use `--text ...`.

---

## Security and Failure Cases

| Threat / failure | Mitigation |
|---|---|
| Two CC processes try to own the same task | Exclusive writer lock on `runtime/tcp-task-state.lock`; second `start` fails with existing PID and task key. |
| Stale state from a crashed process blocks a new start | `status` reports `stale`/`overdue`; `recover` clears it without touching the worktree. No implicit recovery in `start`. |
| Recover kills the wrong process | `recover` sends signals only to the PID recorded in the state file, never to a PID discovered from `ps`. |
| Audit result updates board before commit exists | `sync-audit` runs `git cat-file -e <sha>` before any `gh project item-edit` call. |
| Audit result is misspelled | `sync-audit` accepts only `accepted` or `rejected`; anything else exits non-zero before any board mutation. |
| Process exit triggers an automatic state change | The script has no `trap` that calls `sync-audit`, `recover`, or board updates on `EXIT`. |
| Read-only worker mutates board state | `status` and future read-only helpers use shared lock or no lock and call no `gh project item-edit`. |
| `gh` CLI is unavailable or unauthenticated | Each `gh` call is wrapped; on non-zero exit the script logs stderr and exits without partial board updates. `sync-audit` does not fall back to cached IDs if live resolution fails. |
| Stale threshold is set dangerously low | Values below 60 s are rejected; default is 3600 s. |
| Allowed-file list leaks or drifts | Recorded in state at `start`; `status` checks only those paths. If empty, it reports repo-wide last change. |
| State file corruption | `start` validates JSON schema with `jq`; malformed state causes `status`/`recover` to report the error and exit safely. |
| Worktree is destroyed during recovery | `recover` performs no `git` destructive operations. Tests assert absence of `git reset`/`git checkout --force`/`git clean` in the script body. |

---

## Deterministic Test Inventory

`scripts/tests/test_tcp_taskctl.sh` creates a temp directory, initializes a Git repo, builds mocked `gh` and `claude` binaries on `PATH`, and runs the following cases:

| # | Test | Pass criteria |
|---|---|---|
| 1 | `start` records state | State file exists with correct project item ID, task key, PID, base HEAD, allowed files, and default stale threshold. |
| 2 | Active writer guard | Second `start` while the first process is alive exits non-zero and does not overwrite state. |
| 3 | `status` alive/stale | `status` reports `alive` for a running child PID and `stale` after the child exits. |
| 4 | `status` dirty paths | After touching an untracked file, `status` lists the dirty path. |
| 5 | `recover` terminates only recorded PID | `recover` kills the recorded child PID, preserves tracked and untracked files, and moves state to `runtime/tcp-runs/*-recovered.json`. |
| 6 | `recover` no-op when idle | `recover` with no state exits 0 and logs "no active task". |
| 7 | `sync-audit accepted` updates board | Mock `gh` receives the correct item ID, field IDs, and `Status` option ID for `Done`; output contains the commit and `accepted`. |
| 8 | `sync-audit rejected` updates board | Mock `gh` receives `Blocked` status and `已阻塞` phase state. |
| 9 | `sync-audit` rejects invalid result | `--result maybe` exits non-zero before calling `gh`. |
| 10 | `sync-audit` rejects missing commit | Exits non-zero before any `gh project item-edit` if commit SHA does not exist. |
| 11 | No forbidden commands | The script source does not contain `git merge`, `git reset`, `git checkout --force`, `git clean -f`, or any dispatch of a next task. |
| 12 | Stale threshold safe default | Calling `start` without `--stale-after` sets 3600 s; `--stale-after 30` is rejected. |

Run the suite with:

```bash
bash scripts/tests/test_tcp_taskctl.sh
```

The suite exits 0 only when all cases pass and leaves no temp directories behind.

---

## TDD Steps and Commands

### Task 1: Scaffold script, state contract, and writer guard

**Files:**
- Create: `scripts/tcp-taskctl.sh`, `runtime/.gitignore`

**Interfaces:**
- Produces: `start` and `status` subcommands with state-file schema, lock-file handling, and safe default `--stale-after 3600`.

- [ ] **RED:** Add `scripts/tests/test_tcp_taskctl.sh` with tests 1–4 and 11–12. Run `bash scripts/tests/test_tcp_taskctl.sh`; expect failures because the script is missing.
- [ ] **Implement:** Create `scripts/tcp-taskctl.sh` with argument parsing, `flock`-based writer guard, state-file write/read, `start`, and read-only `status`. Add `runtime/.gitignore` ignoring `tcp-task-state.json`, `tcp-task-state.lock`, and `tcp-runs/`.
- [ ] **GREEN:** Run `bash scripts/tests/test_tcp_taskctl.sh`; expect tests 1–4 and 11–12 to pass.
- [ ] **Commit:** `git add scripts/tcp-taskctl.sh scripts/tests/test_tcp_taskctl.sh runtime/.gitignore && git commit -m "feat: tcp task control start/status with writer guard"`.

### Task 2: Recover and sync-audit

**Files:**
- Modify: `scripts/tcp-taskctl.sh`
- Modify: `scripts/tests/test_tcp_taskctl.sh`

**Interfaces:**
- Produces: `recover` (PID-only termination, worktree preservation) and `sync-audit` (explicit accepted/rejected + commit validation + GitHub Project field updates).

- [ ] **RED:** Add tests 5–10 to the test file. Run `bash scripts/tests/test_tcp_taskctl.sh`; expect `recover`/`sync-audit` assertions to fail.
- [ ] **Implement:** Add `recover` with `SIGTERM`/`SIGKILL` only to recorded PID; add `sync-audit` with result/commit validation and dynamic field ID resolution; add helper functions to call mocked/real `gh project item-edit`.
- [ ] **GREEN:** Run `bash scripts/tests/test_tcp_taskctl.sh`; expect all 12 tests to pass.
- [ ] **Commit:** `git add scripts/tcp-taskctl.sh scripts/tests/test_tcp_taskctl.sh && git commit -m "feat: tcp task control recover and sync-audit"`.

### Task 3: Hardening and operator manual

**Files:**
- Create: `docs/07_Task_Control.md`
- Modify: `docs/06_Roadmap.md`

**Interfaces:**
- Produces: operator manual and targeted roadmap update reflecting iteration 3 in progress.

- [ ] **RED:** Add a test-level lint that verifies `docs/07_Task_Control.md` exists and references the script. Run the suite; expect failure.
- [ ] **Implement:** Write `docs/07_Task_Control.md` covering subcommands, state schema, field mapping, recovery playbook, and mock-based test instructions. Update `docs/06_Roadmap.md` §2/§3 to set iteration 3 status to `进行中`, record the task-control commit range, and link to `docs/07_Task_Control.md`. Update only if the user has explicitly authorized iteration 3 to start.
- [ ] **GREEN:** Re-run `bash scripts/tests/test_tcp_taskctl.sh`; expect the doc-existence assertion to pass.
- [ ] **Commit:** `git add docs/07_Task_Control.md docs/06_Roadmap.md && git commit -m "docs: task control manual and iteration 3 progress"`.

---

## Self-Review Checklist

- [x] Smallest workable design: one shell script, one state file, one lock file, one log directory.
- [x] Active writer guard implemented with exclusive `flock`; read-only `status` uses shared lock.
- [x] `start` records project item ID, task key, PID, start time, allowed files, and base HEAD.
- [x] `status` reports process alive/stale/overdue, last file change, dirty paths, and latest commit.
- [x] `recover` terminates only the recorded PID and preserves the worktree.
- [x] `sync-audit` requires explicit `accepted`/`rejected` and a validated commit before board updates.
- [x] No automatic merge, reset, status change, or next-task dispatch on process exit.
- [x] Stale threshold is a command argument with a 3600 s safe default and a 60 s floor.
- [x] Every mutation is logged under `runtime/tcp-runs/`.
- [x] GitHub Project fields (`Status`, `阶段状态`, `当前实施方`, `实施过程`, `输出与验收`, `执行顺序`) are resolved dynamically; no task-specific IDs are embedded.
- [x] Deterministic shell tests use temp directories and mocked `gh`/`claude`; no real GitHub changes.
- [x] Only Bash, `jq`, `gh`, and Git are used; no dependency additions.
- [x] `docs/07_Task_Control.md` and the `docs/06_Roadmap.md` update are sequenced after tool tests pass.

#!/usr/bin/env bash
# TCP PreToolUse guard — deterministic allow/deny/ask for Bash commands.
#
# Protocol (Claude Code PreToolUse hook):
#   stdin  : JSON {hook_event_name, tool_name, tool_input:{command}, ...}
#   stdout : optional {"hookSpecificOutput":{"hookEventName":"PreToolUse",
#            "permissionDecision":"allow|deny|ask","permissionDecisionReason":"..."}}
#   exit 0 = allow (or ask via stdout decision), exit 2 = deny
#
# Never echoes the command itself (it may contain secrets); all reasons are
# static strings. Decision tables are explicit; unknown inputs pass through.
set -u

REPO_ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
export REPO_ROOT

input=$(cat)

REPO_ROOT="$REPO_ROOT" python3 - "$input" <<'PYEOF'
import json
import os
import re
import shlex
import sys

raw = sys.argv[1]
try:
    data = json.loads(raw)
except Exception:
    sys.exit(0)  # unparseable input -> pass through

event = data.get("hook_event_name")
tool = data.get("tool_name")
tool_input = data.get("tool_input") or {}
cmd = tool_input.get("command") or ""
if event != "PreToolUse" or tool != "Bash" or not cmd:
    sys.exit(0)

REPO_ROOT = os.environ["REPO_ROOT"]
WORKSPACE_ROOT = os.path.dirname(os.path.dirname(REPO_ROOT))
WORKTREES = os.path.join(WORKSPACE_ROOT, "worktrees")
RUNTIME = os.path.join(REPO_ROOT, "runtime")


def reply(decision, reason):
    out = {
        "hookSpecificOutput": {
            "hookEventName": "PreToolUse",
            "permissionDecision": decision,
            "permissionDecisionReason": reason,
        }
    }
    print(json.dumps(out), flush=True)
    sys.exit(0 if decision != "deny" else 2)


def deny(reason):
    reply("deny", reason)


def ask(reason):
    reply("ask", reason)


def allowed_root(path):
    p = os.path.expanduser(path)
    if not p.startswith("/"):
        return True  # relative paths resolve inside the session cwd (repo)
    if p in (REPO_ROOT, WORKTREES, RUNTIME, "/tmp"):
        return True
    return (
        p.startswith(REPO_ROOT + "/")
        or p.startswith(WORKTREES + "/")
        or p.startswith(RUNTIME + "/")
        or p.startswith("/tmp/")
    )


try:
    tokens = shlex.split(cmd)
except Exception:
    tokens = cmd.split()
low = cmd.lower()

# ---------------------------------------------------------------- rm -rf
if any(t == "rm" for t in tokens):
    i = tokens.index("rm")
    rest = tokens[i + 1 :]
    flags = [t for t in rest if t.startswith("-")]
    targets = [t for t in rest if not t.startswith("-")]
    has_r = any(re.fullmatch(r"-{1,2}[A-Za-z]+", f) and "r" in f.lower() for f in flags)
    has_f = any(re.fullmatch(r"-{1,2}[A-Za-z]+", f) and "f" in f.lower() for f in flags)
    if has_r and has_f:
        for t in targets:
            t = os.path.expanduser(t)
            if t in (".", ".."):
                deny("refusing rm -rf of '.' or '..' (deletes session/repo root contents)")
            if not t.startswith("/") and any(ch in t for ch in "*?["):
                ask("rm -rf with a wildcard target — confirm the exact scope")
            elif not t.startswith("/"):
                # relative path inside the repo cwd
                if re.search(r"(^|/)evidence(/|$)", t) or t in ("runtime",):
                    deny("refusing to delete evidence/runtime artifacts")
            elif re.search(r"(^|/)evidence(/|$)", t) or t.startswith(RUNTIME + "/"):
                deny("refusing to delete evidence/runtime artifacts")
            elif not allowed_root(t):
                deny("refusing destructive rm outside the repository, its worktrees, or runtime")

# ------------------------------------------------------------ SQL/DB ops
sql_tools = re.search(
    r"\b(psql|mysql|sqlite3|mariadb|clickhouse-client|redis-cli|pg_ctl)\b", low
)
if sql_tools and re.search(
    r"\b(drop database|drop table|drop schema|truncate|delete from|flushall|flushdb)\b",
    low,
):
    deny("refusing destructive database command (drop/truncate/delete/flush)")
if re.search(r"\bdropdb\b", low):
    deny("refusing dropdb (destructive database drop)")
if re.search(r"\b(django flush|migrate reset|migrate down|alembic downgrade)\b", low):
    deny("refusing database reset/downgrade (destructive)")

# ------------------------------------------------------- volumes/restore
if re.search(r"\bdocker\s+(compose\s+)?(down|rm)\b[^;|&]*(-v|--volumes)\b", low) or re.search(
    r"\bdocker\s+volume\s+rm\b", low
):
    deny("refusing to remove Docker volumes (docker down -v / volume rm)")
if re.search(r"\bdocker\s+system\s+prune\b", low):
    ask("docker system prune — confirm the scope")
if re.search(r"\bpg_restore\b", low):
    deny("refusing pg_restore (destructive restore — manual review required)")

# ------------------------------------------------------------- git state
if re.search(r"\bgit\s+reset\s+--hard\b", low):
    deny("refusing git reset --hard (discards working tree)")
if re.search(r"\bgit\s+clean\s+-f", low):
    deny("refusing git clean -f (deletes untracked files)")
if re.search(r"\bgit\s+checkout\s+--(\s|$)", low) or re.search(
    r"\bgit\s+checkout\s+\.(\s|$)", low
):
    deny("refusing git checkout -- (restores/discards working-tree changes)")
if re.search(r"\bgit\s+push\b", low):
    if re.search(r"\bgit\s+push\b[^;|&]*\s(-f|--force|--force-with-lease)(\s|$)", low):
        deny("refusing force push")
    if re.search(r"\bgit\s+push\b[^;|&]*\s--delete\b", low):
        deny("refusing remote branch deletion via push --delete")
    try:
        after = tokens[tokens.index("push") + 1 :]
        args = [t for t in after if not t.startswith("-")]
    except ValueError:
        args = []
    if args and args[0] != "origin":
        ask("push targets a remote other than origin — confirm the remote")

# ------------------------------------------------------------- escalation
if re.search(r"\bsudo\b", low):
    deny("refusing sudo (outside the session permission boundary)")
if re.search(r"\bchown\b", low):
    deny("refusing chown (ownership change outside the session boundary)")
if re.search(r"\bchmod\b", low) and re.search(r"(4777|777|666|000|ugo\s*=)", low):
    deny("refusing broad permission escalation (chmod)")
if re.search(r"dangerously[-_ ]?skip[-_ ]?permissions", low):
    deny("refusing permission-bypass flags")

# ----------------------------------------------------- production targets
if re.search(
    r"\b(kubectl|helm|terraform\s+apply)\b|(--env\s*(=| )?(prod|production)\b)|(apply\s+-f\s+\S*prod)",
    low,
):
    deny("refusing production/infra command")

# -------------------------------------------------- migration apply (ask)
if re.search(r"\balembic\s+upgrade\b", low) or re.search(
    r"(^|[;&|])\s*python[^;|&]*migrations[^;|&]*(upgrade|apply|run)", low
):
    ask("migration apply — confirm backup and ledger verification (migrations.md)")

# --------------------------------------------------- out-of-repo writes
for m in re.finditer(r">>?\s*([^\s;|&]+)", cmd):
    target = os.path.expanduser(m.group(1))
    if target.startswith("/") and not allowed_root(target) and not target.startswith("<<"):
        deny("refusing to write outside the repository, its worktrees, or runtime")

# ----------------------------------------------------------- runtime ops
if re.search(r"\bdocker\s+compose\s+down\b", low):
    ask("docker compose down — confirm the target stack")

sys.exit(0)
PYEOF

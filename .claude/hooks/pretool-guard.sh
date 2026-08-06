#!/usr/bin/env bash
# TCP PreToolUse guard — deterministic allow/deny/ask for Bash commands and
# the file-writing tools (Edit/Write/MultiEdit/NotebookEdit).
#
# Protocol (Claude Code PreToolUse hook):
#   stdin  : JSON {hook_event_name, tool_name, tool_input:{command|file_path|...}, cwd, ...}
#   stdout : optional {"hookSpecificOutput":{"hookEventName":"PreToolUse",
#            "permissionDecision":"allow|deny|ask","permissionDecisionReason":"..."}}
#   exit 0 = allow (or ask via stdout decision), exit 2 = deny
#
# Model: REPO_ROOT is the only ordinary write root — for Bash writes and for
# file-tool paths alike. Reads may cross the workspace; writes/destructive
# actions to sibling worktrees or other repositories ask/deny — the worktrees
# parent is never a blanket write root. The canonical runtime checkout is not
# implementation source for this session: code/config edits there deny,
# runtime/output artifact writes ask. /tmp stays narrowly allowed for
# non-destructive Bash temporary output; broad delete/wildcard ambiguity asks.
# Unparseable payloads for any matched tool never fail open. Command and path
# contents are never echoed; all reasons are static strings; decision tables
# are explicit.
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
    data = None

MATCHED_TOOLS = {"Bash", "Edit", "Write", "MultiEdit", "NotebookEdit"}

if data is not None:
    event = data.get("hook_event_name")
    tool = data.get("tool_name")
    if event != "PreToolUse" or tool not in MATCHED_TOOLS:
        sys.exit(0)
    tool_input = data.get("tool_input") or {}
    cmd = tool_input.get("command")
    if not isinstance(cmd, str):
        cmd = ""
    session_cwd = data.get("cwd")
    if not isinstance(session_cwd, str) or not session_cwd.startswith("/"):
        session_cwd = ""
else:
    # Malformed/unparseable input for our event must not fail open.
    event, tool, cmd, session_cwd = "PreToolUse", "Bash", "", ""

REPO_ROOT = os.environ["REPO_ROOT"]
WORKSPACE_ROOT = os.path.dirname(os.path.dirname(REPO_ROOT))
CANONICAL_RUNTIME = os.path.normpath(os.path.join(WORKSPACE_ROOT, "team-capability-platform"))
RUNTIME = os.path.join(REPO_ROOT, "runtime")
TMP_OK = "/tmp"


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


def under(path, root):
    p = os.path.normpath(os.path.expanduser(path))
    if p == root:
        return True
    return p.startswith(root.rstrip("/") + "/")


# Unparseable PreToolUse input for a matched tool -> supported ask result,
# static reason. Never fail open.
if data is None:
    ask("unable to parse PreToolUse hook input")

# ------------------------------------------------- file-writing tools
if tool != "Bash":
    if tool in ("Edit", "Write", "MultiEdit"):
        path = tool_input.get("file_path")
    else:  # NotebookEdit
        path = tool_input.get("notebook_path")
    if not isinstance(path, str) or not path.strip():
        ask("file-write tool input without a resolvable path — confirm the target")
    resolved = os.path.normpath(os.path.expanduser(path))
    if not resolved.startswith("/"):
        resolved = os.path.normpath(os.path.join(session_cwd if session_cwd else REPO_ROOT, resolved))
    if under(resolved, REPO_ROOT):
        sys.exit(0)  # ordinary in-repo edit/write
    if CANONICAL_RUNTIME != REPO_ROOT and under(resolved, CANONICAL_RUNTIME):
        if re.search(r"(^|/)(runtime|output|artifacts|logs|evidence)(/|$)", resolved):
            ask("canonical runtime artifact write — confirm explicit task-level authorization")
        deny("refusing code/config edit in the canonical runtime checkout")
    deny("refusing file write/edit outside the repository")

if not cmd:
    sys.exit(0)

try:
    tokens = shlex.split(cmd)
except Exception:
    tokens = cmd.split()
low = cmd.lower()

# Normalized executable tokens: strip standard wrappers (command/env/time/
# nohup/exec/…) plus env assignments, and map absolute executable paths
# (e.g. /bin/rm) to their basename so destructive-command checks cannot be
# bypassed by spelling. Used for the rm and write-command branches only.
toks = list(tokens)
while toks and toks[0] in ("command", "env", "time", "nohup", "exec", "nice", "ionice", "taskset", "stdbuf"):
    toks.pop(0)
    while toks and re.match(r"^[A-Za-z_][A-Za-z0-9_]*=", toks[0]):
        toks.pop(0)

# A token names a command when it starts the line or follows a control/executor
# token (pipeline, &&, ;, xargs, …) — not when it is a plain argument.
CTRL = {"|", "||", "&&", ";", "&", "xargs", "env", "command", "time", "nohup", "exec", "nice", "ionice", "taskset", "stdbuf"}


def command_index(names):
    for i, t in enumerate(toks):
        base = os.path.basename(t) if "/" in t else t
        if base in names and (i == 0 or toks[i - 1] in CTRL):
            return i
    return None

# Effective working directory after any cd/pushd in a compound command.
def effective_cwd():
    cwd = session_cwd if session_cwd else REPO_ROOT
    unknown = False
    i = 0
    while i < len(tokens):
        if tokens[i] in ("cd", "pushd"):
            if i + 1 >= len(tokens) or tokens[i + 1] in ("&&", "||", ";", "&"):
                cwd = os.path.expanduser("~")
            elif tokens[i + 1] == "-":
                unknown = True
            elif tokens[i + 1].startswith("/"):
                cwd = os.path.normpath(os.path.expanduser(tokens[i + 1]))
            else:
                cwd = os.path.normpath(os.path.join(cwd, os.path.expanduser(tokens[i + 1])))
            i += 2
        else:
            i += 1
    return cwd, unknown


eff_cwd, eff_unknown = effective_cwd()


def in_repo(cwd):
    return cwd is not None and (under(cwd, REPO_ROOT) or under(cwd, TMP_OK))


# ---------------------------------------------------------------- rm (any)
rm_idx = command_index({"rm"})
if rm_idx is not None:
    rest = toks[rm_idx + 1 :]
    flags = [t for t in rest if t.startswith("-")]
    targets = [t for t in rest if not t.startswith("-")]
    has_r = any(re.fullmatch(r"-{1,2}[A-Za-z]+", f) and "r" in f.lower() for f in flags)
    for t in targets:
        if not t:
            continue
        if has_r and t in (".", ".."):
            deny("refusing rm of '.' or '..' (deletes the effective cwd contents)")
        expanded = os.path.expanduser(t)
        norm = os.path.normpath(expanded)
        if norm == REPO_ROOT:
            deny("refusing to delete the repository root")
        if expanded.startswith("/"):
            if any(ch in expanded for ch in "*?["):
                if under(expanded, TMP_OK) or under(expanded, REPO_ROOT):
                    ask("rm with a wildcard target — confirm the exact scope")
                deny("refusing destructive rm with a wildcard target")
            if under(expanded, TMP_OK):
                continue  # narrow temp allowance for exact /tmp targets
            if re.search(r"(^|/)evidence(/|$)", expanded) or under(expanded, RUNTIME):
                deny("refusing to delete evidence/runtime artifacts")
            if not under(expanded, REPO_ROOT):
                deny("refusing destructive rm outside the repository")
        else:
            # relative -> resolves against the effective cwd
            if eff_unknown:
                ask("rm with a relative target and unknown cwd (cd -) — confirm the scope")
            if not in_repo(eff_cwd):
                deny("refusing destructive rm outside the repository (foreign effective cwd)")
            if any(ch in t for ch in "*?["):
                ask("rm with a wildcard target — confirm the exact scope")
            if re.search(r"(^|/)evidence(/|$)", t) or t in ("runtime",) or t.startswith("runtime/"):
                deny("refusing to delete evidence/runtime artifacts")
            # else: in-repo relative rm -> allow

# ------------------------------------------------- SQL/DB destructive ops
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

# --------------------------------------------------- git state (incl. -C)
# -C normalized on the original-case command (-C is case-sensitive); git
# subcommands are matched case-insensitively.
git_norm = re.sub(r"\bgit\s+(-C\s+\S+\s+)+", "git ", cmd)
if re.search(r"\bgit\s+reset\s+--hard\b", git_norm, re.I):
    deny("refusing git reset --hard (discards working tree)")
if re.search(r"\bgit\s+clean\s+-f", git_norm, re.I):
    deny("refusing git clean -f (deletes untracked files)")
if re.search(r"\bgit\s+checkout\s+--(\s|$)", git_norm, re.I) or re.search(
    r"\bgit\s+checkout\s+\.(\s|$)", git_norm, re.I
):
    deny("refusing git checkout -- (restores/discards working-tree changes)")
if re.search(r"\bgit\s+push\b", git_norm, re.I):
    if re.search(
        r"\bgit\s+push\b[^;|&]*\s(-f|--force|--force-with-lease(=\S*)?|--force-if-includes)(\s|$)",
        git_norm,
        re.I,
    ):
        deny("refusing force push")
    if re.search(r"\bgit\s+push\b[^;|&]*\s--delete\b", git_norm, re.I):
        deny("refusing remote branch deletion via push --delete")
    try:
        after = tokens[tokens.index("push") + 1 :]
        args = [t for t in after if not t.startswith("-")]
    except ValueError:
        args = []
    if args and args[0] != "origin":
        ask("push targets a remote other than origin — confirm the remote")
# git mutation targeting a checkout outside this repository (git -C ...)
try:
    idx = tokens.index("-C")
    git_target = os.path.expanduser(tokens[idx + 1]) if idx + 1 < len(tokens) else None
except ValueError:
    git_target = None
if git_target and not under(git_target, REPO_ROOT):
    if re.search(r"\bgit\s+(commit|push|pull|merge|reset|checkout|clean|stash|branch|tag|rebase|cherry-pick|revert|rm|mv)\b", git_norm, re.I):
        ask("git mutation targeting a checkout outside this repository — confirm the target")

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

# ------------------------------------------------ migration apply (ask)
if re.search(r"\balembic\s+upgrade\b", low) or re.search(
    r"(^|[;&|])\s*python[^;|&]*migrations[^;|&]*(upgrade|apply|run)", low
):
    ask("migration apply — confirm backup and ledger verification (migrations.md)")

# ------------------------------------------- container/runtime ops (ask)
if re.search(r"\bdocker\s+(exec|run|rm)\b", low) or re.search(
    r"\bdocker\s+compose\s+(up|start|restart|stop|down|rm)\b", low
):
    ask("container/runtime mutation — confirm explicit task-level authorization")

# ---------------------------------------- writes outside the repository
# cp/mv/install/tee destinations (wrapper/absolute-path/piped aware via toks)
w_idx = command_index({"cp", "mv", "install", "tee"})
if w_idx is not None:
    w_args = toks[w_idx + 1 :]
    dest = None
    if "-t" in w_args:
        try:
            dest = w_args[w_args.index("-t") + 1]
        except IndexError:
            dest = None
    else:
        positionals = [t for t in w_args if not t.startswith("-")]
        dest = (positionals[0] if positionals else None) if toks[w_idx] == "tee" else (positionals[-1] if positionals else None)
    if dest:
        expanded = os.path.expanduser(dest)
        if expanded.startswith("/"):
            if not under(expanded, TMP_OK) and not under(expanded, REPO_ROOT):
                ask("write target outside the repository — confirm the destination (cp/mv/install/tee)")
        else:
            if eff_unknown:
                ask("write target with unknown cwd (cd -) — confirm the destination")
            if not in_repo(eff_cwd):
                ask("write target outside the repository (foreign effective cwd) — confirm the destination")
# redirections
for m in re.finditer(r">>?\s*([^\s;|&]+)", cmd):
    target = os.path.expanduser(m.group(1))
    if target.startswith("<<"):
        continue
    if target.startswith("/"):
        if not under(target, TMP_OK) and not under(target, REPO_ROOT):
            ask("write target outside the repository — confirm the destination (redirection)")
    else:
        if eff_unknown:
            ask("write target with unknown cwd (cd -) — confirm the destination (redirection)")
        if not in_repo(eff_cwd):
            ask("write target outside the repository (foreign effective cwd) — confirm the destination (redirection)")

# ------------------------------- canonical runtime mutations (ask)
if CANONICAL_RUNTIME != REPO_ROOT and not eff_unknown and eff_cwd is not None and under(eff_cwd, CANONICAL_RUNTIME):
    tail = re.sub(r"^(cd\s+(\S+\s+)?(&&\s*)?)+", "", git_norm)
    readonly = bool(
        re.search(r"^(ls|cat|head|tail|wc|grep|find|jq|pwd|echo|git\s+(status|diff|log|show|remote|rev-parse))\b", tail, re.I)
    )
    if not readonly:
        ask("canonical runtime mutation — confirm explicit task-level authorization")

sys.exit(0)
PYEOF

---
name: tcp-uat-execution
description: Optional TCP-specific UAT workflow — admission A/B/C (deployed SHA, health, identities, isolation), the real TCP business flow with a proven shared-write gate before fan-out, visible-UI execution, evidence preservation by default, read-only reconciliation before any retry, and OBSERVED_PASS/FAIL/BLOCKED/NOT_RUN outcomes. Composes the playwright-skill browser capability; never auto-cleans records. Use for authorized UAT runs only, never for routine dev testing.
---

# TCP UAT Execution

Optional workflow for authorized end-to-end verification of a delivered TCP change. Invoke explicitly; do not auto-run. Admission A/B/C below only proves it is safe to begin business verification — it is never a UAT pass by itself.

## 1. Admission (all must hold)

- **A — Deployment state**: the exact deployed full SHA matches the task pin; service/proxy URLs, ports, and health are confirmed; the expected migration ledger/schema is present; no runtime/version drift between what is deployed and what the task pins.
- **B — Test setup**: exact test identities with roles/relationships; access probes confirm each identity reaches only what its role allows; business-data prerequisites are present.
- **C — Isolation**: isolated browser contexts; dedicated accounts/record prefixes/mutable records/artifact directories; one serialized shared-write owner; no other Issue/UAT stack contamination.

Any admission failure → report BLOCKED; do not start business verification.

## 2. Business flow (real, in order)

login → Member self-assessment → Buddy review/request-adjustment/final acceptance → plan generation/view → task/log/time/task evidence → Buddy evidence review → task completion/retrospective → downstream checks

Each stage's output feeds the next; a failure at stage N blocks stages N+1… unless the change's scope explicitly excludes them.

## 3. Shared-write gate before fan-out

Prove the public Buddy acceptance / first-plan write gate on one owner before any fan-out: a single identity performs the first real write and the result is observed. Waiting consumers are not active progress — spawn downstream stages only after the gate is observed.

## 4. Execution

- **Visible UI** — browsers run headless: false; UI evidence is screenshots, not DOM assertions.
- **Browser automation is delegated to the installed `playwright-skill` capability** (plugin identifier `playwright-skill@playwright-skill`). Use only its documented interface and helpers; do not copy or re-implement a general browser-testing skill.

## 5. Evidence preservation (default)

Preserve test records, screenshots, traces, and handoffs by default. Never auto-clean or delete records on success or failure. Cleanup is a separate, explicitly authorized operation — never part of this workflow.

## 6. Interruption and unknown results

On page/API interruption or unknown result: reconcile counts, state, and handoff read-only first — before anything else. Retry at most once, and only after proving zero execution and zero write (no partial effect). Partial/unknown write isolates the lane (no further writes on that lane until reconciled); shared identity, permission, or data loss pauses all writes until resolved.

## 7. Serialized shared writes

One designated owner performs all shared writes (records, evidence artifacts); everyone else reads only. Concurrent UAT sessions on the same data are not allowed — serialize or wait.

## 8. Checkpoint / handoff / evidence

- Checkpoint after each stage: state summary plus evidence (command, output, screenshot, SHA).
- Handoff: when ownership changes, hand over the checkpoint summary; the new owner verifies the state before writing.
- Evidence goes to the task's declared authoritative location (GitHub PR/Issue when applicable, plus versioned artifacts); exact SHA required.

## 9. Outcomes

Use only OBSERVED_PASS / FAIL / BLOCKED / NOT_RUN, each with evidence. Never claim final user acceptance — that belongs to the accountable human.

## 10. Stall recovery

Bounded retries with increasing waits. On repeated stall: produce a checkpoint and escalate to the user. Never silently "fix" the flow by skipping steps.

## Self-check (static assertions)

Run read-only; needs nothing beyond this file. Fails if the dangerous auto-cleanup sentence is present or any core admission/flow/retry marker is missing:

```bash
python3 - <<'EOF'
import pathlib, re
text = pathlib.Path(".claude/skills/tcp-uat-execution/SKILL.md").read_text()
assert not re.search(r"clean\s*up\s*every\s*record", text, re.I), "auto-cleanup sentence must not exist"
required = [
    "Admission", "deployed full SHA", "migration ledger", "test identities",
    "access probes", "isolated browser contexts", "shared-write owner",
    "login → Member self-assessment", "Buddy review", "Buddy evidence review",
    "never a UAT pass", "read-only first", "Retry at most once",
    "zero execution and zero write", "isolates the lane", "pauses all writes",
    "OBSERVED_PASS", "Never auto-clean", "explicitly authorized operation",
]
missing = [m for m in required if m not in text]
assert not missing, f"missing markers: {missing}"
print("tcp-uat-execution self-check OK")
EOF
```

---
name: tcp-uat-execution
description: Optional TCP-specific UAT workflow — admission checks, business dependency graph, visible-UI execution, isolated identities/records/browser contexts/artifacts, serialized shared writes, checkpoint/handoff/evidence, unknown-write convergence, stall recovery. Composes the playwright-skill browser capability. Use for authorized UAT runs only, never for routine dev testing.
---

# TCP UAT Execution

Optional workflow for authorized end-to-end verification of a delivered TCP change. Invoke explicitly; do not auto-run.

## 1. Admission (all must hold)

- **A** — The change under test is a reviewed delivery tied to a GitHub Issue; the target SHA is pinned.
- **B** — Targeted/affected unit tests pass with evidence (see `.claude/rules/testing-and-evidence.md`).
- **C** — If the change includes schema/migration work, the migrations gate holds: red test, upgrade/fresh/idempotency verified, backup + ledger verified (see `.claude/rules/migrations.md`).

Any admission failure → stop and report; do not start UAT.

## 2. Business dependency graph

Test along the real business flow, in order:

Capability Model → Assessment → Gap Analysis → Growth Plan → Learning Task → Evidence → Buddy Review → Capability Profile

Each stage's output feeds the next. A failure at stage N blocks stages N+1… unless the change's scope explicitly excludes them.

## 3. Execution

- **Visible UI** — browsers run headless: false; UI evidence is screenshots, not DOM assertions.
- **Browser automation is delegated to the installed `playwright-skill` capability** (plugin identifier `playwright-skill@playwright-skill`). Use only its documented interface and helpers; do not copy or re-implement a general browser-testing skill.

## 4. Isolation

- Dedicated test identities and records, clearly marked as test data; clean up every record created — including on failure.
- Isolated browser contexts per scenario; no shared login state between scenarios.
- Artifacts and temp files stay in the skill-defined temp location; no repo or runtime writes without an explicit owner.

## 5. Serialized shared writes

- One designated owner performs all shared writes (records, evidence artifacts); everyone else reads only.
- Concurrent UAT sessions on the same data are not allowed — serialize or wait.

## 6. Checkpoint / handoff / evidence

- Checkpoint after each stage: state summary plus evidence (command, output, screenshot, SHA).
- Handoff: when ownership changes, hand over the checkpoint summary; the new owner verifies the state before writing.
- Evidence goes to the Issue comment; exact SHA required.

## 7. Unknown-write convergence

Any unexpected write to shared data or runtime state: stop, record what was observed, and converge with the write owner before continuing.

## 8. Stall recovery

Bounded retries with increasing waits. On repeated stall: produce a checkpoint and escalate to the user. Never silently "fix" the flow by skipping steps.

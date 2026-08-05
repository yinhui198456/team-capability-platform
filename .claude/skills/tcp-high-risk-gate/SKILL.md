---
name: tcp-high-risk-gate
description: Optional pre-merge gate for high-risk TCP changes — migrations, authorization, concurrency, atomicity, idempotency, compatibility, red tests — one risk-proportionate clean gate and stop-after-push evidence. Use before merging or pushing high-risk families; not for routine changes.
---

# TCP High-Risk Gate

Optional workflow for high-risk change families, run before merge/push. Invoke explicitly; do not auto-run.

## 1. Trigger families (any of)

- Migrations / schema changes
- Authorization or role logic (`backend/app/access`)
- Concurrency, locking, or shared-write behavior
- Atomicity / transactional integrity
- Idempotency (re-runs, double-apply, duplicate protection)
- API/contract compatibility (request/response shapes, DB constraints)

## 2. Gate steps

1. **Red test** — a failing test that demonstrates the defect the change fixes exists (or is added); it must fail against the pre-change code and pass on the changed code.
2. **Targeted checks** — run the directly affected tests with evidence.
3. **Affected checks** — run dependent modules' tests (see `.claude/rules/testing-and-evidence.md`).
4. **One clean gate** — run the designated gate exactly once after the final edit; no rerun-until-green. A flaky or failing gate is a finding, not a retry.
5. **Stop-after-push evidence** — after push, record in the Issue: SHA, gate result, residual risks. Do not silently proceed to deploy or close.

## 3. Decision

- Gate green → record evidence and stop. Deploy/UAT is not part of this gate; tcp-uat-execution's admission is the next step if UAT is requested.
- Gate red → stop: do not push or merge; report the failure with evidence.

---
description: Risk-proportionate test gates and evidence standards — exact-SHA, visible UI, executor self-report is not proof.
paths:
  - backend/tests/**
  - frontend/tests/**
  - frontend/src/**/*.test.*
---

# Testing & Evidence

## Risk-proportionate gates

- **Tier 1 — cosmetic/test-only**: a behavior/test-contract defect (visual, selector, copy, test expectation) needs a related check or regression that fails on the old version; a pure docs/formatting change needs only the exact checker plus diff review. Both run targeted/affected checks with same-SHA CI as the full gate — no local full E2E.
- **Tier 2 — ordinary page state / event-timing fixes**: component-level red test + directly related checks + one real API E2E + same-SHA CI.
- **Tier 3 — structural** (migration, authorization, concurrency, idempotency, test harness, cross-layer contract): one clean local full gate — the full unit suite (`pytest tests -q` / `npm test`) and, only when justified, the E2E gates — exactly once after the final edit; no rerun-until-green.
- Expensive stages (Tier 3 gates or long CI) document expected duration and monitoring thresholds before running; any retry requires proven zero execution and zero write.

## Evidence standards

- Every test claim carries the exact command, output excerpt, and the SHA of the code under test.
- UI verification requires a visible-browser run (headless: false, via the playwright-skill capability) with screenshots; DOM-only assertions are not UI evidence.
- Executor self-report is not final proof — a reproducible command with captured output is.
- Evidence lands in the task's declared authoritative location — the GitHub PR/Issue when applicable, plus versioned artifacts and check outputs — not only the chat.

## Red tests

- A defect fix is not done until a test that fails on the pre-change code exists and passes on the changed code.

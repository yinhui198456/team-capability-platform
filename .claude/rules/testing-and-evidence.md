---
description: Risk-proportionate test gates and evidence standards — exact-SHA, visible UI, executor self-report is not proof.
paths:
  - backend/tests/**
  - frontend/tests/**
  - frontend/src/**/*.test.*
---

# Testing & Evidence

## Risk-proportionate gates

- **Targeted** — low-risk, isolated change: run the directly affected tests only.
- **Affected** — change touches shared modules, contracts, or data: run the affected module's tests plus its direct dependents.
- **Full** — high-risk or cross-cutting change (authorization, migrations, core loop): run the full unit suite (`pytest tests -q` / `npm test`) and, only when justified, the E2E gates.

## Evidence standards

- Every test claim carries the exact command, output excerpt, and the SHA of the code under test.
- UI verification requires a visible-browser run (headless: false, via the playwright-skill capability) with screenshots; DOM-only assertions are not UI evidence.
- Executor self-report is not final proof — a reproducible command with captured output is.
- Evidence lands in the Issue comment, not only the chat.

## Red tests

- A defect fix is not done until a test that fails on the pre-change code exists and passes on the changed code.

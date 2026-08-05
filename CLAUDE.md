# Team Capability Platform (TCP)

## 1. Repository

- GitHub: https://github.com/yinhui198456/team-capability-platform
- This checkout may be the main repo or one of its declared worktrees under `/opt/personal-agent-workspace/worktrees/`.
- `runtime/` holds local runtime artifacts only — never a source of truth.

## 2. Product Boundary

TCP is not an LMS, not an exam platform, not a course manager, not a performance system.

Goal: continuous capability growth for engineering teams, driven by the capability model.

Core business loop — every feature serves it:

Capability Model → Assessment → Gap Analysis → Growth Plan → Learning Task → Evidence → Buddy Review → Capability Profile

## 3. Source of Truth

1. `capability-model/` — the authoritative Excel sources: capability model, levels, annual learning plan template. Business rules come from here; never invent new rules.
2. `docs/` — 01_Product.md (frozen business rules), 02_Design.md, 03_Data.md, 04_UI.md, 05_Development.md, 06_Roadmap.md.
3. `backend/` + `frontend/` — code must match the docs; code never leads design.

Read order depends on the task: for design-affecting work read README.md → 01_Product.md → 02_Design.md → 03_Data.md → 04_UI.md → 05_Development.md (plus capability-model/ when the capability model is involved). For code-only work, read the affected module plus 03_Data.md / 05_Development.md as needed — do not re-read every document each session.

## 4. Working Principles

- Understand first, design next, code last.
- Never guess business rules — when information is missing, list the questions.
- Design changes: update the Markdown first, then the code.
- Do not restructure the repository layout.
- Roles are fixed: Member, Buddy, Leader, Admin. Do not add roles.
- Do not add core business objects without stating the reason.
- One name per object: Growth Plan, Learning Task, Evidence, Buddy Review, Capability Profile.

## 5. Repository Layout

- `backend/` — FastAPI app (`backend/app/`), SQLAlchemy; pytest suite (`backend/tests/`); sequential SQL migrations (`backend/app/migrations/versions/vNNNN_*.py`, driven by `backend/app/migrations/runner.py`).
- `frontend/` — React + TypeScript + Ant Design Pro; Vitest unit tests co-located under `frontend/src/` (`*.test.tsx`); Playwright E2E under `frontend/tests/e2e/` (config `frontend/playwright.config.ts`).
- `docs/` — design docs and acceptance mapping.
- `capability-model/` — authoritative Excel sources.
- `scripts/` — local helper scripts.
- `runtime/` — local runtime artifacts.
- `compose.yaml` — local development services (Postgres etc.), development only.

## 6. Authoritative Commands

Backend (run from `backend/`):
- Format/lint gate: `ruff check app tests && black --check app tests`
- Full unit suite: `pytest tests -q`
- Focused: `pytest tests/test_<module>.py -v`

Frontend (run from `frontend/`):
- Unit: `npm test` (Vitest)
- E2E: `npm run test:e2e` (Playwright)
- Format/lint: project eslint/Prettier scripts

Migrations: add `backend/app/migrations/versions/vNNNN_<name>.py` and register it in `runner.py`; see `.claude/rules/migrations.md`.

## 7. Project Governance (`.claude/`)

Loaded automatically; read the relevant piece instead of duplicating it here:

- Rules — `.claude/rules/`: `delivery-boundaries.md` (global: repository/host boundaries, one writer, evidence, stop conditions), `backend.md`, `frontend.md`, `migrations.md`, `testing-and-evidence.md` (path-scoped).
- Skills — `.claude/skills/` (optional, invoked on demand): `tcp-uat-execution` (authorized UAT runs), `tcp-high-risk-gate` (pre-merge gate for high-risk families).
- Agents — `.claude/agents/` (read-only reviewers): `contract-reviewer`, `permission-concurrency-reviewer`, `test-gap-reviewer`.
- Enforcement — `.claude/settings.json` + `.claude/hooks/pretool-guard.sh`: PreToolUse hook that deterministically blocks destructive/out-of-repo Bash commands; browser automation comes from the installed `playwright-skill` plugin capability.

## 8. Delivery Rules (summary — full text in `.claude/rules/delivery-boundaries.md`)

- One writer per session/branch; never race writes on shared files or runtime data.
- Commits and PRs reference the related Issue; evidence goes into Issue comments, not chat alone.
- No automatic commit/push/merge/deploy; GitHub write operations follow the user-confirmed plan.
- Never touch another Issue's branch/PR, runtime data, containers, or databases.
- Never touch production; no force-push; no destructive DB or restore/rollback commands.
- Stop and ask when: credentials/MFA unavailable, production detected, a destructive reset/restore is requested, or schema/protocol cannot be verified without guessing.

## 9. Review Checklist

Before committing any change:

- Matches 01_Product.md and the capability model.
- No new business objects or roles; naming consistent with section 4.
- Migration rule satisfied when schema changes (red test, upgrade/fresh/idempotency, no auto rollback).
- Targeted/affected tests pass with exact-SHA evidence (see `testing-and-evidence.md`).
- No out-of-scope or cross-project files touched.

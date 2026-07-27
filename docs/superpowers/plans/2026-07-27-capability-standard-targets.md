# Capability Standard Targets Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement Issue #49 standard target resolution, immutable Assessment snapshots, reviewed personal adjustments, compatible migration, and minimal Leader/Member/Buddy UI.

**Architecture:** A shared backend rule module parses job-level ranges and resolves targets using applicability-first precedence. A normalized override table supplies Leader exceptions, while Assessment Detail stores immutable snapshots and retains `target_level` as the effective compatibility field. A small versioned migration runner upgrades existing PostgreSQL data without reseeding or rewriting historical targets.

**Tech Stack:** FastAPI, Pydantic, psycopg/PostgreSQL, React 18, TypeScript, Vitest, Playwright, Docker Compose.

---

### Task 1: Freeze business and technical contracts

**Files:**
- Modify: `docs/01_Product.md`
- Modify: `docs/02_Design.md`
- Modify: `docs/03_Data.md`
- Modify: `docs/04_UI.md`

- [ ] Add the default target mapping and applicability-first override rule to Product.
- [ ] Add target resolution, immutable snapshot, migration, and existing Buddy Review flow to Design.
- [ ] Add the override object, Assessment Detail snapshot fields, constraints, and legacy migration semantics to Data.
- [ ] Add the three-state Leader control, read-only standard target, Member adjustment fields, and Buddy display to UI.
- [ ] Run `rg -n "标准目标|个人调整|legacy_preserved" docs/0{1,2,3,4}_*.md` and verify every rule is traceable without mentioning Issue #50.

### Task 2: Add target rule tests and minimal resolver

**Files:**
- Create: `backend/app/catalog/standard_targets.py`
- Create: `backend/tests/test_standard_targets.py`

- [ ] Write failing parameterized tests for `P4`, `P4-P5`, `P4–P5`, `P6—P8`, reversed ranges, and malformed input.
- [ ] Run `cd backend && source .venv/bin/activate && pytest tests/test_standard_targets.py -q`; expect failures because the resolver does not exist.
- [ ] Implement `parse_earliest_level(value)` with a full-match regular expression and `resolve_standard_target(member_level, recommended, override_present, override_value)` with applicability-first precedence and the fixed default map.
- [ ] Run the same test command; expect all tests to pass.

### Task 3: Add versioned migration and compatibility tests

**Files:**
- Create: `backend/app/migrations/__init__.py`
- Create: `backend/app/migrations/runner.py`
- Create: `backend/app/migrations/versions/__init__.py`
- Create: `backend/app/migrations/versions/v0001_standard_targets.py`
- Create: `backend/tests/test_standard_target_migration.py`
- Modify: `backend/app/main.py`
- Modify: `backend/app/catalog/schema.py`
- Modify: `backend/app/assessment/schema.py`

- [ ] Write a failing migration test that creates the pre-Issue schema and rows for editable draft, pending review, and archived Assessments, then asserts idempotence, preserved non-null targets/Gaps, migrated editable null targets, and recorded migration version.
- [ ] Run `cd backend && source .venv/bin/activate && pytest tests/test_standard_target_migration.py -q`; expect missing migration runner/schema failures.
- [ ] Add `schema_migration`, `capability_standard_target_override`, and snapshot columns/check constraints. Represent row absence/default, numeric override, and stored-null/not-applicable distinctly.
- [ ] Implement an ordered migration registry. Apply each version once inside one transaction, preserve all existing non-null targets as `legacy_preserved`, and resolve only editable null-target drafts when current inputs are valid.
- [ ] Call the migration runner after base schema creation and before demo seed logic.
- [ ] Run the migration test twice against the same schema; expect no duplicate rows, reseed, historical rewrites, or errors.

### Task 4: Add Leader override API through TDD

**Files:**
- Modify: `backend/app/catalog/api.py`
- Modify: `backend/app/catalog/repository.py`
- Modify: `backend/tests/test_catalog_management.py`

- [ ] Add failing API tests for Leader create/update/clear override states, null as explicit not applicable, invalid level/value, lower-than-start rejection, malformed recommendation, non-Leader 403, and changing the start level with incompatible existing overrides.
- [ ] Run the targeted catalog tests and confirm the expected response/field failures.
- [ ] Extend model reads with `standard_target_overrides`; extend L3 update payloads with a full replacement map whose keys are P4-P8 and values are 1-5 or null.
- [ ] Validate the resulting recommendation plus overrides in the repository transaction, reject lower-level rows, and replace override rows atomically.
- [ ] Rerun targeted catalog tests; expect all to pass.

### Task 5: Generate Assessment snapshots through TDD

**Files:**
- Modify: `backend/app/assessment/api.py`
- Modify: `backend/app/assessment/repository.py`
- Modify: `backend/tests/test_assessment.py`
- Modify: `backend/tests/test_gap.py`

- [ ] Add failing tests for default mapping, Leader overrides, explicit not applicable, applicability precedence, missing Member target level, malformed recommendation, and snapshots unchanged after model/member changes.
- [ ] Run targeted Assessment and Gap tests; verify failures are caused by missing snapshot generation.
- [ ] On Assessment creation, require a Member target level, resolve every enabled L3 in one transaction, and store standard applicability/target, effective `target_level`, source, and null Gap for not-applicable rows.
- [ ] Log L3 parse failures and return a domain error that the API maps to 422 without leaving a partial Assessment.
- [ ] Exclude not-applicable details from Gap summary and Gap table generation.
- [ ] Rerun targeted tests; expect all to pass.

### Task 6: Validate and atomically save personal adjustments

**Files:**
- Modify: `backend/app/assessment/api.py`
- Modify: `backend/app/assessment/repository.py`
- Modify: `backend/tests/test_assessment.py`

- [ ] Add failing tests proving standard/effective target payload fields are rejected, applicable adjustments require value and trimmed reason, not-applicable adjustments/plan candidates are rejected, effective target and Gap are server-calculated, unknown/duplicate L3 rows reject the whole batch, and concurrent saves leave one complete batch.
- [ ] Run targeted tests and confirm the expected validation or atomicity failures.
- [ ] Replace the Member detail contract with current/evidence/plan/adjustment fields only and `extra="forbid"`.
- [ ] Lock the Assessment row `FOR UPDATE`, validate the complete code set before writes, calculate effective targets from stored snapshots, then update the batch in one transaction.
- [ ] Keep last-write-wins behavior while guaranteeing no partial mixed batch.
- [ ] Rerun targeted tests; expect all to pass.

### Task 7: Add minimal Leader, Member, and Buddy UI

**Files:**
- Modify: `frontend/src/catalog.ts`
- Modify: `frontend/src/CapabilityModelPage.tsx`
- Modify: `frontend/src/assessment.ts`
- Modify: `frontend/src/AssessmentGapPage.tsx`
- Modify: `frontend/src/AssessmentGapPage.module.css`
- Modify: `frontend/src/AssessmentReviewPage.tsx`
- Modify: `frontend/src/BuddyReviewCenter.tsx`
- Modify: `frontend/src/catalog.test.tsx`
- Modify: `frontend/src/assessment.test.tsx`
- Modify: `frontend/src/AssessmentReviewPage.test.tsx`
- Modify: `frontend/src/BuddyReviewCenter.test.tsx`

- [ ] Write failing Vitest cases for three-state overrides, disabled lower job levels, read-only standard target, applicable-only adjustment controls/reason, payload omission of target fields, and Buddy display of all snapshot fields.
- [ ] Run the four targeted test files and verify expected failures.
- [ ] Extend TypeScript contracts to match API nullability and snapshot fields exactly.
- [ ] Implement native select/checkbox/textarea controls in existing forms; do not add dependencies or restructure the page.
- [ ] Show `不适用` and `—` Gap for excluded rows and prevent plan-candidate selection.
- [ ] Run targeted tests, `npm run lint`, `npm run format:check`, and `npm run build`; expect clean results.

### Task 8: Add functional E2E and visual verification

**Files:**
- Create: `frontend/tests/e2e/features/capability-standard-targets.spec.ts`
- Update only if required by intentional UI changes: relevant UI-02/UI-04 snapshot PNG files.

- [ ] Add an E2E path that logs in as Leader, verifies lower-level controls are disabled and saves an applicable override; logs in as Member, creates an Assessment, sees read-only standard/not-applicable targets, submits an adjustment with reason; logs in as Buddy and sees the standard, adjustment, reason, effective target, and Gap.
- [ ] Run the new E2E test against Docker Compose without destructive volume commands.
- [ ] Run UI-02 and UI-04 visual specs. Inspect diffs; update only snapshots changed by the required fields and record the reason in the PR.

### Task 9: Full verification and Draft PR

**Files:**
- Review all changed files; do not stage `.claude/`.

- [ ] Run Backend: `cd backend && source .venv/bin/activate && ruff check app tests && black --check app tests && pytest tests -q`.
- [ ] Run Frontend: `cd frontend && npm run lint && npm run format:check && npm run test && npm run build`.
- [ ] Run E2E: `cd frontend && npm run test:e2e` without `docker compose down -v`.
- [ ] Run Docker test stage using the project Dockerfile and a non-destructive PostgreSQL service.
- [ ] Compare every Issue #49 acceptance item against tests and the final Diff; verify Issue #50 and unrelated navigation/layout files are absent.
- [ ] Stage explicit paths only, commit with Issue #49 references, push `feat/capability-standard-targets`, and create a Draft PR that includes migration/compatibility notes and exact test counts.
- [ ] Wait for Frontend Quality Gate, Backend Quality Gate, and E2E Tests; inspect any failure before reporting.

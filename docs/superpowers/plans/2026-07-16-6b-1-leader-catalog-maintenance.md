# TCP 6B-1 Leader Catalog Maintenance Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `subagent-driven-development` task by task. Keep this task on the approved `master` branch; the user explicitly authorized continuing 6B before the deferred 6A UAT.

**Goal:** Let a signed-in Leader maintain the existing capability-model details and learning-resource index at `/capability/model` and `/operations/resources`, without changing the frozen capability hierarchy or creating a course lifecycle.

**Architecture:** Extend the existing `catalog` module with narrowly-scoped, parameterized psycopg updates. Every mutation requires the effective `Leader` role through the existing cookie session dependency. Keep anonymous GET catalog routes working. The frontend reuses the existing catalog pages and only renders mutation controls after `/api/auth/me` proves the `Leader` role.

**Tech Stack:** Existing FastAPI, psycopg 3, PostgreSQL, React, TypeScript, Vite, Vitest. No new dependency, ORM, migration tool, router library, upload, or import endpoint.

## Constraints

- The user explicitly bypassed the 6A UAT *entry* gate for 6B development. 6A-4 remains pending user confirmation and must not be marked passed.
- Preserve the six enabled domains: `P01`, `P02`, `P03`, `C01`, `C02`, `C03`.
- Do not create, delete, re-parent, or renumber L1/L2/L3 nodes. Do not change model/version/source provenance. This is not online large-scale capability-model editing.
- A Leader may update an existing node's name, enabled flag, P4–P8 descriptions, and (for L3 only) recommended level, material text, expected output, estimated hours, and linked resource codes.
- A Leader may create, edit, and archive learning-resource indexes. `material_code` is immutable after creation; archiving changes `status` and does not delete the row or its L3 links.
- Links are only between existing L3 nodes and existing resources. Validate both sides and replace a resource's L3-link set atomically.
- `Member`, `Buddy`, anonymous callers, and an `Admin` without `Leader` remain unable to mutate the catalog (401/403 as applicable). Admin inherits this operation only when it has the Leader role.
- Keep resource listing/details and model viewing available to anonymous callers exactly as in Iteration 2.
- Do not add UI-05, team annual planning, user/role/settings management, charts, or UAT acceptance work.

## Task 1: Backend contracts, guarded mutation API, and tests

**Files:**
- Modify: `backend/app/catalog/api.py`, `backend/app/catalog/repository.py`
- Create: `backend/tests/test_catalog_management.py`

**Interfaces:**
- `PUT /api/capability-model/nodes/{node_code}` with a typed request body for the allowed existing-node fields.
- `POST /api/learning-resources` creates an indexed resource with `material_code`, `name`, `material_type`, `source_text`, `purpose`, `status`, and `l3_codes`.
- `PUT /api/learning-resources/{material_code}` updates the mutable fields and atomically replaces `l3_codes`; the URL code is immutable.
- `POST /api/learning-resources/{material_code}/archive` archives the resource by status change only.
- All four mutations depend on `require_any_role("Leader")`; GET behavior remains public.

- [ ] **RED:** Add API tests that seed the catalog plus access roles and prove: Leader can update an L3 and a domain description; invalid/unknown node, invalid level/parent-incompatible fields, unknown L3, duplicate resource code, and unsupported code fail; Leader can create/update/archive a resource and replace its L3 links; resource codes and hierarchy cannot be mutated; Member/Buddy/Admin-without-Leader get 403; anonymous requests get 401; anonymous GETs still return 200.
- [ ] **Implement:** Add Pydantic request models and parameterized repository operations. Use one transaction for each resource write and link replacement. For imported rows preserved as editable, retain their source provenance. New resources use explicit `manual` provenance values. Return the same catalog-shaped objects used by the existing GET views.
- [ ] **GREEN:** Run the targeted backend test file in the existing Compose test container. Commit only the backend module and test file as `feat: add leader catalog maintenance`.

## Task 2: Leader-gated catalog controls and frontend tests

**Files:**
- Modify: `frontend/src/App.tsx`, `frontend/src/catalog.ts`, `frontend/src/styles.css`, `frontend/src/catalog.test.tsx`

**Interfaces:**
- Extend `catalog.ts` with typed cookie-aware mutation helpers; every helper refreshes the relevant query state after success.
- The capability-model page exposes one compact edit form for the selected existing node only to a Leader.
- The resource page exposes create/edit/archive and L3 link selection only to a Leader. Non-Leader pages remain readable and show no mutation controls.

- [ ] **RED:** Add frontend tests mocking `/api/auth/me` for Leader, Member, and unauthenticated states. Prove Leader controls submit the exact endpoints/payloads and refresh their views; prove Member/anonymous callers see no edit/create/archive controls; preserve the existing catalog display/filter/detail tests.
- [ ] **Implement:** Reuse existing native React state and `useCatalog`; add no router, form, chart, or UI library. Label archive clearly and require a local confirmation click. Keep `material_code` read-only after creation.
- [ ] **GREEN:** Run `npm run test -- src/catalog.test.tsx`, then `npm run lint`, `npm run format:check`, and `npm run build`. Commit frontend changes as `feat: add leader catalog controls`.

## Task 3: Codex acceptance gate and board transition

- [ ] Wait for the CC task controller to reach a terminal state and inspect its run log; an empty live log is not progress evidence.
- [ ] Independently run the complete relevant backend suite, complete frontend test suite, lint, formatting check, production build, and `git diff --check`.
- [ ] Review the changed API for Leader-only mutation, immutable hierarchy/code constraints, atomic links, and preserved public GETs. If any check fails, return the concrete failure to the CC fixer; do not mark 6B-1 Done.
- [ ] Only after the independent gate passes, set 6B-1 to `Done`; leave 6B `In Progress`, 6A-4 `In Progress / 待用户确认 / 用户`, and all prior UAT cards unchanged.

## Operational safeguards used for this task

1. **History-first:** resolve scope from 01–05, Project cards, current Git state, and the previous CC run before asking any routine question.
2. **Single ownership:** start CC only through `scripts/tcp-taskctl.sh`; the board identifies the one active implementation owner and run log.
3. **Terminal reporting:** Codex does not yield a completion report while task state is `running`; only `completed` or `failed` plus inspected log is terminal.
4. **Independent acceptance:** CC's report means “implementation ready,” never “accepted.” Codex owns the full test/lint/format/build/diff gate and board Done transition.
5. **Explicit override record:** the UAT bypass is recorded on 6B, limited to development execution, and never converts a pending UAT into a passed UAT.

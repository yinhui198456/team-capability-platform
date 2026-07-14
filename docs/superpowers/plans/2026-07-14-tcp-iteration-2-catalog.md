# TCP Iteration 2 Catalog Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Import the fixed Excel capability catalog into four PostgreSQL tables and expose it through two anonymous read-only pages.

**Architecture:** A backend-only initialization importer atomically replaces the catalog from the two fixed workbooks. FastAPI serves the imported tree and resources through four GET routes; React renders those responses without any mutation controls. The backend image copies the root workbook directory via the one permitted build-context exception.

**Tech Stack:** FastAPI, PostgreSQL, Python Excel reader, React, TypeScript, Vite, Docker Compose.

## Global Constraints

- Import only `P01`, `P02`, `P03`, `C01`, `C02`, `C03`; accept 47 L2, 310 L3, and 95 unique resources after a valid import.
- Create exactly `capability_model`, `capability_node`, `learning_resource`, and `capability_node_resource` as catalog business tables.
- Preserve every L3 `materials_text` verbatim; unmatched codes and non-code text are visible warnings, never synthetic resources.
- Expose only the four specified GET routes; no catalog writes, uploads, accounts, assessments, plans, tasks, Evidence, or Reviews.
- Keep Compose services, ports, volumes, and health checks unchanged; only the backend build context/Dockerfile copy may change to include `capability-model/*.xlsx`.

---

### Task 1: Catalog schema and fixed-workbook importer

**Files:**
- Create: `backend/app/catalog/models.py`, `backend/app/catalog/importer.py`, `backend/tests/test_catalog_importer.py`
- Modify: `backend/app/main.py`, `backend/requirements.txt`

**Interfaces:**
- Produces: `import_catalog(workbook_dir: Path, session: Session) -> ImportReport` and `ImportReport(model_count: int, l1_count: int, l2_count: int, l3_count: int, resource_count: int, relation_count: int, unmatched_materials: list[str], errors: list[str])`.
- Persists: `capability_model`, `capability_node`, `learning_resource`, `capability_node_resource`; the importer commits once only after all validation succeeds.

- [ ] **RED:** add importer tests for the fixed files, six-domain tree, 47/310/95 baseline, preserved `materials_text`, unmatched `A8`, and rollback on an unknown L1; run `docker compose run --rm backend pytest tests/test_catalog_importer.py -q` and expect failure because the catalog module does not exist.
- [ ] **Implement:** define the four constrained ORM tables and one fixed-path importer. Validate every required source field before replacing the catalog in one transaction; create links only for indexed `Pxx-Mxxx`/`Cxx-Mxxx` codes and return the full report.
- [ ] **GREEN:** run `docker compose run --rm backend pytest tests/test_catalog_importer.py -q` and expect all importer assertions to pass.
- [ ] **Commit:** `git add backend/app backend/tests/test_catalog_importer.py backend/requirements.txt && git commit -m "feat: import capability catalog"`.

### Task 2: Read-only catalog API

**Files:**
- Create: `backend/app/catalog/api.py`, `backend/tests/test_catalog_api.py`
- Modify: `backend/app/main.py`

**Interfaces:**
- Consumes: imported `capability_model` graph and `learning_resource` rows.
- Produces: `GET /api/capability-model?domain_code={code}`, `GET /api/learning-resources?name={name}&status={status}&l3_code={l3_code}`, and `GET /api/learning-resources/{material_code}`; every response uses catalog-only fields.

- [ ] **RED:** add API tests for six-domain-only trees, domain/resource not-found responses, resource filters and reverse L3 links, empty links for valid unused resources, and `POST`/`PUT`/`PATCH`/`DELETE` method-not-allowed; run `docker compose run --rm backend pytest tests/test_catalog_api.py -q` and expect failure because the routes do not exist.
- [ ] **Implement:** add query serializers and GET-only FastAPI routes. Return L3 attributes, verbatim materials, linked-resource summaries, and unmatched-reference warnings; never expose or mutate non-catalog data.
- [ ] **GREEN:** run `docker compose run --rm backend pytest tests/test_catalog_api.py -q` and expect all API assertions to pass.
- [ ] **Commit:** `git add backend/app/main.py backend/app/catalog/api.py backend/tests/test_catalog_api.py && git commit -m "feat: expose read-only catalog api"`.

### Task 3: Read-only model and resource pages

**Files:**
- Modify: `frontend/src/App.tsx`, `frontend/src/styles.css`
- Create: `frontend/src/catalog.ts`, `frontend/src/catalog.test.tsx`

**Interfaces:**
- Consumes: `GET /api/capability-model` tree with L1 P4–P8 and L3 details, plus resource-list/detail responses from Task 2.
- Produces: anonymous routes `/capability/model` and `/operations/resources`, with tree expansion, resource name/status/L3 filters, resource detail, and L3 reverse links only.

- [ ] **RED:** add component tests proving both routes render catalog data and unmatched warnings while no edit, import, upload, delete, role-switch, assessment, plan, task, Evidence, Review, or user control is rendered; run `npm test -- --run src/catalog.test.tsx` in `frontend` and expect failure because the catalog views do not exist.
- [ ] **Implement:** add typed fetch helpers and the two route views in the existing app. Render the specified read-only fields and loading/not-found states with native controls; add no client mutation path or dependency.
- [ ] **GREEN:** run `npm test -- --run src/catalog.test.tsx` in `frontend` and expect all view assertions to pass.
- [ ] **Commit:** `git add frontend/src && git commit -m "feat: add read-only catalog pages"`.

### Task 4: Backend build context and end-to-end verification

**Files:**
- Modify: `compose.yaml`, `backend/Dockerfile`
- Create: `backend/tests/test_catalog_e2e.py`

**Interfaces:**
- Consumes: root `capability-model/*.xlsx` during backend image build and the Task 1 importer.
- Produces: a backend image containing both fixed workbooks and an end-to-end catalog import/API proof without changes to Compose services, ports, volumes, or health checks.

- [ ] **RED:** add an E2E test that imports from the image path and fetches the model/resources baseline; run `docker compose run --rm backend pytest tests/test_catalog_e2e.py -q` and expect failure because the image cannot access the root workbooks.
- [ ] **Implement:** set only the backend service build context to `.` with `dockerfile: backend/Dockerfile`, then copy `backend` and `capability-model` in the Dockerfile. Preserve every existing service name, port, volume, command, and health check.
- [ ] **GREEN:** run `docker compose config && docker compose build backend && docker compose run --rm backend pytest tests/test_catalog_e2e.py -q` and expect configuration, build, and E2E checks to pass.
- [ ] **Commit:** `git add compose.yaml backend/Dockerfile backend/tests/test_catalog_e2e.py && git commit -m "build: include fixed catalog workbooks"`.

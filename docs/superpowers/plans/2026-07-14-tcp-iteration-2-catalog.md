# TCP Iteration 2 Catalog Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Import the fixed Excel capability catalog into four PostgreSQL tables and expose it through two anonymous read-only pages.

**Architecture:** psycopg executes the four-table DDL and fixed-workbook import in one PostgreSQL transaction. FastAPI's lifespan creates the catalog schema and imports only when the catalog is empty; the router exposes only four GET routes. React renders those responses through same-origin `/api`, which Nginx and Vite proxy to `backend:8000` and `localhost:8000` respectively.

**Tech Stack:** FastAPI, psycopg 3, PostgreSQL, openpyxl, React, TypeScript, Vite, Vitest, Docker Compose.

## Global Constraints

- Import only `P01`, `P02`, `P03`, `C01`, `C02`, `C03`; accept 47 L2, 310 L3, and 95 unique resources after a valid import.
- Create exactly `capability_model`, `capability_node`, `learning_resource`, and `capability_node_resource` as catalog business tables.
- Preserve every L3 `materials_text` verbatim; unmatched codes and non-code text are visible warnings, never synthetic resources.
- Expose only the four specified GET routes; no catalog writes, uploads, accounts, assessments, plans, tasks, Evidence, or Reviews.
- Keep Compose services, ports, volumes, and health checks unchanged; only the backend build context/Dockerfile copy may change to include `capability-model/*.xlsx`.
- Add `openpyxl==3.1.5` to `backend/requirements.txt`; pin it exactly, matching the existing production dependency policy.
- Backend test precondition: `docker compose up -d postgres && until docker compose exec -T postgres pg_isready -U tcp -d tcp >/dev/null; do sleep 1; done`. Run backend tests with the repository mounted for test files and requirements: `docker compose run --rm -v "$PWD/backend:/workspace/backend:ro" -v "$PWD/capability-model:/capability-model:ro" backend sh -c "pip install -q -r /workspace/backend/requirements-dev.txt && cd /workspace/backend && PYTHONPATH=/workspace/backend pytest -q <test-path>"`.

---

### Task 1: psycopg schema, empty-catalog initialization, and fixed-workbook importer

**Files:**
- Create: `backend/app/catalog/schema.py`, `backend/app/catalog/repository.py`, `backend/app/catalog/importer.py`, `backend/tests/test_catalog_importer.py`
- Modify: `backend/app/main.py`, `backend/requirements.txt`

**Interfaces:**
- Produces: `create_catalog_schema(connection: psycopg.Connection) -> None`, `catalog_is_empty(connection: psycopg.Connection) -> bool`, `import_catalog(workbook_dir: Path, connection: psycopg.Connection) -> ImportReport`, and `ensure_catalog_initialized(connection: psycopg.Connection, workbook_dir: Path) -> ImportReport | None`.
- Persists: `capability_model`, `capability_node`, `learning_resource`, and `capability_node_resource` through parameterized psycopg SQL. `ensure_catalog_initialized` is called from FastAPI lifespan, creates the four tables, and imports only when `catalog_is_empty` is true; no HTTP route can invoke it.

- [ ] **RED:** add tests for fixed files, six domains, 47/310/95 baseline, verbatim `materials_text`, unmatched `A8`, unknown-L1 rollback, and a second lifespan initialization that does not reimport. Run the global backend precondition, then `docker compose run --rm -v "$PWD/backend:/workspace/backend:ro" -v "$PWD/capability-model:/capability-model:ro" backend sh -c "pip install -q -r /workspace/backend/requirements-dev.txt && cd /workspace/backend && PYTHONPATH=/workspace/backend pytest -q tests/test_catalog_importer.py"`; expect import errors because the catalog modules are absent.
- [ ] **Implement:** add `openpyxl==3.1.5`; create the four tables and importer with psycopg, `connection.transaction()`, fixed workbook paths, strict validation before replacement, and code-only resource links. Wire lifespan to initialize only an empty catalog at `/app/capability-model`.
- [ ] **GREEN:** repeat the RED command; expect importer, transaction, and no-reimport assertions to pass.
- [ ] **Commit:** `git add backend/app backend/tests/test_catalog_importer.py backend/requirements.txt && git commit -m "feat: import capability catalog"`.

### Task 2: Read-only catalog API

**Files:**
- Create: `backend/app/catalog/api.py`, `backend/tests/test_catalog_api.py`
- Modify: `backend/app/main.py`

**Interfaces:**
- Consumes: `get_capability_model(connection: psycopg.Connection, domain_code: str | None) -> dict[str, object] | None`, `list_learning_resources(connection: psycopg.Connection, name: str | None, status: str | None, l3_code: str | None) -> list[dict[str, object]]`, and `get_learning_resource(connection: psycopg.Connection, material_code: str) -> dict[str, object] | None` in `repository.py`.
- Produces: `GET /api/capability-model?domain_code={code}`, `GET /api/learning-resources?name={name}&status={status}&l3_code={l3_code}`, and `GET /api/learning-resources/{material_code}`; every response uses catalog-only fields.

- [ ] **RED:** add route tests for six-domain-only trees, domain/resource not-found, name/status/L3 filters, reverse links, valid unused resources, and 405 for `POST`/`PUT`/`PATCH`/`DELETE`. Run the global backend precondition, then `docker compose run --rm -v "$PWD/backend:/workspace/backend:ro" -v "$PWD/capability-model:/capability-model:ro" backend sh -c "pip install -q -r /workspace/backend/requirements-dev.txt && cd /workspace/backend && PYTHONPATH=/workspace/backend pytest -q tests/test_catalog_api.py"`; expect route-import failure.
- [ ] **Implement:** add parameterized psycopg repository queries, a connection dependency, and GET-only FastAPI routes. Return L3 attributes, original materials, linked-resource summaries, and unmatched warnings; do not define any write or import route.
- [ ] **GREEN:** repeat the RED command; expect all route and method assertions to pass.
- [ ] **Commit:** `git add backend/app/main.py backend/app/catalog/api.py backend/tests/test_catalog_api.py && git commit -m "feat: expose read-only catalog api"`.

### Task 3: Read-only model and resource pages

**Files:**
- Modify: `frontend/package.json`, `frontend/package-lock.json`, `frontend/vite.config.ts`, `frontend/nginx.conf`, `frontend/src/App.tsx`, `frontend/src/styles.css`
- Create: `frontend/src/catalog.ts`, `frontend/src/catalog.test.tsx`

**Interfaces:**
- Consumes: `GET /api/capability-model` tree with L1 P4–P8 and L3 details, plus resource-list/detail responses from Task 2.
- Produces: anonymous routes `/capability/model` and `/operations/resources`, with tree expansion, resource name/status/L3 filters, resource detail, and L3 reverse links only; browser `/api` is proxied by Nginx at port 18081 to `backend:8000` and by Vite to `http://localhost:8000`.

- [ ] **RED:** add only `vitest@^3.2.4`, `jsdom@^26.1.0`, and `@testing-library/react@^16.3.0` as dev dependencies, record their resolved versions in `package-lock.json`, and add the exact script `"test": "vitest run"`. Add component tests for both routes, unmatched warnings, and the absence of every mutation/other-domain control. Run `cd frontend && npm install --save-dev vitest@^3.2.4 jsdom@^26.1.0 @testing-library/react@^16.3.0 && npm run test -- src/catalog.test.tsx`; expect assertions to fail because the views are absent.
- [ ] **Implement:** configure Vitest's jsdom environment in `vite.config.ts`, typed `/api` fetch helpers, and the two route views. Dispatch on `window.location.pathname` in the existing `App` instead of adding a router dependency. Configure `nginx.conf` `location /api/` with `proxy_pass http://backend:8000;`; configure Vite `server.proxy['/api']` to `http://localhost:8000`; render no client mutation path.
- [ ] **GREEN:** run `cd frontend && npm ci && npm run test -- src/catalog.test.tsx && npm run build`; expect tests and production build to pass.
- [ ] **Commit:** `git add frontend/package.json frontend/package-lock.json frontend/vite.config.ts frontend/nginx.conf frontend/src && git commit -m "feat: add read-only catalog pages"`.

### Task 4: Backend build context and end-to-end verification

**Files:**
- Modify: `compose.yaml`, `backend/Dockerfile`
- Create: `backend/tests/test_catalog_e2e.py`

**Interfaces:**
- Consumes: root `capability-model/*.xlsx` during backend image build and the Task 1 importer.
- Produces: a backend image containing both fixed workbooks and an end-to-end catalog/API plus Nginx `/api` proxy proof without changes to Compose services, ports, volumes, or health checks.

- [ ] **RED:** add an E2E test that starts from `/app/capability-model` without a workbook bind mount and fetches the model/resources baseline. Run `docker compose build backend && docker compose up -d postgres && until docker compose exec -T postgres pg_isready -U tcp -d tcp >/dev/null; do sleep 1; done && docker compose run --rm -v "$PWD/backend:/workspace/backend:ro" backend sh -c "pip install -q -r /workspace/backend/requirements-dev.txt && PYTHONPATH=/app pytest -q /workspace/backend/tests/test_catalog_e2e.py"`; expect the image-path workbook assertion to fail.
- [ ] **Implement:** change only backend `build` to `context: .` and `dockerfile: backend/Dockerfile`; update the Dockerfile to copy `backend/requirements.txt`, `backend/app`, and `capability-model` into `/app`. Keep every Compose service, port, volume, command, and health check byte-for-byte unchanged outside the backend build stanza.
- [ ] **GREEN:** run `docker compose config && docker compose build backend && docker compose up -d postgres backend frontend && until docker compose exec -T postgres pg_isready -U tcp -d tcp >/dev/null; do sleep 1; done && docker compose run --rm -v "$PWD/backend:/workspace/backend:ro" backend sh -c "pip install -q -r /workspace/backend/requirements-dev.txt && PYTHONPATH=/app pytest -q /workspace/backend/tests/test_catalog_e2e.py" && curl -fsS http://localhost:18081/api/capability-model`; expect config/build/tests to pass and the final request to return the six-domain JSON through Nginx.
- [ ] **Commit:** `git add compose.yaml backend/Dockerfile backend/tests/test_catalog_e2e.py && git commit -m "build: include fixed catalog workbooks"`.

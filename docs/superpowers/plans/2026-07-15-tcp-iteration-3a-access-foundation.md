# TCP Iteration 3A Access Foundation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Establish the minimal access foundation for single-team UAT: built-in accounts, N:M effective roles, one primary Buddy per Member, HttpOnly cookie sessions, and 401/403 enforcement, while keeping the existing anonymous catalog GET routes available and changing CORS only enough to allow `POST`.

**Architecture:** A new `backend/app/access/` module uses raw psycopg 3 for schema, repository, and policy. FastAPI lifespan creates the access schema and seeds a fixed set of UAT-only demo accounts when `tcp_user` is empty. Authentication is stateful: the backend issues a random session token, stores only its SHA-256 digest in `tcp_session.token_hash`, returns the raw token only via `Set-Cookie: tcp_session=...; HttpOnly; SameSite=Lax; Path=/` (add `Secure` only when `session_cookie_secure=true`; default `false` for local HTTP UAT and required `true` for HTTPS deployments), and never exposes the token in JSON or localStorage. The repository hashes the raw token for `create_session`, `get_session_user`, and `delete_session`; no raw token column or index exists. Catalog routes stay unprotected; 401/403 is proven through a test-only FastAPI router/fixture, not through production `/api/demo/*` routes. The frontend adds a minimal `/login` page used only for UAT, leaving full UI-01/02/03/04/05 integration to later iterations.

**Tech Stack:** FastAPI, psycopg 3, PostgreSQL, Python 3.12 stdlib password hashing (`hashlib.scrypt`), React, TypeScript, Vite. No ORM, no Alembic, no SSO/OAuth, no registration, no password recovery, no new runtime dependencies.

**Baseline Read:** `AGENTS.md` does not exist in this repository; `CLAUDE.md` and `docs/01_Product.md`–`06_Roadmap.md` serve as the working baseline. `compose.yaml`, `backend/app`, `backend/tests`, and `frontend/src` were inspected to derive the exact file inventory and contracts below.

---

## Global Constraints

- **No new runtime dependencies.** `backend/requirements.txt` already contains `fastapi`, `psycopg[binary]`, `pydantic-settings`, `uvicorn[standard]`, `openpyxl`; do not add `passlib`, `bcrypt`, `alembic`, SQLAlchemy, or any auth library.
- **No ORM / no Alembic.** Schema evolution is explicit psycopg `CREATE TABLE IF NOT EXISTS` / `CREATE INDEX IF NOT EXISTS` in `backend/app/access/schema.py`, executed from FastAPI lifespan, exactly like `backend/app/catalog/schema.py`.
- **No SSO / no registration / no password recovery / no Admin management pages.** 3A only enables UAT login, logout, and current-identity read. Admin user/role CRUI remains in 6B per `docs/05_Development.md` §7.1.
- **No 3B scope.** Assessment, Assessment Review, Gap, and the annual-plan gating rule are out of scope; they depend on 3A Codex review passing.
- **Raw psycopg + `tcp_test` advisory lock.** All tests continue to use the existing `conftest.py` session-scoped advisory lock (`TEST_DATABASE_LOCK_KEY = 651042`) and the isolated `tcp_test` database.
- **Anonymous catalog stays available.** `GET /api/capability-model` and `GET /api/learning-resources*` remain callable without authentication.
- **CORS change is minimal.** Extend `allow_methods` from `["GET"]` to `["GET", "POST", "OPTIONS"]`; keep `allow_credentials=True`, `allow_origins=settings.cors_origin_list`, and `allow_headers=["*"]`.
- **Cookie only.** The session token never appears in JSON response bodies or `localStorage`. Frontend login uses `fetch(..., { credentials: 'include' })` and relies on the browser cookie store.
- **N:M roles.** A user can have any subset of `{Member, Buddy, Leader, Admin}`; effective permissions are the union of assigned roles. 3A only exposes the role list, not fine-grained resource permissions.
- **One primary Buddy per Member.** `buddy_relationship` enforces at most one active primary relationship per member through a partial unique index.
- **Session expiry.** Sessions carry `expires_at`; expired rows are rejected; logout deletes the row.

---

## Exact File Inventory

### New files

| Path | Responsibility |
|------|----------------|
| `backend/app/access/__init__.py` | Package marker. |
| `backend/app/access/schema.py` | DDL for `tcp_user`, `tcp_role`, `tcp_user_role`, `tcp_session`, `buddy_relationship`; role seed; idempotent `create_access_schema(connection)`. |
| `backend/app/access/security.py` | `hash_password(password, salt) -> str`, `verify_password(password, hash) -> bool` using `hashlib.scrypt` + `secrets.token_hex` salt; `generate_session_token() -> str`. |
| `backend/app/access/repository.py` | psycopg CRUD for users, roles, sessions, buddy relationships; lookup by token; delete expired sessions. |
| `backend/app/access/policies.py` | `get_current_user(request)`, `require_any_role(*roles)`, `require_authenticated` FastAPI dependencies; 401/403 logic. |
| `backend/app/access/api.py` | `POST /api/auth/login`, `POST /api/auth/logout`, `GET /api/auth/me`. |
| `backend/app/access/seed.py` | UAT-only demo account creation if `tcp_user` is empty; uses environment-provided plaintext passwords hashed at seed time. |
| `backend/tests/test_access_schema.py` | Schema creation and role baseline. |
| `backend/tests/test_access_auth.py` | Login/logout/me cookie flow, 401/403, session expiry. |
| `backend/tests/test_access_roles.py` | N:M role assignment and role-based access. |
| `backend/tests/test_access_buddy.py` | One-primary-Buddy invariant and buddy lookup. |
| `backend/tests/test_access_catalog_still_public.py` | Catalog GET remains public after auth middleware is installed. |
| `frontend/src/access.ts` | Types and `fetch` helpers (`login`, `logout`, `me`) that always send/accept cookies without touching `localStorage`. |
| `frontend/src/LoginPage.tsx` | Minimal UAT login form; on success navigates to `/capability/model` or reloads. |
| `frontend/src/access.test.tsx` | Vitest tests for the login helper and component. |

### Modified files

| Path | Change |
|------|--------|
| `backend/app/main.py` | Import and `app.include_router(access_router)`; extend CORS `allow_methods` to `["GET", "POST", "OPTIONS"]`; call `create_access_schema` and seed demo accounts in lifespan after catalog initialization. |
| `backend/app/settings.py` | Add `session_cookie_secure: bool = False`, `session_max_age_seconds: int = 86400`, `demo_account_passwords_json: str | None = None`, and keep existing `database_url`, `cors_origins`, `port`. Parse `demo_account_passwords_json` explicitly as JSON; missing or invalid values fail fast. |
| `backend/app/catalog/api.py` | No route changes; keep catalog endpoints unprotected. |
| `frontend/src/App.tsx` | Add `/login` route branch; preserve `/capability/model` and `/operations/resources`; after login, redirect to `/capability/model`. |
| `frontend/src/styles.css` | Add minimal login form layout without changing catalog styles. |

### Not changed

- `compose.yaml` services, ports, volumes, health checks.
- `backend/Dockerfile`, `backend/requirements.txt`.
- `backend/app/catalog/schema.py`, `repository.py`, `importer.py`.
- Catalog page components and existing catalog tests.

---

## Database Schema Contract (psycopg)

`create_access_schema(connection: psycopg.Connection) -> None` creates the following tables and indexes idempotently.

### Tables

```sql
CREATE TABLE IF NOT EXISTS tcp_user (
    id BIGINT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
    username TEXT NOT NULL UNIQUE,
    full_name TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS tcp_role (
    id BIGINT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
    code TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS tcp_user_role (
    user_id BIGINT NOT NULL REFERENCES tcp_user(id) ON DELETE CASCADE,
    role_id BIGINT NOT NULL REFERENCES tcp_role(id) ON DELETE CASCADE,
    PRIMARY KEY (user_id, role_id)
);

CREATE TABLE IF NOT EXISTS tcp_session (
    id BIGINT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
    token_hash TEXT NOT NULL UNIQUE,
    user_id BIGINT NOT NULL REFERENCES tcp_user(id) ON DELETE CASCADE,
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS buddy_relationship (
    id BIGINT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
    member_id BIGINT NOT NULL REFERENCES tcp_user(id) ON DELETE CASCADE,
    buddy_id BIGINT NOT NULL REFERENCES tcp_user(id) ON DELETE CASCADE,
    effective_from DATE NOT NULL DEFAULT CURRENT_DATE,
    effective_to DATE,
    is_primary BOOLEAN NOT NULL DEFAULT TRUE,
    CHECK (member_id <> buddy_id)
);
```

### Indexes

```sql
CREATE INDEX IF NOT EXISTS idx_session_token_hash ON tcp_session(token_hash);
CREATE INDEX IF NOT EXISTS idx_session_expires ON tcp_session(expires_at);
CREATE UNIQUE INDEX IF NOT EXISTS unique_active_primary_buddy
    ON buddy_relationship(member_id)
    WHERE is_primary = TRUE AND effective_to IS NULL;
```

### Role seed

`create_access_schema` inserts the four fixed roles if `tcp_role` is empty:

| code | name |
|------|------|
| `Member` | Member |
| `Buddy` | Buddy |
| `Leader` | Leader |
| `Admin` | Admin |

---

## Repository / Policy / API Contract

### `backend/app/access/security.py`

```python
def hash_password(password: str, salt: str | None = None) -> str: ...
def verify_password(password: str, hashed: str) -> bool: ...
def generate_session_token() -> str: ...
def hash_session_token(token: str) -> str: ...
```

- Hash format: `f"{salt}${scrypt_hash}"`, salt 32 hex chars, scrypt uses `n=2**14, r=8, p=1` via `hashlib.scrypt`.
- `verify_password` splits on `$`, recomputes the hash, and compares with `secrets.compare_digest`.
- `generate_session_token` returns a 32-byte (64 hex char) high-entropy random token using `secrets.token_hex(32)`.
- `hash_session_token` returns the lowercase hex SHA-256 digest of the raw token. Only this digest is stored in `tcp_session.token_hash`; the raw token exists only in the `tcp_session` cookie.

### `backend/app/access/repository.py`

```python
def create_user(
    connection: psycopg.Connection,
    username: str,
    full_name: str,
    password: str,
    is_active: bool = True,
) -> int: ...

def assign_role(
    connection: psycopg.Connection, user_id: int, role_code: str
) -> None: ...

def get_user_with_roles(
    connection: psycopg.Connection, user_id: int
) -> dict[str, object] | None: ...

def get_user_by_username(
    connection: psycopg.Connection, username: str
) -> dict[str, object] | None: ...

def create_session(
    connection: psycopg.Connection, user_id: int, max_age_seconds: int
) -> str: ...

def get_session_user(
    connection: psycopg.Connection, token: str
) -> dict[str, object] | None: ...

def delete_session(connection: psycopg.Connection, token: str) -> None: ...

def delete_expired_sessions(connection: psycopg.Connection) -> None: ...

def create_buddy_relationship(
    connection: psycopg.Connection,
    member_id: int,
    buddy_id: int,
    is_primary: bool = True,
) -> int: ...

def get_primary_buddy(
    connection: psycopg.Connection, member_id: int
) -> dict[str, object] | None: ...

def get_assigned_members(
    connection: psycopg.Connection, buddy_id: int
) -> list[dict[str, object]]: ...
```

- `create_session` generates a raw random token, hashes it with SHA-256, stores the digest in `tcp_session.token_hash`, and returns the raw token to the caller (the API sets it as the cookie value).
- `get_session_user` and `delete_session` receive the raw token from the cookie, hash it with SHA-256, and query/delete by `token_hash`. No raw token is ever stored or indexed.
- `create_buddy_relationship` first verifies `member_id` has the `Member` role and `buddy_id` has the `Buddy` role; raises `ValueError` if either role check fails.

### `backend/app/access/policies.py`

```python
async def current_user(
    request: Request, connection: Connection
) -> dict[str, object]: ...

def require_authenticated() -> Depends: ...
def require_any_role(*role_codes: str) -> Depends: ...
```

- `current_user` reads `tcp_session` from the `tcp_session` cookie, computes `SHA-256` of the raw token to look up `tcp_session.token_hash`, validates expiry, and returns the user dict with `roles` list.
- Missing/invalid/expired cookie → 401 `{"detail": "not authenticated"}`.
- `require_any_role("Buddy", "Leader")` returns 403 `{"detail": "insufficient permissions"}` if the authenticated user has none of the requested roles.

### `backend/app/access/api.py`

| Method | Route | Auth | Request | Response |
|--------|-------|------|---------|----------|
| `POST` | `/api/auth/login` | public | `{"username": "...", "password": "..."}` | `200` + `Set-Cookie: tcp_session=...; HttpOnly; SameSite=Lax; Path=/; Max-Age=<seconds>` (+ `Secure` when `session_cookie_secure=true`) + body `{"id": ..., "username": "...", "full_name": "...", "roles": ["..."]}` |
| `POST` | `/api/auth/logout` | authenticated | — | `200` + `Set-Cookie: tcp_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0` (+ `Secure` when `session_cookie_secure=true`) + body `{"ok": true}` |
| `GET`  | `/api/auth/me` | authenticated | — | `200` + `{"id": ..., "username": "...", "full_name": "...", "roles": ["..."], "primary_buddy": {...} | null, "assigned_members": [...]}` |

- Login failures return `401` with `{"detail": "invalid credentials"}`.
- The `tcp_session` cookie value is never returned in the JSON body.

### Testing 401/403

401/403 behavior is verified through a **test-only FastAPI router/fixture** or direct dependency tests. No `/api/demo/*` routes ship in production.

---

## Frontend Contract

### `frontend/src/access.ts`

```typescript
export type User = {
  id: number
  username: string
  full_name: string
  roles: string[]
}

export async function login(username: string, password: string): Promise<User>
export async function logout(): Promise<void>
export async function me(): Promise<User>
```

- All helpers call `fetch('/api/auth/...', { method, credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: ... })`.
- No `localStorage` / `sessionStorage` access for tokens.
- On 401 from `me()`, the caller may redirect to `/login`.

### `frontend/src/LoginPage.tsx`

- Minimal form: username, password, submit.
- On success, reload the page or set `window.location.href = '/capability/model'`.
- On error, show the message from the backend detail.
- No token display.

### `frontend/src/App.tsx`

```typescript
if (pathname === '/login') return <LoginPage />
```

Preserve existing `/capability/model` and `/operations/resources` branches.

---

## Demo Accounts & UAT

`backend/app/access/seed.py` seeds the following accounts only when `tcp_user` is empty at lifespan startup. Passwords are read from the environment variable `TCP_DEMO_PASSWORDS` as a complete JSON string, e.g.:

```bash
TCP_DEMO_PASSWORDS='{"admin":"admin","leader":"leader","buddy":"buddy","member":"member","member2":"member2"}'
```

There is **no fallback or default password set**. `seed.py` explicitly parses the JSON with `json.loads`, validates that **all five** usernames (`admin`, `leader`, `buddy`, `member`, `member2`) are present with non-empty string passwords, and aborts seed/startup if the configuration is missing, malformed, or incomplete. Deployments inject this value at runtime via a secret manager or `.env` file that is not committed to the repository. The seed hashes passwords via `hash_password` before insertion.

| Username | Roles | Primary Buddy | Purpose |
|----------|-------|---------------|---------|
| `admin` | `Admin`, `Leader`, `Member` | — | Full system access for setup/UAT. |
| `leader` | `Leader`, `Member` | — | Demonstrates Leader + Member permission stacking. |
| `buddy` | `Buddy`, `Member` | — | Reviews assigned members. |
| `member` | `Member` | `buddy` | Standard Member with a Buddy. |
| `member2` | `Member` | `buddy` | Second Member to prove one Buddy can have many Members. |

`GET /api/auth/me` for `buddy` returns `assigned_members: ["member", "member2"]`; for `member` it returns `primary_buddy: { username: "buddy", full_name: "..." }`.

---

## Task Breakdown: TDD RED-GREEN

### Task 1: Access schema and role baseline

**Files:**
- Create: `backend/app/access/__init__.py`, `backend/app/access/schema.py`, `backend/tests/test_access_schema.py`
- Modify: `backend/app/main.py` (lifespan call only)

**Interfaces:**
- `create_access_schema(connection: psycopg.Connection) -> None`
- Idempotent creation of `tcp_user`, `tcp_role`, `tcp_user_role`, `tcp_session`, `buddy_relationship`, indexes, and the four fixed roles.

- [ ] **RED:** add `test_access_schema.py` asserting that after `create_access_schema` the four roles exist and the schema can be called twice without error. Run the global backend precondition, then `docker compose run --rm -v "$PWD/backend:/workspace/backend:ro" -v "$PWD/capability-model:/capability-model:ro" backend sh -c "pip install -q -r /workspace/backend/requirements-dev.txt && cd /workspace/backend && PYTHONPATH=/workspace/backend pytest -q tests/test_access_schema.py"`; expect import/schema errors because the module is absent.
- [ ] **Implement:** create `backend/app/access/schema.py` with the DDL and role seed; call it from `app.main.lifespan` after `create_catalog_schema`.
- [ ] **GREEN:** repeat the RED command; expect role and idempotency assertions to pass.
- [ ] **Commit:** `git add backend/app/access backend/tests/test_access_schema.py backend/app/main.py && git commit -m "feat: add access schema and role baseline"`.

### Task 2: Password hashing and session repository

**Files:**
- Create: `backend/app/access/security.py`, `backend/app/access/repository.py`, `backend/tests/test_access_repository.py`
- Modify: `backend/app/settings.py`

**Interfaces:**
- `hash_password(password, salt=None)`, `verify_password(password, hashed)`, `generate_session_token()`
- Repository functions listed in §Repository / Policy / API Contract.

- [ ] **RED:** add repository tests for user CRUD, role assignment, session creation/lookup/expiry/deletion, and buddy one-primary invariant. Run `docker compose run --rm -v "$PWD/backend:/workspace/backend:ro" -v "$PWD/capability-model:/capability-model:ro" backend sh -c "pip install -q -r /workspace/backend/requirements-dev.txt && cd /workspace/backend && PYTHONPATH=/workspace/backend pytest -q tests/test_access_repository.py"`; expect module import failures.
- [ ] **Implement:** implement `security.py` with `hashlib.scrypt` and `secrets`; implement `repository.py` with parameterized psycopg queries; add `session_cookie_secure` and `session_max_age_seconds` to settings; parse `demo_account_passwords_json` explicitly.
- [ ] **GREEN:** repeat the RED command; expect user, session, and buddy assertions to pass.
- [ ] **Commit:** `git add backend/app/access/security.py backend/app/access/repository.py backend/app/settings.py backend/tests/test_access_repository.py && git commit -m "feat: access security and repository"`.

### Task 3: Auth API with HttpOnly cookie

**Files:**
- Create: `backend/app/access/policies.py`, `backend/app/access/api.py`, `backend/tests/test_access_auth.py`
- Modify: `backend/app/main.py` (include router, extend CORS)

**Interfaces:**
- `POST /api/auth/login`, `POST /api/auth/logout`, `GET /api/auth/me`
- `current_user` dependency; `require_authenticated`, `require_any_role` helpers.

- [ ] **RED:** add tests that login sets an `HttpOnly` `tcp_session` cookie, returns user without a token, rejects bad passwords with 401, `/api/auth/me` returns 401 without a cookie, logout clears the cookie, and expired sessions are rejected. Run `docker compose run --rm -v "$PWD/backend:/workspace/backend:ro" -v "$PWD/capability-model:/capability-model:ro" backend sh -c "pip install -q -r /workspace/backend/requirements-dev.txt && cd /workspace/backend && PYTHONPATH=/workspace/backend pytest -q tests/test_access_auth.py"`; expect route failures.
- [ ] **Implement:** build `policies.py` and `api.py`; wire the router in `main.py`; change CORS `allow_methods` to `["GET", "POST", "OPTIONS"]`; set the `Secure` cookie attribute based on `settings.session_cookie_secure` (false for local HTTP UAT, true for HTTPS deployments).
- [ ] **GREEN:** repeat the RED command; expect all cookie, 401, and expiry assertions to pass.
- [ ] **Commit:** `git add backend/app/access/policies.py backend/app/access/api.py backend/tests/test_access_auth.py backend/app/main.py && git commit -m "feat: auth api with httponly cookie"`.

### Task 4: N:M roles and 403 policy

**Files:**
- Create: `backend/tests/test_access_roles.py`
- Modify: `backend/app/access/policies.py` (if `require_any_role` not fully implemented)

**Interfaces:**
- Direct `require_any_role` dependency tests or a test-only FastAPI router/fixture; no production `/api/demo/*` endpoints.

- [ ] **RED:** add tests for `require_any_role` directly or via a test-only fixture: a user with only `Member` requesting a Leader-protected operation receives 403, a user with `Leader` succeeds, and an `Admin` without `Leader` receives 403. Run `docker compose run --rm -v "$PWD/backend:/workspace/backend:ro" -v "$PWD/capability-model:/capability-model:ro" backend sh -c "pip install -q -r /workspace/backend/requirements-dev.txt && cd /workspace/backend && PYTHONPATH=/workspace/backend pytest -q tests/test_access_roles.py"`; expect 403 logic missing.
- [ ] **Implement:** complete `require_any_role`; exercise it through test-only fixtures, not production routes.
- [ ] **GREEN:** repeat the RED command; expect 401/403 role assertions to pass.
- [ ] **Commit:** `git add backend/app/access/policies.py backend/app/access/api.py backend/tests/test_access_roles.py && git commit -m "feat: enforce n:m role based 403"`.

### Task 5: One-primary-Buddy relationship

**Files:**
- Create: `backend/tests/test_access_buddy.py`

**Interfaces:**
- `create_buddy_relationship`, `get_primary_buddy`, `get_assigned_members`.

- [ ] **RED:** add tests that creating a second active primary Buddy for the same Member raises a unique violation, that `member` resolves `buddy` as primary Buddy, that `buddy` lists `[member, member2]`, and that creating a relationship fails when the member does not have the `Member` role or the buddy does not have the `Buddy` role. Run `docker compose run --rm -v "$PWD/backend:/workspace/backend:ro" -v "$PWD/capability-model:/capability-model:ro" backend sh -c "pip install -q -r /workspace/backend/requirements-dev.txt && cd /workspace/backend && PYTHONPATH=/workspace/backend pytest -q tests/test_access_buddy.py"`; expect repository not yet used.
- [ ] **Implement:** ensure the partial unique index in schema.py is created; verify `create_buddy_relationship` checks roles before inserting; verify repository functions return the correct shape.
- [ ] **GREEN:** repeat the RED command; expect buddy relationship assertions to pass.
- [ ] **Commit:** `git add backend/tests/test_access_buddy.py backend/app/access/schema.py backend/app/access/repository.py && git commit -m "feat: primary buddy relationship"`.

### Task 6: Anonymous catalog remains public

**Files:**
- Create: `backend/tests/test_access_catalog_still_public.py`

**Interfaces:**
- `GET /api/capability-model` and `GET /api/learning-resources*` stay callable without a session.

- [ ] **RED:** add tests that catalog GET requests return 200 without any cookie and that write methods still return 405. Run `docker compose run --rm -v "$PWD/backend:/workspace/backend:ro" -v "$PWD/capability-model:/capability-model:ro" backend sh -c "pip install -q -r /workspace/backend/requirements-dev.txt && cd /workspace/backend && PYTHONPATH=/workspace/backend pytest -q tests/test_access_catalog_still_public.py"`; expect tests to pass because catalog routes are unchanged (RED only if a route was accidentally protected).
- [ ] **Implement:** confirm `backend/app/catalog/api.py` has no auth dependencies; remove any accidental protection.
- [ ] **GREEN:** repeat the RED command; expect 200 for anonymous GET and 405 for writes.
- [ ] **Commit:** `git add backend/tests/test_access_catalog_still_public.py && git commit -m "test: confirm catalog stays public under auth"`.

### Task 7: Demo account seed and UAT smoke

**Files:**
- Create: `backend/app/access/seed.py`, `backend/tests/test_access_seed.py`
- Modify: `backend/app/main.py` (call seed from lifespan)

**Interfaces:**
- `seed_demo_accounts(connection: psycopg.Connection) -> None` inserts the five demo accounts, assigns roles, and creates buddy relationships only when `tcp_user` is empty.

- [ ] **RED:** add tests that seed runs idempotently (second run does not duplicate), passwords verify, roles are assigned, and buddy relationships are created. Run `docker compose run --rm -v "$PWD/backend:/workspace/backend:ro" -v "$PWD/capability-model:/capability-model:ro" -e TCP_DEMO_PASSWORDS='{"admin":"admin","leader":"leader","buddy":"buddy","member":"member","member2":"member2"}' backend sh -c "pip install -q -r /workspace/backend/requirements-dev.txt && cd /workspace/backend && PYTHONPATH=/workspace/backend pytest -q tests/test_access_seed.py"`; expect seed module missing.
- [ ] **Implement:** create `seed.py` and call it from lifespan after schema creation; read `TCP_DEMO_PASSWORDS` via `settings.demo_account_passwords_json` and parse it explicitly with `json.loads`; validate all five usernames with non-empty passwords and abort seed/startup if the configuration is missing, malformed, or incomplete.
- [ ] **GREEN:** repeat the RED command; expect idempotent seed, login with seeded passwords, and buddy assignments to pass.
- [ ] **Commit:** `git add backend/app/access/seed.py backend/tests/test_access_seed.py backend/app/main.py && git commit -m "feat: seed uat demo accounts"`.

### Task 8: Minimal frontend login page

**Files:**
- Create: `frontend/src/access.ts`, `frontend/src/LoginPage.tsx`, `frontend/src/access.test.tsx`
- Modify: `frontend/src/App.tsx`, `frontend/src/styles.css`

**Interfaces:**
- `login`, `logout`, `me` helpers; `/login` route; no token in localStorage.

- [ ] **RED:** add component and helper tests asserting that `login` calls `/api/auth/login` with `credentials: 'include'`, does not write to `localStorage`, and that `LoginPage` renders username/password inputs. Run `cd frontend && npm run test -- src/access.test.tsx`; expect failures because files are absent.
- [ ] **Implement:** create the helpers and page; add `/login` branch to `App.tsx`; add minimal login CSS.
- [ ] **GREEN:** repeat the RED command; expect tests to pass.
- [ ] **Commit:** `git add frontend/src/access.ts frontend/src/LoginPage.tsx frontend/src/access.test.tsx frontend/src/App.tsx frontend/src/styles.css && git commit -m "feat: minimal uat login page"`.

---

## Integration & UAT Verification

After all tasks are GREEN, run the integration suite:

```bash
# 1. Validate schema and all access tests
docker compose up -d postgres
until docker compose exec -T postgres pg_isready -U tcp -d tcp >/dev/null; do sleep 1; done
docker compose run --rm -v "$PWD/backend:/workspace/backend:ro" -v "$PWD/capability-model:/capability-model:ro" -e TCP_DEMO_PASSWORDS='{"admin":"admin","leader":"leader","buddy":"buddy","member":"member","member2":"member2"}' backend sh -c "pip install -q -r /workspace/backend/requirements-dev.txt && cd /workspace/backend && PYTHONPATH=/workspace/backend pytest -q tests/"

# 2. Build and run full stack
docker compose build backend frontend
docker compose up -d
until curl -fsS http://localhost:18001/ready >/dev/null; do sleep 1; done

# 3. UAT smoke: anonymous catalog still works
curl -fsS http://localhost:18081/api/capability-model | jq '.domains | length'
# expected: 6

# 4. UAT smoke: login returns HttpOnly cookie (local HTTP omits Secure)
curl -fsS -c /tmp/tcp_uat_cookies.txt -X POST http://localhost:18081/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"username":"member","password":"member"}' | jq '.roles'
# expected: ["Member"]
grep -q 'HttpOnly' /tmp/tcp_uat_cookies.txt && echo 'cookie is HttpOnly'
# HTTPS deployments must also set session_cookie_secure=true and verify Secure is present.

# 5. UAT smoke: /api/auth/me with cookie returns identity
curl -fsS -b /tmp/tcp_uat_cookies.txt http://localhost:18081/api/auth/me | jq '.primary_buddy.username'
# expected: "buddy"

# 6. UAT smoke: logout clears cookie
curl -fsS -b /tmp/tcp_uat_cookies.txt -c /tmp/tcp_uat_cookies.txt -X POST http://localhost:18081/api/auth/logout
curl -fsS -b /tmp/tcp_uat_cookies.txt http://localhost:18081/api/auth/me
# expected: 401

# 7. Frontend UAT: open http://localhost:18081/login, sign in as leader/leader, verify redirect to /capability/model
```

---

## Self-Review Checklist (before final commit)

- [ ] Every new file in the inventory exists and is tracked.
- [ ] `backend/requirements.txt` is unchanged (no new runtime dependencies).
- [ ] `backend/app/main.py` still calls catalog lifespan first, then access schema, then demo seed.
- [ ] CORS `allow_methods` is exactly `["GET", "POST", "OPTIONS"]`.
- [ ] No token appears in `/api/auth/login` or `/api/auth/me` JSON bodies.
- [ ] `tcp_session` stores only SHA-256 digests (`token_hash`); raw tokens exist only in cookies.
- [ ] `tcp_session` cookie attributes include `HttpOnly`, `SameSite=Lax`, `Path=/`; `Secure` is present only when `session_cookie_secure=true`.
- [ ] Demo password seeding has no fallback defaults; missing/invalid `TCP_DEMO_PASSWORDS` fails fast.
- [ ] No `/api/demo/*` routes exist in production; 401/403 tests use test-only fixtures or direct dependency tests.
- [ ] `GET /api/capability-model` and `GET /api/learning-resources*` require no cookie.
- [ ] `POST /api/auth/login` and `POST /api/auth/logout` work cross-origin from `http://localhost:5173` and `http://localhost:18081`.
- [ ] N:M role assignment is tested; role union is used for 403.
- [ ] One-primary-Buddy partial unique index is present and tested.
- [ ] All tests pass under the existing `tcp_test` advisory-lock fixture.
- [ ] `git diff --check` reports no trailing whitespace or conflict markers.

---

## Out of Scope (3B and beyond)

- Assessment, Assessment Review, Gap calculation, and the annual-plan gating rule.
- Admin user/role CRUD pages.
- Password reset, registration, email verification, SSO.
- Fine-grained object-level permissions beyond role checks.
- Full navigation layout and role-based menus (UI-01/02/03/04/05 integration).

These remain strictly in later iterations per `docs/05_Development.md` and `docs/06_Roadmap.md`.

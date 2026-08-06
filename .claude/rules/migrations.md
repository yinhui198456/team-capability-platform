---
description: TCP database migration and schema-change rules — red test first, upgrade/fresh/idempotency, non-target preservation, no automatic rollback.
paths: backend/app/migrations/**
---

# Migrations

Migrations are sequential files `backend/app/migrations/versions/vNNNN_<name>.py` registered in `backend/app/migrations/runner.py`. Target schema must match docs/03_Data.md.

## Required before a migration is accepted

1. **Red test** — a failing test demonstrating the pre-migration behavior gap exists first.
2. **Upgrade path** — applying the migration on an already-upgraded database yields the target schema and preserves existing data semantics.
3. **Fresh path** — the full migration chain runs cleanly on a fresh database.
4. **Idempotency** — re-running the migration is safe (no duplicate rows, no double-apply errors).
5. **Non-target preservation** — tables, columns, and data outside the migration's declared scope are untouched.

## Before any authorized UAT execution

- Confirm a backup of the affected data exists and is verified restorable.
- Confirm the migration ledger/version state is recorded and matches that backup.

## Forbidden

- Automatic rollback or restore as part of the migration flow (rollback is manual and reviewed only).
- Schema changes without the red test and the checks above.
- Mutating shared/dev databases outside the authorized test environment.

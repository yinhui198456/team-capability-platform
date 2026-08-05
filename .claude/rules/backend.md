---
description: TCP backend (FastAPI + SQLAlchemy) implementation and test conventions.
paths: backend/**
---

# Backend

## Structure

- `backend/app/` — application modules: `access` (auth/authz), `assessment`, `catalog`, `planning`, `migrations`.
- `backend/app/main.py` — FastAPI entry.
- `backend/tests/` — pytest suite; `conftest.py` provides fixtures.

## Conventions

- Follow the existing module structure; do not restructure.
- API and data behavior must match docs/01_Product.md and docs/03_Data.md.
- Keep the unified naming: Growth Plan, Learning Task, Evidence, Buddy Review, Capability Profile.

## Tests

- Run focused tests first: `pytest tests/test_<module>.py -v` from `backend/`.
- Format/lint gate before commit: `ruff check app tests && black --check app tests`.
- Evidence for any claim: exact command, output excerpt, and the SHA under test (see testing-and-evidence.md).
- Run the full suite (`pytest tests -q`) only when the change's reach justifies the full gate (see testing-and-evidence.md).

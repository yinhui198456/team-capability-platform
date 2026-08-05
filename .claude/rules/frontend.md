---
description: TCP frontend (React + TypeScript + Ant Design Pro) implementation and test conventions.
paths: frontend/**
---

# Frontend

## Structure

- `frontend/src/` — React/TS source; Vitest unit tests co-located (`*.test.tsx`).
- `frontend/tests/e2e/` — Playwright E2E (smoke, functional, evidence, visual); config `frontend/playwright.config.ts`.

## Conventions

- Follow existing page/module patterns and naming; do not restructure.
- UI must match docs/04_UI.md; behavior must match docs/01_Product.md.

## Tests

- Unit: `npm test` from `frontend/`; co-located tests change with the code.
- E2E: delegate browser automation to the installed `playwright-skill` capability — do not hand-roll new browser tooling or copy general browser-testing skills.
- Evidence: exact command, output excerpt, and SHA; UI evidence requires a visible-browser run with screenshots attached to the Issue (see testing-and-evidence.md).

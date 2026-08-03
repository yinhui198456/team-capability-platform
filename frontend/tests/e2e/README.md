# E2E Tests

This directory contains Playwright end-to-end and visual-regression tests for the TCP frontend.

## Prerequisites

```bash
npm run test:e2e:install
```

## Run against Docker Compose

The default `playwright.config.ts` points to `http://localhost:18081` and will start Docker Compose automatically unless `PLAYWRIGHT_NO_WEBSERVER=1` is set.

```bash
npm run test:e2e
```

## Run against local Vite dev server

```bash
npm run dev
# in another terminal
PLAYWRIGHT_BASE_URL=http://localhost:5173 PLAYWRIGHT_NO_WEBSERVER=1 npm run test:e2e
```

## Update visual regression baselines

```bash
npm run test:e2e:update-snapshots
```

## Debug

```bash
npm run test:e2e:ui
npm run test:e2e:debug
```

## Official container baseline (canonical, matches `.github/workflows/e2e.yml`)

Visual baselines and green-run evidence are recorded in the official Playwright image against a fresh Compose stack, so CI and local runs share browser, fonts and locale:

```bash
docker compose up -d --build   # wait for backend /ready
docker run --rm --network host -v "$PWD/frontend:/app" -w /app \
  -e PLAYWRIGHT_NO_WEBSERVER=1 -e TCP_E2E_ISOLATED=1 \
  mcr.microsoft.com/playwright:v1.61.1-jammy \
  bash -c "apt-get update && apt-get install -y fonts-noto-cjk && npm ci && npx playwright test"
```

Inside a Docker network (no `--network host`), frontend and backend URLs must share one origin because cookies are scoped per domain: `PLAYWRIGHT_BASE_URL=http://frontend PLAYWRIGHT_BACKEND_URL=http://frontend` (nginx proxies `/api`).

## Directory layout

- `fixtures/` — shared helpers: `auth.ts` (role-based login + default API routes), `buddy-review-mock.ts`, `capability-map-mock.ts`, `growth-profile-mock.ts`, `team-analytics-mock.ts`.
- `smoke/` — quick health checks and issue-scoped real-API chains that require a running environment (`issue-61-assessment`, `issue-62-buddy-review`, `issue-63-execution-evidence`, …).
- `features/` — feature-level specs (assessment scope/draft repair, capability map, growth profile, member dashboard stages, …).
- `functional/` — cross-role functional flows (`four-role-core.spec.ts`).
- `evidence/` — recorded run evidence (e.g. `issue50`).
- `visual/` — screenshot-based visual regression for UI-01 ~ UI-06 prototype pages.

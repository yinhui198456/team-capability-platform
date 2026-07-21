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

## Directory layout

- `fixtures/` — shared helpers such as role-based login.
- `smoke/` — quick health checks that require a running environment.
- `visual/` — screenshot-based visual regression for UI-01 ~ UI-06 prototype pages.

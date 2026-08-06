#!/usr/bin/env node
// Focused non-network regression for frontend/tests/e2e/fixtures/auth.ts.
//
// Validation must reject missing / whitespace-only TCP_E2E_DEMO_PASSWORD, but
// the exported DEMO_PASSWORD must be the exact raw environment value: leading
// or trailing whitespace is part of the credential and must stay identical to
// DEMO_SEED_PASSWORD. No credential value is ever printed.
//
// Needs Node >= 22.6 (type stripping). Run from the frontend directory:
//   node tests/e2e/fixtures/auth.transport.test.mjs
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const frontendRoot = fileURLToPath(new URL('../../..', import.meta.url))
const moduleUrl = new URL('./auth.ts', import.meta.url).href

function runWith(envValue) {
  const env = { ...process.env }
  if (envValue !== undefined) env.TCP_E2E_DEMO_PASSWORD = envValue
  const code = `
    import(${JSON.stringify(moduleUrl)})
      .then((m) => process.stdout.write(JSON.stringify(m.DEMO_PASSWORD)))
      .catch((err) => {
        process.stderr.write(String((err && err.message) || err))
        process.exit(3)
      })
  `
  return spawnSync(
    process.execPath,
    ['--experimental-strip-types', '--input-type=module', '-e', code],
    {
      cwd: frontendRoot,
      env,
      encoding: 'utf8',
    },
  )
}

const CONTROLLED_ERROR = 'TCP_E2E_DEMO_PASSWORD is required for E2E demo logins'

// 1. A valid raw value must be exported byte-for-byte: leading/trailing
//    whitespace, quotes, backslashes, tabs, newlines, and Unicode.
const raw = '  p"w\\d \t\n你 好  '
const ok = runWith(raw)
if (ok.status !== 0) {
  console.error(`FAIL: valid raw value rejected (status ${ok.status})`)
  process.exit(1)
}
if (JSON.parse(ok.stdout) !== raw) {
  console.error(
    'FAIL: exported DEMO_PASSWORD was normalized; must be the raw env value',
  )
  process.exit(1)
}

// 2. Missing value must fail immediately with the controlled error.
const missing = runWith(undefined)
if (missing.status !== 3 || !missing.stderr.includes(CONTROLLED_ERROR)) {
  console.error(
    'FAIL: missing TCP_E2E_DEMO_PASSWORD did not fail with the controlled error',
  )
  process.exit(1)
}

// 3. Whitespace-only value must fail immediately with the controlled error.
const blank = runWith(' \t ')
if (blank.status !== 3 || !blank.stderr.includes(CONTROLLED_ERROR)) {
  console.error(
    'FAIL: whitespace-only TCP_E2E_DEMO_PASSWORD did not fail with the controlled error',
  )
  process.exit(1)
}

// 4. Structural static assertion: the exported binding is the raw value, not
//    the output of a normalization call such as trim().
const src = readFileSync(new URL('./auth.ts', import.meta.url), 'utf8')
if (!src.includes('export const DEMO_PASSWORD')) {
  console.error('FAIL: DEMO_PASSWORD export missing from auth.ts')
  process.exit(1)
}
if (/export const DEMO_PASSWORD = [^;]*\.trim\(\)/.test(src)) {
  console.error(
    'FAIL: exported DEMO_PASSWORD is normalized (trim); must stay raw',
  )
  process.exit(1)
}

console.log(
  'PASS: fixture validates missing/blank but exports the exact raw credential',
)

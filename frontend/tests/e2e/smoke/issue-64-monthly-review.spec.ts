/** Issue #64: Monthly Review write-failure paths — real-API E2E.

  Phase 1 contract: the monthly review page must consume the new
  GET/PUT contract, and on 409/422/403 keep the typed input and allow a
  precise retry (fresh revision for CAS retries).  The six-state summary,
  estimated/actual hours and revision history are covered by component
  tests with contract-shaped fixtures; this spec exercises the failure
  paths against the REAL backend:

  - E2E-64-01: first-create CAS race through the UI — the page holds
    revision 0 ("未创建"), a concurrent writer creates v1, the member's
    save is a real 409; input is preserved, "重新加载最新版本" refreshes
    the revision without dropping the draft, and the retry succeeds with
    the fresh expected_revision.  This is the P1-3 concurrency fix's
    user-visible path.
  - E2E-64-02: a real 422 from backend field validation (3000-char cap)
    keeps the input; after fixing it, the exact retry succeeds.
  - E2E-64-03: a Member-less Leader can read its own review but its PUT
    is a real 403 — no partial write, input kept.

  Isolation contract (same as issue-61/62/63): each scenario owns a fixed
  unique slot per attempt.  The FRONTEND only accepts years returned by
  /api/planning/available-years (unknown years are redirected to the
  active year), so isolation uses the active year with a per-attempt
  MONTH: months [5,7,8] for retry 0, [9,10,11] for retry 1, [12,1,2] for
  retry 2, [3,4,6] for retry 3 (month 6 is skipped on the first pass — it
  carries residue on long-lived local volumes).  For repeated local
  reruns on a persistent volume, shift the whole range with
  E2E64_MONTH_BASE (e.g. 9).  Writes go through the REAL API (page.request
  shares the cookie jar of the logged-in page).
 */

import { expect, test } from '@playwright/test'
import type { APIRequestContext, Page } from '@playwright/test'

import { loginAs } from '../fixtures/auth'

const BACKEND = process.env.PLAYWRIGHT_BACKEND_URL ?? 'http://localhost:18001'

const MONTH_BASE = Number(process.env.E2E64_MONTH_BASE ?? 5)

/** Offset per scenario slot: [0, 2, 3, 4, …, 1] so consecutive attempts
  never reuse a month within a 12-month cycle. */
const SLOT_OFFSETS = [0, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 1]

function monthFor(tag: string, retry: number): number {
  const n = Number(tag.replace('E2E-64-', ''))
  if (!Number.isInteger(n) || n < 1 || n > 3) {
    throw new Error(`unexpected scenario tag: ${tag}`)
  }
  const idx = n - 1 + retry * 3
  if (!Number.isInteger(retry) || retry < 0 || idx > 11) {
    throw new Error(`unexpected retry: ${retry}`)
  }
  return ((MONTH_BASE - 1 + SLOT_OFFSETS[idx]) % 12) + 1
}

/** The frontend only renders years it knows about; the active year is the
  one the app redirects unknown ?year= values to. */
async function fetchActiveYear(request: APIRequestContext): Promise<number> {
  const resp = await request.get(`${BACKEND}/api/planning/available-years`)
  expect(resp.ok()).toBeTruthy()
  const body = await resp.json()
  const active = body.active_year
  expect(Number.isInteger(active)).toBeTruthy()
  return active
}

async function openMonthlyReview(
  page: Page,
  year: number,
  month: number,
): Promise<void> {
  await page.goto(`/growth/review/monthly?year=${year}&month=${month}`)
  await expect(page.getByRole('heading', { name: '月度复盘' })).toBeVisible()
  await expect(page.getByTestId('current-revision')).toContainText('未创建')
}

/** The page keeps the draft on failure; on retry the PUT must carry the
  fresh revision.  Returns {revision, main_output, history} of the row. */
async function fetchReview(
  request: APIRequestContext,
  year: number,
  month: number,
): Promise<{
  written: {
    revision: number
    main_output: string | null
    notes: string | null
  } | null
  history: {
    revision: number
    main_output: string | null
    notes: string | null
  }[]
}> {
  const resp = await request.get(
    `${BACKEND}/api/planning/monthly-reviews?year=${year}&month=${month}`,
  )
  expect(resp.ok()).toBeTruthy()
  const body = await resp.json()
  return {
    written: body.written
      ? {
          revision: body.written.revision,
          main_output: body.written.main_output,
          notes: body.written.notes,
        }
      : null,
    history: body.history.map(
      (entry: {
        revision: number
        main_output: string | null
        notes: string | null
      }) => ({
        revision: entry.revision,
        main_output: entry.main_output,
        notes: entry.notes,
      }),
    ),
  }
}

test('E2E-64-01 首次创建并发竞态：409 保留输入、刷新修订号、精确重试成功', async ({
  page,
}, testInfo) => {
  test.setTimeout(120_000)
  const request = page.request
  await loginAs(page, 'member')
  const year = await fetchActiveYear(request)
  const month = monthFor('E2E-64-01', testInfo.retry)

  // The member's page holds "未创建" (revision 0) for a fresh year+month.
  // The six-state summary renders from the real backend, whatever its
  // contents (fresh CI databases have no plan items; long-lived volumes
  // may carry real plan data for the active year).
  await openMonthlyReview(page, year, month)
  const summary = page.getByTestId('monthly-summary')
  for (const key of [
    '计划',
    '已完成',
    '进行中',
    '延期',
    '暂停',
    '取消',
    '完成率',
    '预计耗时',
    '实际耗时',
  ]) {
    await expect(summary).toContainText(key)
  }

  // …while a concurrent writer creates v1 through the real API.
  const create = await request.put(
    `${BACKEND}/api/planning/monthly-reviews?year=${year}&month=${month}`,
    {
      data: {
        main_output: '并发写入 v1',
        problems: null,
        next_month_focus: null,
        notes: null,
        expected_revision: 0,
      },
    },
  )
  expect(create.status()).toBe(200)

  // The stale save is a real 409: alert shown, typed input preserved.
  const draft = 'E2E-64-01 冲突后的草稿'
  await page.getByLabel('本月主要产出').fill(draft)
  await page.getByRole('button', { name: '保存月度复盘' }).click()
  await expect(page.getByRole('alert')).toContainText('版本冲突')
  await expect(page.getByLabel('本月主要产出')).toHaveValue(draft)

  // Precise retry: reload the latest revision without dropping the draft.
  await page.getByRole('button', { name: '重新加载最新版本' }).click()
  await expect(page.getByTestId('current-revision')).toContainText('v1')
  await expect(page.getByLabel('本月主要产出')).toHaveValue(draft)

  // Retry now carries the fresh expected_revision and lands as v2.
  await page.getByRole('button', { name: '保存月度复盘' }).click()
  await expect(page.getByTestId('current-revision')).toContainText('v2')
  await expect(page.getByRole('alert')).toBeHidden()

  // Immutable history: v1 is the concurrent writer's row, v2 the retry.
  const review = await fetchReview(request, year, month)
  expect(review.written?.revision).toBe(2)
  expect(review.history.map((h) => h.revision)).toEqual([1, 2])
  expect(review.history[0].main_output).toBe('并发写入 v1')
  expect(review.history[1].main_output).toBe(draft)
})

test('E2E-64-02 字段超长 422：保留输入，修正后精确重试成功', async ({
  page,
}, testInfo) => {
  test.setTimeout(120_000)
  const request = page.request
  await loginAs(page, 'member')
  const year = await fetchActiveYear(request)
  const month = monthFor('E2E-64-02', testInfo.retry)

  // Month slots are best-effort isolation: a long-lived volume may already
  // hold a review for this year+month (run 31410105797 collided on v1
  // residue and saw a 409 instead of the expected 422).  Drive every
  // assertion from the before state instead of assuming written=null.
  const before = await fetchReview(request, year, month)
  await page.goto(`/growth/review/monthly?year=${year}&month=${month}`)
  await expect(page.getByRole('heading', { name: '月度复盘' })).toBeVisible()
  await expect(page.getByTestId('current-revision')).toContainText(
    before.written ? `v${before.written.revision}` : '未创建',
  )

  const tooLong = 'a'.repeat(3001)
  await page.getByLabel('备注').fill(tooLong)
  await page.getByRole('button', { name: '保存月度复盘' }).click()
  await expect(page.getByRole('alert')).toContainText(
    'must be a string of at most 3000 characters',
  )
  await expect(page.getByLabel('备注')).toHaveValue(tooLong)
  // No partial write: written and history are exactly the before state.
  expect(await fetchReview(request, year, month)).toEqual(before)

  // Fix the input; the exact retry succeeds with the same in-memory revision.
  const fixed = 'E2E-64-02 修正'
  await page.getByLabel('备注').fill(fixed)
  await page.getByRole('button', { name: '保存月度复盘' }).click()
  const expectedRevision = (before.written?.revision ?? 0) + 1
  await expect(page.getByTestId('current-revision')).toContainText(
    `v${expectedRevision}`,
  )
  await expect(page.getByRole('alert')).toBeHidden()
  const review = await fetchReview(request, year, month)
  expect(review.written?.revision).toBe(expectedRevision)
  expect(review.written?.notes).toBe(fixed)
  // Immutable history: exactly one entry appended, carrying the fixed notes.
  expect(review.history).toHaveLength(before.history.length + 1)
  expect(review.history.slice(0, before.history.length)).toEqual(before.history)
  expect(review.history[before.history.length].revision).toBe(expectedRevision)
  expect(review.history[before.history.length].notes).toBe(fixed)
})

const LEADER_RO = { username: 'e2e64_leader_ro', password: '123456' }

/** Create (idempotently) a Leader-only user — no Member role, so its PUT
  is a real 403 while its self-read stays allowed. */
async function ensureLeaderOnlyUser(page: Page): Promise<void> {
  await loginAs(page, 'admin')
  const createResp = await page.request.post(`${BACKEND}/api/system/users`, {
    data: {
      username: LEADER_RO.username,
      full_name: 'E2E64 Leader RO',
      password: LEADER_RO.password,
      is_active: true,
      roles: ['Leader'],
      current_level: null,
      target_level: null,
    },
  })
  // 201 on first run, 422 (already exists) on retries — both acceptable
  expect([200, 201, 422]).toContain(createResp.status())
}

test('E2E-64-03 非 Member 角色写入 403：保留输入、无部分写入', async ({
  page,
}, testInfo) => {
  test.setTimeout(120_000)
  const request = page.request
  // The active year must be read with a Member session (the endpoint is
  // Member-only); the Leader-only user cannot query it.
  await loginAs(page, 'member')
  const year = await fetchActiveYear(request)
  await ensureLeaderOnlyUser(page)
  const month = monthFor('E2E-64-03', testInfo.retry)

  await page.request.post('/api/auth/logout')
  await page.goto('/login')
  await page.getByLabel('用户名').fill(LEADER_RO.username)
  await page.getByLabel('密码').fill(LEADER_RO.password)
  await page.getByRole('button', { name: '登录' }).click()
  await page.waitForURL((url) => url.pathname === '/operations/analytics')

  // A Leader may read their own monthly review…
  await openMonthlyReview(page, year, month)

  // …but the write is a real 403: alert shown, typed input preserved.
  const draft = 'E2E-64-03 无权限写入'
  await page.getByLabel('本月主要产出').fill(draft)
  await page.getByRole('button', { name: '保存月度复盘' }).click()
  await expect(page.getByRole('alert')).toContainText(
    'insufficient permissions',
  )
  await expect(page.getByLabel('本月主要产出')).toHaveValue(draft)

  // No partial write: the row is still absent for this year+month.
  expect((await fetchReview(request, year, month)).written).toBeNull()
})

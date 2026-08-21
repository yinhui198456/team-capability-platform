/** Issue #61 — assessment page visual regression tests.
 *
 * Issue #194 P1: 权威原型 M02 V1 四区能力项行合法替代原七列表格——
 * 本 spec 改为在三个常见视口验证四区行头、无横向溢出与行内评级/计划
 * 操作可达。
 *
 * Determinism contract:
 * - AssessmentGapPage loads the editable draft (status 草稿/建议调整) whose
 *   year matches the URL/year context, so this suite renders its dedicated
 *   year-2280 draft regardless of other open drafts.
 * - Other suites occupy 2026 (seed), 2201-2218, 2261-2270 and 2311-2315,
 *   so pinning any of those years would drift with their leftovers.
 * - This spec therefore creates (or reuses) its own dedicated draft for
 *   year 2280 via the real API — the same business-key contract as the
 *   smoke suites — before loading the page.
 */

import { expect, test, type Page } from '@playwright/test'

import { loginAs } from '../fixtures/auth'

const VIEWPORTS = [
  { width: 1280, height: 800, label: '1280x800' },
  { width: 1440, height: 900, label: '1440x900' },
  { width: 1920, height: 1080, label: '1920x1080' },
] as const

const BACKEND = process.env.PLAYWRIGHT_BACKEND_URL ?? 'http://localhost:18001'

// Dedicated year: collides with no other suite (seed=2026, smoke=2201-2218,
// 2261-2270, 2311-2315) and exists in available_years once the draft is
// created, so YearContext never redirects away from it.
const VISUAL_YEAR = 2280

async function ensureVisualDraft(page: Page): Promise<void> {
  const previewResp = await page.request.get(
    `${BACKEND}/api/assessments/scope-preview?year=${VISUAL_YEAR}&assessment_type=年度`,
  )
  expect(previewResp.ok()).toBeTruthy()
  const preview = await previewResp.json()

  const listResp = await page.request.get(`${BACKEND}/api/assessments`)
  expect(listResp.ok()).toBeTruthy()
  const list = await listResp.json()
  const existing = list.find(
    (a: { year: number; assessment_type: string; status: string }) =>
      a.year === VISUAL_YEAR &&
      a.assessment_type === '年度' &&
      ['草稿', '建议调整'].includes(a.status),
  )
  if (existing) return

  const createResp = await page.request.post(`${BACKEND}/api/assessments`, {
    data: {
      year: VISUAL_YEAR,
      assessment_type: '年度',
      scope_token: preview.scope_token,
    },
  })
  expect(createResp.ok()).toBeTruthy()
}

test.describe('Issue #61 — assessment page visual', () => {
  for (const vp of VIEWPORTS) {
    test(`M02 four-zone rows at ${vp.label} — no horizontal overflow`, async ({
      page,
    }) => {
      await page.setViewportSize({ width: vp.width, height: vp.height })
      await loginAs(page, 'member')
      await ensureVisualDraft(page)

      // The URL pin is accepted (2280 exists in available_years) and selects
      // this spec's dedicated draft rather than another year's open draft.
      await page.goto(`/capability/assessment?year=${VISUAL_YEAR}`)
      await expect(page).toHaveURL(new RegExp(`[?&]year=${VISUAL_YEAR}`))
      await expect(page.getByTestId('scope-header')).toHaveCount(0)

      // Issue #194 P1: 权威原型 M02 V1 四区行头合法替代 #61 七列表头。
      const table = page.getByTestId('assessment-table').first()
      const headers = table.locator('[class*="abilityHead"] > span')
      await expect(headers).toHaveCount(4)
      await expect(headers.nth(0)).toHaveText('能力项')
      await expect(headers.nth(1)).toHaveText('当前评级')
      await expect(headers.nth(2)).toHaveText('目标与差距')
      await expect(headers.nth(3)).toHaveText('提升计划')

      // Verify no horizontal overflow on the page
      const bodyWidth = await page.evaluate(() => document.body.scrollWidth)
      const viewportWidth = await page.evaluate(() => window.innerWidth)
      expect(bodyWidth).toBeLessThanOrEqual(viewportWidth + 1)

      // 评级与计划操作仍在能力项行内可达（原「计划时间」列的等价合同）。
      await expect(
        page.getByRole('button', { name: '保存能力评级' }),
      ).toBeVisible()
      await expect(
        page.locator('[aria-label^="当前等级"]').first(),
      ).toBeVisible()

      // Take screenshot
      await expect(page).toHaveScreenshot(
        `assessment-m02-four-zone-${vp.label}.png`,
        { fullPage: false },
      )
    })
  }
})

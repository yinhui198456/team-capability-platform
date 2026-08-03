/** Issue #61 — assessment page visual regression tests.
 *
 * Verifies 7-column table layout at three common viewport sizes,
 * checking that no horizontal overflow occurs and the plan-time
 * column is visible.
 *
 * Determinism contract:
 * - AssessmentGapPage ignores the URL year and always loads the NEWEST
 *   open draft (status 草稿/建议调整) of the logged-in member, so the
 *   screenshot content is whatever the newest draft is in the shared DB.
 * - Other suites occupy 2026 (seed), 2201-2218, 2261-2270 and 2311-2315,
 *   so pinning any of those years would drift with their leftovers.
 * - This spec therefore creates (or reuses) its own dedicated draft for
 *   year 2280 via the real API — the same business-key contract as the
 *   smoke suites — before loading the page. Created last, it is the
 *   newest draft, hence the page's guaranteed content source.
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
    test(`7-column table at ${vp.label} — no horizontal overflow`, async ({
      page,
    }) => {
      await page.setViewportSize({ width: vp.width, height: vp.height })
      await loginAs(page, 'member')
      await ensureVisualDraft(page)

      // The page loads the newest open draft; ours (created last) is it.
      // The URL pin is accepted (2280 exists in available_years), and the
      // scope header proves the rendered content is the dedicated draft.
      await page.goto(`/capability/assessment?year=${VISUAL_YEAR}`)
      await expect(page).toHaveURL(new RegExp(`[?&]year=${VISUAL_YEAR}`))
      const scopeHeader = page.getByTestId('scope-header')
      await expect(scopeHeader).toContainText(`${VISUAL_YEAR} 年度`)

      // Verify 7-column headers
      const headers = page.locator('thead th')
      await expect(headers).toHaveCount(7)

      // Verify no horizontal overflow on the page
      const bodyWidth = await page.evaluate(() => document.body.scrollWidth)
      const viewportWidth = await page.evaluate(() => window.innerWidth)
      expect(bodyWidth).toBeLessThanOrEqual(viewportWidth + 1)

      // Verify plan time column (column 7) is visible
      const planTimeHeader = page.getByText('计划时间')
      await expect(planTimeHeader).toBeVisible()

      // Take screenshot
      await expect(page).toHaveScreenshot(`assessment-7col-${vp.label}.png`, {
        fullPage: false,
      })
    })
  }
})

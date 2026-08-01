/** Issue #61 — assessment page visual regression tests.
 *
 * Verifies 7-column table layout at three common viewport sizes,
 * checking that no horizontal overflow occurs and the plan-time
 * column is visible.
 */

import { expect, test, type Page } from '@playwright/test'

import { loginAs } from '../fixtures/auth'

const VIEWPORTS = [
  { width: 1280, height: 800, label: '1280x800' },
  { width: 1440, height: 900, label: '1440x900' },
  { width: 1920, height: 1080, label: '1920x1080' },
] as const

const BACKEND = process.env.PLAYWRIGHT_BACKEND_URL ?? 'http://localhost:18001'

const VISUAL_YEAR = 2271

async function ensureAssessmentDraft(page: Page): Promise<void> {
  // Pin a fixed isolated year so the 7-column table content is deterministic
  // regardless of other suites' leftover drafts in the shared database.
  await page.goto(`/capability/assessment?year=${VISUAL_YEAR}`)
  await page.waitForLoadState('networkidle')

  // If already on the assessment form (no preview button), we're done
  const previewBtn = page.getByRole('button', { name: '预览评估范围' })
  if (!(await previewBtn.isVisible().catch(() => false))) {
    return
  }

  // Check for existing draft via API — if one exists, use it
  const listResp = await page.request.get(`${BACKEND}/api/assessments`)
  if (listResp.ok()) {
    const list = await listResp.json()
    const existing = list.find((a: { status: string }) =>
      ['draft', 'open'].includes(a.status),
    )
    if (existing) {
      // Navigate to the existing draft
      await page.goto(`/capability/assessment?id=${existing.id}`)
      await page.waitForLoadState('networkidle')
      return
    }
  }

  // Create a new draft via preview
  await previewBtn.click()
  await page.waitForTimeout(2000)

  const createBtn = page.getByRole('button', { name: /确认创建/ })
  if (await createBtn.isVisible().catch(() => false)) {
    await createBtn.click()
    await page.waitForLoadState('networkidle')
  }
}

test.describe('Issue #61 — assessment page visual', () => {
  for (const vp of VIEWPORTS) {
    test(`7-column table at ${vp.label} — no horizontal overflow`, async ({
      page,
    }) => {
      await page.setViewportSize({ width: vp.width, height: vp.height })
      await loginAs(page, 'member')
      await ensureAssessmentDraft(page)

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

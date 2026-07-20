import { expect, test } from '@playwright/test'

import { loginAs } from '../fixtures/auth'

const VIEWPORTS = [
  { name: '1440x900', width: 1440, height: 900 },
  { name: '1280x800', width: 1280, height: 800 },
] as const

for (const viewport of VIEWPORTS) {
  test.describe(`UI-03 annual plan visual regression @ ${viewport.name}`, () => {
    test.beforeEach(async ({ page }) => {
      await page.setViewportSize(viewport)
      await loginAs(page, 'member')
      await page.goto('/growth/annual-plan')
      await expect(
        page.getByRole('heading', { name: '年度成长计划' }),
      ).toBeVisible()
      // Wait for async plan items to render before screenshots
      await expect.poll(async () => page.getByTestId('plan-item').count()).toBeGreaterThan(0)
    })

    test('annual plan and learning-task semantics', async ({ page }) => {
      const summary = page.getByTestId('plan-summary')
      await expect(summary).toContainText('总体进度')
      await expect(summary).toContainText('预计时长')
      await expect(summary).toContainText('实际时长')
      await expect(summary).toContainText('已完成')

      const timeline = page.getByTestId('month-timeline')
      await expect(timeline.getByRole('button')).toHaveCount(12)
      await expect(timeline).toContainText('1 月')
      await expect(timeline).toContainText('12 月')

      const planItems = page.getByTestId('plan-item')
      await expect.poll(async () => planItems.count()).toBeGreaterThan(0)
    })

    test('annual plan screenshot', async ({ page }) => {
      await expect(page).toHaveScreenshot(
        `ui-03-annual-plan-${viewport.name}.png`,
        { maxDiffPixelRatio: 0.05 },
      )
    })

    test('tasks route uses the unified annual-plan workspace', async ({
      page,
    }) => {
      await page.goto('/growth/tasks')
      await expect(page).toHaveURL(/\/growth\/annual-plan/)
      await expect(
        page.getByRole('heading', { name: '年度成长计划' }),
      ).toBeVisible()
    })
  })
}

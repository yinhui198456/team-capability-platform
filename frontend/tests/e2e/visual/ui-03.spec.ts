import { expect, test } from '@playwright/test'

import { loginAs } from '../fixtures/auth'

const VIEWPORTS = [
  { name: '1440x900', width: 1440, height: 900 },
  { name: '1920x1080', width: 1920, height: 1080 },
  { name: '1280x800', width: 1280, height: 800 },
] as const

for (const viewport of VIEWPORTS) {
  test.describe(`UI-03 annual plan visual regression @ ${viewport.name}`, () => {
    test.beforeEach(async ({ page }) => {
      await page.setViewportSize(viewport)
      await loginAs(page, 'member')
      // Pin to 2026: the seed's annual plan lives there; the active-year
      // resolver otherwise follows future-year smoke drafts.
      await page.goto('/growth/annual-plan?year=2026')
      await expect(
        page.getByRole('heading', { name: '年度成长计划' }),
      ).toBeVisible()
      // 真实计划/任务数据下首屏更慢：有界等待加载态消失（或错误态出现），
      // 默认 5s poll 门槛太短。随后再断言无错误 alert 且计划项已渲染。
      await expect
        .poll(
          async () =>
            page.getByText('加载中…').count() === 0 ||
            page.getByRole('alert').count() > 0,
          { timeout: 20000 },
        )
        .toBeTruthy()
      await expect(page.getByRole('alert')).toHaveCount(0)
      await expect(page.getByTestId('plan-item')).not.toHaveCount(0)
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
      await expect(page.getByText('二级能力标准 → 三级达成路径')).toBeVisible()
      await expect(page.getByText('掌握度提升')).toBeVisible()
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

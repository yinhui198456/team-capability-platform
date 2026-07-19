import { expect, test } from '@playwright/test'

import { loginAs } from '../fixtures/auth'

test.describe('UI-03 annual plan visual regression', () => {
  test.beforeEach(async ({ page }) => {
    await loginAs(page, 'member')
    await page.goto('/growth/annual-plan')
    await expect(
      page.getByRole('heading', { name: '年度成长计划' }),
    ).toBeVisible()
  })

  test('annual plan and learning-task semantics', async ({ page }) => {
    const summary = page.getByRole('region', { name: '年度计划总览' })
    await expect(summary).toContainText('年度 / 周期')
    await expect(summary).toContainText('预计时长')
    await expect(summary).toContainText('实际时长')
    await expect(summary).toContainText('预计时长')
    await expect(summary).toContainText('实际时长')

    const timeline = page.getByRole('region', { name: '月度时间轴' })
    await expect(timeline.getByRole('button')).toHaveCount(12)
    await expect(timeline).toContainText('1 月')
    await expect(timeline).toContainText('12 月')

    const overview = page.locator('.plan-overview')
    for (const status of [
      '未开始',
      '进行中',
      '已完成',
      '延期',
      '暂停',
      '取消',
    ]) {
      await expect(overview).toContainText(status)
    }
    await expect(page.locator('.plan-item')).toHaveCount(1)
    const workspace = page.getByRole('complementary', {
      name: '计划项详情与学习任务',
    })
    await expect(workspace).toContainText('学习任务 / 实操内容')
    await expect(workspace).toContainText('Evidence')
  })

  test('annual plan screenshot', async ({ page }) => {
    await expect(page.locator('.annual-plan-page')).toHaveScreenshot(
      'ui-03-annual-plan-empty.png',
      { maxDiffPixels: 1000 },
    )
  })

  test('tasks route uses the unified annual-plan workspace', async ({
    page,
  }) => {
    await page.goto('/growth/tasks')
    await expect(page).toHaveURL(/\/growth\/annual-plan$/)
    await expect(
      page.getByRole('heading', { name: '年度成长计划' }),
    ).toBeVisible()
  })
})

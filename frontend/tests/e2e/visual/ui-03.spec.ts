import { expect, test } from '@playwright/test'

import { loginAs } from '../fixtures/auth'

const VIEWPORTS = [
  { name: '1440x900', width: 1440, height: 900 },
  { name: '1920x1080', width: 1920, height: 1080 },
  { name: '1280x800', width: 1280, height: 800 },
] as const

for (const viewport of VIEWPORTS) {
  test.describe(`UI-03 M03–M05 @ ${viewport.name}`, () => {
    test.beforeEach(async ({ page }) => {
      await page.setViewportSize(viewport)
      await loginAs(page, 'member')
      // Pin to the seed year; the active-year resolver otherwise follows
      // future-year smoke drafts.
      await page.goto('/growth/annual-plan?year=2026')
      await expect(
        page.getByRole('heading', { name: '月度计划时间轴' }),
      ).toBeVisible()
      await expect(page.getByLabel('年度任务时间轴')).toBeVisible()
    })

    test('M03 presents a month timeline and its current task metrics', async ({
      page,
    }) => {
      const summary = page.getByLabel('计划指标')
      await expect(summary).toContainText('任务总数')
      await expect(summary).toContainText('进行中')
      await expect(summary).toContainText('已完成')

      const timeline = page.getByLabel('年度任务时间轴')
      await expect(timeline.getByRole('button')).toHaveCount(12)
      await expect(timeline.getByLabel('2026年01月')).toBeVisible()
      await expect(timeline.getByLabel('2026年12月')).toBeVisible()
    })

    test('M03 opens M04 without preselecting a task', async ({ page }) => {
      await page.getByRole('link', { name: '查看任务列表' }).click()
      await expect(page).toHaveURL(/\/growth\/tasks\?year=2026$/)
      expect(page.url()).not.toContain('task_id=')
      await expect(
        page.getByRole('heading', { name: '学习任务' }),
      ).toBeVisible()
    })

    test('M04 enters M05 with the task identity chain', async ({ page }) => {
      await page.goto('/growth/tasks?year=2026&month=7')
      await expect(
        page.getByRole('heading', { name: '学习任务' }),
      ).toBeVisible()
      const task = page.getByRole('link', { name: '进入任务' }).first()
      await expect(task).toBeVisible()
      await task.click()
      await expect(page).toHaveURL(
        /\/growth\/tasks\/\d+\?year=2026&month=\d+&.*l3_code=.*plan_item_id=\d+.*task_id=\d+/,
      )
      await expect(
        page.getByRole('heading', { name: '任务概览' }),
      ).toBeVisible()
    })
  })
}

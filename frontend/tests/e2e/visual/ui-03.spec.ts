import { expect, test } from '@playwright/test'

import { loginAs } from '../fixtures/auth'

const VIEWPORTS = [
  { name: '1440x900', width: 1440, height: 900 },
  { name: '1024x768', width: 1024, height: 768 },
  { name: '768x900', width: 768, height: 900 },
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
        page.getByRole('heading', {
          name: '2026 年度成长旅程',
          level: 1,
        }),
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
      const tasksResponse = await page.request.get(
        '/api/planning/learning-tasks?year=2026',
      )
      expect(tasksResponse.ok()).toBeTruthy()
      const tasks = (await tasksResponse.json()) as Array<{
        id: number
        plan_item_id: number
        l3_code: string
        status: string
        plan_item_target_month: number | null
        plan_item_plan_month: string | null
      }>
      const seededTask = tasks.find(
        (candidate) =>
          candidate.plan_item_target_month != null ||
          candidate.plan_item_plan_month != null,
      )
      expect(seededTask).toBeDefined()
      const month =
        seededTask!.plan_item_target_month ??
        Number(seededTask!.plan_item_plan_month!.slice(-2))
      const search = new URLSearchParams({
        year: '2026',
        month: String(month),
        search: seededTask!.l3_code,
        status: seededTask!.status,
      })
      await page.goto(`/growth/tasks?${search}`)
      await expect(
        page.getByRole('heading', { name: '学习任务' }),
      ).toBeVisible()
      const task = page.getByRole('link', { name: '进入任务' }).first()
      await expect(task).toBeVisible()
      await task.click()
      const detailUrl = new URL(page.url())
      expect(detailUrl.pathname).toBe(`/growth/tasks/${seededTask!.id}`)
      expect(detailUrl.searchParams.get('year')).toBe('2026')
      expect(detailUrl.searchParams.get('month')).toBe(String(month))
      expect(detailUrl.searchParams.get('search')).toBe(seededTask!.l3_code)
      expect(detailUrl.searchParams.get('status')).toBe(seededTask!.status)
      expect(detailUrl.searchParams.get('l3_code')).toBe(seededTask!.l3_code)
      expect(detailUrl.searchParams.get('plan_item_id')).toBe(
        String(seededTask!.plan_item_id),
      )
      expect(detailUrl.searchParams.get('task_id')).toBe(String(seededTask!.id))
      await expect(
        page.getByRole('heading', { name: '任务概览' }),
      ).toBeVisible()
      const back = new URL(
        (await page
          .locator('section.page')
          .filter({ has: page.getByRole('heading', { name: '任务概览' }) })
          .getByRole('link', { name: '学习任务' })
          .getAttribute('href')) ?? '',
        page.url(),
      )
      expect(back.searchParams.get('year')).toBe('2026')
      expect(back.searchParams.get('month')).toBe(String(month))
      expect(back.searchParams.get('search')).toBe(seededTask!.l3_code)
      expect(back.searchParams.get('status')).toBe(seededTask!.status)
      expect(back.searchParams.get('l3_code')).toBe(seededTask!.l3_code)
      expect(back.searchParams.get('plan_item_id')).toBe(
        String(seededTask!.plan_item_id),
      )
      expect(back.searchParams.get('task_id')).toBe(String(seededTask!.id))
    })
  })
}

import { expect, test } from '@playwright/test'

import { loginAs } from '../fixtures/auth'
import { VIEWPORTS } from './viewports'

for (const viewport of VIEWPORTS) {
  test.describe(`UI-01 Member dashboard visual regression @ ${viewport.name}`, () => {
    test.beforeEach(async ({ page }) => {
      await page.setViewportSize(viewport)
      await loginAs(page, 'member')
      await page.goto('/dashboard/member')
      await expect(page.getByText('我的成长总览')).toBeVisible()
    })

    test('semantic alignment', async ({ page }) => {
      // 学习时长单位应为 h 而非 小时
      const hourUnits = page.locator('.hours-unit')
      await expect.poll(async () => hourUnits.count()).toBeGreaterThanOrEqual(4)
      for (const unit of await hourUnits.all()) {
        const text = await unit.textContent()
        expect(text).toContain('h')
        expect(text).not.toContain('小时')
      }

      // 六个能力域中文描述应出现在能力域筛选中
      const domainFilter = page.getByTestId('domain-filter')
      await expect(domainFilter).toContainText('数据基础设施')
      await expect(domainFilter).toContainText('AI Infra / Agent')
      await expect(domainFilter).toContainText('工程编码')
      await expect(domainFilter).toContainText('基本办公能力')
      await expect(domainFilter).toContainText('沟通协作')
      await expect(domainFilter).toContainText('学习创新')

      // 待办事项 4 个图标卡片文案
      const todoCard = page.getByTestId('todo-card')
      await expect(todoCard.getByText('待提交 Evidence')).toBeVisible()
      await expect(todoCard.getByText('待 Buddy 复核')).toBeVisible()
      await expect(todoCard.getByText('计划到期')).toBeVisible()
      await expect(todoCard.getByText('学习任务延期')).toBeVisible()

      // 当前学习任务表格应出现至少一行
      const taskTable = page.getByTestId('current-tasks-table')
      await expect(taskTable).toBeVisible()
      const taskRows = taskTable.locator('tbody tr')
      await expect.poll(async () => taskRows.count()).toBeGreaterThan(0)
    })

    test('full page screenshot', async ({ page }) => {
      await expect(page.locator('section.page')).toHaveScreenshot(
        `member-dashboard-full-${viewport.name}.png`,
        { maxDiffPixels: 1000 },
      )
    })

    test('learning hours card screenshot', async ({ page }) => {
      const card = page.getByTestId('learning-hours-card')
      await expect(card).toHaveScreenshot(
        `member-dashboard-hours-${viewport.name}.png`,
        { maxDiffPixels: 200 },
      )
    })

    test('todo card screenshot', async ({ page }) => {
      const card = page.getByTestId('todo-card')
      await expect(card).toHaveScreenshot(
        `member-dashboard-todo-${viewport.name}.png`,
        { maxDiffPixels: 200 },
      )
    })
  })
}

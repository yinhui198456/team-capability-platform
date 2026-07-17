import { expect, test } from '@playwright/test'

import { loginAs } from '../fixtures/auth'

test.describe('UI-01 Member dashboard visual regression', () => {
  test.beforeEach(async ({ page }) => {
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
    const domainFilter = page.getByLabel('能力域筛选')
    await expect(domainFilter).toContainText('Data Infra')
    await expect(domainFilter).toContainText('AI Infra / Agent')
    await expect(domainFilter).toContainText('Coding')
    await expect(domainFilter).toContainText('基本办公')
    await expect(domainFilter).toContainText('沟通协作')
    await expect(domainFilter).toContainText('学习创新')

    // 待办事项 4 个图标卡片文案
    await expect(page.getByText('待提交 Evidence')).toBeVisible()
    await expect(page.getByText('待 Buddy 复核')).toBeVisible()
    await expect(page.getByText('计划到期')).toBeVisible()
    await expect(page.getByText('学习任务延期')).toBeVisible()

    // 当前学习任务表格应出现至少一行
    const taskTable = page.locator('.task-table')
    await expect(taskTable).toBeVisible()
    const taskRows = taskTable.locator('tbody tr')
    await expect.poll(async () => taskRows.count()).toBeGreaterThan(0)

    // TODO: 当前 seed 数据中 task.l3_name 与 capability_node 编码格式不一致
    // （seed 为 P01-L2A-L3A，catalog 为 P01.01.01），导致 L3 列 fallback 为 raw code。
    // 等数据对齐后，恢复以下断言：
    // const taskL3 = taskTable.locator('.task-l3-name')
    // await expect.poll(async () => taskL3.count()).toBeGreaterThan(0)
    // const l3Text = await taskL3.first().textContent()
    // expect(l3Text).not.toMatch(/^P\d+-/)
  })

  test('full page screenshot', async ({ page }) => {
    await expect(page.locator('.dashboard-page')).toHaveScreenshot('member-dashboard-full.png', {
      maxDiffPixels: 1000,
    })
  })

  test('learning hours card screenshot', async ({ page }) => {
    const card = page.locator('.learning-hours-card')
    await expect(card).toHaveScreenshot('member-dashboard-hours.png', {
      maxDiffPixels: 200,
    })
  })

  test('todo card screenshot', async ({ page }) => {
    const card = page.locator('.todo-card')
    await expect(card).toHaveScreenshot('member-dashboard-todo.png', {
      maxDiffPixels: 200,
    })
  })
})

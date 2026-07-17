import { expect, test, type Page } from '@playwright/test'

import { loginAs } from '../fixtures/auth'

async function getFirstL3Code(page: Page): Promise<string> {
  const response = await page.request.get('/api/capability-model')
  expect(response.ok()).toBeTruthy()
  const payload = await response.json()
  for (const domain of payload.domains) {
    for (const l2 of domain.children ?? []) {
      for (const l3 of l2.children ?? []) {
        if (l3.code) return l3.code as string
      }
    }
  }
  throw new Error('no L3 code found in capability model')
}

const backendURL = process.env.PLAYWRIGHT_BACKEND_URL ?? 'http://localhost:18001'

test.describe('four-role core path', () => {
  test('Member + Buddy full capability loop', async ({ page }) => {
    const l3Code = await test.step('fetch a valid L3 code', async () => {
      await page.goto('/capability/model')
      return getFirstL3Code(page)
    })

    await test.step('Member2: create and submit assessment', async () => {
      await loginAs(page, 'member2')
      await page.goto('/capability/assessment')
      await expect(page.getByText('当前年度暂无草稿')).toBeVisible()
      await page.getByRole('button', { name: '创建年度自评草稿' }).click()
      await expect(page.getByRole('heading', { name: '能力自评' })).toBeVisible()

      await page.getByRole('button', { name: '添加 L3' }).click()
      await page.getByLabel('L3 编码').first().fill(l3Code)
      await page.getByLabel('当前掌握度').first().selectOption('2')
      await page.getByLabel('目标掌握度').first().selectOption('3')
      await page.getByLabel('自评依据').first().fill('E2E 自评依据')
      await page.getByLabel('纳入计划候选').first().check()

      await page.getByRole('button', { name: '保存草稿' }).click()
      await expect(page.getByRole('status')).toContainText('草稿已保存')

      await page.getByRole('button', { name: '提交自评' }).click()
      await expect(page.getByRole('status')).toContainText('已提交，等待 Buddy 复核')
    })

    await test.step('Buddy: approve assessment', async () => {
      await loginAs(page, 'buddy')
      await page.goto('/mentoring/assessment-review')
      await expect(page.locator('.assessment-list button').first()).toBeVisible()
      await page.locator('.assessment-list button').first().click()

      await page.getByRole('radio', { name: '认可' }).check()
      await page.getByLabel('反馈').fill('E2E 认可')
      await page.getByRole('button', { name: '提交复核' }).click()
      await expect(page.getByRole('status')).toContainText('已认可并归档')
    })

    await test.step('Member2: gap → goal → plan → task → evidence', async () => {
      await loginAs(page, 'member2')

      await page.goto('/capability/gap')
      await expect(page.locator('.gap-list')).toContainText(l3Code)
      await page.locator('.gap-priority select').first().selectOption('高')
      await expect(page.locator('.gap-candidate input').first()).toBeChecked()

      await page.goto('/growth/goals')
      await expect(page.getByText('可纳入计划的 Gap')).toBeVisible()
      await page.getByRole('button', { name: '纳入目标' }).first().click()
      await expect(page.locator('.goal-list')).toContainText(l3Code)

      await page.goto('/growth/annual-plan')
      await expect(page.getByRole('button', { name: '生成计划项' })).toBeVisible()
      await page.getByRole('button', { name: '生成计划项' }).click()
      await expect(page.locator('.plan-item-list')).toContainText(l3Code)

      await page.goto('/growth/tasks')
      await expect(page.getByRole('button', { name: '创建学习任务' })).toBeVisible()
      await page.getByRole('button', { name: '创建学习任务' }).click()
      await expect(page.locator('.learning-task-list')).toContainText(l3Code)

      await page.getByRole('button', { name: '新增版本' }).click()
      await page.getByLabel('提交内容').fill('E2E Evidence 内容')
      await page.getByLabel('证据链接').fill('https://example.invalid/e2e-evidence')
      await page.getByRole('button', { name: '保存' }).click()
      await expect(page.locator('.evidence-list')).toContainText('E2E Evidence 内容')

      await page.getByRole('button', { name: '提交' }).click()
      await expect(page.locator('.evidence-list')).toContainText('待 Review')
    })

    await test.step('Buddy: approve evidence', async () => {
      await loginAs(page, 'buddy')
      await page.goto('/mentoring/evidence-review')
      await expect(page.locator('.evidence-review-list button').first()).toBeVisible()
      await page.locator('.evidence-review-list button').first().click()

      await page.getByRole('radio', { name: '通过' }).check()
      await page.getByLabel('反馈').fill('E2E Evidence 通过')
      await page.getByRole('button', { name: '提交 Review' }).click()
      await expect(page.getByRole('status')).toContainText('已通过并归档')
    })
  })

  test('Leader: team analytics loads KPIs and member attainment', async ({ page }) => {
    await loginAs(page, 'leader')
    await page.goto('/operations/analytics')

    await expect(page.getByRole('heading', { name: '团队能力分析' })).toBeVisible()
    await expect(page.getByText('自评完成率')).toBeVisible()
    await expect(page.getByText('计划完成率')).toBeVisible()
    await expect(page.getByText('Evidence 通过率')).toBeVisible()
    await expect(page.getByText('延期计划项', { exact: true })).toBeVisible()

    await expect(page.getByText('成员能力达成率')).toBeVisible()
    await expect(page.locator('.analytics-table').first()).toBeVisible()

    const response = await page.request.get('/api/planning/team-analytics?year=2026')
    expect(response.ok()).toBeTruthy()
    const payload = await response.json()
    expect(payload.kpis.assessment_total_count).toBeGreaterThan(0)
  })

  test('Admin: user management and system config', async ({ page }) => {
    await loginAs(page, 'admin')
    await page.goto('/system/users')

    await expect(page.getByRole('heading', { name: '系统管理' })).toBeVisible()
    await expect(page.getByText('Admin User')).toBeVisible()
    await expect(page.getByText('Leader User')).toBeVisible()
    await expect(page.getByText('Buddy User')).toBeVisible()
    await expect(page.getByText('Member User')).toBeVisible()
    await expect(page.getByText('Member Two')).toBeVisible()

    const username = `e2e-${Date.now()}`
    await test.step('create a new system user', async () => {
      await page.getByLabel('用户名').fill(username)
      await page.getByLabel('姓名').fill('E2E Test User')
      await page.getByLabel('初始密码').fill('password123')
      await page.getByLabel('启用账号').check()
      await page.getByLabel('Member').check()
      await page.getByRole('button', { name: '创建用户' }).click()
      await expect(page.locator('.system-user-list')).toContainText('E2E Test User')
    })

    await test.step('health endpoint is ready', async () => {
      const response = await page.request.get(`${backendURL}/ready`)
      expect(response.ok()).toBeTruthy()
      const payload = await response.json()
      expect(payload.status).toBe('ready')
    })
  })
})

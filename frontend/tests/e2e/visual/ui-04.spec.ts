import { expect, test } from '@playwright/test'

import { loginAs } from '../fixtures/auth'

test.describe.fixme('UI-04 Buddy review center visual regression', () => {
  test.beforeEach(async ({ page }) => {
    await loginAs(page, 'buddy')
    await page.goto('/mentoring/dashboard')
    await expect(
      page.getByRole('heading', { name: 'Buddy 复核中心' }),
    ).toBeVisible()
  })

  test('empty-queue semantic alignment', async ({ page }) => {
    const summary = page.getByLabel('Buddy 待办摘要')
    await expect(summary).toContainText('辅导成员')
    await expect(summary).toContainText('待复核自评')
    await expect(summary).toContainText('待 Review Evidence')
    await expect(summary).toContainText('需跟进')

    const members = page.locator('.buddy-member-list')
    await expect(
      members.getByRole('heading', { name: '辅导成员' }),
    ).toBeVisible()
    await expect(
      members.getByRole('button', { name: '全部成员' }),
    ).toBeVisible()

    const queue = page.locator('.buddy-queue')
    await expect(queue.getByRole('heading', { name: '复核队列' })).toBeVisible()
    await expect(
      queue.getByRole('tablist', { name: '复核队列类型' }),
    ).toContainText('全部待复核')
    await expect(queue.getByRole('tab', { name: '自评复核' })).toBeVisible()
    await expect(
      queue.getByRole('tab', { name: 'Evidence Review' }),
    ).toBeVisible()
    await expect(queue).toContainText('当前范围暂无待复核项。')

    const workspace = page.locator('.buddy-workspace')
    await expect(
      workspace.getByRole('heading', { name: '复核工作区' }),
    ).toBeVisible()
    await expect(workspace).toContainText(
      '选择一项待复核内容后查看依据和历史反馈。',
    )
  })

  test('empty queue screenshot', async ({ page }) => {
    await expect(page.locator('.buddy-review-center')).toHaveScreenshot(
      'ui-04-buddy-review-center-empty.png',
      { maxDiffPixels: 1000 },
    )
  })
})

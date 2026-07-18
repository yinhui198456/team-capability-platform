import { expect, test } from '@playwright/test'

import { loginAs } from '../fixtures/auth'

test.describe('UI-02 assessment and Gap visual regression', () => {
  test.beforeEach(async ({ page }) => {
    test.skip(
      !process.env.TCP_E2E_ISOLATED,
      'UI-02 prepares a draft and requires an isolated database',
    )
    await loginAs(page, 'member2')
    await page.goto('/capability/assessment')
    await expect(
      page.getByRole('heading', { name: '能力自评与 Gap 分析' }),
    ).toBeVisible()
    const createDraft = page.getByRole('button', {
      name: '创建年度自评草稿',
    })
    if (await createDraft.isVisible()) {
      await createDraft.click()
    }
    await expect(page.getByLabel('评估摘要')).toBeVisible()
  })

  test('semantic alignment', async ({ page }) => {
    await expect(page.getByLabel('评估摘要')).toContainText('评估进度')
    await expect(page.getByLabel('评估摘要')).toContainText('最新 Review')
    await expect(page.getByLabel('评估摘要')).toContainText('计划门禁')
    await expect(page.getByText('Review 闭环前不可正式纳入计划')).toBeVisible()

    const tables = page.locator('.assessment-table')
    await expect(tables).toHaveCount(6)
    const firstTable = tables.first()
    await expect(firstTable).toContainText('L3 能力项')
    await expect(firstTable).toContainText('当前')
    await expect(firstTable).toContainText('目标')
    await expect(firstTable).toContainText('Gap')
    await expect(firstTable).toContainText('优先级')
    await expect(firstTable.locator('tbody tr').first()).toContainText(
      '常用办公工具基础',
    )

    await expect(page.getByLabel('当前掌握度').first()).toBeVisible()
    await expect(page.getByLabel('目标掌握度').first()).toBeVisible()
    const domains = await page.locator('.domain-label').allTextContents()
    expect(domains).toEqual(
      expect.arrayContaining([
        'P01 · 数据基础设施',
        'P02 · AI Infra / Agent',
        'P03 · 工程编码',
        'C01 · 基本办公能力',
        'C02 · 沟通协作',
        'C03 · 学习创新',
      ]),
    )

    const gapSidebar = page.locator('.gap-sidebar')
    await expect(gapSidebar).toContainText('Gap 分析')
    await expect(gapSidebar).toContainText('Gap 总数')
    await expect(gapSidebar).toContainText('平均 Gap')
    await expect(gapSidebar.locator('.gap-priority-list .high')).toContainText(
      '高',
    )
    await expect(
      gapSidebar.locator('.gap-priority-list .medium'),
    ).toContainText('中')
    await expect(gapSidebar.locator('.gap-priority-list .low')).toContainText(
      '低',
    )

    await page.goto('/capability/gap')
    await expect(
      page.getByRole('heading', { name: '能力自评与 Gap 分析' }),
    ).toBeVisible()
    await expect(page.locator('.assessment-table')).toHaveCount(6)
  })

  test('assessment overview screenshot', async ({ page }) => {
    await expect(page).toHaveScreenshot('ui-02-assessment-overview.png', {
      maxDiffPixels: 1000,
    })
  })

  test('Gap sidebar screenshot', async ({ page }) => {
    const gapSidebar = page.locator('.gap-sidebar')
    await gapSidebar.scrollIntoViewIfNeeded()
    await expect(gapSidebar).toHaveScreenshot('ui-02-gap-sidebar.png', {
      maxDiffPixels: 300,
    })
  })
})

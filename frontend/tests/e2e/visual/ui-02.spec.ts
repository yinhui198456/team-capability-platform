import { expect, test } from '@playwright/test'

import { loginAs } from '../fixtures/auth'

const VIEWPORTS = [
  { name: '1440x900', width: 1440, height: 900 },
  { name: '1280x800', width: 1280, height: 800 },
] as const

for (const viewport of VIEWPORTS) {
  test.describe(`UI-02 assessment and Gap visual regression @ ${viewport.name}`, () => {
    test.beforeEach(async ({ page }) => {
      test.skip(
        !process.env.TCP_E2E_ISOLATED,
        'UI-02 prepares a draft and requires an isolated database',
      )
      await page.setViewportSize(viewport)
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
      // Wait for assessment tables and Gap sidebar to render before screenshots
      await expect(page.getByTestId('assessment-table')).toHaveCount(6)
      await expect(page.getByTestId('gap-sidebar')).toBeVisible()
    })

    test('semantic alignment', async ({ page }) => {
      const summary = page.getByLabel('评估摘要')
      await expect(summary).toContainText('评估进度')
      await expect(summary).toContainText('未完成')
      await expect(summary).toContainText('最新 Review')

      const tables = page.getByTestId('assessment-table')
      await expect(tables).toHaveCount(6)
      const firstTable = tables.first()
      await expect(firstTable).toContainText('L3 能力项')
      await expect(firstTable).toContainText('建议起始')
      await expect(firstTable).toContainText('当前 (1-5)')
      await expect(firstTable).toContainText('目标 (1-5)')
      await expect(firstTable).toContainText('Gap')
      await expect(firstTable).toContainText('优先级')

      const domainLabels = page.getByTestId('domain-label')
      const domains = await domainLabels.allTextContents()
      expect(domains).toEqual(
        expect.arrayContaining([
          expect.stringContaining('P01 · 数据基础设施'),
          expect.stringContaining('P02 · AI Infra / Agent'),
          expect.stringContaining('P03 · 工程编码'),
          expect.stringContaining('C01 · 基本办公能力'),
          expect.stringContaining('C02 · 沟通协作'),
          expect.stringContaining('C03 · 学习创新'),
        ]),
      )

      const gapSidebar = page.getByTestId('gap-sidebar')
      await expect(gapSidebar).toContainText('本次评估整体 Gap')
      await expect(gapSidebar).toContainText('Gap 总数')
      await expect(gapSidebar).toContainText('平均 Gap')
      await expect(gapSidebar).toContainText('高')
      await expect(gapSidebar).toContainText('中')
      await expect(gapSidebar).toContainText('低')

      await page.goto('/capability/gap')
      await expect(
        page.getByRole('heading', { name: '能力自评与 Gap 分析' }),
      ).toBeVisible()
      await expect(page.getByTestId('assessment-table')).toHaveCount(6)
    })

    test('assessment overview screenshot', async ({ page }) => {
      await expect(page).toHaveScreenshot(
        `ui-02-assessment-overview-${viewport.name}.png`,
        { maxDiffPixelRatio: 0.05 },
      )
    })
  })
}

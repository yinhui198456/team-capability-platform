import { expect, test } from '@playwright/test'

import { loginAs } from '../fixtures/auth'

test.describe.fixme('UI-05 team capability analysis visual regression', () => {
  test.beforeEach(async ({ page }) => {
    await loginAs(page, 'leader')
    await page.goto('/operations/analytics')
    await expect(
      page.getByRole('heading', { name: '团队能力分析' }),
    ).toBeVisible()
    await expect(page.getByLabel('团队关键指标')).toBeVisible()
  })

  test('semantic alignment', async ({ page }) => {
    const filters = page.getByLabel('团队能力分析筛选')
    await expect(filters.getByLabel('年度')).toBeVisible()
    await expect(filters.getByLabel('成员')).toContainText('全部')
    await expect(filters.getByLabel('能力域')).toContainText('全部')
    await expect(filters.getByLabel('能力域')).toContainText('P01 · Data Infra')
    await expect(filters.getByLabel('能力域')).toContainText('C03 · 学习创新')

    const kpis = page.getByLabel('团队关键指标')
    for (const label of [
      '自评完成率',
      '计划完成率',
      'Evidence 通过率',
      '延期计划项',
    ]) {
      await expect(kpis).toContainText(label)
    }

    for (const heading of [
      '能力实际 vs 计划',
      '成员能力达成率',
      '计划完成趋势',
      '学习时长趋势',
      '延期计划项明细',
    ]) {
      await expect(page.getByRole('heading', { name: heading })).toBeVisible()
    }

    await expect(page.getByLabel('计划完成组合图')).toBeVisible()
    await expect(page.getByLabel('学习时长组合图')).toBeVisible()
    await expect(page.getByLabel('P01实际')).toBeVisible()
    await expect(page.getByLabel('P01目标')).toBeVisible()
    await expect(
      page.getByRole('progressbar', { name: '1月计划完成', exact: true }),
    ).toBeVisible()
    await expect(
      page.getByRole('progressbar', { name: '1月实际时长', exact: true }),
    ).toBeVisible()
  })

  test('team capability analysis screenshot', async ({ page }) => {
    await expect(page.locator('.dashboard-page')).toHaveScreenshot(
      'ui-05-team-capability-analysis.png',
      { maxDiffPixels: 1500 },
    )
  })
})

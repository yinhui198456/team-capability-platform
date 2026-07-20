import { expect, test } from '@playwright/test'

import { loginAs } from '../fixtures/auth'

const VIEWPORTS = [
  { name: '1440x900', width: 1440, height: 900 },
  { name: '1280x800', width: 1280, height: 800 },
] as const

for (const viewport of VIEWPORTS) {
  test.describe(`UI-05 team capability analysis visual regression @ ${viewport.name}`, () => {
    test.beforeEach(async ({ page }) => {
      await page.setViewportSize(viewport)
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
        '计划完成率',
        'Evidence 通过率',
        '延期计划项',
      ]) {
        await expect(kpis).toContainText(label)
      }
      // 自评完成率 must not appear per Issue #28
      await expect(kpis).not.toContainText('自评完成率')

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
        `ui-05-team-capability-analysis-${viewport.name}.png`,
        { maxDiffPixels: 1500 },
      )
    })

    test('overdue item drawer opens and closes read-only', async ({ page }) => {
      const rows = page.locator('.analytics-table .clickable')
      const count = await rows.count()
      if (count === 0) {
        // Accept empty state
        await expect(page.getByText('暂无延期计划项。')).toBeVisible()
        return
      }
      await rows.first().click()
      const drawer = page.getByRole('dialog', { name: '延期计划项详情' })
      await expect(drawer).toBeVisible()
      await expect(drawer.getByRole('document')).toContainText('只读')
      await expect(drawer.locator('dl')).toBeVisible()
      await drawer.getByRole('button', { name: '关闭详情' }).click()
      await expect(drawer).not.toBeVisible()

      // Keyboard access
      await rows.first().press('Enter')
      await expect(
        page.getByRole('dialog', { name: '延期计划项详情' }),
      ).toBeVisible()
      await page.getByRole('dialog', { name: '延期计划项详情' }).getByRole('button', { name: '关闭详情' }).click()
    })

    test('filters update KPI and charts', async ({ page }) => {
      const filters = page.getByLabel('团队能力分析筛选')
      await filters.getByLabel('能力域').selectOption('P01')
      await page.waitForResponse(
        (resp) =>
          resp.url().includes('/api/planning/team-analytics') &&
          resp.status() === 200,
      )
      await expect(page.getByLabel('团队关键指标')).toBeVisible()
      await expect(page.getByRole('heading', { name: '能力实际 vs 计划' })).toBeVisible()
    })
  })
}

test.describe('UI-05 team capability analysis permission boundary', () => {
  test('Member cannot access team analytics', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    await loginAs(page, 'member')
    await page.goto('/operations/analytics')
    await expect(page.getByText(/无权限/)).toBeVisible()
  })

  test('Buddy cannot access team analytics', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    await loginAs(page, 'buddy')
    await page.goto('/operations/analytics')
    await expect(page.getByText(/无权限/)).toBeVisible()
  })
})

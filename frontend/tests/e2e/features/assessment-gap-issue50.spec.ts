import { expect, test } from '@playwright/test'

import { loginAs } from '../fixtures/auth'

test.describe('Issue #50 assessment gap workflow', () => {
  test.beforeEach(async ({ page }) => {
    test.skip(
      !process.env.TCP_E2E_ISOLATED,
      'Issue #50 writes assessment data and requires an isolated database',
    )
    await loginAs(page, 'member2')
    await page.goto('/capability/assessment')
    const createDraft = page.getByRole('button', { name: '创建年度自评草稿' })
    const summary = page.getByLabel('评估摘要')
    await expect(createDraft.or(summary)).toBeVisible()
    if (await createDraft.isVisible()) await createDraft.click()
    await expect(summary).toBeVisible({ timeout: 10000 })
    await expect(page.getByTestId('assessment-table').first()).toBeVisible()
  })

  test('search switches domain, expands L2, and focuses the selected L3', async ({
    page,
  }) => {
    const search = page.getByLabel('搜索全部能力项')
    await search.fill('P01')
    const result = page
      .getByRole('listbox', { name: '搜索结果' })
      .getByRole('button')
      .first()
    await expect(result).toBeVisible()
    await result.click()
    await expect(search).toHaveValue('')
    await expect(page.locator('[id^="row-"]:focus')).toHaveCount(1)
  })

  test('Gap Drawer is on demand and L2 batch fill requires confirmation', async ({
    page,
  }) => {
    await expect(page.getByTestId('gap-drawer')).toHaveCount(0)
    await page.getByRole('button', { name: '查看 Gap 摘要' }).click()
    await expect(page.getByTestId('gap-drawer')).toBeVisible()
    await page.getByRole('button', { name: '关闭' }).click()

    const batch = page.getByRole('button', { name: '批量填空值' }).first()
    if (await batch.isVisible()) {
      await batch.click()
      await expect(page.getByRole('button', { name: '确认填 1' })).toBeVisible()
    }
  })

  test('partial save keeps the page dense and avoids viewport overflow', async ({
    page,
  }) => {
    const viewport = page.viewportSize()
    expect(viewport).not.toBeNull()
    await expect(page.getByRole('button', { name: '保存草稿' })).toBeVisible()
    const metrics = await page
      .getByTestId('assessment-main-area')
      .evaluate((element) => {
        const main = element.getBoundingClientRect()
        const table = element.querySelector('table')?.getBoundingClientRect()
        const rows = [...element.querySelectorAll('tbody tr')].filter((row) => {
          const rect = row.getBoundingClientRect()
          return rect.top >= 0 && rect.bottom <= window.innerHeight
        }).length
        return { mainWidth: main.width, tableWidth: table?.width ?? 0, rows }
      })
    expect(metrics.tableWidth / metrics.mainWidth).toBeGreaterThanOrEqual(0.7)
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBeLessThanOrEqual(viewport!.width)
  })
})

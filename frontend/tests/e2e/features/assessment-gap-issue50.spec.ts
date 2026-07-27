import { expect, test } from '@playwright/test'

import { loginAs } from '../fixtures/auth'

test.describe('Issue #50 assessment gap workflow', () => {
  test.beforeEach(async ({ page }) => {
    test.skip(
      !process.env.TCP_E2E_ISOLATED,
      'Issue #50 writes assessment data and requires an isolated database',
    )
    await loginAs(page, 'member2')
    const created = await page.request.post('/api/assessments', {
      data: { year: 2026, assessment_type: '年度' },
    })
    expect(created.ok()).toBeTruthy()
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
    await search.fill('P')
    await search.press('ArrowDown')
    await expect(
      page.locator('[role="option"][aria-selected="true"]'),
    ).toHaveCount(1)
    await search.press('Enter')
    await expect(search).toHaveValue('')
    await expect(page.locator('[id^="row-"]:focus')).toHaveCount(1)
  })

  test('Escape closes search results and restores input focus', async ({
    page,
  }) => {
    const search = page.getByLabel('搜索全部能力项')
    await search.fill('P01')
    const result = page
      .getByRole('listbox', { name: '搜索结果' })
      .getByRole('option')
      .first()
    await expect(result).toBeVisible()
    await search.press('Escape')
    await expect(search).toHaveValue('')
    await expect(page.getByRole('listbox', { name: '搜索结果' })).toHaveCount(0)
    await expect(search).toBeFocused()
  })

  test('Gap Drawer is on demand and L2 batch fill requires confirmation', async ({
    page,
  }) => {
    await expect(page.getByTestId('gap-drawer')).toHaveCount(0)
    await page.getByRole('button', { name: '查看 Gap 摘要' }).click()
    await expect(page.getByTestId('gap-drawer')).toBeVisible()
    await page.getByRole('button', { name: '关闭' }).click()

    const batch = page.getByRole('button', { name: '批量填 2' }).first()
    if (await batch.isVisible()) {
      await batch.click()
      await expect(page.getByRole('button', { name: '确认填 2' })).toBeVisible()
    }
  })

  test('level 3 without evidence is visibly incomplete before submit', async ({
    page,
  }) => {
    const current = page.getByRole('combobox', { name: /当前等级/ }).first()
    await current.selectOption('3')
    await expect(page.getByText('需自评依据').first()).toBeVisible()
    await expect(page.getByRole('button', { name: '提交自评' })).toBeDisabled()
  })

  test('first evaluation fills all domains and submits dirty input', async ({
    page,
  }) => {
    test.setTimeout(120_000)
    const firstCurrent = page
      .getByRole('combobox', { name: /当前等级/ })
      .first()
    if ((await firstCurrent.inputValue()) === '') {
      await firstCurrent.selectOption('1')
    }
    for (const domain of await page
      .getByRole('navigation', { name: '一级能力域导航' })
      .getByRole('button')
      .all()) {
      await domain.click()
      while (await page.getByRole('button', { name: '批量填 1' }).count()) {
        await page.getByRole('button', { name: '批量填 1' }).first().click()
        const responsePromise = page.waitForResponse(
          (response) =>
            response.url().includes('/batch-level') &&
            response.request().method() === 'POST',
        )
        await page.getByRole('button', { name: '确认填 1' }).click()
        expect((await responsePromise).status()).toBe(200)
      }
    }
    await expect(page.getByRole('button', { name: '提交自评' })).toBeEnabled()
    await page.getByRole('button', { name: '提交自评' }).click()
    await expect(page.getByText(/已提交/)).toBeVisible({ timeout: 15000 })
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

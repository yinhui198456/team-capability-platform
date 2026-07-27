import { expect, test } from '@playwright/test'

import { loginAs } from '../fixtures/auth'

const VIEWPORTS = [
  { name: '1440x900', width: 1440, height: 900 },
  { name: '1920x1080', width: 1920, height: 1080 },
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
      const created = await page.request.post('/api/assessments', {
        data: { year: 2026, assessment_type: '年度' },
      })
      expect(created.ok()).toBeTruthy()
      await page.goto('/capability/assessment')
      await expect(
        page.getByRole('heading', { name: '能力自评与 Gap 分析' }),
      ).toBeVisible()
      const createDraft = page.getByRole('button', {
        name: '创建年度自评草稿',
      })
      const summary = page.getByLabel('评估摘要')
      await expect(createDraft.or(summary)).toBeVisible()
      if (await createDraft.isVisible()) {
        await createDraft.click()
      }
      await expect(summary).toBeVisible({ timeout: 10000 })
      await expect(page.getByTestId('assessment-table').first()).toBeVisible()
      await expect(page.getByTestId('gap-sidebar')).toHaveCount(0)
    })

    test('semantic alignment', async ({ page }) => {
      const summary = page.getByLabel('评估摘要')
      await expect(summary).toContainText('进度')
      await expect(summary).toContainText('未完成')
      await expect(summary).toContainText('Review')

      const tables = page.getByTestId('assessment-table')
      await expect(tables.first()).toBeVisible()
      const firstTable = tables.first()
      await expect(firstTable).toContainText('L3 能力项')
      await expect(firstTable).toContainText('当前')
      await expect(firstTable).toContainText('标准目标')
      await expect(firstTable).toContainText('个人调整')
      await expect(firstTable).toContainText('最终目标')
      await expect(firstTable).toContainText('Gap')
      await expect(firstTable).toContainText('优先级')

      await expect(
        page.getByRole('navigation', { name: '一级能力域导航' }),
      ).toBeVisible()
      await expect(page.getByTestId('gap-drawer')).toHaveCount(0)
      await page.getByRole('button', { name: '查看 Gap 摘要' }).click()
      await expect(page.getByTestId('gap-drawer')).toBeVisible()
      await page.getByRole('button', { name: '关闭' }).click()
      await expect(page.getByTestId('gap-drawer')).toHaveCount(0)

      const metrics = await page
        .getByTestId('assessment-main-area')
        .evaluate((element) => {
          const visible = (rect: DOMRect) => {
            const left = Math.max(0, rect.left)
            const top = Math.max(0, rect.top)
            const right = Math.min(window.innerWidth, rect.right)
            const bottom = Math.min(window.innerHeight, rect.bottom)
            return {
              width: Math.max(0, right - left),
              height: Math.max(0, bottom - top),
            }
          }
          const main = visible(element.getBoundingClientRect())
          const tableElement = element.querySelector('table')
          const table = tableElement
            ? visible(tableElement.getBoundingClientRect())
            : { width: 0, height: 0 }
          const rows = [...element.querySelectorAll('tbody tr')].filter(
            (row) => {
              const rect = row.getBoundingClientRect()
              return rect.top >= 0 && rect.bottom <= window.innerHeight
            },
          ).length
          const sticky = document.querySelector('[class*="stickyActions"]')
          const stickyRect = sticky?.getBoundingClientRect()
          const visibleRows = [...element.querySelectorAll('tbody tr')].filter(
            (row) => {
              const rect = row.getBoundingClientRect()
              return rect.top < window.innerHeight && rect.bottom > 0
            },
          )
          const lastVisibleRow = visibleRows.at(-1)?.getBoundingClientRect()
          return {
            mainArea: main.width * main.height,
            tableArea: table.width * table.height,
            rows,
            lastVisibleRowBottom: lastVisibleRow?.bottom ?? 0,
            stickyTop: stickyRect?.top ?? window.innerHeight,
          }
        })
      expect(metrics.tableArea / metrics.mainArea).toBeGreaterThanOrEqual(0.7)
      expect(metrics.rows).toBeGreaterThanOrEqual(
        viewport.name === '1920x1080'
          ? 8
          : viewport.name === '1440x900'
            ? 6
            : 1,
      )
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth),
      ).toBeLessThanOrEqual(viewport.width)
      expect(metrics.lastVisibleRowBottom).toBeLessThanOrEqual(
        metrics.stickyTop + 1,
      )

      await page.goto('/capability/gap')
      await expect(
        page.getByRole('heading', { name: '能力自评与 Gap 分析' }),
      ).toBeVisible()
      await expect(page.getByTestId('assessment-table').first()).toBeVisible()
    })

    test('assessment overview screenshot', async ({ page }) => {
      await expect(page).toHaveScreenshot(
        `ui-02-assessment-overview-${viewport.name}.png`,
        { maxDiffPixelRatio: 0.05 },
      )
    })
  })
}

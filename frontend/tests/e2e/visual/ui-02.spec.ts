import { expect, test } from '@playwright/test'

import { loginAs } from '../fixtures/auth'

const VIEWPORTS = [
  { name: '1440x900', width: 1440, height: 900 },
  { name: '1024x768', width: 1024, height: 768 },
  { name: '768x900', width: 768, height: 900 },
] as const

for (const viewport of VIEWPORTS) {
  test.describe(`M02 V1 @ ${viewport.name}`, () => {
    test.beforeEach(async ({ page }) => {
      test.skip(
        !process.env.TCP_E2E_ISOLATED,
        'M02 prepares a controlled draft only in the isolated E2E environment',
      )
      await page.setViewportSize(viewport)
      await loginAs(page, 'member2')
      const preview = await page.request.get(
        '/api/assessments/scope-preview?year=2026',
      )
      expect(preview.ok()).toBeTruthy()
      const previewBody = (await preview.json()) as {
        scope_token: string
        open_draft_id: number | null
      }
      if (!previewBody.open_draft_id) {
        const created = await page.request.post('/api/assessments', {
          data: {
            year: 2026,
            assessment_type: '年度',
            scope_token: previewBody.scope_token,
          },
        })
        expect(created.ok()).toBeTruthy()
      }
      await page.goto('/capability/assessment')
      await expect(
        page.getByRole('heading', { name: '能力评级与提升计划' }),
      ).toBeVisible()
    })

    test('keeps the approved M02 actions, navigation, and no-clipping contract', async ({
      page,
    }) => {
      const summary = page.getByLabel('评估摘要')
      await expect(summary).toBeVisible()
      for (const metric of ['三级能力项', '已评级', '存在差距', '已加入计划']) {
        await expect(summary).toContainText(metric)
      }

      const domainNav = page.getByRole('navigation', {
        name: '一级能力域导航',
      })
      await expect(
        domainNav.getByRole('button', { name: '全部能力域' }),
      ).toBeVisible()
      await expect(
        page.getByRole('combobox', { name: '搜索全部能力项' }),
      ).toBeVisible()
      await expect(
        page.getByRole('button', { name: '保存能力评级' }),
      ).toBeVisible()
      await expect(
        page.getByRole('button', { name: '生成所选学习任务' }),
      ).toBeVisible()
      await expect(page.getByLabel('计划草稿操作')).toBeVisible()
      await expect(page.getByText(/Assessment Review/)).toHaveCount(0)

      await domainNav.getByRole('button', { name: '全部能力域' }).focus()
      await expect(
        domainNav.getByRole('button', { name: '全部能力域' }),
      ).toBeFocused()

      const clipped = await page.evaluate(() => {
        const nodes = [
          document.documentElement,
          document.querySelector('[aria-label="一级能力域导航"]'),
          ...document.querySelectorAll('[aria-label^="当前等级"] button'),
        ].filter((node): node is HTMLElement => node instanceof HTMLElement)
        return nodes.some((node) => node.scrollWidth > node.clientWidth + 1)
      })
      expect(clipped).toBe(false)
    })

    test('keeps rating save and plan drafting independent', async ({
      page,
    }) => {
      const table = page.getByTestId('assessment-table').first()
      await expect(table).toBeVisible()
      const rating = table.getByRole('button', { name: /^0 · 未接触/ }).first()
      await rating.click()
      await page.getByRole('button', { name: '保存能力评级' }).click()

      const join = table.getByRole('button', { name: /^加入提升计划 / }).first()
      await expect(join).toBeEnabled()
      await join.click()
      const row = join.locator('xpath=ancestor::div[starts-with(@id, "row-")]')
      await expect(
        row.getByRole('combobox', { name: /^优先级 / }),
      ).toBeVisible()
      await expect(row.getByTestId(/^plan-month-control-/)).toBeVisible()
      await expect(page.getByLabel('计划草稿操作')).toContainText('计划草稿：')
    })
  })
}

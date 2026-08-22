import path from 'node:path'

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
      const preview = await page.request.get(
        '/api/assessments/scope-preview?year=2026',
      )
      expect(preview.ok()).toBeTruthy()
      const previewBody = (await preview.json()) as {
        scope_token: string
        open_draft_id: number | null
      }
      let draftId = previewBody.open_draft_id
      if (!previewBody.open_draft_id) {
        const created = await page.request.post('/api/assessments', {
          data: {
            year: 2026,
            assessment_type: '年度',
            scope_token: previewBody.scope_token,
          },
        })
        expect(created.ok()).toBeTruthy()
        draftId = ((await created.json()) as { id: number }).id
      }
      expect(draftId).toBeTruthy()
      const draftResponse = await page.request.get(
        `/api/assessments/${draftId}`,
      )
      expect(draftResponse.ok()).toBeTruthy()
      const draft = (await draftResponse.json()) as {
        id: number
        revision: number
        details: Array<{
          l3_code: string
          l3_node_id?: number | null
          current_level: number | null
          target_level: number | null
          standard_target_level?: number | null
          standard_target_applicable?: boolean | null
          include_in_plan?: boolean | null
          member_priority?: string | null
          plan_month?: string | null
        }>
      }
      const planDetail = draft.details.find((detail) => {
        const target = detail.standard_target_level ?? detail.target_level
        return (
          detail.standard_target_applicable !== false &&
          target != null &&
          target > 0
        )
      })
      expect(planDetail).toBeDefined()
      const target =
        planDetail!.standard_target_level ?? planDetail!.target_level
      const currentLevel = Math.max(0, target! - 1)
      const planReady =
        planDetail!.current_level === currentLevel &&
        planDetail!.include_in_plan === true &&
        planDetail!.member_priority === '高' &&
        planDetail!.plan_month === '2026-05'
      if (!planReady) {
        const saved = await page.request.patch(
          `/api/assessments/${draft.id}/draft`,
          {
            data: {
              expected_revision: draft.revision,
              details: [
                {
                  l3_node_id: planDetail!.l3_node_id,
                  l3_code: planDetail!.l3_code,
                  current_level: currentLevel,
                  include_in_plan: true,
                  member_priority: '高',
                  plan_month: '2026-05',
                },
              ],
            },
          },
        )
        expect(saved.ok()).toBeTruthy()
        const savedBody = (await saved.json()) as { revision: number }
        expect(savedBody.revision).toBeGreaterThan(draft.revision)
      }
      await page.goto('/capability/assessment')
      await expect(
        page.getByRole('heading', { name: '能力评级与提升计划' }),
      ).toBeVisible()
      const summary = page.getByLabel('评估摘要')
      await expect(summary).toBeVisible({ timeout: 15000 })
      await expect(page.getByTestId('assessment-table').first()).toBeVisible()
      await expect(page.getByTestId('gap-sidebar')).toHaveCount(0)
    })

    test('semantic alignment', async ({ page }) => {
      const summary = page.getByLabel('评估摘要')
      await expect(summary).toContainText('能力域')
      await expect(summary).toContainText('三级能力项')
      await expect(summary).toContainText('已评级')
      await expect(summary).toContainText('存在差距')
      await expect(summary).toContainText('已加入计划')

      const tables = page.getByTestId('assessment-table')
      await expect(tables.first()).toBeVisible()
      const firstTable = tables.first()
      // Issue #194 P1: #61 七列表格合同由权威原型 M02 V1 四区行头合法替代
      await expect(firstTable).toContainText('能力项')
      await expect(firstTable).toContainText('当前评级')
      await expect(firstTable).toContainText('目标与差距')
      await expect(firstTable).toContainText('提升计划')
      await expect(firstTable).toContainText('Gap：')
      const priority = page.locator('select[aria-label^="优先级"]').first()
      await expect(priority).toBeVisible()
      await expect(priority).toHaveValue('高')
      await expect(
        page.locator('input[type="month"][aria-label^="计划月份"]').first(),
      ).toHaveValue('2026-05')
      await expect(page.getByText('职级要求').first()).toBeVisible()

      await expect(
        page.getByRole('navigation', { name: '一级能力域导航' }),
      ).toBeVisible()
      await expect(
        page.getByRole('button', { name: '查看 Gap 摘要' }),
      ).toHaveCount(0)

      const metrics = await page
        .getByTestId('assessment-content-area')
        .evaluate((content) => {
          const sticky = document.querySelector('[class*="stickyActions"]')
          const stickyRect = sticky?.getBoundingClientRect()
          const stickyTop = stickyRect?.top ?? window.innerHeight
          // Issue #194 P1: 能力项行容器为 div[id^="row-"]（原七列表格已退役）。
          const rows = [...content.querySelectorAll('[id^="row-"]')].filter(
            (row) => {
              const rect = row.getBoundingClientRect()
              return rect.top >= 0 && rect.bottom <= stickyTop
            },
          ).length
          const visibleRows = [
            ...content.querySelectorAll('[id^="row-"]'),
          ].filter((row) => {
            const rect = row.getBoundingClientRect()
            return rect.top >= 0 && rect.bottom <= stickyTop
          })
          const lastVisibleRow = visibleRows.at(-1)?.getBoundingClientRect()
          return {
            rows,
            lastVisibleRowBottom: lastVisibleRow?.bottom ?? 0,
            stickyTop,
          }
        })
      // Issue #194 P1: 权威原型 M02 V1 四区行（min-height 92px + 逐档评级
      // 按钮）合法替代紧凑七列行，首屏完整行数按原型行高重新标定：
      // 实测 1440x900=3、1920x1080=4、1280x800=2，阈值取实测-1 作稳定下界。
      // 首屏实质性内容合同不变：L2 职级要求行内头部 + 至少一行 L3 达成路径。
      const minCompleteRows: Record<string, number> = {
        '1440x900': 2,
        '1920x1080': 3,
        '1280x800': 1,
      }
      expect(metrics.rows).toBeGreaterThanOrEqual(
        minCompleteRows[viewport.name],
      )
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth),
      ).toBeLessThanOrEqual(viewport.width)
      expect(metrics.lastVisibleRowBottom).toBeLessThanOrEqual(
        metrics.stickyTop + 1,
      )

      await page.goto('/capability/gap')
      await expect(
        page.getByRole('heading', { name: '能力评级与提升计划' }),
      ).toBeVisible()
      await expect(page.getByTestId('assessment-table').first()).toBeVisible()
    })

    test('assessment overview screenshot', async ({ page }) => {
      await expect(page).toHaveScreenshot(
        `ui-02-assessment-overview-${viewport.name}.png`,
        { maxDiffPixelRatio: 0.05 },
      )
      const evidenceDir = process.env.ISSUE50_SCREENSHOT_DIR
      if (evidenceDir) {
        await page.screenshot({
          path: path.join(evidenceDir, `assessment-${viewport.name}.png`),
          fullPage: false,
        })
      }
    })
  })
}

import { expect, test, type Page } from '@playwright/test'

import { loginAs } from '../fixtures/auth'
import { mockTeamAnnualPlanData } from '../fixtures/team-annual-plan-mock'

const VIEWPORTS = [
  { name: '1920x1080', width: 1920, height: 1080 },
  { name: '1440x900', width: 1440, height: 900 },
  { name: '1280x800', width: 1280, height: 800 },
] as const

async function assertPlanItemTable(page: Page) {
  const table = page.locator(
    'section[aria-label="团队年度计划正式项列表"] .analytics-table',
  )
  await expect(table).toBeVisible()
  for (const heading of ['成员', '能力路径', '优先级', '月份', '季度', '状态']) {
    await expect(table).toContainText(heading)
  }
  await expect(table).toContainText('张三')
  await expect(table).toContainText('李四')
  await expect(table).toContainText('数据建模与治理')
  await expect(table).toContainText('技术创新提案')
}

for (const viewport of VIEWPORTS) {
  test.describe(`Team Annual Plan visual regression @ ${viewport.name}`, () => {
    test.beforeEach(async ({ page }) => {
      await page.setViewportSize(viewport)
      await mockTeamAnnualPlanData(page)
    })

    test('semantic alignment for Leader', async ({ page }) => {
      await loginAs(page, 'leader')
      await page.goto('/operations/team-annual-plan')
      await expect(
        page.getByRole('heading', { name: '团队年度能力规划', exact: true }),
      ).toBeVisible()
      await expect(
        page.getByRole('heading', { name: '团队年度计划正式项' }),
      ).toBeVisible()
      await expect(
        page.getByRole('heading', { name: '团队年度能力规划管理' }),
      ).toBeVisible()

      await assertPlanItemTable(page)

      const filters = page.getByLabel('年度计划项筛选与排序')
      for (const label of [
        '年度计划项年度',
        '能力域筛选',
        '优先级筛选',
        '状态筛选',
        '季度筛选',
        '月份筛选',
        '成员筛选',
        '搜索计划项',
        '排序字段',
        '排序顺序',
        '每页条数',
      ]) {
        await expect(filters.getByLabel(label)).toBeVisible()
      }

      await expect(page.getByText('数据范围：leader_team')).toBeVisible()
      await expect(page.getByText('TACP-2026')).toBeVisible()
      await expect(page.getByText('更新')).toBeVisible()
      await expect(page.getByText('归档')).toBeVisible()
    })

    test('default full viewport screenshot for Leader', async ({ page }) => {
      await loginAs(page, 'leader')
      await page.goto('/operations/team-annual-plan')
      await assertPlanItemTable(page)
      await expect(page.getByText('TACP-2026')).toBeVisible()
      await page.evaluate(() => window.scrollTo(0, 0))
      await expect(page).toHaveScreenshot(
        `team-annual-plan-${viewport.name}.png`,
        { fullPage: false, maxDiffPixels: 1500 },
      )
    })

    test('Member sees read-only list without management controls', async ({
      page,
    }) => {
      await loginAs(page, 'member')
      await page.goto('/operations/team-annual-plan')
      await expect(
        page.getByRole('heading', { name: '团队年度计划正式项' }),
      ).toBeVisible()
      await assertPlanItemTable(page)
      await expect(page.getByText('发布')).not.toBeVisible()
      await expect(page.getByText('更新')).not.toBeVisible()
      await expect(page.getByText('归档')).not.toBeVisible()
    })
  })
}

test.describe('Team Annual Plan permission boundary', () => {
  test('Member can access the read-only PlanItem list', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    await mockTeamAnnualPlanData(page)
    await loginAs(page, 'member')
    await page.goto('/operations/team-annual-plan')
    await expect(
      page.getByRole('heading', { name: '团队年度计划正式项' }),
    ).toBeVisible()
  })

  test('Buddy can access the read-only PlanItem list', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    await mockTeamAnnualPlanData(page)
    await loginAs(page, 'buddy')
    await page.goto('/operations/team-annual-plan')
    await expect(
      page.getByRole('heading', { name: '团队年度计划正式项' }),
    ).toBeVisible()
  })
})

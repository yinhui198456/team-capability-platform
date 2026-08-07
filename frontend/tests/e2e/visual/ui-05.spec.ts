import { expect, test, type Page } from '@playwright/test'

import { loginAs } from '../fixtures/auth'
import {
  mockTeamAnalyticsData,
  mockTeamAnalyticsEmptyData,
} from '../fixtures/team-analytics-mock'

const VIEWPORTS = [
  { name: '1920x1080', width: 1920, height: 1080 },
  { name: '1440x900', width: 1440, height: 900 },
  { name: '1280x800', width: 1280, height: 800 },
] as const

// Snapshot-invariant business assertions for a given filter state.
// These values are produced by the deterministic fixture and must be
// identical across both viewports.
const EXPECTED_DEFAULT = {
  planCompletionRate: '58%',
  evidencePassRate: '75%',
  overdueCount: '3',
  p01Actual: '3',
  p01Target: '4',
  zhangsanP01: '63%',
  lisiP02: '40%',
}

const EXPECTED_ZHANGSAN = {
  planCompletionRate: '50%',
  evidencePassRate: '67%',
  overdueCount: '1',
  p01Actual: '2.5',
  p01Target: '4',
  zhangsanP01: '63%',
}

const EXPECTED_P01 = {
  planCompletionRate: '55%',
  evidencePassRate: '70%',
  overdueCount: '1',
  domainRows: 1,
  p01Actual: '3',
  p01Target: '4',
}

const EXPECTED_LISI_P02 = {
  planCompletionRate: '40%',
  evidencePassRate: '50%',
  overdueCount: '1',
  p02Actual: '1.4',
  p02Target: '3.5',
  lisiP02: '40%',
}

async function assertKpis(
  page: Page,
  expected: {
    planCompletionRate: string
    evidencePassRate: string
    overdueCount: string
  },
) {
  const kpis = page.getByLabel('团队关键指标')
  await expect(kpis).toContainText(`计划完成率${expected.planCompletionRate}`)
  await expect(kpis).toContainText(
    `任务成果证明 通过率${expected.evidencePassRate}`,
  )
  await expect(kpis).toContainText(`延期计划项${expected.overdueCount}`)
}

for (const viewport of VIEWPORTS) {
  test.describe(`UI-05 team capability analysis visual regression @ ${viewport.name}`, () => {
    test.beforeEach(async ({ page }) => {
      await page.setViewportSize(viewport)
      await mockTeamAnalyticsData(page)
      await loginAs(page, 'leader')
      await page.goto('/operations/analytics')
      await expect(
        page.getByRole('heading', { name: '团队能力分析' }),
      ).toBeVisible()
      await expect(page.getByLabel('团队关键指标')).toBeVisible()
      await page.evaluate(() => window.scrollTo(0, 0))
    })

    test('semantic alignment', async ({ page }) => {
      const filters = page.getByLabel('团队能力分析筛选')
      await expect(filters.getByLabel('成员')).toContainText('全部')
      await expect(filters.getByLabel('能力域')).toContainText('全部')
      await expect(filters.getByLabel('能力域')).toContainText(
        'P01 · Data Infra',
      )
      await expect(filters.getByLabel('能力域')).toContainText('C03 · 学习创新')

      const kpis = page.getByLabel('团队关键指标')
      for (const label of ['计划完成率', '任务成果证明 通过率', '延期计划项']) {
        await expect(kpis).toContainText(label)
      }
      const gaps = page.getByLabel('差距分布')
      await expect(gaps).toContainText('当前必修差距')
      await expect(gaps).toContainText('进阶目标差距')
      // Self-assessment rate must not appear per Issue #28
      await expect(kpis).not.toContainText('自评完成率')

      for (const heading of [
        'L3 掌握度实际 vs 目标',
        '成员 L3 掌握度达成率',
        '计划完成趋势',
        '学习时长趋势',
        '延期计划项明细',
      ]) {
        await expect(page.getByRole('heading', { name: heading })).toBeVisible()
      }

      await expect(page.getByLabel('计划完成组合图')).toBeVisible()
      await expect(page.getByLabel('学习时长组合图')).toBeVisible()
      await expect(page.getByLabel('P01当前掌握度均值')).toBeVisible()
      await expect(page.getByLabel('P01目标掌握度均值')).toBeVisible()
      await expect(
        page.getByText('不代表二级能力标准 P4–P8 岗位职级达成率。'),
      ).toBeVisible()

      // Fixed legend must be present
      const legends = page.locator('ul.trend-legend')
      await expect(legends.first()).toContainText('当月计划')
      await expect(legends.first()).toContainText('当月实际')
      await expect(legends.first()).toContainText('累计计划')
      await expect(legends.first()).toContainText('累计实际')

      // Year selector cleanup: only Topbar YearContext selector exists
      const topbar = page.locator('.app-topbar')
      await expect(topbar.getByLabel('选择年度')).toBeVisible()
      const content = page.locator('.app-content')
      await expect(content.getByLabel('年度')).not.toBeVisible()
      await expect(
        content.getByRole('spinbutton', { name: '年度' }),
      ).not.toBeVisible()

      // Domain table labels must state L3 mastery means, not generic targets.
      const domainTable = page.locator(
        '.dashboard-card:has-text("L3 掌握度实际 vs 目标") .analytics-table',
      )
      await expect(domainTable).toContainText('当前掌握度均值（1–5）')
      await expect(domainTable).toContainText('目标掌握度均值（1–5）')

      const overdueTable = page.locator(
        '.dashboard-card:has-text("延期计划项明细") .analytics-table',
      )
      await expect(overdueTable).toContainText('二级能力标准 → 三级达成路径')
      await expect(overdueTable).toContainText(
        'P01-L2A · 数据建模标准 → P01-L2A-L3A · 数据建模与治理',
      )
    })

    // Screenshot: default page (full viewport = Topbar + Sidebar + content)
    test('default full viewport screenshot', async ({ page }) => {
      await assertKpis(page, EXPECTED_DEFAULT)
      await expect(page.getByRole('row', { name: /张三/ })).toContainText(
        EXPECTED_DEFAULT.zhangsanP01,
      )
      await expect(page.getByRole('row', { name: /李四/ })).toContainText(
        EXPECTED_DEFAULT.lisiP02,
      )
      await expect(page).toHaveScreenshot(
        `ui-05-team-capability-analysis-${viewport.name}.png`,
        { fullPage: false, maxDiffPixels: 1500 },
      )
    })

    // Screenshot + cascade: member filter selected
    test('member filter screenshot', async ({ page }) => {
      const filters = page.getByLabel('团队能力分析筛选')
      await filters.getByLabel('成员').selectOption({ label: '张三' })
      await page.waitForResponse(
        (resp) =>
          resp.url().includes('/api/planning/team-analytics') &&
          resp.status() === 200,
      )
      await assertKpis(page, EXPECTED_ZHANGSAN)
      await expect(page.getByRole('row', { name: /张三/ })).toContainText(
        EXPECTED_ZHANGSAN.zhangsanP01,
      )
      await expect(page.getByLabel('团队关键指标')).toBeVisible()
      await page.evaluate(() => window.scrollTo(0, 0))
      await expect(page).toHaveScreenshot(
        `ui-05-team-capability-analysis-member-${viewport.name}.png`,
        { fullPage: false, maxDiffPixels: 1500 },
      )
    })

    // Screenshot + cascade: domain filter selected
    test('domain filter screenshot', async ({ page }) => {
      const filters = page.getByLabel('团队能力分析筛选')
      await filters
        .getByLabel('能力域')
        .selectOption({ label: 'P01 · Data Infra' })
      await page.waitForResponse(
        (resp) =>
          resp.url().includes('/api/planning/team-analytics') &&
          resp.status() === 200,
      )
      await assertKpis(page, EXPECTED_P01)
      const domainTable = page.locator(
        '.dashboard-card:has-text("L3 掌握度实际 vs 目标") .analytics-table',
      )
      await expect(domainTable.locator('tbody tr')).toHaveCount(
        EXPECTED_P01.domainRows,
      )
      await expect(page.getByLabel('团队关键指标')).toBeVisible()
      await page.evaluate(() => window.scrollTo(0, 0))
      await expect(page).toHaveScreenshot(
        `ui-05-team-capability-analysis-domain-${viewport.name}.png`,
        { fullPage: false, maxDiffPixels: 1500 },
      )
    })

    // Screenshot + cascade: member + domain combined filter
    test('combined filter screenshot', async ({ page }) => {
      const filters = page.getByLabel('团队能力分析筛选')
      await filters.getByLabel('成员').selectOption({ label: '李四' })
      await page.waitForResponse(
        (resp) =>
          resp.url().includes('/api/planning/team-analytics') &&
          resp.status() === 200,
      )
      await filters
        .getByLabel('能力域')
        .selectOption({ label: 'P02 · AI Infra / Agent' })
      await page.waitForResponse(
        (resp) =>
          resp.url().includes('/api/planning/team-analytics') &&
          resp.status() === 200,
      )
      await assertKpis(page, EXPECTED_LISI_P02)
      await expect(page.getByRole('row', { name: /李四/ })).toContainText(
        EXPECTED_LISI_P02.lisiP02,
      )
      await expect(page.getByLabel('团队关键指标')).toBeVisible()
      await page.evaluate(() => window.scrollTo(0, 0))
      await expect(page).toHaveScreenshot(
        `ui-05-team-capability-analysis-combined-${viewport.name}.png`,
        { fullPage: false, maxDiffPixels: 1500 },
      )
    })

    // Screenshot: overdue detail drawer open
    test('overdue drawer open screenshot', async ({ page }) => {
      const rows = page.locator('.analytics-table .clickable')
      await expect(rows.first()).toBeVisible()
      await rows.first().click()
      const drawer = page.getByRole('dialog', { name: '延期计划项详情' })
      await expect(drawer).toBeVisible()
      await expect(drawer.getByRole('document')).toContainText('延期计划项详情')
      await expect(drawer.getByRole('document')).toContainText('只读')
      await expect(drawer.getByRole('document')).toContainText('计划开始日期')
      await expect(drawer.getByRole('document')).toContainText('计划结束日期')
      await expect(page).toHaveScreenshot(
        `ui-05-team-capability-analysis-drawer-${viewport.name}.png`,
        { fullPage: false, maxDiffPixels: 1500 },
      )
      // Keyboard close
      await page.keyboard.press('Escape')
      await expect(drawer).not.toBeVisible()
    })

    // Screenshot: empty state
    test('empty state screenshot', async ({ page }) => {
      await mockTeamAnalyticsEmptyData(page)
      await page.goto('/operations/analytics')
      await expect(
        page.getByRole('heading', { name: '团队能力分析' }),
      ).toBeVisible()
      await expect(page.getByLabel('团队关键指标')).toContainText('0%')
      await expect(page.getByText('暂无延期计划项。')).toBeVisible()
      await page.evaluate(() => window.scrollTo(0, 0))
      await expect(page).toHaveScreenshot(
        `ui-05-team-capability-analysis-empty-${viewport.name}.png`,
        { fullPage: false, maxDiffPixels: 1500 },
      )
    })
  })
}

// Cross-viewport numeric consistency: same filter state must yield identical KPI text.
test.describe('UI-05 cross-viewport business value consistency', () => {
  for (const scenario of [
    {
      label: 'default',
      url: '/operations/analytics',
      expected: EXPECTED_DEFAULT,
    },
    {
      label: 'zhangsan',
      url: '/operations/analytics?year=2026',
      member: '张三',
      expected: EXPECTED_ZHANGSAN,
    },
    {
      label: 'p01',
      url: '/operations/analytics?year=2026',
      domain: 'P01 · Data Infra',
      expected: EXPECTED_P01,
    },
    {
      label: 'lisi-p02',
      url: '/operations/analytics?year=2026',
      member: '李四',
      domain: 'P02 · AI Infra / Agent',
      expected: EXPECTED_LISI_P02,
    },
  ] as const) {
    for (const viewport of VIEWPORTS) {
      test(`${scenario.label} @ ${viewport.name}`, async ({ page }) => {
        await page.setViewportSize(viewport)
        await mockTeamAnalyticsData(page)
        await loginAs(page, 'leader')
        await page.goto(scenario.url)
        await expect(
          page.getByRole('heading', { name: '团队能力分析' }),
        ).toBeVisible()

        const filters = page.getByLabel('团队能力分析筛选')
        if (scenario.member) {
          await filters
            .getByLabel('成员')
            .selectOption({ label: scenario.member })
          await page.waitForResponse(
            (resp) =>
              resp.url().includes('/api/planning/team-analytics') &&
              resp.status() === 200,
          )
        }
        if (scenario.domain) {
          await filters
            .getByLabel('能力域')
            .selectOption({ label: scenario.domain })
          await page.waitForResponse(
            (resp) =>
              resp.url().includes('/api/planning/team-analytics') &&
              resp.status() === 200,
          )
        }

        const kpis = page.getByLabel('团队关键指标')
        await expect(
          kpis.locator('article:has-text("计划完成率") strong'),
        ).toHaveText(scenario.expected.planCompletionRate)
        await expect(
          kpis.locator('article:has-text("任务成果证明 通过率") strong'),
        ).toHaveText(scenario.expected.evidencePassRate)
        await expect(
          kpis.locator('article:has-text("延期计划项") strong'),
        ).toHaveText(scenario.expected.overdueCount)
      })
    }
  }
})

test.describe('UI-05 team capability analysis permission boundary', () => {
  test('Member can access scoped team analytics', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    await mockTeamAnalyticsData(page)
    await loginAs(page, 'member')
    await page.goto('/operations/analytics')
    await expect(
      page.getByRole('heading', { name: '团队能力分析' }),
    ).toBeVisible()
    await expect(page.getByLabel('团队关键指标')).toBeVisible()
  })

  test('Buddy can access scoped team analytics', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    await mockTeamAnalyticsData(page)
    await loginAs(page, 'buddy')
    await page.goto('/operations/analytics')
    await expect(
      page.getByRole('heading', { name: '团队能力分析' }),
    ).toBeVisible()
    await expect(page.getByLabel('团队关键指标')).toBeVisible()
  })
})

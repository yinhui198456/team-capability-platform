import { expect, test, type Page } from '@playwright/test'
import { mkdirSync } from 'node:fs'
import path from 'node:path'

/**
 * Issue #175 — isolated Member monthly-review layout check.
 *
 * Mocks auth and API routes entirely (no login, no database, no shared
 * runtime writes).  Layout is asserted structurally (grid tracks, viewport
 * bounding boxes, horizontal overflow) instead of fragile pixel diffs;
 * screenshots are saved under tests/e2e/evidence/issue175/ as PR-referable
 * first-screen evidence.
 */
test.use({
  locale: 'zh-CN',
  timezoneId: 'Asia/Shanghai',
})

const VIEWPORTS = [
  { name: '1440x900', width: 1440, height: 900 },
  { name: '1024x900', width: 1024, height: 900 },
  { name: '768x900', width: 768, height: 900 },
] as const

const memberUser = {
  id: 1,
  username: 'member',
  full_name: 'Member',
  roles: ['Member'],
}

// Deterministic payload matching the unit-test fixture shape; summary and
// details stay reconcilable (planned = 5, one row per visible state).
const reviewPayload = {
  summary: {
    planned_count: 5,
    completed_count: 1,
    in_progress_count: 1,
    delayed_count: 1,
    paused_count: 1,
    cancelled_count: 1,
    completion_rate: 0.2,
    actual_hours: 2,
    estimated_hours_summary: {
      min_hours: 16,
      max_hours: 18,
      has_values: true,
      has_unparsed: false,
    },
  },
  details: [
    {
      plan_item_id: 11,
      task_id: 21,
      l3_code: 'P01.01.01',
      status: '已完成',
      estimated_hours: '6-8',
      estimated_hours_parsed: {
        raw: '6-8',
        min_hours: 6,
        max_hours: 8,
        is_valid: true,
        is_range: true,
      },
      actual_hours: 2,
    },
    {
      plan_item_id: 12,
      task_id: 22,
      l3_code: 'C01.01.01',
      status: '延期',
      estimated_hours: null,
      estimated_hours_parsed: {
        raw: null,
        min_hours: null,
        max_hours: null,
        is_valid: false,
        is_range: false,
      },
      actual_hours: 0,
    },
    {
      plan_item_id: 13,
      task_id: 23,
      l3_code: 'P02.01.01',
      status: '进行中',
      estimated_hours: '10',
      estimated_hours_parsed: {
        raw: '10',
        min_hours: 10,
        max_hours: 10,
        is_valid: true,
        is_range: false,
      },
      actual_hours: 0,
    },
    {
      plan_item_id: 14,
      task_id: null,
      l3_code: 'C03.01.01',
      status: '取消',
      estimated_hours: '随时',
      estimated_hours_parsed: {
        raw: '随时',
        min_hours: null,
        max_hours: null,
        is_valid: false,
        is_range: false,
      },
      actual_hours: 0,
    },
    {
      plan_item_id: 15,
      task_id: null,
      l3_code: 'P03.01.02',
      status: '暂停',
      estimated_hours: null,
      estimated_hours_parsed: {
        raw: null,
        min_hours: null,
        max_hours: null,
        is_valid: false,
        is_range: false,
      },
      actual_hours: 0,
    },
  ],
  written: {
    id: 9,
    member_id: 1,
    year: 2026,
    month: 5,
    revision: 2,
    main_output: '完成数据建模规范初稿',
    problems: '排期紧张',
    next_month_focus: '推进 C01 任务',
    notes: '备注文本',
    created_at: '2026-05-31T10:00:00Z',
    updated_at: '2026-06-02T09:00:00Z',
  },
  history: [
    {
      revision: 1,
      main_output: '完成数据建模规范初稿',
      problems: null,
      next_month_focus: null,
      notes: null,
      changed_by: 1,
      changed_at: '2026-05-31T10:00:00Z',
    },
    {
      revision: 2,
      main_output: '完成数据建模规范初稿',
      problems: '排期紧张',
      next_month_focus: '推进 C01 任务',
      notes: '备注文本',
      changed_by: 1,
      changed_at: '2026-06-02T09:00:00Z',
    },
  ],
  meta: {
    year: 2026,
    month: 5,
    scope: '本人',
    as_of: '2026-06-02T09:00:00Z',
    source: 'monthly_review.v1',
  },
}

function routeMocks(page: Page) {
  return Promise.all([
    page.route('**/api/auth/me', async (route) => {
      await route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify(memberUser),
      })
    }),
    page.route('**/api/planning/available-years', async (route) => {
      await route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({ available_years: [2026], active_year: 2026 }),
      })
    }),
    page.route('**/api/planning/monthly-reviews*', async (route) => {
      await route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify(reviewPayload),
      })
    }),
  ])
}

function evidenceDir(): string {
  const dir = path.resolve('tests/e2e/evidence/issue175')
  mkdirSync(dir, { recursive: true })
  return dir
}

for (const viewport of VIEWPORTS) {
  test(`monthly review layout @ ${viewport.name}`, async ({ page }) => {
    await page.setViewportSize(viewport)
    await routeMocks(page)
    await page.goto('/growth/review/monthly?year=2026&month=5')

    await expect(
      page.getByRole('heading', { name: '月度复盘', level: 1 }),
    ).toBeVisible()
    await expect(page.getByTestId('monthly-summary')).toBeVisible()

    // 1) 汇总为自适应网格而非单列纵向堆叠（Issue #175 根因回归）。
    const summaryGrid = await page.evaluate(() => {
      const dl = document.querySelector('[data-testid="monthly-summary"] dl')
      const cs = getComputedStyle(dl as HTMLElement)
      return {
        display: cs.display,
        tracks: cs.gridTemplateColumns.split(' ').length,
      }
    })
    expect(summaryGrid.display).toBe('grid')
    expect(summaryGrid.tracks).toBeGreaterThan(1)

    // 2) 无页面级横向溢出（关键内容不裁切）。
    const overflow = await page.evaluate(() => ({
      doc: document.documentElement.scrollWidth - window.innerWidth,
      body: document.body.scrollWidth - window.innerWidth,
    }))
    expect(overflow.doc).toBeLessThanOrEqual(0)
    expect(overflow.body).toBeLessThanOrEqual(0)

    // 3) 异常/待处理项（延期、暂停、取消）默认展示；完整明细默认折叠。
    const anomalyTable = page.getByTestId('anomaly-table')
    await expect(anomalyTable).toBeVisible()
    await expect(anomalyTable).toContainText('延期')
    await expect(anomalyTable).toContainText('暂停')
    await expect(anomalyTable).toContainText('取消')
    const fullTable = page.locator(
      '[data-testid="monthly-details"] details table',
    )
    await expect(fullTable).toHaveCount(1)
    await expect(fullTable.locator('tbody tr').first()).not.toBeVisible()

    // 4) 首屏（1440×900）：复盘表单标题与首个输入项均落在视口内。
    if (viewport.name === '1440x900') {
      await expect(
        page.getByRole('heading', { name: '本月复盘填写', level: 2 }),
      ).toBeVisible()
      const firstInput = await page.getByLabel('本月主要产出').boundingBox()
      expect(firstInput).not.toBeNull()
      expect(firstInput!.y).toBeGreaterThanOrEqual(0)
      expect(firstInput!.y + firstInput!.height).toBeLessThanOrEqual(900)
    }

    // 5) 截图证据（默认折叠状态的纯净首屏）：必须在任何会改变
    // 焦点/滚动位置的交互（768 fill、details 展开）之前完成，
    // 保证同一视觉命令连续运行的产物字节稳定。
    await page.screenshot({
      path: path.join(evidenceDir(), `monthly-review-${viewport.name}.png`),
    })

    // 6) 768：表单可填写；异常表行不超出视口宽度。
    if (viewport.name === '768x900') {
      await page.getByLabel('本月主要产出').fill('布局检查填写内容')
      await expect(page.getByLabel('本月主要产出')).toHaveValue(
        '布局检查填写内容',
      )
      const anomalyRow = anomalyTable.locator('tbody tr').first()
      await expect(anomalyRow).toBeVisible()
      const rowBox = await anomalyRow.boundingBox()
      expect(rowBox).not.toBeNull()
      expect(rowBox!.x).toBeGreaterThanOrEqual(0)
      expect(rowBox!.x + rowBox!.width).toBeLessThanOrEqual(768)
    }

    // 7) 展开完整明细后可见非异常状态行。
    await page.getByText('查看完整明细（5 项）').click()
    await expect(fullTable.locator('tbody tr').first()).toBeVisible()
    await expect(fullTable).toContainText('已完成')
  })
}

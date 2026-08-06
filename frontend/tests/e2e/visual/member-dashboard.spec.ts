import { expect, test, type Page } from '@playwright/test'

import { loginAs } from '../fixtures/auth'

/** Pin the visual regression to a deterministic browser environment so the
  snapshot is reproducible in the canonical CI container and on local dev
  machines regardless of host locale/timezone. */
test.use({
  locale: 'zh-CN',
  timezoneId: 'Asia/Shanghai',
})

const VIEWPORTS = [
  { name: '1440x900', width: 1440, height: 900 },
  { name: '1280x800', width: 1280, height: 800 },
] as const

/** Deterministic dashboard fixture: exactly one in-progress task, one gap,
  and stable derived numbers.  This decouples UI-01 from the shared mutable
  database; earlier specs that create cross-year tasks cannot pollute the
  snapshot because the route intercept replaces the backend response. */
const deterministicDashboard = {
  year: 2026,
  meta: {
    year: 2026,
    scope: '本人',
    as_of: '2026-08-04T00:00:00Z',
    source: 'member_dashboard.v1',
    denominator_source: 'assessment_details',
  },
  gap_summary: {
    current_required: 1,
    target_progressive: 0,
    derivation: 'scope_v1',
  },
  current_month: {
    planned_count: 1,
    planned_ids: [1],
    in_progress_count: 1,
    delayed_count: 0,
    pending_evidence_count: 0,
    actual_hours: 4,
  },
  next_action: {
    action_key: 'submit_evidence',
    message: '提交待提交的学习证据',
    count: 0,
  },
  assessment: {
    id: 1,
    status: '已归档',
    submitted_at: '2026-01-02T00:00:00Z',
    archived_at: '2026-01-03T00:00:00Z',
    review_status: '已闭环',
    review_conclusion: '认可',
    member_current_level_snapshot: null,
    member_target_level_snapshot: null,
    applicable_completion: { total: 1, completed: 1, ratio: 1 },
  },
  annual_plan_status: '执行中',
  summary: {
    annual_actual_hours: 4,
    annual_planned_hours: 10,
    annual_planned_hours_min: 10,
    annual_planned_hours_max: 10,
    annual_planned_hours_has_values: true,
    annual_planned_hours_has_unparsed: false,
    current_month_actual_hours: 4,
    current_month_planned_hours: 10,
    current_month_planned_hours_min: 10,
    current_month_planned_hours_max: 10,
    current_month_planned_hours_has_values: true,
    current_month_planned_hours_has_unparsed: false,
    completed_task_count: 0,
    pending_evidence_to_submit: 0,
    pending_evidence_to_review: 0,
  },
  plan_progress: {
    total: 1,
    未开始: 0,
    进行中: 1,
    已完成: 0,
    延期: 0,
    暂停: 0,
    取消: 0,
  },
  domain_radar: [
    { domain_code: 'P01', score: 3.2 },
    { domain_code: 'P02', score: 2.8 },
    { domain_code: 'P03', score: 3.5 },
    { domain_code: 'C01', score: 4.0 },
    { domain_code: 'C02', score: 3.1 },
    { domain_code: 'C03', score: 2.5 },
  ],
  gaps: [
    {
      id: 1,
      assessment_id: 1,
      l1_code: 'P01',
      l1_name: '数据基础设施',
      l2_code: 'P01.01',
      l2_name: '数据基础',
      l3_code: 'P01.01.01',
      l3_name: '数据建模与设计',
      current_level: 2,
      target_level: 4,
      gap_value: 2,
      priority: '中',
      plan_candidate: true,
    },
  ],
  current_tasks: [
    {
      id: 1,
      plan_item_id: 1,
      l1_code: 'P01',
      l1_name: '数据基础设施',
      l2_code: 'P01.01',
      l2_name: '数据基础',
      l3_code: 'P01.01.01',
      l3_name: '数据建模与设计',
      status: '进行中',
      actual_start_date: '2026-03-01',
      actual_end_date: null,
      actual_hours: 4,
      completion_quality: null,
      review_conclusion: null,
      next_action: '完成数据口径梳理文档',
      revision: 0,
      actual_started_at: '2026-03-01T00:00:00Z',
      actual_completed_at: null,
      delay_reason: null,
      pause_reason: null,
      cancel_reason: null,
      revised_due_date: null,
      plan_item_current_level: 2,
      plan_item_target_level: 4,
      plan_item_priority: '中',
      plan_item_learning_material: '数据工程指南',
      plan_item_learning_task_content: '搭建数据管道并完成文档',
      plan_item_expected_output: '数据管道 + 口径文档',
      plan_item_estimated_hours: '24',
      plan_item_target_month: 3,
    },
  ],
}

function routeDashboard(page: Page) {
  return page.route('**/api/planning/member-dashboard**', async (route) => {
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify(deterministicDashboard),
    })
  })
}

for (const viewport of VIEWPORTS) {
  test.describe(`UI-01 Member dashboard visual regression @ ${viewport.name}`, () => {
    test.beforeEach(async ({ page }) => {
      await page.setViewportSize(viewport)
      await loginAs(page, 'member')
      await routeDashboard(page)
      // Pin to 2026: the intercepted payload is fixed to that year; the
      // active-year resolver otherwise follows future-year smoke drafts.
      await page.goto('/dashboard/member?year=2026')
      await expect(page.getByText('我的成长总览')).toBeVisible()
      // Wait for async dashboard data to avoid screenshot height instability
      await expect(page.getByTestId('current-tasks-table')).toBeVisible()
      await expect(
        page.getByTestId('current-tasks-table').locator('tbody tr'),
      ).not.toHaveCount(0)
    })

    test('semantic alignment', async ({ page }) => {
      // 学习时长单位应为 h 而非 小时
      const hourUnits = page.locator('.hours-unit')
      await expect.poll(async () => hourUnits.count()).toBeGreaterThanOrEqual(3)
      for (const unit of await hourUnits.all()) {
        const text = await unit.textContent()
        expect(text).toContain('h')
        expect(text).not.toContain('小时')
      }

      // 六个能力域中文描述应出现在能力域筛选中
      const domainFilter = page.getByTestId('domain-filter')
      await expect(domainFilter).toContainText('数据基础设施')
      await expect(domainFilter).toContainText('AI Infra / Agent')
      await expect(domainFilter).toContainText('工程编码')
      await expect(domainFilter).toContainText('基本办公能力')
      await expect(domainFilter).toContainText('沟通协作')
      await expect(domainFilter).toContainText('学习创新')

      // 待办事项 4 个图标卡片文案
      const todoCard = page.getByTestId('todo-card')
      await expect(todoCard.getByText('待提交任务成果证明')).toBeVisible()
      await expect(todoCard.getByText('待 Buddy 复核')).toBeVisible()
      await expect(todoCard.getByText('计划到期')).toBeVisible()
      await expect(todoCard.getByText('学习任务延期')).toBeVisible()

      // 当前学习任务表格应出现至少一行
      const taskTable = page.getByTestId('current-tasks-table')
      await expect(taskTable).toBeVisible()
      const taskRows = taskTable.locator('tbody tr')
      await expect.poll(async () => taskRows.count()).toBeGreaterThan(0)
    })

    test('full page screenshot', async ({ page }) => {
      await expect(page).toHaveScreenshot(
        `member-dashboard-full-${viewport.name}.png`,
        { maxDiffPixelRatio: 0.05, fullPage: true },
      )
    })

    test('learning hours card screenshot', async ({ page }) => {
      const card = page.getByTestId('learning-hours-card')
      await expect(card).toHaveScreenshot(
        `member-dashboard-hours-${viewport.name}.png`,
        { maxDiffPixelRatio: 0.05 },
      )
    })

    test('todo card screenshot', async ({ page }) => {
      const card = page.getByTestId('todo-card')
      await expect(card).toHaveScreenshot(
        `member-dashboard-todo-${viewport.name}.png`,
        { maxDiffPixelRatio: 0.05 },
      )
    })
  })
}

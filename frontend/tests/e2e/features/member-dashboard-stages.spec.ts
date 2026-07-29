import { expect, test, type Page } from '@playwright/test'

import { loginAs } from '../fixtures/auth'

const baseRadar = [
  { domain_code: 'P01', score: 0 },
  { domain_code: 'P02', score: 0 },
  { domain_code: 'P03', score: 0 },
  { domain_code: 'C01', score: 0 },
  { domain_code: 'C02', score: 0 },
  { domain_code: 'C03', score: 0 },
]

const emptySummary = {
  annual_actual_hours: 0,
  annual_planned_hours: 0,
  current_month_actual_hours: 0,
  current_month_planned_hours: 0,
  completed_task_count: 0,
  pending_evidence_count: 0,
}

const emptyProgress = {
  total: 0,
  未开始: 0,
  进行中: 0,
  '待 Evidence Review': 0,
  已完成: 0,
  延期: 0,
}

function routeDashboard(page: Page, payload: object) {
  return page.route('**/api/planning/member-dashboard**', async (route) => {
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify(payload),
    })
  })
}

const selfAssessmentPayload = {
  year: 2026,
  assessment: null,
  annual_plan_status: null,
  summary: emptySummary,
  plan_progress: emptyProgress,
  domain_radar: baseRadar,
  gaps: [],
  current_tasks: [],
}

const pendingReviewPayload = {
  year: 2026,
  assessment: {
    id: 2,
    status: '待复核',
    submitted_at: '2026-02-01T00:00:00Z',
    archived_at: null,
    review_status: '待复核',
    review_conclusion: null,
  },
  annual_plan_status: null,
  summary: emptySummary,
  plan_progress: emptyProgress,
  domain_radar: [
    { domain_code: 'P01', score: 2 },
    { domain_code: 'P02', score: 0 },
    { domain_code: 'P03', score: 0 },
    { domain_code: 'C01', score: 0 },
    { domain_code: 'C02', score: 0 },
    { domain_code: 'C03', score: 0 },
  ],
  gaps: [
    {
      id: 1,
      assessment_id: 2,
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
      plan_candidate: false,
    },
  ],
  current_tasks: [],
}

const planPayload = {
  year: 2026,
  assessment: {
    id: 1,
    status: '已归档',
    submitted_at: '2026-01-02T00:00:00Z',
    archived_at: null,
    review_status: '已闭环',
    review_conclusion: '认可',
  },
  annual_plan_status: '执行中',
  summary: {
    annual_actual_hours: 4,
    annual_planned_hours: 10,
    current_month_actual_hours: 0,
    current_month_planned_hours: 10,
    completed_task_count: 0,
    pending_evidence_count: 1,
  },
  plan_progress: {
    total: 1,
    未开始: 0,
    进行中: 1,
    '待 Evidence Review': 0,
    已完成: 0,
    延期: 0,
  },
  domain_radar: [
    { domain_code: 'P01', score: 2 },
    { domain_code: 'P02', score: 0 },
    { domain_code: 'P03', score: 0 },
    { domain_code: 'C01', score: 0 },
    { domain_code: 'C02', score: 0 },
    { domain_code: 'C03', score: 0 },
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
      priority: '高',
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
      actual_start_date: null,
      actual_end_date: null,
      actual_hours: 4,
      completion_quality: null,
      review_conclusion: null,
      next_action: null,
      plan_item_current_level: 2,
      plan_item_target_level: 4,
      plan_item_priority: '高',
      plan_item_learning_material: null,
      plan_item_learning_task_content: '数据建模规范与实践',
      plan_item_expected_output: null,
      plan_item_estimated_hours: '10',
      plan_item_target_month: 7,
    },
  ],
}

const archivedPayload = {
  year: 2026,
  assessment: {
    id: 1,
    status: '已归档',
    submitted_at: '2026-01-02T00:00:00Z',
    archived_at: '2026-12-31T00:00:00Z',
    review_status: '已闭环',
    review_conclusion: '认可',
  },
  annual_plan_status: '已归档',
  summary: {
    annual_actual_hours: 10,
    annual_planned_hours: 10,
    current_month_actual_hours: 0,
    current_month_planned_hours: 0,
    completed_task_count: 1,
    pending_evidence_count: 0,
  },
  plan_progress: {
    total: 1,
    未开始: 0,
    进行中: 0,
    '待 Evidence Review': 0,
    已完成: 1,
    延期: 0,
  },
  domain_radar: [
    { domain_code: 'P01', score: 4 },
    { domain_code: 'P02', score: 0 },
    { domain_code: 'P03', score: 0 },
    { domain_code: 'C01', score: 0 },
    { domain_code: 'C02', score: 0 },
    { domain_code: 'C03', score: 0 },
  ],
  gaps: [],
  current_tasks: [],
}

test.describe('Member 工作台成长阶段', () => {
  test.beforeEach(async ({ page }) => {
    await loginAs(page, 'member')
  })

  test('未自评阶段：主按钮为“开始能力自评”', async ({ page }) => {
    await routeDashboard(page, selfAssessmentPayload)
    await page.goto('/dashboard/member?year=2026')
    await expect(
      page.getByRole('heading', { name: '完成能力自评' }),
    ).toBeVisible()
    await expect(page.getByLabel('当前阶段')).toHaveText('待完成自评')

    const cta = page.getByRole('link', { name: '开始能力自评' })
    await expect(cta).toBeVisible()
    await expect(cta).toHaveAttribute(
      'href',
      '/capability/assessment?year=2026',
    )

    await expect(page.getByTestId('todo-card')).not.toBeVisible()
    await expect(page.getByTestId('current-tasks-table')).not.toBeVisible()
  })

  test('待复核阶段：主按钮为“查看复核状态”', async ({ page }) => {
    await routeDashboard(page, pendingReviewPayload)
    await page.goto('/dashboard/member?year=2026')
    await expect(
      page.getByRole('heading', { name: '自评已提交' }),
    ).toBeVisible()
    await expect(page.getByLabel('当前阶段')).toHaveText('待 Buddy 复核')

    const cta = page.getByRole('link', { name: '查看复核状态' })
    await expect(cta).toBeVisible()
    await expect(cta).toHaveAttribute(
      'href',
      '/capability/assessment?year=2026',
    )

    await expect(page.getByRole('heading', { name: '复核状态' })).toBeVisible()
    await expect(page.getByText('数据建模与设计')).toBeVisible()
  })

  test('计划执行中阶段：主按钮为“查看年度计划”', async ({ page }) => {
    await routeDashboard(page, planPayload)
    await page.goto('/dashboard/member?year=2026')
    await expect(
      page.getByRole('heading', { name: '我的成长总览' }),
    ).toBeVisible()
    await expect(page.getByLabel('当前阶段')).toHaveText('计划执行中')

    const cta = page.getByRole('link', { name: '查看年度计划' }).first()
    await expect(cta).toBeVisible()
    await expect(cta).toHaveAttribute('href', '/growth/annual-plan?year=2026')

    await expect(page.getByTestId('todo-card')).toBeVisible()
    await expect(page.getByTestId('current-tasks-table')).toBeVisible()
  })

  test('待制定计划阶段：主按钮为“生成年度计划”', async ({ page }) => {
    await routeDashboard(page, {
      ...planPayload,
      annual_plan_status: null,
      plan_progress: emptyProgress,
      current_tasks: [],
    })
    await page.goto('/dashboard/member?year=2026')
    await expect(
      page.getByRole('heading', { name: '准备生成年度计划' }),
    ).toBeVisible()
    await expect(page.getByLabel('当前阶段')).toHaveText('待制定计划')

    const cta = page.getByRole('link', { name: '生成年度计划' }).first()
    await expect(cta).toBeVisible()
    await expect(cta).toHaveAttribute('href', '/growth/annual-plan?year=2026')

    await expect(page.getByTestId('todo-card')).not.toBeVisible()
    await expect(page.getByTestId('current-tasks-table')).not.toBeVisible()
  })

  test('年度完成阶段：主按钮为“查看成长档案”', async ({ page }) => {
    await routeDashboard(page, archivedPayload)
    await page.goto('/dashboard/member?year=2026')
    await expect(
      page.getByRole('heading', { name: '年度成长总结' }),
    ).toBeVisible()
    await expect(page.getByLabel('当前阶段')).toHaveText('年度已归档')

    const cta = page.getByRole('link', { name: '查看成长档案' })
    await expect(cta).toBeVisible()
    await expect(cta).toHaveAttribute('href', '/growth/profile?year=2026')

    await expect(page.getByTestId('todo-card')).not.toBeVisible()
    await expect(page.getByTestId('current-tasks-table')).not.toBeVisible()
  })
})

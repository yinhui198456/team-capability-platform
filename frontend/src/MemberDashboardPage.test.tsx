/// @vitest-environment jsdom

import {
  cleanup,
  render,
  screen,
  waitFor,
  fireEvent,
} from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { App } from './App'
import * as accessApi from './access'
import * as planningApi from './planning'
import { MemoryRouter } from 'react-router-dom'

const baseDashboard: planningApi.MemberDashboard = {
  year: 2026,
  assessment: {
    id: 1,
    status: '已归档' as const,
    submitted_at: '2026-01-02T00:00:00Z',
    archived_at: '2026-01-03T00:00:00Z',
    review_status: '已闭环' as const,
    review_conclusion: '认可' as const,
    applicable_completion: { total: 3, completed: 1, ratio: 1 / 3 },
  },
  annual_plan_status: '执行中' as const,
  follow_up: {
    assessment_id: 1,
    assessment_status: '已归档',
    required_incomplete: 0,
    advanced_unassessed: 1,
    gaps_waiting_planning: 2,
    review_return: false,
  },
  summary: {
    annual_actual_hours: 5,
    annual_planned_hours: 20,
    current_month_actual_hours: 2,
    current_month_planned_hours: 8,
    completed_task_count: 1,
    pending_evidence_to_submit: 2,
    pending_evidence_to_review: 1,
  },
  plan_progress: {
    total: 4,
    未开始: 1,
    进行中: 1,
    已完成: 0,
    延期: 1,
    暂停: 0,
    取消: 0,
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
  gap_summary: {
    current_required: 1,
    target_progressive: 2,
    derivation: 'scope_v1',
  },
  current_month: {
    planned_count: 4,
    planned_ids: [1, 2, 3, 4],
    in_progress_count: 1,
    delayed_count: 1,
    pending_evidence_count: 2,
    actual_hours: 2,
  },
  next_action: {
    action_key: 'submit_evidence',
    message: '提交 2 份任务成果证明待 Buddy 复核',
    count: 2,
  },
  meta: {
    year: 2026,
    scope: '本人',
    as_of: '2026-06-01T00:00:00Z',
    source: 'member_dashboard.v1',
    denominator_source: 'assessment_details',
  },
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
      status: '进行中' as const,
      actual_start_date: null,
      actual_end_date: null,
      actual_hours: 5,
      completion_quality: null,
      review_conclusion: null,
      next_action: null,
      revision: 0,
      actual_started_at: null,
      actual_completed_at: null,
      delay_reason: null,
      pause_reason: null,
      cancel_reason: null,
      revised_due_date: null,
      plan_item_current_level: 2,
      plan_item_target_level: 4,
      plan_item_priority: '高',
      plan_item_learning_material: null,
      plan_item_learning_task_content: '数据建模规范与实践',
      plan_item_expected_output: null,
      plan_item_estimated_hours: '10',
      plan_item_target_month: 6,
    },
  ],
}

function stubMember() {
  return vi.spyOn(accessApi, 'me').mockResolvedValue({
    id: 1,
    username: 'member',
    full_name: 'Member',
    roles: ['Member'],
  })
}

function stubYear() {
  return vi
    .spyOn(planningApi, 'getAvailableYears')
    .mockResolvedValue({ available_years: [2026], active_year: 2026 })
}

describe('MemberDashboardPage', () => {
  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it('renders the member summary, gaps, and current tasks in plan stage', async () => {
    stubYear()
    stubMember()
    vi.spyOn(planningApi, 'getMemberDashboard').mockResolvedValue(baseDashboard)
    render(
      <MemoryRouter initialEntries={['/dashboard/member']}>
        <App />
      </MemoryRouter>,
    )
    await waitFor(() => {
      expect(screen.getByText('我的成长总览')).toBeTruthy()
    })
    await waitFor(() => {
      expect(screen.getByText('计划执行中')).toBeTruthy()
    })
    expect(screen.getByText('数据范围：本人')).toBeTruthy()
    expect(screen.getByRole('link', { name: '能力自评与 Gap' })).toBeTruthy()
    expect(screen.getByText('全年累计时长')).toBeTruthy()
    expect(screen.getByText('全年计划时长')).toBeTruthy()
    expect(screen.getByText('当月累计时长')).toBeTruthy()
    expect(screen.getByText('当月计划时长')).toBeTruthy()
    expect(screen.getByText('年度计划进度')).toBeTruthy()
    expect(
      screen.getAllByRole('link', { name: '查看年度计划' }).length,
    ).toBeGreaterThanOrEqual(1)
  })

  it('renders the follow-up card with backlog counts and deep links', async () => {
    stubYear()
    stubMember()
    vi.spyOn(planningApi, 'getMemberDashboard').mockResolvedValue(baseDashboard)
    render(
      <MemoryRouter initialEntries={['/dashboard/member']}>
        <App />
      </MemoryRouter>,
    )
    await waitFor(() => {
      expect(screen.getByText('成长待办')).toBeTruthy()
    })
    expect(screen.getByRole('link', { name: /进阶能力待评估/ })).toBeTruthy()
    expect(screen.getByRole('link', { name: /Gap 待规划/ })).toBeTruthy()
    // required_incomplete is 0 in the fixture: the blocking category is
    // absent, the non-blocking categories render with deep links.
    expect(
      screen.queryByRole('link', { name: /当前职级必备能力未完成评估/ }),
    ).toBeNull()
    expect(
      screen.getByRole('link', { name: /进阶能力待评估/ }).getAttribute('href'),
    ).toContain('focus=advanced-unassessed')
  })

  it('hides the follow-up card when nothing is pending', async () => {
    stubYear()
    stubMember()
    vi.spyOn(planningApi, 'getMemberDashboard').mockResolvedValue({
      ...baseDashboard,
      follow_up: {
        assessment_id: 1,
        assessment_status: '已归档',
        required_incomplete: 0,
        advanced_unassessed: 0,
        gaps_waiting_planning: 0,
        review_return: false,
      },
    })
    render(
      <MemoryRouter initialEntries={['/dashboard/member']}>
        <App />
      </MemoryRouter>,
    )
    await waitFor(() => {
      expect(screen.getByText('计划执行中')).toBeTruthy()
    })
    expect(screen.queryByText('成长待办')).toBeNull()
  })

  it('filters gaps by domain and restores on 全部', async () => {
    stubYear()
    stubMember()
    vi.spyOn(planningApi, 'getMemberDashboard').mockResolvedValue({
      ...baseDashboard,
      summary: {
        annual_actual_hours: 0,
        annual_planned_hours: 0,
        current_month_actual_hours: 0,
        current_month_planned_hours: 0,
        completed_task_count: 0,
        pending_evidence_to_submit: 0,
        pending_evidence_to_review: 0,
      },
      plan_progress: {
        total: 0,
        未开始: 0,
        进行中: 0,
        已完成: 0,
        延期: 0,
        暂停: 0,
        取消: 0,
      },
      current_tasks: [],
      gaps: [
        {
          id: 1,
          assessment_id: 1,
          l3_code: 'P01.01.01',
          current_level: 2,
          target_level: 4,
          gap_value: 2,
          priority: '高',
          plan_candidate: true,
        },
        {
          id: 2,
          assessment_id: 1,
          l3_code: 'C01.01.01',
          current_level: 3,
          target_level: 5,
          gap_value: 2,
          priority: '中',
          plan_candidate: true,
        },
      ],
    })
    render(
      <MemoryRouter initialEntries={['/dashboard/member']}>
        <App />
      </MemoryRouter>,
    )
    await waitFor(() => {
      expect(screen.getByText('我的成长总览')).toBeTruthy()
    })
    await waitFor(() => {
      expect(screen.getByText('P01.01.01')).toBeTruthy()
    })
    expect(screen.getByText('C01.01.01')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /P01/ }))
    await waitFor(() => {
      expect(screen.queryByText('C01.01.01')).toBeNull()
    })
    fireEvent.click(screen.getByRole('button', { name: '全部' }))
    await waitFor(() => {
      expect(screen.getByText('C01.01.01')).toBeTruthy()
    })
  })

  it('renders self-assessment stage when no assessment', async () => {
    stubYear()
    stubMember()
    vi.spyOn(planningApi, 'getMemberDashboard').mockResolvedValue({
      ...baseDashboard,
      assessment: null,
      annual_plan_status: null,
      plan_progress: {
        total: 0,
        未开始: 0,
        进行中: 0,
        已完成: 0,
        延期: 0,
        暂停: 0,
        取消: 0,
      },
      current_tasks: [],
      gaps: [],
      domain_radar: [
        { domain_code: 'P01', score: 0 },
        { domain_code: 'P02', score: 0 },
        { domain_code: 'P03', score: 0 },
        { domain_code: 'C01', score: 0 },
        { domain_code: 'C02', score: 0 },
        { domain_code: 'C03', score: 0 },
      ],
    })
    render(
      <MemoryRouter initialEntries={['/dashboard/member']}>
        <App />
      </MemoryRouter>,
    )
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: '完成能力自评' })).toBeTruthy()
    })
    expect(screen.getByText('待完成自评')).toBeTruthy()
    expect(screen.getByRole('link', { name: '开始能力自评' })).toBeTruthy()
    expect(screen.queryByText('年度计划进度')).toBeNull()
    expect(screen.queryByTestId('current-tasks-table')).toBeNull()
  })

  it('renders pending-review stage with review status and gaps', async () => {
    stubYear()
    stubMember()
    vi.spyOn(planningApi, 'getMemberDashboard').mockResolvedValue({
      ...baseDashboard,
      assessment: {
        id: 2,
        status: '待复核' as const,
        submitted_at: '2026-02-01T00:00:00Z',
        archived_at: null,
        review_status: '待复核' as const,
        review_conclusion: null,
      },
      annual_plan_status: null,
      plan_progress: {
        total: 0,
        未开始: 0,
        进行中: 0,
        已完成: 0,
        延期: 0,
        暂停: 0,
        取消: 0,
      },
      current_tasks: [],
      gaps: [
        {
          id: 3,
          assessment_id: 2,
          l3_code: 'P02.01.01',
          current_level: 1,
          target_level: 3,
          gap_value: 2,
          priority: '中',
          plan_candidate: false,
        },
      ],
    })
    render(
      <MemoryRouter initialEntries={['/dashboard/member']}>
        <App />
      </MemoryRouter>,
    )
    await waitFor(() => {
      expect(screen.getByText('自评已提交')).toBeTruthy()
    })
    expect(screen.getByLabelText('当前阶段').textContent).toBe('待 Buddy 复核')
    expect(screen.getByText('复核状态')).toBeTruthy()
    expect(screen.getByText('P02.01.01')).toBeTruthy()
    expect(screen.queryByText('年度计划进度')).toBeNull()
    expect(screen.queryByTestId('todo-card')).toBeNull()
    // Issue #94: Buddy review is feedback, not a plan-generation gate (#82) —
    // the old "复核通过后即可生成年度计划" prerequisite copy must be gone.
    expect(screen.queryByText(/复核通过后即可生成年度计划/)).toBeNull()
    expect(
      screen.getAllByRole('link', { name: '生成年度计划' }).length,
    ).toBeGreaterThanOrEqual(1)
  })

  it('shows plan execution first when the plan already exists despite a pending review (#94)', async () => {
    stubYear()
    stubMember()
    vi.spyOn(planningApi, 'getMemberDashboard').mockResolvedValue({
      ...baseDashboard,
      assessment: {
        id: 2,
        status: '待复核' as const,
        submitted_at: '2026-02-01T00:00:00Z',
        archived_at: null,
        review_status: '待复核' as const,
        review_conclusion: null,
      },
      annual_plan_status: '制定中' as const,
      follow_up: {
        ...baseDashboard.follow_up,
        assessment_status: '待复核',
        review_return: true,
      },
    })
    render(
      <MemoryRouter initialEntries={['/dashboard/member']}>
        <App />
      </MemoryRouter>,
    )
    await waitFor(() => {
      expect(screen.getByText('我的成长总览')).toBeTruthy()
    })
    expect(screen.getByLabelText('当前阶段').textContent).toBe('计划执行中')
    expect(screen.getByText('年度计划进度')).toBeTruthy()
    expect(screen.getByTestId('current-tasks-table')).toBeTruthy()
    expect(
      screen.getByTestId('review-not-blocking-note').textContent,
    ).toContain('不阻塞当前计划执行')
    // Pending review stays non-blocking info, never the blocking stage.
    expect(screen.queryByText('自评已提交')).toBeNull()
    expect(screen.queryByText('复核状态')).toBeNull()
    expect(
      screen.getAllByRole('link', { name: '查看年度计划' }).length,
    ).toBeGreaterThanOrEqual(1)
  })

  it('renders plan-pending stage after reviewed assessment without plan', async () => {
    stubYear()
    stubMember()
    vi.spyOn(planningApi, 'getMemberDashboard').mockResolvedValue({
      ...baseDashboard,
      assessment: {
        id: 1,
        status: '已复核' as const,
        submitted_at: '2026-01-02T00:00:00Z',
        archived_at: null,
        review_status: '已闭环' as const,
        review_conclusion: '认可' as const,
      },
      annual_plan_status: null,
      plan_progress: {
        total: 0,
        未开始: 0,
        进行中: 0,
        已完成: 0,
        延期: 0,
        暂停: 0,
        取消: 0,
      },
      current_tasks: [],
      gaps: [],
    })
    render(
      <MemoryRouter initialEntries={['/dashboard/member']}>
        <App />
      </MemoryRouter>,
    )
    await waitFor(() => {
      expect(screen.getByText('准备生成年度计划')).toBeTruthy()
    })
    expect(screen.getByLabelText('当前阶段').textContent).toBe('待制定计划')
    expect(
      screen.getAllByRole('link', { name: '生成年度计划' }).length,
    ).toBeGreaterThanOrEqual(1)
    expect(screen.queryByText('年度计划进度')).toBeNull()
    expect(screen.queryByTestId('current-tasks-table')).toBeNull()
  })

  it('shows gap split, applicable completion, current-month states and next action', async () => {
    stubYear()
    stubMember()
    vi.spyOn(planningApi, 'getMemberDashboard').mockResolvedValue(baseDashboard)
    render(
      <MemoryRouter initialEntries={['/dashboard/member']}>
        <App />
      </MemoryRouter>,
    )
    await waitFor(() => {
      expect(screen.getByText('我的成长总览')).toBeTruthy()
    })
    // 必备 / 进阶 Gap 拆分来自 assessment 快照 scope（scope-v1）。
    const gapSummary = screen.getByTestId('gap-summary')
    expect(gapSummary.textContent).toContain('必备 Gap')
    expect(gapSummary.textContent).toContain('1')
    expect(gapSummary.textContent).toContain('进阶 Gap')
    expect(gapSummary.textContent).toContain('2')
    // 适用完成度 = 当前自评 applicable 明细中已达有效目标的占比。
    const completion = screen.getByTestId('applicable-completion')
    expect(completion.textContent).toContain('适用完成度')
    expect(completion.textContent).toContain('1/3')
    // 本月六态与下一步动作来自 current_month / next_action 合同块。
    const month = screen.getByTestId('current-month-card')
    expect(month.textContent).toContain('本月计划')
    expect(month.textContent).toContain('4')
    expect(month.textContent).toContain('本月进行中')
    expect(month.textContent).toContain('本月延期')
    expect(month.textContent).toContain('本月待验收')
    expect(month.textContent).toContain('提交 2 份任务成果证明待 Buddy 复核')
  })

  it('shows all six plan states and the split evidence todos', async () => {
    stubYear()
    stubMember()
    vi.spyOn(planningApi, 'getMemberDashboard').mockResolvedValue({
      ...baseDashboard,
      plan_progress: {
        total: 6,
        未开始: 1,
        进行中: 1,
        已完成: 1,
        延期: 1,
        暂停: 1,
        取消: 1,
      },
    })
    render(
      <MemoryRouter initialEntries={['/dashboard/member']}>
        <App />
      </MemoryRouter>,
    )
    await waitFor(() => {
      expect(screen.getByText('我的成长总览')).toBeTruthy()
    })
    await waitFor(() => {
      expect(screen.getByText('待提交任务成果证明')).toBeTruthy()
    })
    // 暂停 / 取消 are part of the six-state progress card.
    expect(screen.getByText('暂停')).toBeTruthy()
    expect(screen.getByText('取消')).toBeTruthy()
    // Member-to-submit and buddy-to-review are displayed separately.
    const submitCard = screen
      .getByText('待提交任务成果证明')
      .closest('[class*="todoItem"]')
    expect(submitCard?.textContent).toContain('2')
    const reviewCard = screen
      .getByText('待 Buddy 复核')
      .closest('[class*="todoItem"]')
    expect(reviewCard?.textContent).toContain('1')
    // No legacy key anywhere.
    expect(screen.queryByText('待任务成果证明 Review')).toBeNull()
  })

  it('shows no danger style when overdue count is zero', async () => {
    stubYear()
    stubMember()
    vi.spyOn(planningApi, 'getMemberDashboard').mockResolvedValue({
      ...baseDashboard,
      plan_progress: { ...baseDashboard.plan_progress, 延期: 0 },
    })
    render(
      <MemoryRouter initialEntries={['/dashboard/member']}>
        <App />
      </MemoryRouter>,
    )
    await waitFor(() => {
      expect(screen.getByText('我的成长总览')).toBeTruthy()
    })
    await waitFor(() => {
      expect(screen.getByText('计划到期')).toBeTruthy()
    })
    // The "计划到期" todo card should NOT have danger styling when overdue=0
    const planOverdueCard = screen
      .getByText('计划到期')
      .closest('[class*="todoItem"]')
    expect(planOverdueCard?.className).not.toContain('todoDanger')
  })

  it('shows danger style when overdue count is greater than zero', async () => {
    stubYear()
    stubMember()
    vi.spyOn(planningApi, 'getMemberDashboard').mockResolvedValue({
      ...baseDashboard,
      plan_progress: { ...baseDashboard.plan_progress, 延期: 3 },
    })
    render(
      <MemoryRouter initialEntries={['/dashboard/member']}>
        <App />
      </MemoryRouter>,
    )
    await waitFor(() => {
      expect(screen.getByText('我的成长总览')).toBeTruthy()
    })
    await waitFor(() => {
      expect(screen.getByText('计划到期')).toBeTruthy()
    })
    // The "计划到期" todo card SHOULD have danger styling when overdue=3
    const planOverdueCard = screen
      .getByText('计划到期')
      .closest('[class*="todoItem"]')
    expect(planOverdueCard?.className).toContain('todoDanger')
  })

  it('renders archived stage with annual summary', async () => {
    stubYear()
    stubMember()
    vi.spyOn(planningApi, 'getMemberDashboard').mockResolvedValue({
      ...baseDashboard,
      assessment: {
        id: 1,
        status: '已归档' as const,
        submitted_at: '2026-01-02T00:00:00Z',
        archived_at: '2026-12-31T00:00:00Z',
        review_status: '已闭环' as const,
        review_conclusion: '认可' as const,
      },
      annual_plan_status: '已归档' as const,
    })
    render(
      <MemoryRouter initialEntries={['/dashboard/member']}>
        <App />
      </MemoryRouter>,
    )
    await waitFor(() => {
      expect(screen.getByText('年度成长总结')).toBeTruthy()
    })
    expect(screen.getByText('年度已归档')).toBeTruthy()
    expect(screen.getByText('查看成长档案')).toBeTruthy()
    expect(screen.queryByTestId('todo-card')).toBeNull()
    expect(screen.queryByTestId('current-tasks-table')).toBeNull()
  })
})

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
  },
  annual_plan_status: '执行中' as const,
  summary: {
    annual_actual_hours: 5,
    annual_planned_hours: 20,
    current_month_actual_hours: 2,
    current_month_planned_hours: 8,
    completed_task_count: 1,
    pending_evidence_count: 2,
  },
  plan_progress: {
    total: 4,
    未开始: 1,
    进行中: 1,
    '待 Evidence Review': 1,
    已完成: 0,
    延期: 1,
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
      l3_code: 'P01.01.01',
      l3_name: '数据建模与设计',
      status: '进行中' as const,
      actual_start_date: null,
      actual_end_date: null,
      actual_hours: 5,
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
        pending_evidence_count: 0,
      },
      plan_progress: {
        total: 0,
        未开始: 0,
        进行中: 0,
        '待 Evidence Review': 0,
        已完成: 0,
        延期: 0,
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
        '待 Evidence Review': 0,
        已完成: 0,
        延期: 0,
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
        '待 Evidence Review': 0,
        已完成: 0,
        延期: 0,
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
        '待 Evidence Review': 0,
        已完成: 0,
        延期: 0,
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

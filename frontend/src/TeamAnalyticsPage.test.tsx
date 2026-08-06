/// @vitest-environment jsdom

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { App } from './App'
import * as accessApi from './access'
import * as planningApi from './planning'
import { MemoryRouter } from 'react-router-dom'

const analytics: planningApi.TeamAnalytics = {
  year: 2026,
  meta: {
    year: 2026,
    as_of: '2026-01-01T00:00:00Z',
    scope: 'leader_team',
    source: 'team_analytics.v2',
    denominator_source: 'assessment_details',
  },
  gap_summary: {
    current_required: 2,
    target_progressive: 1,
    derivation: 'scope_v1',
  },
  filters: { member_id: null, domain_code: null },
  kpis: {
    assessment_completion_rate: 0.5,
    assessment_completed_count: 1,
    assessment_total_count: 2,
    plan_completion_rate: 0.5,
    plan_completed_count: 1,
    plan_total_count: 2,
    evidence_pass_rate: 1,
    evidence_passed_count: 1,
    evidence_total_count: 1,
    overdue_plan_item_count: 1,
  },
  domain_averages: [
    { domain_code: 'P01', actual: 2, target: 4 },
    { domain_code: 'P02', actual: 0, target: 0 },
  ],
  member_attainment: [
    {
      member_id: 2,
      username: 'member',
      full_name: '成员甲',
      domain_code: 'P01',
      attainment: 50,
      actual: 2,
      target: 4,
    },
    {
      member_id: 2,
      username: 'member',
      full_name: '成员甲',
      domain_code: 'P02',
      attainment: null,
      actual: null,
      target: null,
    },
  ],
  monthly_trends: Array.from({ length: 12 }, (_, index) => ({
    month: index + 1,
    planned_count: index === 0 ? 2 : 0,
    actual_count: index === 0 ? 1 : 0,
    cumulative_planned_rate: index === 0 ? 1 : 0,
    cumulative_actual_rate: index === 0 ? 0.5 : 0.5,
    planned_hours: index === 0 ? 10 : 0,
    actual_hours: index === 0 ? 5 : 0,
    cumulative_planned_hours: index === 0 ? 10 : 10,
    cumulative_actual_hours: index === 0 ? 5 : 5,
  })),
  overdue_items: [
    {
      member_id: 2,
      username: 'member',
      full_name: '成员甲',
      l2_code: 'P01.01',
      l2_name: '数据基础',
      l3_code: 'P01-L2A-L3A',
      l3_name: '数据开发',
      due_date: '2026-01-31',
      plan_start_date: '2026-01-01',
      plan_end_date: '2026-01-31',
      overdue_days: 3,
      status: '延期',
    },
  ],
  distributions: {
    priority: { 高: 1, 中: 1, 低: 0, total: 2 },
    formal_inclusion_ratio: { included_count: 2, total_count: 2, ratio: 1 },
    quarterly: { Q1: 2, Q2: 0, Q3: 0, Q4: 0, total: 2 },
    plan_status: {
      未开始: 0,
      进行中: 1,
      已完成: 1,
      延期: 0,
      暂停: 0,
      取消: 0,
      total: 2,
    },
    pending_acceptance: { count: 0 },
  },
}

describe('TeamAnalyticsPage', () => {
  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it('renders the Leader UI-05 aggregates and applies filters', async () => {
    vi.spyOn(accessApi, 'me').mockResolvedValue({
      id: 1,
      username: 'leader',
      full_name: 'Leader',
      roles: ['Leader'],
    })
    const getTeamAnalytics = vi
      .spyOn(planningApi, 'getTeamAnalytics')
      .mockResolvedValue(analytics)
    render(
      <MemoryRouter initialEntries={['/operations/analytics']}>
        <App />
      </MemoryRouter>,
    )
    await waitFor(() => expect(screen.getByText('延期计划项明细')).toBeTruthy())
    expect(screen.getAllByText('50%')).not.toHaveLength(0)
    expect(screen.getByText('成员 L3 掌握度达成率')).toBeTruthy()
    expect(screen.getByText('L3 掌握度实际 vs 目标')).toBeTruthy()
    expect(
      screen.getByText(
        '以上指标基于三级达成路径的当前掌握度与目标掌握度聚合，不代表二级能力标准 P4–P8 岗位职级达成率。',
      ),
    ).toBeTruthy()
    expect(screen.getByRole('figure', { name: '计划完成组合图' })).toBeTruthy()
    expect(screen.getByRole('figure', { name: '学习时长组合图' })).toBeTruthy()
    // 自评完成率 must not appear per Issue #28
    expect(screen.queryByText('自评完成率')).toBeNull()

    fireEvent.change(screen.getByLabelText('能力域'), {
      target: { value: 'P01' },
    })
    await waitFor(() =>
      expect(getTeamAnalytics).toHaveBeenLastCalledWith({
        year: 2026,
        domain_code: 'P01',
      }),
    )
  })

  it('opens a read-only detail drawer on overdue item click', async () => {
    vi.spyOn(accessApi, 'me').mockResolvedValue({
      id: 1,
      username: 'leader',
      full_name: 'Leader',
      roles: ['Leader'],
    })
    vi.spyOn(planningApi, 'getTeamAnalytics').mockResolvedValue(analytics)
    render(
      <MemoryRouter initialEntries={['/operations/analytics']}>
        <App />
      </MemoryRouter>,
    )
    await waitFor(() => expect(screen.getByText('延期计划项明细')).toBeTruthy())
    fireEvent.click(screen.getByText(/P01-L2A-L3A/))
    const drawer = await screen.findByRole('dialog', { name: '延期计划项详情' })
    expect(drawer).toBeTruthy()
    expect(drawer.textContent).toContain('数据开发')
    expect(
      within(drawer).getByRole('heading', { name: '延期计划项详情' }),
    ).toBeTruthy()
    expect(drawer.textContent).toContain('只读')
    expect(drawer.textContent).toContain('计划开始日期')
    expect(drawer.textContent).toContain('计划结束日期')
    expect(drawer.textContent).toContain('延期原因')
    expect(drawer.textContent).toContain('下一步行动')
    fireEvent.click(screen.getByRole('button', { name: '关闭详情' }))
    await waitFor(() =>
      expect(
        screen.queryByRole('dialog', { name: '延期计划项详情' }),
      ).toBeNull(),
    )
  })

  it('does not request team data for a user without any role', async () => {
    vi.spyOn(accessApi, 'me').mockResolvedValue({
      id: 2,
      username: 'guest',
      full_name: 'Guest',
      roles: [],
    })
    const getTeamAnalytics = vi.spyOn(planningApi, 'getTeamAnalytics')
    render(
      <MemoryRouter initialEntries={['/operations/analytics']}>
        <App />
      </MemoryRouter>,
    )
    await waitFor(() => expect(screen.getByText(/无权限/)).toBeTruthy())
    expect(getTeamAnalytics).not.toHaveBeenCalled()
  })
})

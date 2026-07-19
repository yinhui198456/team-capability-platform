/// @vitest-environment jsdom

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { App } from './App'
import * as accessApi from './access'
import * as planningApi from './planning'
import { MemoryRouter } from 'react-router-dom'

const analytics: planningApi.TeamAnalytics = {
  year: 2026,
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
      l3_code: 'P01-L2A-L3A',
      l3_name: '数据开发',
      due_date: '2026-01-31',
      overdue_days: 3,
      status: '延期',
    },
  ],
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
      </MemoryRouter>
    )
    await waitFor(() => expect(screen.getByText('延期计划项明细')).toBeTruthy())
    expect(screen.getAllByText('50%')).not.toHaveLength(0)
    expect(screen.getByText('成员能力达成率')).toBeTruthy()
    expect(screen.getByRole('figure', { name: '计划完成组合图' })).toBeTruthy()
    expect(screen.getByRole('figure', { name: '学习时长组合图' })).toBeTruthy()

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

  it('does not request team data for a non-Leader', async () => {
    vi.spyOn(accessApi, 'me').mockResolvedValue({
      id: 2,
      username: 'member',
      full_name: 'Member',
      roles: ['Member'],
    })
    const getTeamAnalytics = vi.spyOn(planningApi, 'getTeamAnalytics')
    render(
      <MemoryRouter initialEntries={['/operations/analytics']}>
        <App />
      </MemoryRouter>
    )
    await waitFor(() => expect(screen.getByText(/无权限/)).toBeTruthy())
    expect(getTeamAnalytics).not.toHaveBeenCalled()
  })
})

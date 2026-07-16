/// @vitest-environment jsdom

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { App } from './App'
import * as accessApi from './access'
import * as planningApi from './planning'

describe('AnnualPlanPage', () => {
  beforeEach(() => {
    vi.spyOn(planningApi, 'getAnnualPlan').mockResolvedValue(null)
    vi.spyOn(planningApi, 'listPlanItems').mockResolvedValue([])
  })

  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it('renders annual plan page and plan item list', async () => {
    vi.spyOn(accessApi, 'me').mockResolvedValue({
      id: 1,
      username: 'member',
      full_name: 'Member',
      roles: ['Member'],
    })
    vi.spyOn(planningApi, 'getAnnualPlanEligibility').mockResolvedValue({
      eligible: true,
      reason: null,
    })
    vi.spyOn(planningApi, 'getAnnualPlan').mockResolvedValue({
      id: 10,
      member_id: 1,
      year: 2026,
      plan_cycle: 12,
      status: '制定中',
      start_date: '2026-01-01',
      end_date: '2026-12-31',
      created_at: '2026-01-01T00:00:00Z',
      items: [
        {
          id: 1,
          annual_growth_plan_id: 10,
          growth_goal_id: 5,
          l3_code: 'P01-L2A-L3A',
          current_level: 2,
          target_level: 4,
          priority: '中',
          learning_material: null,
          learning_task_content: null,
          expected_output: null,
          estimated_hours: '10',
          plan_start_date: null,
          plan_end_date: null,
          target_month: null,
          status: '未开始',
        },
      ],
    })

    window.history.pushState({}, '', '/growth/annual-plan')
    render(<App />)

    await waitFor(() => {
      expect(screen.getByText('年度成长计划')).toBeTruthy()
    })

    expect(screen.getByText(/P01-L2A-L3A/)).toBeTruthy()
    expect(screen.getByText(/预计耗时：10/)).toBeTruthy()
    expect(screen.getByText(/状态：未开始/)).toBeTruthy()
  })

  it('calls generatePlanItems and refreshes list on generate', async () => {
    vi.spyOn(accessApi, 'me').mockResolvedValue({
      id: 1,
      username: 'member',
      full_name: 'Member',
      roles: ['Member'],
    })
    vi.spyOn(planningApi, 'getAnnualPlanEligibility').mockResolvedValue({
      eligible: true,
      reason: null,
    })
    vi.spyOn(planningApi, 'getAnnualPlan').mockResolvedValue({
      id: 10,
      member_id: 1,
      year: 2026,
      plan_cycle: 12,
      status: '制定中',
      start_date: '2026-01-01',
      end_date: '2026-12-31',
      created_at: '2026-01-01T00:00:00Z',
      items: [],
    })
    const generatePlanItems = vi
      .spyOn(planningApi, 'generatePlanItems')
      .mockResolvedValue({
        created: 1,
        items: [
          {
            id: 1,
            annual_growth_plan_id: 10,
            growth_goal_id: 5,
            l3_code: 'P01-L2A-L3A',
            current_level: 2,
            target_level: 4,
            priority: '中',
            learning_material: null,
            learning_task_content: null,
            expected_output: null,
            estimated_hours: '10',
            plan_start_date: null,
            plan_end_date: null,
            target_month: null,
            status: '未开始',
          },
        ],
      })

    window.history.pushState({}, '', '/growth/annual-plan')
    render(<App />)

    await waitFor(() => {
      expect(screen.getByText('生成计划项')).toBeTruthy()
    })

    fireEvent.click(screen.getByText('生成计划项'))

    await waitFor(() => {
      expect(generatePlanItems).toHaveBeenCalled()
    })
  })

  it('shows gate reason and disables generate when gate is blocked', async () => {
    vi.spyOn(accessApi, 'me').mockResolvedValue({
      id: 1,
      username: 'member',
      full_name: 'Member',
      roles: ['Member'],
    })
    vi.spyOn(planningApi, 'getAnnualPlanEligibility').mockResolvedValue({
      eligible: false,
      reason: '暂无已提交的能力评估',
    })

    window.history.pushState({}, '', '/growth/annual-plan')
    render(<App />)

    await waitFor(() => {
      expect(screen.getByText(/年度计划生成受限/)).toBeTruthy()
    })

    expect(screen.getByText(/暂无已提交的能力评估/)).toBeTruthy()
    expect(screen.queryByText('生成计划项')).toBeNull()
  })
})

describe('annual plan api helpers', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ id: 1 }),
        }),
      ),
    )
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('getAnnualPlan fetches with year query and credentials include', async () => {
    await planningApi.getAnnualPlan(2026)
    expect(fetch).toHaveBeenCalledWith(
      '/api/planning/annual-plan?year=2026',
      expect.objectContaining({
        method: 'GET',
        credentials: 'include',
      }),
    )
  })

  it('generatePlanItems posts with credentials include', async () => {
    await planningApi.generatePlanItems()
    expect(fetch).toHaveBeenCalledWith(
      '/api/planning/annual-plan/generate',
      expect.objectContaining({
        method: 'POST',
        credentials: 'include',
        body: JSON.stringify({}),
      }),
    )
  })

  it('listPlanItems fetches with credentials include', async () => {
    await planningApi.listPlanItems()
    expect(fetch).toHaveBeenCalledWith(
      '/api/planning/plan-items',
      expect.objectContaining({
        method: 'GET',
        credentials: 'include',
      }),
    )
  })
})

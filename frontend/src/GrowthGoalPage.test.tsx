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
import { MemoryRouter } from 'react-router-dom'

describe('GrowthGoalPage', () => {
  beforeEach(() => {
    vi.spyOn(planningApi, 'getEligibleGaps').mockResolvedValue([])
    vi.spyOn(planningApi, 'listGrowthGoals').mockResolvedValue([])
  })

  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it('renders eligible gaps and create button when gate is eligible', async () => {
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
    vi.spyOn(planningApi, 'getEligibleGaps').mockResolvedValue([
      {
        id: 10,
        assessment_id: 7,
        l3_code: 'P01-L2A-L3A',
        current_level: 2,
        target_level: 4,
        gap_value: 2,
        priority: '中',
        plan_candidate: true,
      },
    ])
    vi.spyOn(planningApi, 'listGrowthGoals').mockResolvedValue([])

    render(
      <MemoryRouter initialEntries={['/growth/goals']}>
        <App />
      </MemoryRouter>
    )
    await waitFor(() => {
      expect(screen.getByText(/P01-L2A-L3A/)).toBeTruthy()
    })

    expect(screen.getByText('创建成长目标')).toBeTruthy()
  })

  it('calls createGrowthGoal and refreshes list on create', async () => {
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
    vi.spyOn(planningApi, 'getEligibleGaps').mockResolvedValue([
      {
        id: 10,
        assessment_id: 7,
        l3_code: 'P01-L2A-L3A',
        current_level: 2,
        target_level: 4,
        gap_value: 2,
        priority: '中',
        plan_candidate: true,
      },
    ])
    vi.spyOn(planningApi, 'listGrowthGoals').mockResolvedValue([])
    const createGrowthGoal = vi
      .spyOn(planningApi, 'createGrowthGoal')
      .mockResolvedValue({
        id: 1,
        gap_id: 10,
        annual_growth_plan_id: 5,
        l3_code: 'P01-L2A-L3A',
        year: 2026,
        target_level: 4,
        priority: '中',
      })

    render(
      <MemoryRouter initialEntries={['/growth/goals']}>
        <App />
      </MemoryRouter>
    )
    await waitFor(() => {
      expect(screen.getByText('创建成长目标')).toBeTruthy()
    })

    fireEvent.click(screen.getByText('创建成长目标'))

    await waitFor(() => {
      expect(createGrowthGoal).toHaveBeenCalledWith(10)
    })
  })

  it('shows gate reason and disables create when gate is blocked', async () => {
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
    vi.spyOn(planningApi, 'getEligibleGaps').mockResolvedValue([
      {
        id: 10,
        assessment_id: 7,
        l3_code: 'P01-L2A-L3A',
        current_level: 2,
        target_level: 4,
        gap_value: 2,
        priority: '中',
        plan_candidate: true,
      },
    ])

    render(
      <MemoryRouter initialEntries={['/growth/goals']}>
        <App />
      </MemoryRouter>
    )
    await waitFor(() => {
      expect(screen.getByText(/年度计划生成受限/)).toBeTruthy()
    })

    expect(screen.getByText(/暂无已提交的能力评估/)).toBeTruthy()
    expect(
      (screen.getByText('创建成长目标') as HTMLButtonElement).disabled,
    ).toBe(true)
  })

  it('calls deleteGrowthGoal when remove is clicked', async () => {
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
    vi.spyOn(planningApi, 'getEligibleGaps').mockResolvedValue([])
    vi.spyOn(planningApi, 'listGrowthGoals').mockResolvedValue([
      {
        id: 1,
        gap_id: 10,
        annual_growth_plan_id: 5,
        l3_code: 'P01-L2A-L3A',
        year: 2026,
        target_level: 4,
        priority: '中',
      },
    ])
    const deleteGrowthGoal = vi
      .spyOn(planningApi, 'deleteGrowthGoal')
      .mockResolvedValue(undefined)

    render(
      <MemoryRouter initialEntries={['/growth/goals']}>
        <App />
      </MemoryRouter>
    )
    await waitFor(() => {
      expect(screen.getByText(/P01-L2A-L3A/)).toBeTruthy()
    })

    fireEvent.click(screen.getByText('删除'))

    await waitFor(() => {
      expect(deleteGrowthGoal).toHaveBeenCalledWith(1)
    })
  })
})

describe('growth goal api helpers', () => {
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

  it('getEligibleGaps fetches with credentials include', async () => {
    await planningApi.getEligibleGaps()
    expect(fetch).toHaveBeenCalledWith(
      '/api/planning/eligible-gaps',
      expect.objectContaining({
        method: 'GET',
        credentials: 'include',
      }),
    )
  })

  it('createGrowthGoal posts gap_id with credentials include', async () => {
    await planningApi.createGrowthGoal(10)
    expect(fetch).toHaveBeenCalledWith(
      '/api/planning/growth-goals',
      expect.objectContaining({
        method: 'POST',
        credentials: 'include',
        body: JSON.stringify({ gap_id: 10 }),
      }),
    )
  })

  it('listGrowthGoals fetches with credentials include', async () => {
    await planningApi.listGrowthGoals()
    expect(fetch).toHaveBeenCalledWith(
      '/api/planning/growth-goals',
      expect.objectContaining({
        method: 'GET',
        credentials: 'include',
      }),
    )
  })

  it('deleteGrowthGoal deletes with credentials include', async () => {
    await planningApi.deleteGrowthGoal(1)
    expect(fetch).toHaveBeenCalledWith(
      '/api/planning/growth-goals/1',
      expect.objectContaining({
        method: 'DELETE',
        credentials: 'include',
      }),
    )
  })
})

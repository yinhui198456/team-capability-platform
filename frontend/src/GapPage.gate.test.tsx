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
import * as assessmentApi from './assessment'
import * as gapApi from './gap'
import * as planningApi from './planning'

describe('GapPage gate', () => {
  beforeEach(() => {
    vi.spyOn(assessmentApi, 'listAssessments').mockResolvedValue([])
    vi.spyOn(gapApi, 'listGaps').mockResolvedValue([])
  })

  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it('shows eligibility reason when gate is blocked', async () => {
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

    window.history.pushState({}, '', '/capability/gap')
    render(<App />)

    await waitFor(() => {
      expect(screen.getByText(/年度计划生成受限/)).toBeTruthy()
    })

    expect(screen.getByText(/暂无已提交的能力评估/)).toBeTruthy()
  })

  it('dry run button shows success message when eligible', async () => {
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
    vi.spyOn(planningApi, 'annualPlanDryRun').mockResolvedValue({ ok: true })

    window.history.pushState({}, '', '/capability/gap')
    render(<App />)

    await waitFor(() => {
      expect(screen.getByText('模拟生成年度计划')).toBeTruthy()
    })

    fireEvent.click(screen.getByText('模拟生成年度计划'))

    await waitFor(() => {
      expect(screen.getByText('可生成年度计划')).toBeTruthy()
    })
  })

  it('dry run button shows backend failure reason when blocked', async () => {
    vi.spyOn(accessApi, 'me').mockResolvedValue({
      id: 1,
      username: 'member',
      full_name: 'Member',
      roles: ['Member'],
    })
    vi.spyOn(planningApi, 'getAnnualPlanEligibility').mockResolvedValue({
      eligible: false,
      reason: '存在待复核的自评，请等待 Buddy 复核',
    })
    vi.spyOn(planningApi, 'annualPlanDryRun').mockRejectedValue(
      new Error('存在待复核的自评，请等待 Buddy 复核'),
    )

    window.history.pushState({}, '', '/capability/gap')
    render(<App />)

    await waitFor(() => {
      expect(screen.getByText('模拟生成年度计划')).toBeTruthy()
    })

    fireEvent.click(screen.getByText('模拟生成年度计划'))

    await waitFor(() => {
      expect(
        screen.getByText('存在待复核的自评，请等待 Buddy 复核'),
      ).toBeTruthy()
    })
  })
})

describe('planning api helpers', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ eligible: true, reason: null }),
        }),
      ),
    )
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('getAnnualPlanEligibility fetches with credentials include', async () => {
    await planningApi.getAnnualPlanEligibility()
    expect(fetch).toHaveBeenCalledWith(
      '/api/planning/annual-plan-eligibility',
      expect.objectContaining({
        method: 'GET',
        credentials: 'include',
      }),
    )
  })

  it('annualPlanDryRun posts empty body with credentials include', async () => {
    await planningApi.annualPlanDryRun()
    expect(fetch).toHaveBeenCalledWith(
      '/api/planning/annual-plan-dry-run',
      expect.objectContaining({
        method: 'POST',
        credentials: 'include',
        body: JSON.stringify({}),
      }),
    )
  })
})

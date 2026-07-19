/// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { App } from './App'
import * as accessApi from './access'
import * as planningApi from './planning'
import { MemoryRouter } from 'react-router-dom'

describe('LearningTaskPage – redirect to annual plan', () => {
  beforeEach(() => {
    vi.spyOn(planningApi, 'getAnnualPlan').mockResolvedValue(null)
    vi.spyOn(planningApi, 'getAnnualPlanEligibility').mockResolvedValue({
      eligible: true,
      reason: null,
    })
    vi.spyOn(planningApi, 'listLearningTasks').mockResolvedValue([])
    vi.spyOn(planningApi, 'listProgressLogs').mockResolvedValue([])
    vi.spyOn(planningApi, 'listEvidences').mockResolvedValue([])
    vi.spyOn(planningApi, 'listEvidenceReviewsForTask').mockResolvedValue([])
    vi.spyOn(planningApi, 'getMonthlyHours').mockResolvedValue([])
  })

  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it('redirects /growth/tasks to /growth/annual-plan', async () => {
    vi.spyOn(accessApi, 'me').mockResolvedValue({
      id: 1,
      username: 'member',
      full_name: 'Member',
      roles: ['Member'],
    })

    render(
      <MemoryRouter initialEntries={['/growth/tasks']}>
        <App />
      </MemoryRouter>
    )
    await waitFor(() => {
      // After redirect, should show the annual plan page heading
      expect(
        screen.getByRole('heading', { name: '年度成长计划', level: 1 }),
      ).toBeTruthy()
    })
  })
})

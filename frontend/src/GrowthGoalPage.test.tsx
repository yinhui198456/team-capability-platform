/// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { App } from './App'
import * as accessApi from './access'
import * as planningApi from './planning'
import { MemoryRouter } from 'react-router-dom'

describe('GrowthGoalPage route', () => {
  beforeEach(() => {
    vi.spyOn(accessApi, 'me').mockResolvedValue({
      id: 1,
      username: 'member',
      full_name: 'Member',
      roles: ['Member'],
    })
    vi.spyOn(planningApi, 'getAnnualPlan').mockResolvedValue(null)
  })

  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it('redirects the deprecated growth-goals route to the annual plan page', async () => {
    render(
      <MemoryRouter initialEntries={['/growth/goals']}>
        <App />
      </MemoryRouter>,
    )
    await waitFor(() => {
      expect(
        screen.getByRole('heading', { name: '月度计划时间轴' }),
      ).toBeTruthy()
    })
  })
})

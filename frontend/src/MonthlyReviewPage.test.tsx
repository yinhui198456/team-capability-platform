/// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { App } from './App'
import * as accessApi from './access'
import * as planningApi from './planning'

describe('MonthlyReviewPage', () => {
  beforeEach(() => {
    vi.spyOn(planningApi, 'getMonthlyHours').mockResolvedValue([
      { month: 6, total_hours: 2 },
      { month: 7, total_hours: 8 },
    ])
  })

  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it('renders monthly hours summary', async () => {
    vi.spyOn(accessApi, 'me').mockResolvedValue({
      id: 1,
      username: 'member',
      full_name: 'Member',
      roles: ['Member'],
    })

    window.history.pushState({}, '', '/growth/review/monthly')
    render(<App />)

    await waitFor(() => {
      expect(screen.getByText('月度复盘')).toBeTruthy()
    })

    expect(screen.getByText('6 月')).toBeTruthy()
    expect(screen.getByText('2 小时')).toBeTruthy()
    expect(screen.getByText('7 月')).toBeTruthy()
    expect(screen.getByText('8 小时')).toBeTruthy()
  })

  it('shows empty message when no hours recorded', async () => {
    vi.spyOn(accessApi, 'me').mockResolvedValue({
      id: 1,
      username: 'member',
      full_name: 'Member',
      roles: ['Member'],
    })
    vi.spyOn(planningApi, 'getMonthlyHours').mockResolvedValue([])

    window.history.pushState({}, '', '/growth/review/monthly')
    render(<App />)

    await waitFor(() => {
      expect(screen.getByText('2026 年暂无学习时长记录。')).toBeTruthy()
    })
  })
})

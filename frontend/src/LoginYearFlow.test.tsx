/// @vitest-environment jsdom

import {
  cleanup,
  render,
  screen,
  waitFor,
  fireEvent,
} from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MemoryRouter } from 'react-router-dom'

import { App } from './App'
import * as accessApi from './access'
import * as planningApi from './planning'

describe('login year initialization flow', () => {
  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it('does not fetch available years on /login before authentication', async () => {
    const getAvailableYears = vi
      .spyOn(planningApi, 'getAvailableYears')
      .mockResolvedValue({ available_years: [2026], active_year: 2026 })
    vi.spyOn(accessApi, 'me').mockRejectedValue(new Error('Unauthorized'))

    render(
      <MemoryRouter initialEntries={['/login']}>
        <App />
      </MemoryRouter>,
    )
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'UAT 登录' })).toBeTruthy()
    })
    expect(getAvailableYears).not.toHaveBeenCalled()
  })

  it('re-fetches available years after SPA login and enters active year into context', async () => {
    const memberUser: accessApi.User = {
      id: 1,
      username: 'member',
      full_name: 'Member',
      roles: ['Member'],
    }
    vi.spyOn(accessApi, 'login').mockResolvedValue(memberUser)
    vi.spyOn(accessApi, 'me').mockResolvedValue(memberUser)
    const getAvailableYears = vi
      .spyOn(planningApi, 'getAvailableYears')
      .mockResolvedValue({
        available_years: [2025, 2026],
        active_year: 2026,
      })
    vi.spyOn(planningApi, 'getMemberDashboard').mockResolvedValue({
      year: 2026,
      meta: {
        year: 2026,
        scope: '本人',
        as_of: '2026-07-01T00:00:00Z',
        source: 'member_dashboard.v1',
        denominator_source: 'planned_items',
      },
      gap_summary: {
        current_required: 0,
        target_progressive: 0,
        derivation: 'legacy_fallback',
      },
      current_month: {
        planned_count: 0,
        planned_ids: [],
        in_progress_count: 0,
        delayed_count: 0,
        pending_evidence_count: 0,
        actual_hours: 0,
      },
      next_action: {
        action_key: 'none',
        message: '当前没有需要处理的事项',
        count: 0,
      },
      assessment: null,
      annual_plan_status: null,
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
      domain_radar: [
        { domain_code: 'P01', score: 0 },
        { domain_code: 'P02', score: 0 },
        { domain_code: 'P03', score: 0 },
        { domain_code: 'C01', score: 0 },
        { domain_code: 'C02', score: 0 },
        { domain_code: 'C03', score: 0 },
      ],
      gaps: [],
      current_tasks: [],
    })

    render(
      <MemoryRouter initialEntries={['/login']}>
        <App />
      </MemoryRouter>,
    )
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'UAT 登录' })).toBeTruthy()
    })
    expect(getAvailableYears).not.toHaveBeenCalled()

    screen.getByLabelText('用户名').click()
    // Use fireEvent-like input via native setter to avoid act warnings
    const usernameInput = screen.getByLabelText('用户名') as HTMLInputElement
    const passwordInput = screen.getByLabelText('密码') as HTMLInputElement
    fireEvent.change(usernameInput, { target: { value: 'member' } })
    fireEvent.change(passwordInput, { target: { value: '123456' } })

    fireEvent.click(screen.getByRole('button', { name: '登录' }))

    await waitFor(() => {
      expect(getAvailableYears).toHaveBeenCalledTimes(1)
    })
    await waitFor(() => {
      expect(screen.getByRole('combobox', { name: '选择年度' })).toBeTruthy()
    })
    const yearSelector = screen.getByRole('combobox', {
      name: '选择年度',
    }) as HTMLSelectElement
    expect(yearSelector.value).toBe('2026')
    expect(Array.from(yearSelector.options).map((o) => o.value)).toEqual([
      '2025',
      '2026',
    ])
  })

  it('switches year and re-fetches dependent page data with new year', async () => {
    const memberUser: accessApi.User = {
      id: 1,
      username: 'member',
      full_name: 'Member',
      roles: ['Member'],
    }
    vi.spyOn(accessApi, 'login').mockResolvedValue(memberUser)
    vi.spyOn(accessApi, 'me').mockResolvedValue(memberUser)
    vi.spyOn(planningApi, 'getAvailableYears').mockResolvedValue({
      available_years: [2025, 2026],
      active_year: 2026,
    })
    const getMemberDashboard = vi
      .spyOn(planningApi, 'getMemberDashboard')
      .mockResolvedValue({
        year: 2026,
        meta: {
          year: 2026,
          scope: '本人',
          as_of: '2026-07-01T00:00:00Z',
          source: 'member_dashboard.v1',
          denominator_source: 'planned_items',
        },
        gap_summary: {
          current_required: 0,
          target_progressive: 0,
          derivation: 'legacy_fallback',
        },
        current_month: {
          planned_count: 0,
          planned_ids: [],
          in_progress_count: 0,
          delayed_count: 0,
          pending_evidence_count: 0,
          actual_hours: 0,
        },
        next_action: {
          action_key: 'none',
          message: '当前没有需要处理的事项',
          count: 0,
        },
        assessment: null,
        annual_plan_status: null,
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
        domain_radar: [
          { domain_code: 'P01', score: 0 },
          { domain_code: 'P02', score: 0 },
          { domain_code: 'P03', score: 0 },
          { domain_code: 'C01', score: 0 },
          { domain_code: 'C02', score: 0 },
          { domain_code: 'C03', score: 0 },
        ],
        gaps: [],
        current_tasks: [],
      })

    render(
      <MemoryRouter initialEntries={['/login']}>
        <App />
      </MemoryRouter>,
    )
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'UAT 登录' })).toBeTruthy()
    })

    const usernameInput = screen.getByLabelText('用户名') as HTMLInputElement
    const passwordInput = screen.getByLabelText('密码') as HTMLInputElement
    fireEvent.change(usernameInput, { target: { value: 'member' } })
    fireEvent.change(passwordInput, { target: { value: '123456' } })
    fireEvent.click(screen.getByRole('button', { name: '登录' }))

    await waitFor(() => {
      expect(screen.getByRole('combobox', { name: '选择年度' })).toBeTruthy()
    })
    expect(getMemberDashboard).toHaveBeenLastCalledWith(2026)

    const yearSelector = screen.getByRole('combobox', {
      name: '选择年度',
    }) as HTMLSelectElement
    fireEvent.change(yearSelector, { target: { value: '2025' } })

    await waitFor(() => {
      expect(getMemberDashboard).toHaveBeenLastCalledWith(2025)
    })
  })
})

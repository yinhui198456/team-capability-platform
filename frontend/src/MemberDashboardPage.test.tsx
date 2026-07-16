/// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { App } from './App'
import * as accessApi from './access'
import * as planningApi from './planning'

describe('MemberDashboardPage', () => {
  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it('renders the member summary, gaps, and current tasks', async () => {
    vi.spyOn(accessApi, 'me').mockResolvedValue({
      id: 1,
      username: 'member',
      full_name: 'Member',
      roles: ['Member'],
    })
    vi.spyOn(planningApi, 'getMemberDashboard').mockResolvedValue({
      year: 2026,
      summary: {
        total_learning_hours: 5,
        completed_task_count: 1,
        pending_evidence_count: 2,
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
          l3_code: 'P01-L2A-L3A',
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
          l3_code: 'P01-L2A-L3A',
          status: '进行中',
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
          plan_item_learning_task_content: null,
          plan_item_expected_output: null,
          plan_item_estimated_hours: '10',
        },
      ],
    })

    window.history.pushState({}, '', '/dashboard/member')
    render(<App />)

    await waitFor(() => {
      expect(screen.getByText('我的成长总览')).toBeTruthy()
    })
    expect(screen.getByText('5 小时')).toBeTruthy()
    expect(screen.getAllByText('P01-L2A-L3A')).toHaveLength(2)
    expect(screen.getByText('待补充 Evidence')).toBeTruthy()
    expect(screen.getByRole('link', { name: '进入能力自评' })).toHaveProperty(
      'href',
      expect.stringContaining('/capability/assessment'),
    )
  })
})

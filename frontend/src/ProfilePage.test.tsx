/// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { App } from './App'
import * as accessApi from './access'
import * as planningApi from './planning'

describe('ProfilePage', () => {
  beforeEach(() => {
    vi.spyOn(planningApi, 'getCapabilityProfile').mockResolvedValue({
      id: 1,
      member_id: 1,
      year: 2026,
      status: '已生成',
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-01T00:00:00Z',
      member: {
        id: 1,
        username: 'member',
        full_name: 'Member',
      },
      assessments: [
        {
          id: 10,
          member_id: 1,
          year: 2026,
          version: 1,
          assessment_type: '年度',
          status: '已归档',
          created_at: '2026-01-01T00:00:00Z',
          submitted_at: '2026-01-02T00:00:00Z',
          archived_at: '2026-01-03T00:00:00Z',
          reviews: [
            {
              id: 100,
              status: '已闭环',
              conclusion: '认可',
              feedback: '符合预期',
              reviewed_at: '2026-01-02T00:00:00Z',
            },
          ],
        },
      ],
      annual_plan: {
        id: 20,
        member_id: 1,
        year: 2026,
        plan_cycle: 12,
        status: '执行中',
        start_date: '2026-01-01',
        end_date: '2026-12-31',
        created_at: '2026-01-01T00:00:00Z',
        items: [
          {
            id: 30,
            annual_growth_plan_id: 20,
            growth_goal_id: 40,
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
            status: '进行中',
            learning_task: {
              id: 50,
              plan_item_id: 30,
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
              plan_item_priority: '中',
              plan_item_learning_material: null,
              plan_item_learning_task_content: null,
              plan_item_expected_output: null,
              plan_item_estimated_hours: '10',
              progress_logs: [
                {
                  id: 60,
                  task_id: 50,
                  record_date: '2026-03-15',
                  actual_hours: 5,
                  note: '学习日志',
                  recorder_id: 1,
                },
              ],
              evidences: [
                {
                  id: 70,
                  learning_task_id: 50,
                  l3_code: 'P01-L2A-L3A',
                  version_number: 1,
                  content: 'Evidence 内容',
                  evidence_link: 'http://example.com',
                  status: '已归档',
                  submitted_at: '2026-03-20T00:00:00Z',
                  created_at: '2026-03-20T00:00:00Z',
                  review: {
                    id: 110,
                    evidence_id: 70,
                    version_number: 1,
                    status: '已闭环',
                    conclusion: '通过',
                    feedback: '符合要求',
                    reviewed_at: '2026-03-21T00:00:00Z',
                  },
                },
              ],
            },
          },
        ],
      },
      statistics: {
        total_learning_hours: 5,
        evidence_count_by_status: {
          已归档: 1,
        },
      },
    })
  })

  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it('renders profile page and aggregated data', async () => {
    vi.spyOn(accessApi, 'me').mockResolvedValue({
      id: 1,
      username: 'member',
      full_name: 'Member',
      roles: ['Member'],
    })

    window.history.pushState({}, '', '/growth/profile')
    render(<App />)

    await waitFor(() => {
      expect(screen.getByText('成长档案')).toBeTruthy()
    })

    expect(screen.getByText(/Member（member）/)).toBeTruthy()
    expect(screen.getByText(/档案状态：已生成/)).toBeTruthy()
    expect(screen.getByText(/P01-L2A-L3A/)).toBeTruthy()
    expect(screen.getByText(/总学习时长：5 小时/)).toBeTruthy()
    expect(screen.getByText(/已归档：1/)).toBeTruthy()
    expect(screen.getByText(/Review 结论：认可/)).toBeTruthy()
    expect(screen.getByText(/Review: 通过/)).toBeTruthy()
  })

  it('shows the Evidence version landmark in the capability profile', async () => {
    vi.spyOn(accessApi, 'me').mockResolvedValue({
      id: 1,
      username: 'member',
      full_name: 'Member',
      roles: ['Member'],
    })

    window.history.pushState({}, '', '/growth/profile')
    render(<App />)

    await waitFor(() => {
      expect(screen.getByRole('region', { name: /学习任务详情/ })).toBeTruthy()
    })

    expect(screen.getByRole('region', { name: /Evidence 版本/ })).toBeTruthy()
    expect(screen.getByText(/Review: 通过/)).toBeTruthy()
  })

  it('shows empty state when profile data is missing', async () => {
    vi.spyOn(accessApi, 'me').mockResolvedValue({
      id: 1,
      username: 'member',
      full_name: 'Member',
      roles: ['Member'],
    })
    vi.spyOn(planningApi, 'getCapabilityProfile').mockRejectedValue(
      new Error('暂无成长档案数据'),
    )

    window.history.pushState({}, '', '/growth/profile')
    render(<App />)

    await waitFor(() => {
      expect(screen.getByText('成长档案')).toBeTruthy()
    })

    expect(screen.getByText(/暂无成长档案数据/)).toBeTruthy()
  })
})

describe('capability profile api helpers', () => {
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

  it('getCapabilityProfile fetches with year query', async () => {
    await planningApi.getCapabilityProfile(2026)
    expect(fetch).toHaveBeenCalledWith(
      '/api/planning/profiles?year=2026',
      expect.objectContaining({
        method: 'GET',
        credentials: 'include',
      }),
    )
  })

  it('getCapabilityProfileForMember fetches with member_id and year', async () => {
    await planningApi.getCapabilityProfileForMember(2, 2026)
    expect(fetch).toHaveBeenCalledWith(
      '/api/planning/profiles?member_id=2&year=2026',
      expect.objectContaining({
        method: 'GET',
        credentials: 'include',
      }),
    )
  })
})

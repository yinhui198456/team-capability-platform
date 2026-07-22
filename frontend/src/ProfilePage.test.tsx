/// @vitest-environment jsdom

import {
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MemoryRouter } from 'react-router-dom'

import { App } from './App'
import * as accessApi from './access'
import * as planningApi from './planning'

const baseProfile: planningApi.CapabilityProfile = {
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
          conclusion: '认可' as const,
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
        l3_name: '测试能力项 P01',
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
          l3_name: '测试能力项 P01',
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
                conclusion: '通过' as const,
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
    total_planned_hours: 10,
    evidence_count_by_status: {
      已归档: 1,
    },
  },
}

describe('ProfilePage', () => {
  beforeEach(() => {
    vi.spyOn(planningApi, 'getCapabilityProfile').mockResolvedValue(baseProfile)
  })

  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it('renders redesigned profile page and aggregated data', async () => {
    vi.spyOn(accessApi, 'me').mockResolvedValue({
      id: 1,
      username: 'member',
      full_name: 'Member',
      roles: ['Member'],
    })

    render(
      <MemoryRouter initialEntries={['/growth/profile']}>
        <App />
      </MemoryRouter>,
    )

    await waitFor(() => {
      expect(
        screen.getByRole('heading', { name: '成长档案', level: 1 }),
      ).toBeTruthy()
    })

    expect(screen.getByText(/成员：Member（member）/)).toBeTruthy()
    expect(screen.getByText(/年度：2026/)).toBeTruthy()
    expect(screen.getByText(/数据范围：本人/, { selector: 'p' })).toBeTruthy()
    const kpiRegion = screen.getByRole('region', { name: '年度成长闭环摘要' })
    expect(within(kpiRegion).getByText('已完成计划项')).toBeTruthy()
    expect(within(kpiRegion).getByText('实际学习时长')).toBeTruthy()
    expect(within(kpiRegion).getByText('已归档 Evidence')).toBeTruthy()
    expect(within(kpiRegion).getByText('能力评估')).toBeTruthy()
    expect(screen.getAllByText('P01-L2A-L3A').length).toBeGreaterThan(0)
    expect(screen.getAllByText('测试能力项 P01').length).toBeGreaterThan(0)
    const assessmentRegion = screen.getByRole('region', { name: '评估历史' })
    expect(within(assessmentRegion).getByText('认可')).toBeTruthy()
    expect(screen.getByText(/Review 结论：通过/)).toBeTruthy()
  })

  it('shows the redesigned landmarks in the capability profile', async () => {
    vi.spyOn(accessApi, 'me').mockResolvedValue({
      id: 1,
      username: 'member',
      full_name: 'Member',
      roles: ['Member'],
    })

    render(
      <MemoryRouter initialEntries={['/growth/profile']}>
        <App />
      </MemoryRouter>,
    )

    await waitFor(() => {
      expect(
        screen.getByRole('region', { name: '年度成长闭环摘要' }),
      ).toBeTruthy()
    })

    expect(
      screen.getByRole('article', { name: '计划项：P01-L2A-L3A' }),
    ).toBeTruthy()
    expect(
      screen.getByRole('article', { name: '学习任务：P01-L2A-L3A' }),
    ).toBeTruthy()
    expect(
      screen.getByRole('article', {
        name: 'Evidence 版本 1：P01-L2A-L3A',
      }),
    ).toBeTruthy()
    expect(screen.getByRole('region', { name: '年度成长计划' })).toBeTruthy()
    expect(screen.getByRole('region', { name: '评估历史' })).toBeTruthy()
    expect(screen.getByRole('region', { name: '年度统计' })).toBeTruthy()
    expect(
      screen.getByRole('region', { name: '学习任务与学习日志' }),
    ).toBeTruthy()
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

    render(
      <MemoryRouter initialEntries={['/growth/profile']}>
        <App />
      </MemoryRouter>,
    )

    await waitFor(() => {
      expect(
        screen.getByRole('heading', { name: '成长档案', level: 1 }),
      ).toBeTruthy()
    })

    expect(screen.getByText(/暂无成长档案数据/)).toBeTruthy()
  })

  it('shows member selector for Buddy and loads assigned member profile', async () => {
    vi.spyOn(accessApi, 'me').mockResolvedValue({
      id: 2,
      username: 'buddy',
      full_name: 'Buddy',
      roles: ['Buddy'],
      assigned_members: [
        { id: 1, username: 'member', full_name: 'Member', is_active: true },
      ],
    })
    vi.spyOn(planningApi, 'getSelectableMembersForProfile').mockResolvedValue({
      members: [{ id: 1, username: 'member', full_name: 'Member' }],
    })
    vi.spyOn(planningApi, 'getCapabilityProfileForMember').mockResolvedValue({
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
      assessments: [],
      annual_plan: null,
      statistics: {
        total_learning_hours: 0,
        total_planned_hours: 0,
        evidence_count_by_status: {},
      },
    } as planningApi.CapabilityProfile)

    render(
      <MemoryRouter initialEntries={['/growth/profile']}>
        <App />
      </MemoryRouter>,
    )

    await waitFor(() => {
      expect(screen.getByLabelText('查看成员')).toBeTruthy()
    })

    expect(screen.getByText(/成员：Member（member）/)).toBeTruthy()
    expect(
      screen.getByText(/数据范围：负责成员/, { selector: 'p' }),
    ).toBeTruthy()
  })

  it('shows member selector for Leader and lists team members', async () => {
    vi.spyOn(accessApi, 'me').mockResolvedValue({
      id: 3,
      username: 'leader',
      full_name: 'Leader',
      roles: ['Leader'],
    })
    vi.spyOn(planningApi, 'getSelectableMembersForProfile').mockResolvedValue({
      members: [
        { id: 1, username: 'member', full_name: 'Member' },
        { id: 2, username: 'member2', full_name: 'Member Two' },
      ],
    })
    vi.spyOn(planningApi, 'getCapabilityProfileForMember').mockResolvedValue({
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
      assessments: [],
      annual_plan: null,
      statistics: {
        total_learning_hours: 0,
        total_planned_hours: 0,
        evidence_count_by_status: {},
      },
    } as planningApi.CapabilityProfile)

    render(
      <MemoryRouter initialEntries={['/growth/profile']}>
        <App />
      </MemoryRouter>,
    )

    // Wait for both the profile load and the member selector to stabilize.
    // The page toggles loading while fetching the selected member profile,
    // so waiting only for the selector can race with the loading state.
    await waitFor(() => {
      expect(screen.getByText(/成员：Member（member）/)).toBeTruthy()
    })

    const selector = screen.getByLabelText('查看成员') as HTMLSelectElement
    expect(selector.options.length).toBe(2)
    expect(screen.getByText(/数据范围：团队/, { selector: 'p' })).toBeTruthy()
  })

  it('does not show member selector for plain Member', async () => {
    vi.spyOn(accessApi, 'me').mockResolvedValue({
      id: 1,
      username: 'member',
      full_name: 'Member',
      roles: ['Member'],
    })

    render(
      <MemoryRouter initialEntries={['/growth/profile']}>
        <App />
      </MemoryRouter>,
    )

    await waitFor(() => {
      expect(
        screen.getByRole('heading', { name: '成长档案', level: 1 }),
      ).toBeTruthy()
    })

    expect(screen.queryByLabelText('查看成员')).toBeNull()
    expect(screen.getByText(/数据范围：本人/, { selector: 'p' })).toBeTruthy()
  })

  it('does not render write actions on profile page', async () => {
    vi.spyOn(accessApi, 'me').mockResolvedValue({
      id: 1,
      username: 'member',
      full_name: 'Member',
      roles: ['Member'],
    })

    render(
      <MemoryRouter initialEntries={['/growth/profile']}>
        <App />
      </MemoryRouter>,
    )

    await waitFor(() => {
      expect(
        screen.getByRole('heading', { name: '成长档案', level: 1 }),
      ).toBeTruthy()
    })

    expect(screen.queryByRole('button', { name: /编辑/ })).toBeNull()
    expect(screen.queryByRole('button', { name: /提交/ })).toBeNull()
    expect(screen.queryByRole('button', { name: /审核/ })).toBeNull()
  })

  it('shows empty state when no selectable members for Buddy', async () => {
    vi.spyOn(accessApi, 'me').mockResolvedValue({
      id: 2,
      username: 'buddy',
      full_name: 'Buddy',
      roles: ['Buddy'],
      assigned_members: [],
    })
    vi.spyOn(planningApi, 'getSelectableMembersForProfile').mockResolvedValue({
      members: [],
    })

    render(
      <MemoryRouter initialEntries={['/growth/profile']}>
        <App />
      </MemoryRouter>,
    )

    await waitFor(() => {
      expect(screen.getByText(/没有可查看的成员/)).toBeTruthy()
    })
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

  it('getSelectableMembersForProfile fetches selectable members', async () => {
    await planningApi.getSelectableMembersForProfile(2026)
    expect(fetch).toHaveBeenCalledWith(
      '/api/planning/profiles/selectable-members?year=2026',
      expect.objectContaining({
        method: 'GET',
        credentials: 'include',
      }),
    )
  })
})

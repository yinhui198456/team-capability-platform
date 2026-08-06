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
    current_level: null,
    target_level: null,
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
        revision: 0,
        annual_growth_plan_id: 20,
        growth_goal_id: 40,
        l3_code: 'P01-L2A-L3A',
        l3_name: '测试能力项 P01',
        l2_code: 'P01-L2A',
        l2_name: '测试二级能力标准',
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
        scope_type: 'current_required',
        source_assessment_id: 10,
        planning_source_type: 'assessment_approval',
        learning_task: {
          id: 50,
          plan_item_id: 30,
          l3_code: 'P01-L2A-L3A',
          l3_name: '测试能力项 P01',
          l2_code: 'P01-L2A',
          l2_name: '测试二级能力标准',
          status: '进行中',
          actual_start_date: null,
          actual_end_date: null,
          actual_hours: 5,
          completion_quality: null,
          review_conclusion: null,
          next_action: null,
          revision: 0,
          actual_started_at: null,
          actual_completed_at: null,
          delay_reason: null,
          pause_reason: null,
          cancel_reason: null,
          revised_due_date: null,
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
              created_at: '2026-03-15T00:00:00Z',
              invalidated_at: null,
              invalidated_by: null,
              correction_of_log_id: null,
              idempotency_key: null,
            },
          ],
          evidences: [
            {
              id: 70,
              learning_task_id: 50,
              l3_code: 'P01-L2A-L3A',
              version_number: 1,
              content: '任务成果证明 内容',
              evidence_link: 'http://example.com',
              status: '已归档',
              submitted_at: '2026-03-20T00:00:00Z',
              created_at: '2026-03-20T00:00:00Z',
              submitted_by: 1,
              description: null,
              evidence_type: null,
              url: null,
              file_reference: null,
              file_name: null,
              mime_type: null,
              file_size: null,
              supersedes_evidence_id: null,
              revision: 0,
              review: {
                id: 110,
                evidence_id: 70,
                version_number: 1,
                status: '已闭环',
                conclusion: '通过' as const,
                feedback: '符合要求',
                reviewed_at: '2026-03-21T00:00:00Z',
                created_at: '2026-03-21T00:00:00Z',
              },
            },
          ],
        },
      },
    ],
  },
  monthly_reviews: [
    {
      id: 9,
      member_id: 1,
      year: 2026,
      month: 5,
      revision: 2,
      main_output: '完成数据建模规范初稿',
      problems: '排期紧张',
      next_month_focus: '推进 C01 任务',
      notes: '备注文本',
      created_at: '2026-05-31T10:00:00Z',
      updated_at: '2026-06-02T09:00:00Z',
      history: [
        {
          revision: 1,
          main_output: '完成数据建模规范初稿',
          problems: null,
          next_month_focus: null,
          notes: null,
          changed_by: 1,
          changed_at: '2026-05-31T10:00:00Z',
        },
        {
          revision: 2,
          main_output: '完成数据建模规范初稿',
          problems: '排期紧张',
          next_month_focus: '推进 C01 任务',
          notes: '备注文本',
          changed_by: 1,
          changed_at: '2026-06-02T09:00:00Z',
        },
      ],
    },
  ],
  meta: {
    year: 2026,
    scope: '本人',
    as_of: '2026-06-02T09:00:00Z',
    source: 'capability_profile.v1',
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

    await waitFor(() => {
      expect(screen.getByText(/成员：Member（member）/)).toBeTruthy()
    })
    expect(screen.getByText(/年度：2026/)).toBeTruthy()
    expect(screen.getByText(/数据范围：本人/, { selector: 'p' })).toBeTruthy()
    const kpiRegion = screen.getByRole('region', { name: '年度成长闭环摘要' })
    expect(within(kpiRegion).getByText('已完成计划项')).toBeTruthy()
    expect(within(kpiRegion).getByText('实际学习时长')).toBeTruthy()
    expect(within(kpiRegion).getByText('已归档任务成果证明')).toBeTruthy()
    expect(within(kpiRegion).getByText('能力评估')).toBeTruthy()
    expect(
      screen.getAllByText(
        /P01-L2A · 测试二级能力标准 → P01-L2A-L3A · 测试能力项 P01/,
      ).length,
    ).toBeGreaterThanOrEqual(2)
    const assessmentRegion = screen.getByRole('region', { name: '评估历史' })
    expect(within(assessmentRegion).getByText('认可')).toBeTruthy()
    expect(screen.getByText(/Review 结论：通过/)).toBeTruthy()
  })

  it('shows plan-item provenance scope and monthly review history', async () => {
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

    // 计划项展示 assessment 快照推导的 scope（必备/进阶），不暗示任务完成即晋级。
    const item = screen.getByRole('article', { name: '计划项：P01-L2A-L3A' })
    expect(item.textContent).toContain('必备')
    expect(item.textContent).toContain('来源自评')

    // 月度复盘记录区展示不可变修订历史。
    const reviews = screen.getByRole('region', { name: '月度复盘记录' })
    expect(reviews.textContent).toContain('5 月')
    expect(reviews.textContent).toContain('完成数据建模规范初稿')
    expect(reviews.textContent).toContain('v1')
    expect(reviews.textContent).toContain('v2')
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
        name: '任务成果证明 版本 1：P01-L2A-L3A',
      }),
    ).toBeTruthy()
    expect(screen.getByRole('region', { name: '年度成长计划' })).toBeTruthy()
    expect(screen.getByRole('region', { name: '评估历史' })).toBeTruthy()
    expect(screen.getByRole('region', { name: '年度统计' })).toBeTruthy()
    expect(
      screen.getByRole('region', { name: '学习任务与学习日志' }),
    ).toBeTruthy()
  })

  it('renders hour-suffix estimated hours as normalized ranges', async () => {
    vi.spyOn(accessApi, 'me').mockResolvedValue({
      id: 1,
      username: 'member',
      full_name: 'Member',
      roles: ['Member'],
    })
    const profileWithRange: planningApi.CapabilityProfile = {
      ...baseProfile,
      annual_plan: {
        ...baseProfile.annual_plan!,
        items: [
          {
            ...baseProfile.annual_plan!.items[0],
            estimated_hours: '4–6h',
            estimated_hours_parsed: {
              raw: '4–6h',
              min_hours: 4,
              max_hours: 6,
              is_valid: true,
              is_range: true,
            },
            learning_task: {
              ...baseProfile.annual_plan!.items[0].learning_task!,
              plan_item_estimated_hours: '4–6h',
              plan_item_estimated_hours_parsed: {
                raw: '4–6h',
                min_hours: 4,
                max_hours: 6,
                is_valid: true,
                is_range: true,
              },
            },
          },
        ],
      },
    }
    vi.spyOn(planningApi, 'getCapabilityProfile').mockResolvedValue(
      profileWithRange,
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
    await waitFor(() => {
      expect(
        screen.getAllByText((content) => content.includes('4–6 h')).length,
      ).toBeGreaterThanOrEqual(1)
    })
    expect(screen.queryByText('46 h')).toBeNull()
    expect(screen.queryByText('4–6h h')).toBeNull()
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
      members: [
        {
          id: 1,
          username: 'member',
          full_name: 'Member',
          current_level: null,
          target_level: null,
        },
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
      monthly_reviews: [],
      meta: {
        year: 2026,
        scope: '负责成员',
        as_of: null,
        source: 'capability_profile.v1',
      },
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

    await waitFor(() => {
      expect(screen.getByText(/成员：Member（member）/)).toBeTruthy()
    })
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
        {
          id: 1,
          username: 'member',
          full_name: 'Member',
          current_level: null,
          target_level: null,
        },
        {
          id: 2,
          username: 'member2',
          full_name: 'Member Two',
          current_level: null,
          target_level: null,
        },
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
      monthly_reviews: [],
      meta: {
        year: 2026,
        scope: '负责成员',
        as_of: null,
        source: 'capability_profile.v1',
      },
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

  it('falls back to l3_code when l3_name is not provided', async () => {
    vi.spyOn(accessApi, 'me').mockResolvedValue({
      id: 1,
      username: 'member',
      full_name: 'Member',
      roles: ['Member'],
    })
    const profileWithoutName: planningApi.CapabilityProfile = {
      ...baseProfile,
      annual_plan: {
        ...baseProfile.annual_plan!,
        items: [
          {
            ...baseProfile.annual_plan!.items[0],
            l3_name: null,
            learning_task: {
              ...baseProfile.annual_plan!.items[0].learning_task!,
              l3_name: null,
            },
          },
        ],
      },
    }
    vi.spyOn(planningApi, 'getCapabilityProfile').mockResolvedValue(
      profileWithoutName,
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

    expect(screen.getAllByText(/P01-L2A-L3A/).length).toBeGreaterThanOrEqual(2)
  })

  it('displays P6 → P7 when both levels set', async () => {
    vi.spyOn(accessApi, 'me').mockResolvedValue({
      id: 1,
      username: 'member',
      full_name: 'Member',
      roles: ['Member'],
    })
    vi.spyOn(planningApi, 'getCapabilityProfile').mockResolvedValue({
      ...baseProfile,
      member: {
        ...baseProfile.member,
        current_level: 'P6',
        target_level: 'P7',
      },
    })
    render(
      <MemoryRouter initialEntries={['/growth/profile']}>
        <App />
      </MemoryRouter>,
    )
    await waitFor(() => {
      expect(screen.getByText(/职级：P6 → P7/)).toBeTruthy()
    })
  })

  it('displays — → P7 when only target set', async () => {
    vi.spyOn(accessApi, 'me').mockResolvedValue({
      id: 1,
      username: 'member',
      full_name: 'Member',
      roles: ['Member'],
    })
    vi.spyOn(planningApi, 'getCapabilityProfile').mockResolvedValue({
      ...baseProfile,
      member: {
        ...baseProfile.member,
        current_level: null,
        target_level: 'P7',
      },
    })
    render(
      <MemoryRouter initialEntries={['/growth/profile']}>
        <App />
      </MemoryRouter>,
    )
    await waitFor(() => {
      expect(screen.getByText(/职级：— → P7/)).toBeTruthy()
    })
  })

  it('displays P6 → — when only current set', async () => {
    vi.spyOn(accessApi, 'me').mockResolvedValue({
      id: 1,
      username: 'member',
      full_name: 'Member',
      roles: ['Member'],
    })
    vi.spyOn(planningApi, 'getCapabilityProfile').mockResolvedValue({
      ...baseProfile,
      member: {
        ...baseProfile.member,
        current_level: 'P6',
        target_level: null,
      },
    })
    render(
      <MemoryRouter initialEntries={['/growth/profile']}>
        <App />
      </MemoryRouter>,
    )
    await waitFor(() => {
      expect(screen.getByText(/职级：P6 → —/)).toBeTruthy()
    })
  })

  it('hides level segment when both are null', async () => {
    vi.spyOn(accessApi, 'me').mockResolvedValue({
      id: 1,
      username: 'member',
      full_name: 'Member',
      roles: ['Member'],
    })
    vi.spyOn(planningApi, 'getCapabilityProfile').mockResolvedValue({
      ...baseProfile,
      member: {
        ...baseProfile.member,
        current_level: null,
        target_level: null,
      },
    })
    render(
      <MemoryRouter initialEntries={['/growth/profile']}>
        <App />
      </MemoryRouter>,
    )
    await waitFor(() => {
      expect(screen.getByText(/成员：Member（member）/)).toBeTruthy()
    })
    expect(screen.queryByText(/职级：/)).toBeNull()
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

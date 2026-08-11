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

const mockModel = {
  code: 'tcp-model',
  version: '1.0',
  domains: [
    {
      code: 'P01',
      name: 'Data Infra',
      p4_description: null,
      p5_description: null,
      p6_description: null,
      p7_description: null,
      p8_description: null,
      children: [],
    },
    {
      code: 'P02',
      name: 'AI Infra / Agent',
      p4_description: null,
      p5_description: null,
      p6_description: null,
      p7_description: null,
      p8_description: null,
      children: [],
    },
    {
      code: 'P03',
      name: 'Coding',
      p4_description: null,
      p5_description: null,
      p6_description: null,
      p7_description: null,
      p8_description: null,
      children: [],
    },
    {
      code: 'C01',
      name: '基本办公',
      p4_description: null,
      p5_description: null,
      p6_description: null,
      p7_description: null,
      p8_description: null,
      children: [],
    },
    {
      code: 'C02',
      name: '沟通协作',
      p4_description: null,
      p5_description: null,
      p6_description: null,
      p7_description: null,
      p8_description: null,
      children: [],
    },
    {
      code: 'C03',
      name: '学习创新',
      p4_description: null,
      p5_description: null,
      p6_description: null,
      p7_description: null,
      p8_description: null,
      children: [],
    },
  ],
}

function publishedPlan(): planningApi.TeamAnnualCapabilityPlan {
  return {
    id: 1,
    code: 'TACP-2026',
    year: 2026,
    publisher_id: 1,
    resource_arrangement: 'Q1 bootcamp + monthly sharing',
    description: 'Team focus for the year',
    published_at: '2026-01-01T00:00:00Z',
    status: '已发布',
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    focus_domains: ['P01', 'P02'],
  }
}

function emptyItemList(): planningApi.TeamAnnualPlanItemList {
  return {
    meta: {
      year: 2026,
      as_of: '2026-01-01T00:00:00Z',
      scope: 'leader_team',
      source: 'team_annual_plan.items.v1',
    },
    filters: {
      domain_code: null,
      priority: null,
      status: null,
      quarter: null,
      month: null,
      member_id: null,
      q: null,
    },
    pagination: {
      page: 1,
      page_size: 20,
      total_pages: 0,
      total_count: 0,
    },
    summary: {
      total_count: 0,
      planned_hours_min: null,
      planned_hours_max: null,
      has_values: false,
      has_unparsed: false,
      actual_hours: 0,
      status_breakdown: {
        未开始: 0,
        进行中: 0,
        已完成: 0,
        延期: 0,
        暂停: 0,
        取消: 0,
        total: 0,
      },
    },
    members: [],
    items: [],
  }
}

function itemList(): planningApi.TeamAnnualPlanItemList {
  return {
    meta: {
      year: 2026,
      as_of: '2026-01-01T00:00:00Z',
      scope: 'leader_team',
      source: 'team_annual_plan.items.v1',
    },
    filters: {
      domain_code: null,
      priority: null,
      status: null,
      quarter: null,
      month: null,
      member_id: null,
      q: null,
    },
    pagination: {
      page: 1,
      page_size: 20,
      total_pages: 1,
      total_count: 2,
    },
    summary: {
      total_count: 2,
      planned_hours_min: 10,
      planned_hours_max: 20,
      has_values: true,
      has_unparsed: false,
      actual_hours: 8,
      status_breakdown: {
        未开始: 0,
        进行中: 0,
        已完成: 1,
        延期: 1,
        暂停: 0,
        取消: 0,
        total: 2,
      },
    },
    members: [{ member_id: 2, username: 'member', full_name: '成员甲' }],
    items: [
      {
        id: 1,
        annual_growth_plan_id: 1,
        growth_goal_id: 1,
        l2_code: 'P01.01',
        l2_name: '数据基础',
        l3_code: 'P01-L1-L2',
        l3_name: '数据开发',
        member_id: 2,
        username: 'member',
        full_name: '成员甲',
        current_level: 2,
        target_level: 4,
        priority: '高',
        learning_material: null,
        learning_task_content: null,
        expected_output: null,
        estimated_hours: '10',
        estimated_hours_parsed: {
          raw: '10',
          min_hours: 10,
          max_hours: 10,
          is_valid: true,
          is_range: false,
        },
        plan_start_date: '2026-03-01',
        plan_end_date: '2026-03-31',
        target_month: 3,
        plan_month: 3,
        plan_quarter: 'Q1',
        status: '已完成',
        revision: 1,
        actual_hours: 8,
      },
      {
        id: 2,
        annual_growth_plan_id: 1,
        growth_goal_id: 1,
        l2_code: 'P02.01',
        l2_name: '模型工程',
        l3_code: 'P02-L1-L2',
        l3_name: '模型服务',
        member_id: 2,
        username: 'member',
        full_name: '成员甲',
        current_level: 1,
        target_level: 3,
        priority: '中',
        learning_material: null,
        learning_task_content: null,
        expected_output: null,
        estimated_hours: '8-12',
        estimated_hours_parsed: {
          raw: '8-12',
          min_hours: 8,
          max_hours: 12,
          is_valid: true,
          is_range: true,
        },
        plan_start_date: '2026-06-01',
        plan_end_date: '2026-06-30',
        target_month: 6,
        plan_month: 6,
        plan_quarter: 'Q2',
        status: '延期',
        revision: 2,
        actual_hours: 0,
      },
    ],
  }
}

describe('TeamAnnualPlanPage', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn((input: string) => {
        if (input === '/api/capability-model') {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve(mockModel),
          })
        }
        if (String(input).includes('/api/planning/change-proposals')) {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve([]),
          })
        }
        return Promise.resolve({ ok: true, json: () => Promise.resolve({}) })
      }),
    )
    vi.spyOn(planningApi, 'getTeamAnnualPlanItems').mockResolvedValue(
      emptyItemList(),
    )
  })

  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('renders existing plan and leader management controls', async () => {
    vi.spyOn(accessApi, 'me').mockResolvedValue({
      id: 1,
      username: 'leader',
      full_name: 'Leader',
      roles: ['Leader'],
    })
    vi.spyOn(planningApi, 'getTeamAnnualPlan').mockResolvedValue(
      publishedPlan(),
    )

    render(
      <MemoryRouter initialEntries={['/operations/team-annual-plan']}>
        <App />
      </MemoryRouter>,
    )
    await waitFor(() => {
      expect(
        screen.getByRole('heading', { name: '团队年度能力规划' }),
      ).toBeTruthy()
    })

    await waitFor(() => {
      expect(screen.getByText(/TACP-2026/)).toBeTruthy()
    })

    expect(screen.getByText(/已发布/)).toBeTruthy()
    expect(screen.getByText('更新')).toBeTruthy()
    expect(screen.getByText('归档')).toBeTruthy()
    expect(screen.queryByText('发布')).toBeNull()
  })

  it('publishes a new plan from the form', async () => {
    vi.spyOn(accessApi, 'me').mockResolvedValue({
      id: 1,
      username: 'leader',
      full_name: 'Leader',
      roles: ['Leader'],
    })
    vi.spyOn(planningApi, 'getTeamAnnualPlan').mockResolvedValue(null)
    const publish = vi
      .spyOn(planningApi, 'publishTeamAnnualPlan')
      .mockResolvedValue(publishedPlan())

    render(
      <MemoryRouter initialEntries={['/operations/team-annual-plan']}>
        <App />
      </MemoryRouter>,
    )
    await waitFor(() => {
      expect(screen.getByText('发布')).toBeTruthy()
    })
    await waitFor(() => {
      expect(screen.getByLabelText('P01 · Data Infra')).toBeTruthy()
    })

    fireEvent.click(screen.getByLabelText('P01 · Data Infra'))
    fireEvent.click(screen.getByLabelText('P03 · Coding'))
    fireEvent.change(screen.getByLabelText('资源安排'), {
      target: { value: 'Q1 bootcamp' },
    })
    fireEvent.change(screen.getByLabelText('说明'), {
      target: { value: 'team focus' },
    })
    fireEvent.click(screen.getByText('发布'))

    await waitFor(() => {
      expect(publish).toHaveBeenCalledWith({
        year: 2026,
        focus_domain_codes: ['P01', 'P03'],
        resource_arrangement: 'Q1 bootcamp',
        description: 'team focus',
      })
    })
  })

  it('updates an existing plan while published', async () => {
    vi.spyOn(accessApi, 'me').mockResolvedValue({
      id: 1,
      username: 'leader',
      full_name: 'Leader',
      roles: ['Leader'],
    })
    vi.spyOn(planningApi, 'getTeamAnnualPlan').mockResolvedValue(
      publishedPlan(),
    )
    const update = vi
      .spyOn(planningApi, 'updateTeamAnnualPlan')
      .mockResolvedValue({
        ...publishedPlan(),
        description: 'updated description',
      })

    render(
      <MemoryRouter initialEntries={['/operations/team-annual-plan']}>
        <App />
      </MemoryRouter>,
    )
    await waitFor(() => {
      expect(screen.getByText('更新')).toBeTruthy()
    })

    fireEvent.change(screen.getByLabelText('说明'), {
      target: { value: 'updated description' },
    })
    fireEvent.click(screen.getByText('更新'))

    await waitFor(() => {
      expect(update).toHaveBeenCalledWith(
        expect.objectContaining({
          year: 2026,
          description: 'updated description',
        }),
      )
    })
  })

  it('archives a published plan and becomes read-only', async () => {
    vi.spyOn(accessApi, 'me').mockResolvedValue({
      id: 1,
      username: 'leader',
      full_name: 'Leader',
      roles: ['Leader'],
    })
    const getTeamAnnualPlan = vi
      .spyOn(planningApi, 'getTeamAnnualPlan')
      .mockResolvedValueOnce(publishedPlan())
      .mockResolvedValueOnce({ ...publishedPlan(), status: '已归档' })
    const archive = vi
      .spyOn(planningApi, 'archiveTeamAnnualPlan')
      .mockResolvedValue({ ok: true })

    render(
      <MemoryRouter initialEntries={['/operations/team-annual-plan']}>
        <App />
      </MemoryRouter>,
    )
    await waitFor(() => {
      expect(screen.getByText('归档')).toBeTruthy()
    })

    fireEvent.click(screen.getByText('归档'))

    await waitFor(() => {
      expect(archive).toHaveBeenCalledWith(2026)
    })

    await waitFor(() => {
      expect(screen.getByText(/已归档/)).toBeTruthy()
    })
    expect(getTeamAnnualPlan).toHaveBeenCalledTimes(2)
    expect(screen.queryByText('更新')).toBeNull()
    expect(screen.queryByText('归档')).toBeNull()
  })

  it('renders KPI summary cards, pill classes and a scrollable items table', async () => {
    vi.spyOn(accessApi, 'me').mockResolvedValue({
      id: 1,
      username: 'leader',
      full_name: 'Leader',
      roles: ['Leader'],
    })
    vi.spyOn(planningApi, 'getTeamAnnualPlan').mockResolvedValue(
      publishedPlan(),
    )
    vi.spyOn(planningApi, 'getTeamAnnualPlanItems').mockResolvedValue(
      itemList(),
    )

    render(
      <MemoryRouter initialEntries={['/operations/team-annual-plan']}>
        <App />
      </MemoryRouter>,
    )
    await waitFor(() => expect(screen.getByText('计划项数')).toBeTruthy())
    // Summary KPI cards render as a single 4-card strip.
    expect(document.querySelectorAll('.kpi-card')).toHaveLength(4)
    expect(screen.getByText('已完成/总数')).toBeTruthy()
    expect(screen.getByText('2')).toBeTruthy()
    // The 9-column items table lives in a horizontal scroll container.
    expect(document.querySelector('.table-scroll table')).toBeTruthy()
    // Priority/status pills carry their semantic classes.
    expect(document.querySelector('.priority-high')?.textContent).toBe('高')
    expect(document.querySelector('.priority-medium')?.textContent).toBe('中')
    expect(document.querySelector('.status-completed')?.textContent).toBe(
      '已完成',
    )
    expect(document.querySelector('.status-delayed')?.textContent).toBe('延期')
  })

  it('shows the read-only PlanItem list but hides management controls for Member users', async () => {
    vi.spyOn(accessApi, 'me').mockResolvedValue({
      id: 2,
      username: 'member',
      full_name: 'Member',
      roles: ['Member'],
    })
    const getTeamAnnualPlan = vi.spyOn(planningApi, 'getTeamAnnualPlan')
    const getTeamAnnualPlanItems = vi.spyOn(
      planningApi,
      'getTeamAnnualPlanItems',
    )

    render(
      <MemoryRouter initialEntries={['/operations/team-annual-plan']}>
        <App />
      </MemoryRouter>,
    )
    await waitFor(() => {
      expect(
        screen.getByRole('heading', { name: '团队年度计划正式项' }),
      ).toBeTruthy()
    })

    expect(getTeamAnnualPlan).not.toHaveBeenCalled()
    expect(getTeamAnnualPlanItems).toHaveBeenCalled()
    expect(screen.queryByText('发布')).toBeNull()
    expect(screen.queryByText('更新')).toBeNull()
    expect(screen.queryByText('归档')).toBeNull()
  })

  it('shows an error without optimistic success when the API fails', async () => {
    vi.spyOn(accessApi, 'me').mockResolvedValue({
      id: 1,
      username: 'leader',
      full_name: 'Leader',
      roles: ['Leader'],
    })
    vi.spyOn(planningApi, 'getTeamAnnualPlan').mockResolvedValue(null)
    vi.spyOn(planningApi, 'publishTeamAnnualPlan').mockRejectedValue(
      new Error('year already exists'),
    )

    render(
      <MemoryRouter initialEntries={['/operations/team-annual-plan']}>
        <App />
      </MemoryRouter>,
    )
    await waitFor(() => {
      expect(screen.getByText('发布')).toBeTruthy()
    })

    fireEvent.click(screen.getByText('发布'))

    await waitFor(() => {
      expect(screen.getByText(/year already exists/)).toBeTruthy()
    })

    expect(screen.queryByText(/发布成功/)).toBeNull()
  })

  it('Issue #93 — narrow shell offers a drawer nav and the items table keeps its scroll contract', async () => {
    vi.stubGlobal(
      'matchMedia',
      vi.fn().mockImplementation((media: string) => ({
        matches: true,
        media,
        onchange: null,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        addListener: vi.fn(),
        removeListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })),
    )
    vi.spyOn(accessApi, 'me').mockResolvedValue({
      id: 1,
      username: 'leader',
      full_name: 'Leader',
      roles: ['Leader'],
    })
    vi.spyOn(planningApi, 'getTeamAnnualPlan').mockResolvedValue(
      publishedPlan(),
    )
    // A populated item list so the table (and its scroll wrapper) render.
    vi.spyOn(planningApi, 'getTeamAnnualPlanItems').mockResolvedValue(
      itemList(),
    )
    render(
      <MemoryRouter initialEntries={['/operations/team-annual-plan']}>
        <App />
      </MemoryRouter>,
    )
    await waitFor(() => {
      expect(
        screen.getByRole('heading', { name: '团队年度计划正式项' }),
      ).toBeTruthy()
    })
    await waitFor(() => {
      expect(document.querySelector('.table-scroll')).toBeTruthy()
    })
    // The narrow shell replaces the fixed sidebar with an operable toggle.
    expect(screen.getByRole('button', { name: '打开导航菜单' })).toBeTruthy()
    // Filters wrap and the table scrolls horizontally — readable at 768.
    const filters = document.querySelector('.analytics-filters') as HTMLElement
    expect(window.getComputedStyle(filters).flexWrap).toBe('wrap')
    const scroll = document.querySelector('.table-scroll') as HTMLElement
    expect(window.getComputedStyle(scroll).overflowX).toBe('auto')
  })
})

describe('team annual plan api helpers', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              id: 1,
              code: 'TACP-2026',
              year: 2026,
              publisher_id: 1,
              resource_arrangement: '',
              description: '',
              published_at: '2026-01-01T00:00:00Z',
              status: '已发布',
              created_at: '2026-01-01T00:00:00Z',
              updated_at: '2026-01-01T00:00:00Z',
              focus_domains: ['P01'],
            }),
        }),
      ),
    )
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('getTeamAnnualPlan returns null when the plan is not found', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve({
          ok: false,
          status: 404,
          json: () => Promise.resolve({ detail: 'team annual plan not found' }),
        }),
      ),
    )

    const result = await planningApi.getTeamAnnualPlan(2026)
    expect(result).toBeNull()
  })

  it('publishTeamAnnualPlan posts with body and credentials include', async () => {
    const body: planningApi.TeamAnnualPlanSave = {
      year: 2026,
      focus_domain_codes: ['P01'],
      resource_arrangement: 'bootcamp',
      description: 'focus',
    }
    await planningApi.publishTeamAnnualPlan(body)
    expect(fetch).toHaveBeenCalledWith(
      '/api/planning/team-annual-plan',
      expect.objectContaining({
        method: 'POST',
        credentials: 'include',
        body: JSON.stringify(body),
      }),
    )
  })

  it('updateTeamAnnualPlan puts with body and credentials include', async () => {
    const body: planningApi.TeamAnnualPlanSave = {
      year: 2026,
      focus_domain_codes: ['P01'],
      resource_arrangement: 'bootcamp',
      description: 'focus',
    }
    await planningApi.updateTeamAnnualPlan(body)
    expect(fetch).toHaveBeenCalledWith(
      '/api/planning/team-annual-plan',
      expect.objectContaining({
        method: 'PUT',
        credentials: 'include',
        body: JSON.stringify(body),
      }),
    )
  })

  it('archiveTeamAnnualPlan posts year and credentials include', async () => {
    await planningApi.archiveTeamAnnualPlan(2026)
    expect(fetch).toHaveBeenCalledWith(
      '/api/planning/team-annual-plan/archive',
      expect.objectContaining({
        method: 'POST',
        credentials: 'include',
        body: JSON.stringify({ year: 2026 }),
      }),
    )
  })
})

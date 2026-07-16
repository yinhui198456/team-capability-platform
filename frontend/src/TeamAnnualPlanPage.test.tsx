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
        return Promise.resolve({ ok: true, json: () => Promise.resolve({}) })
      }),
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

    window.history.pushState({}, '', '/operations/team-annual-plan')
    render(<App />)

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

    window.history.pushState({}, '', '/operations/team-annual-plan')
    render(<App />)

    await waitFor(() => {
      expect(screen.getByText('发布')).toBeTruthy()
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

    window.history.pushState({}, '', '/operations/team-annual-plan')
    render(<App />)

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

    window.history.pushState({}, '', '/operations/team-annual-plan')
    render(<App />)

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

  it('does not expose controls or call management APIs for non-leader users', async () => {
    vi.spyOn(accessApi, 'me').mockResolvedValue({
      id: 2,
      username: 'member',
      full_name: 'Member',
      roles: ['Member'],
    })
    const getTeamAnnualPlan = vi.spyOn(planningApi, 'getTeamAnnualPlan')

    window.history.pushState({}, '', '/operations/team-annual-plan')
    render(<App />)

    await waitFor(() => {
      expect(screen.getByText(/无权限/)).toBeTruthy()
    })

    expect(getTeamAnnualPlan).not.toHaveBeenCalled()
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

    window.history.pushState({}, '', '/operations/team-annual-plan')
    render(<App />)

    await waitFor(() => {
      expect(screen.getByText('发布')).toBeTruthy()
    })

    fireEvent.click(screen.getByText('发布'))

    await waitFor(() => {
      expect(screen.getByText(/year already exists/)).toBeTruthy()
    })

    expect(screen.queryByText(/发布成功/)).toBeNull()
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

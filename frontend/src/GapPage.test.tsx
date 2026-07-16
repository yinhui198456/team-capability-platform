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
import * as assessmentApi from './assessment'
import * as gapApi from './gap'

describe('GapPage', () => {
  beforeEach(() => {
    vi.spyOn(assessmentApi, 'listAssessments').mockResolvedValue([])
  })

  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it('renders member gaps from latest submitted assessment', async () => {
    vi.spyOn(accessApi, 'me').mockResolvedValue({
      id: 1,
      username: 'member',
      full_name: 'Member',
      roles: ['Member'],
    })
    vi.spyOn(assessmentApi, 'listAssessments').mockResolvedValue([
      {
        id: 7,
        member_id: 1,
        year: 2026,
        version: 1,
        assessment_type: '年度',
        status: '待复核',
        created_at: '2026-01-01T00:00:00Z',
        submitted_at: '2026-01-02T00:00:00Z',
        archived_at: null,
      },
    ])
    vi.spyOn(gapApi, 'listGaps').mockResolvedValue([
      {
        id: 10,
        assessment_id: 7,
        member_id: 1,
        l3_code: 'P01-L2A-L3A',
        current_level: 2,
        target_level: 4,
        gap_value: 2,
        priority: '中',
        plan_candidate: false,
      },
    ])

    window.history.pushState({}, '', '/capability/gap')
    render(<App />)

    await waitFor(() => {
      expect(screen.getByText(/P01-L2A-L3A/)).toBeTruthy()
    })

    expect(gapApi.listGaps).toHaveBeenCalledWith(7)
  })

  it('updates priority via api', async () => {
    vi.spyOn(accessApi, 'me').mockResolvedValue({
      id: 1,
      username: 'member',
      full_name: 'Member',
      roles: ['Member'],
    })
    vi.spyOn(assessmentApi, 'listAssessments').mockResolvedValue([
      {
        id: 7,
        member_id: 1,
        year: 2026,
        version: 1,
        assessment_type: '年度',
        status: '待复核',
        created_at: '2026-01-01T00:00:00Z',
        submitted_at: '2026-01-02T00:00:00Z',
        archived_at: null,
      },
    ])
    vi.spyOn(gapApi, 'listGaps').mockResolvedValue([
      {
        id: 10,
        assessment_id: 7,
        member_id: 1,
        l3_code: 'P01-L2A-L3A',
        current_level: 2,
        target_level: 4,
        gap_value: 2,
        priority: '中',
        plan_candidate: false,
      },
    ])
    const updateGap = vi
      .spyOn(gapApi, 'updateGap')
      .mockResolvedValue({ ok: true })

    window.history.pushState({}, '', '/capability/gap')
    render(<App />)

    await waitFor(() => {
      expect(screen.getByText(/P01-L2A-L3A/)).toBeTruthy()
    })

    fireEvent.change(screen.getByLabelText('优先级'), {
      target: { value: '高' },
    })

    await waitFor(() => {
      expect(updateGap).toHaveBeenCalledWith(10, {
        priority: '高',
        plan_candidate: false,
      })
    })
  })

  it('renders all gaps for leader readonly', async () => {
    vi.spyOn(accessApi, 'me').mockResolvedValue({
      id: 2,
      username: 'leader',
      full_name: 'Leader',
      roles: ['Leader'],
    })
    vi.spyOn(gapApi, 'listGaps').mockResolvedValue([
      {
        id: 10,
        assessment_id: 7,
        member_id: 1,
        l3_code: 'P01-L2A-L3A',
        current_level: 2,
        target_level: 4,
        gap_value: 2,
        priority: '中',
        plan_candidate: false,
      },
    ])

    window.history.pushState({}, '', '/capability/gap')
    render(<App />)

    await waitFor(() => {
      expect(screen.getByText(/P01-L2A-L3A/)).toBeTruthy()
    })

    expect(gapApi.listGaps).toHaveBeenCalledWith()
    expect(
      (screen.getByLabelText('优先级') as HTMLSelectElement).disabled,
    ).toBe(true)
    expect(
      (screen.getByLabelText('纳入计划候选') as HTMLInputElement).disabled,
    ).toBe(true)
  })

  it('updates plan candidate via api', async () => {
    vi.spyOn(accessApi, 'me').mockResolvedValue({
      id: 1,
      username: 'member',
      full_name: 'Member',
      roles: ['Member'],
    })
    vi.spyOn(assessmentApi, 'listAssessments').mockResolvedValue([
      {
        id: 7,
        member_id: 1,
        year: 2026,
        version: 1,
        assessment_type: '年度',
        status: '待复核',
        created_at: '2026-01-01T00:00:00Z',
        submitted_at: '2026-01-02T00:00:00Z',
        archived_at: null,
      },
    ])
    vi.spyOn(gapApi, 'listGaps').mockResolvedValue([
      {
        id: 10,
        assessment_id: 7,
        member_id: 1,
        l3_code: 'P01-L2A-L3A',
        current_level: 2,
        target_level: 4,
        gap_value: 2,
        priority: '中',
        plan_candidate: false,
      },
    ])
    const updateGap = vi
      .spyOn(gapApi, 'updateGap')
      .mockResolvedValue({ ok: true })

    window.history.pushState({}, '', '/capability/gap')
    render(<App />)

    await waitFor(() => {
      expect(screen.getByText(/P01-L2A-L3A/)).toBeTruthy()
    })

    fireEvent.click(screen.getByLabelText('纳入计划候选'))

    await waitFor(() => {
      expect(updateGap).toHaveBeenCalledWith(10, {
        priority: '中',
        plan_candidate: true,
      })
    })
  })

  it('shows the Gap overview landmark around the gap list', async () => {
    vi.spyOn(accessApi, 'me').mockResolvedValue({
      id: 1,
      username: 'member',
      full_name: 'Member',
      roles: ['Member'],
    })
    vi.spyOn(assessmentApi, 'listAssessments').mockResolvedValue([
      {
        id: 7,
        member_id: 1,
        year: 2026,
        version: 1,
        assessment_type: '年度',
        status: '待复核',
        created_at: '2026-01-01T00:00:00Z',
        submitted_at: '2026-01-02T00:00:00Z',
        archived_at: null,
      },
    ])
    vi.spyOn(gapApi, 'listGaps').mockResolvedValue([
      {
        id: 10,
        assessment_id: 7,
        member_id: 1,
        l3_code: 'P01-L2A-L3A',
        current_level: 2,
        target_level: 4,
        gap_value: 2,
        priority: '中',
        plan_candidate: false,
      },
    ])

    window.history.pushState({}, '', '/capability/gap')
    render(<App />)

    await waitFor(() => {
      expect(screen.getByRole('region', { name: 'Gap 概览' })).toBeTruthy()
    })

    expect(screen.getByText(/P01-L2A-L3A/)).toBeTruthy()
    expect(screen.getByLabelText('优先级')).toBeTruthy()
  })
})

describe('gap api helpers', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve({
          ok: true,
          json: () => Promise.resolve([{ id: 1 }]),
        }),
      ),
    )
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('listGaps fetches with assessment id query', async () => {
    await gapApi.listGaps(7)
    expect(fetch).toHaveBeenCalledWith(
      '/api/gaps?assessment_id=7',
      expect.objectContaining({
        method: 'GET',
        credentials: 'include',
      }),
    )
  })

  it('updateGap puts with credentials include', async () => {
    await gapApi.updateGap(10, { priority: '高', plan_candidate: true })
    expect(fetch).toHaveBeenCalledWith(
      '/api/gaps/10',
      expect.objectContaining({
        method: 'PUT',
        credentials: 'include',
        body: JSON.stringify({ priority: '高', plan_candidate: true }),
      }),
    )
  })
})

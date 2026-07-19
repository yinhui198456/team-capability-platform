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
import * as assessmentApi from './assessment'
import { MemoryRouter } from 'react-router-dom'

function mockDraftAssessment(
  overrides: Partial<assessmentApi.Assessment> = {},
) {
  return {
    id: 7,
    member_id: 1,
    year: 2026,
    version: 1,
    assessment_type: '年度',
    status: '草稿',
    created_at: '2026-01-01T00:00:00Z',
    submitted_at: null,
    archived_at: null,
    details: [
      {
        id: 1,
        l3_code: 'P01.01.01',
        l3_name: '数据管道基础',
        l1_code: 'P01',
        l1_name: '数据基础设施',
        current_level: 1,
        target_level: 1,
        gap_value: 0,
        evidence_note: '',
        plan_candidate: false,
        recommended_start_level: 'P4',
      },
    ],
    ...overrides,
  }
}

describe('AssessmentGapPage', () => {
  beforeEach(() => {
    vi.spyOn(assessmentApi, 'listAssessments').mockResolvedValue([])
  })

  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it('renders create button when no draft exists', async () => {
    render(
      <MemoryRouter initialEntries={['/capability/assessment']}>
        <App />
      </MemoryRouter>
    )
    await waitFor(() => {
      expect(
        screen.getByRole('button', { name: '创建年度自评草稿' }),
      ).toBeTruthy()
    })
  })

  it('creates draft and shows domain groups with pre-populated L3s', async () => {
    vi.spyOn(assessmentApi, 'createAssessment').mockResolvedValue({ id: 7 })
    vi.spyOn(assessmentApi, 'getAssessment').mockResolvedValue(
      mockDraftAssessment(),
    )

    render(
      <MemoryRouter initialEntries={['/capability/assessment']}>
        <App />
      </MemoryRouter>
    )
    await waitFor(() => {
      expect(
        screen.getByRole('button', { name: '创建年度自评草稿' }),
      ).toBeTruthy()
    })

    fireEvent.click(screen.getByRole('button', { name: '创建年度自评草稿' }))
    expect(assessmentApi.createAssessment).toHaveBeenCalledWith(2026)

    await waitFor(() => {
      expect(screen.getByText('能力自评与 Gap 分析')).toBeTruthy()
    })
    expect(screen.getByText(/P01.01.01/)).toBeTruthy()
    expect(screen.getByText(/P01 · 数据基础设施/)).toBeTruthy()
  })

  it('saves draft and submits with gap sidebar appearing', async () => {
    vi.spyOn(assessmentApi, 'listAssessments').mockResolvedValue([
      {
        id: 7,
        member_id: 1,
        year: 2026,
        version: 1,
        assessment_type: '年度',
        status: '草稿',
        created_at: '2026-01-01T00:00:00Z',
        submitted_at: null,
        archived_at: null,
      },
    ])
    vi.spyOn(assessmentApi, 'getAssessment').mockResolvedValue(
      mockDraftAssessment(),
    )
    vi.spyOn(assessmentApi, 'saveDraft').mockResolvedValue({ ok: true })
    vi.spyOn(assessmentApi, 'submitAssessment').mockResolvedValue({ ok: true })

    render(
      <MemoryRouter initialEntries={['/capability/assessment']}>
        <App />
      </MemoryRouter>
    )
    await waitFor(() => {
      expect(screen.getByRole('button', { name: '保存草稿' })).toBeTruthy()
    })

    fireEvent.click(screen.getByRole('button', { name: '保存草稿' }))
    await waitFor(() => {
      expect(screen.getByText('草稿已保存')).toBeTruthy()
    })

    // After submit, getAssessment returns submitted status with gap_summary.
    vi.spyOn(assessmentApi, 'getAssessment').mockResolvedValue(
      mockDraftAssessment({
        status: '待复核',
        submitted_at: '2026-07-01T00:00:00Z',
        details: [
          {
            id: 1,
            l3_code: 'P01.01.01',
            l3_name: '数据管道基础',
            l1_code: 'P01',
            l1_name: '数据基础设施',
            current_level: 2,
            target_level: 4,
            gap_value: 2,
            evidence_note: '完成梳理',
            plan_candidate: true,
            recommended_start_level: 'P4',
          },
          {
            id: 2,
            l3_code: 'P01.01.02',
            l3_name: '文件规范',
            l1_code: 'P01',
            l1_name: '数据基础设施',
            current_level: 1,
            target_level: 1,
            gap_value: 0,
            evidence_note: '',
            plan_candidate: false,
            recommended_start_level: 'P4',
          },
        ],
        gap_summary: {
          total_gaps: 1,
          avg_gap: 2.0,
          high_priority: 0,
          medium_priority: 1,
          low_priority: 0,
        },
      }),
    )

    fireEvent.click(screen.getByRole('button', { name: '提交自评' }))
    await waitFor(() => {
      expect(screen.getByText(/Gap 即时生成/)).toBeTruthy()
    })

    // Gap sidebar should appear after submit.
    await waitFor(() => {
      expect(screen.getByText('Gap 分析')).toBeTruthy()
    })
    expect(screen.getByText('Gap 总数')).toBeTruthy()
  })

  it('shows gate warning when not yet reviewed', async () => {
    vi.spyOn(assessmentApi, 'listAssessments').mockResolvedValue([
      {
        id: 7,
        member_id: 1,
        year: 2026,
        version: 1,
        assessment_type: '年度',
        status: '草稿',
        created_at: '2026-01-01T00:00:00Z',
        submitted_at: null,
        archived_at: null,
      },
    ])
    vi.spyOn(assessmentApi, 'getAssessment').mockResolvedValue(
      mockDraftAssessment(),
    )

    render(
      <MemoryRouter initialEntries={['/capability/assessment']}>
        <App />
      </MemoryRouter>
    )
    await waitFor(() => {
      expect(screen.getByText('Review 闭环前不可正式纳入计划')).toBeTruthy()
    })
  })
})

describe('AssessmentHistoryPage', () => {
  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it('renders assessment list and expands details', async () => {
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
    vi.spyOn(assessmentApi, 'getAssessment').mockResolvedValue({
      id: 7,
      member_id: 1,
      year: 2026,
      version: 1,
      assessment_type: '年度',
      status: '待复核',
      created_at: '2026-01-01T00:00:00Z',
      submitted_at: '2026-01-02T00:00:00Z',
      archived_at: null,
      details: [
        {
          id: 1,
          l3_code: 'P01.01.01',
          current_level: 2,
          target_level: 4,
          gap_value: 2,
          evidence_note: '测试中',
          plan_candidate: true,
        },
      ],
    })

    render(
      <MemoryRouter initialEntries={['/capability/assessment/history']}>
        <App />
      </MemoryRouter>
    )
    await waitFor(() => {
      expect(screen.getByText(/2026 · 版本 1 · 待复核/)).toBeTruthy()
    })

    fireEvent.click(screen.getByText(/2026 · 版本 1 · 待复核/))
    await waitFor(() => {
      expect(screen.getByText(/P01.01.01/)).toBeTruthy()
    })
  })
})

describe('assessment api helpers', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ id: 7 }),
        }),
      ),
    )
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('createAssessment posts with credentials include', async () => {
    await assessmentApi.createAssessment(2026)
    expect(fetch).toHaveBeenCalledWith(
      '/api/assessments',
      expect.objectContaining({
        method: 'POST',
        credentials: 'include',
        body: JSON.stringify({ year: 2026, assessment_type: '年度' }),
      }),
    )
  })
})

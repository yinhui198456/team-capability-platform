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

describe('AssessmentPage', () => {
  beforeEach(() => {
    vi.spyOn(assessmentApi, 'listAssessments').mockResolvedValue([])
  })

  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it('creates draft and saves details on submit', async () => {
    vi.spyOn(assessmentApi, 'createAssessment').mockResolvedValue({ id: 7 })
    vi.spyOn(assessmentApi, 'getAssessment').mockResolvedValue({
      id: 7,
      member_id: 1,
      year: 2026,
      version: 1,
      assessment_type: '年度',
      status: '草稿',
      created_at: '2026-01-01T00:00:00Z',
      submitted_at: null,
      archived_at: null,
      details: [],
    })
    vi.spyOn(assessmentApi, 'saveDraft').mockResolvedValue({ ok: true })
    vi.spyOn(assessmentApi, 'submitAssessment').mockResolvedValue({ ok: true })

    window.history.pushState({}, '', '/capability/assessment')
    render(<App />)

    await waitFor(() => {
      expect(
        screen.getByRole('button', { name: '创建年度自评草稿' }),
      ).toBeTruthy()
    })

    fireEvent.click(screen.getByRole('button', { name: '创建年度自评草稿' }))

    await waitFor(() => {
      expect(assessmentApi.createAssessment).toHaveBeenCalledWith(2026)
    })

    fireEvent.click(screen.getByRole('button', { name: '添加 L3' }))
    fireEvent.change(screen.getAllByLabelText('L3 编码')[0], {
      target: { value: 'P01-L2A-L3A' },
    })
    fireEvent.change(screen.getAllByLabelText('当前掌握度')[0], {
      target: { value: '2' },
    })
    fireEvent.change(screen.getAllByLabelText('目标掌握度')[0], {
      target: { value: '4' },
    })

    fireEvent.click(screen.getByRole('button', { name: '保存草稿' }))
    await waitFor(() => {
      expect(screen.getByText('草稿已保存')).toBeTruthy()
    })
    expect(assessmentApi.saveDraft).toHaveBeenCalledWith(7, [
      expect.objectContaining({
        l3_code: 'P01-L2A-L3A',
        current_level: 2,
        target_level: 4,
      }),
    ])

    fireEvent.click(screen.getByRole('button', { name: '提交' }))
    await waitFor(() => {
      expect(screen.getByText('已提交，等待 Buddy 复核')).toBeTruthy()
    })
    expect(assessmentApi.submitAssessment).toHaveBeenCalledWith(7)
  })

  it('shows waiting review message after submit', async () => {
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
    vi.spyOn(assessmentApi, 'getAssessment').mockResolvedValue({
      id: 7,
      member_id: 1,
      year: 2026,
      version: 1,
      assessment_type: '年度',
      status: '草稿',
      created_at: '2026-01-01T00:00:00Z',
      submitted_at: null,
      archived_at: null,
      details: [],
    })
    vi.spyOn(assessmentApi, 'submitAssessment').mockResolvedValue({ ok: true })

    window.history.pushState({}, '', '/capability/assessment')
    render(<App />)

    await waitFor(() => {
      expect(screen.getByRole('button', { name: '提交' })).toBeTruthy()
    })

    fireEvent.click(screen.getByRole('button', { name: '提交' }))
    await waitFor(() => {
      expect(screen.getByText('已提交，等待 Buddy 复核')).toBeTruthy()
    })
  })

  it('shows the assessment-to-Gap handoff landmark for a draft', async () => {
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
    vi.spyOn(assessmentApi, 'getAssessment').mockResolvedValue({
      id: 7,
      member_id: 1,
      year: 2026,
      version: 1,
      assessment_type: '年度',
      status: '草稿',
      created_at: '2026-01-01T00:00:00Z',
      submitted_at: null,
      archived_at: null,
      details: [],
    })

    window.history.pushState({}, '', '/capability/assessment')
    render(<App />)

    await waitFor(() => {
      expect(
        screen.getByRole('region', { name: 'Gap 分析入口' }),
      ).toBeTruthy()
    })

    const handoffLink = screen.getByRole('link', { name: '查看 Gap 分析' })
    expect(handoffLink.getAttribute('href')).toBe('/capability/gap')
    expect(screen.getByRole('button', { name: '提交' })).toBeTruthy()
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
          l3_code: 'P01-L2A-L3A',
          current_level: 2,
          target_level: 4,
          gap_value: 2,
          evidence_note: '测试中',
          plan_candidate: true,
        },
      ],
    })

    window.history.pushState({}, '', '/capability/assessment/history')
    render(<App />)

    await waitFor(() => {
      expect(screen.getByText(/2026 · 版本 1 · 待复核/)).toBeTruthy()
    })

    fireEvent.click(screen.getByText(/2026 · 版本 1 · 待复核/))
    await waitFor(() => {
      expect(screen.getByText(/P01-L2A-L3A/)).toBeTruthy()
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

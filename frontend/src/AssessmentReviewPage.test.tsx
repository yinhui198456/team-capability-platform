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
import * as reviewApi from './assessmentReview'

describe('AssessmentReviewPage', () => {
  beforeEach(() => {
    vi.spyOn(assessmentApi, 'listAssessments').mockResolvedValue([])
  })

  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it('renders pending review queue', async () => {
    vi.spyOn(reviewApi, 'listPendingReviews').mockResolvedValue([
      {
        id: 10,
        assessment_id: 7,
        sequence: 1,
        buddy_id: 2,
        status: '待复核',
        member_id: 1,
        year: 2026,
        version: 1,
        assessment_status: '待复核',
        submitted_at: '2026-01-02T00:00:00Z',
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

    window.history.pushState({}, '', '/mentoring/assessment-review')
    render(<App />)

    await waitFor(() => {
      expect(screen.getByText(/成员 1 · 2026 · 版本 1/)).toBeTruthy()
    })
  })

  it('submits approval with correct api call', async () => {
    vi.spyOn(reviewApi, 'listPendingReviews').mockResolvedValue([
      {
        id: 10,
        assessment_id: 7,
        sequence: 1,
        buddy_id: 2,
        status: '待复核',
        member_id: 1,
        year: 2026,
        version: 1,
        assessment_status: '待复核',
        submitted_at: '2026-01-02T00:00:00Z',
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
      details: [],
    })
    const submitReview = vi
      .spyOn(reviewApi, 'submitReview')
      .mockResolvedValue({ ok: true })

    window.history.pushState({}, '', '/mentoring/assessment-review')
    render(<App />)

    await waitFor(() => {
      expect(screen.getByText(/成员 1 · 2026 · 版本 1/)).toBeTruthy()
    })

    fireEvent.click(screen.getByText(/成员 1 · 2026 · 版本 1/))

    await waitFor(() => {
      expect(screen.getByLabelText('认可')).toBeTruthy()
    })

    fireEvent.click(screen.getByLabelText('认可'))
    fireEvent.change(screen.getByLabelText('反馈'), {
      target: { value: '符合预期' },
    })
    fireEvent.click(screen.getByRole('button', { name: '提交复核' }))

    await waitFor(() => {
      expect(screen.getByText('已认可并归档')).toBeTruthy()
    })
    expect(submitReview).toHaveBeenCalledWith(7, 10, {
      conclusion: '认可',
      feedback: '符合预期',
    })
  })

  it('submits adjustment with correct message', async () => {
    vi.spyOn(reviewApi, 'listPendingReviews').mockResolvedValue([
      {
        id: 11,
        assessment_id: 8,
        sequence: 1,
        buddy_id: 2,
        status: '待复核',
        member_id: 1,
        year: 2026,
        version: 1,
        assessment_status: '待复核',
        submitted_at: '2026-01-02T00:00:00Z',
      },
    ])
    vi.spyOn(assessmentApi, 'getAssessment').mockResolvedValue({
      id: 8,
      member_id: 1,
      year: 2026,
      version: 1,
      assessment_type: '年度',
      status: '待复核',
      created_at: '2026-01-01T00:00:00Z',
      submitted_at: '2026-01-02T00:00:00Z',
      archived_at: null,
      details: [],
    })
    const submitReview = vi
      .spyOn(reviewApi, 'submitReview')
      .mockResolvedValue({ ok: true })

    window.history.pushState({}, '', '/mentoring/assessment-review')
    render(<App />)

    await waitFor(() => {
      expect(screen.getByText(/成员 1 · 2026 · 版本 1/)).toBeTruthy()
    })

    fireEvent.click(screen.getByText(/成员 1 · 2026 · 版本 1/))

    await waitFor(() => {
      expect(screen.getByLabelText('建议调整')).toBeTruthy()
    })

    fireEvent.click(screen.getByLabelText('建议调整'))
    fireEvent.change(screen.getByLabelText('反馈'), {
      target: { value: '请补充依据' },
    })
    fireEvent.click(screen.getByRole('button', { name: '提交复核' }))

    await waitFor(() => {
      expect(screen.getByText('已建议调整，等待成员修改')).toBeTruthy()
    })
    expect(submitReview).toHaveBeenCalledWith(8, 11, {
      conclusion: '建议调整',
      feedback: '请补充依据',
    })
  })
})

describe('assessmentReview api helpers', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ ok: true }),
        }),
      ),
    )
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('listPendingReviews fetches with credentials include', async () => {
    await reviewApi.listPendingReviews()
    expect(fetch).toHaveBeenCalledWith(
      '/api/assessments/reviews/pending',
      expect.objectContaining({
        method: 'GET',
        credentials: 'include',
      }),
    )
  })

  it('submitReview posts with credentials include', async () => {
    await reviewApi.submitReview(7, 10, {
      conclusion: '认可',
      feedback: '符合预期',
    })
    expect(fetch).toHaveBeenCalledWith(
      '/api/assessments/7/reviews/10',
      expect.objectContaining({
        method: 'POST',
        credentials: 'include',
        body: JSON.stringify({ conclusion: '认可', feedback: '符合预期' }),
      }),
    )
  })
})

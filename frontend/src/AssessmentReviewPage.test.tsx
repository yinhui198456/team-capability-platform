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
import * as planningApi from './planning'
import * as reviewApi from './assessmentReview'
import { MemoryRouter } from 'react-router-dom'

describe('AssessmentReviewPage', () => {
  beforeEach(() => {
    vi.spyOn(assessmentApi, 'listAssessments').mockResolvedValue([])
    vi.spyOn(accessApi, 'me').mockResolvedValue({
      id: 2,
      username: 'buddy',
      full_name: 'Buddy',
      roles: ['Buddy'],
      assigned_members: [
        { id: 1, username: 'member', full_name: '成员一', is_active: true },
      ],
    })
    vi.spyOn(planningApi, 'listPendingEvidenceReviews').mockResolvedValue([])
    vi.spyOn(reviewApi, 'getAssessmentReviewSummary').mockResolvedValue({
      pending_count: 1,
      completed_count: 0,
    })
    vi.spyOn(planningApi, 'getEvidenceReviewSummary').mockResolvedValue({
      pending_count: 0,
      completed_count: 0,
    })
    vi.spyOn(assessmentApi, 'getAssessmentHistory').mockResolvedValue([])
  })

  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it('redirects the legacy route to the unified review center', async () => {
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

    render(
      <MemoryRouter initialEntries={['/mentoring/assessment-review']}>
        <App />
      </MemoryRouter>
    )
    await waitFor(() => {
      expect(
        screen.getByRole('heading', { name: 'Buddy 复核中心' }),
      ).toBeTruthy()
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

    render(
      <MemoryRouter initialEntries={['/mentoring/assessment-review']}>
        <App />
      </MemoryRouter>
    )
    await waitFor(() => {
      expect(screen.getByLabelText('认可')).toBeTruthy()
    })

    fireEvent.click(screen.getByLabelText('认可'))
    fireEvent.change(screen.getByLabelText('反馈'), {
      target: { value: '符合预期' },
    })
    fireEvent.click(screen.getByRole('button', { name: '提交复核反馈' }))

    await waitFor(() => {
      expect(screen.getByText('已认可，反馈已归入历史。')).toBeTruthy()
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

    render(
      <MemoryRouter initialEntries={['/mentoring/assessment-review']}>
        <App />
      </MemoryRouter>
    )
    await waitFor(() => {
      expect(screen.getByLabelText('建议调整')).toBeTruthy()
    })

    fireEvent.click(screen.getByLabelText('建议调整'))
    fireEvent.change(screen.getByLabelText('反馈'), {
      target: { value: '请补充依据' },
    })
    fireEvent.click(screen.getByRole('button', { name: '提交复核反馈' }))

    await waitFor(() => {
      expect(screen.getByText('已建议调整，反馈已归入历史。')).toBeTruthy()
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

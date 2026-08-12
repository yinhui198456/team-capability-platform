/// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from '@testing-library/react'
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

    render(
      <MemoryRouter initialEntries={['/mentoring/assessment-review']}>
        <App />
      </MemoryRouter>,
    )
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: '辅导成员看板' })).toBeTruthy()
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

  it('submitReview posts with credentials include and idempotency header', async () => {
    await reviewApi.submitReview(
      7,
      10,
      { conclusion: '认可', feedback: '符合预期', expected_revision: 3 },
      'key-1',
    )
    expect(fetch).toHaveBeenCalledWith(
      '/api/assessments/7/reviews/10',
      expect.objectContaining({
        method: 'POST',
        credentials: 'include',
        headers: expect.objectContaining({
          'Idempotency-Key': 'key-1',
        }),
        body: JSON.stringify({
          conclusion: '认可',
          feedback: '符合预期',
          expected_revision: 3,
        }),
      }),
    )
  })
})

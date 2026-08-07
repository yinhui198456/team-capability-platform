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

function workspaceFixture(
  assessmentId: number,
  revision = 3,
): reviewApi.BuddyReviewWorkspace {
  return {
    assessment_id: assessmentId,
    member_id: 1,
    year: 2026,
    version: 1,
    assessment_status: '待复核',
    revision,
    member_current_level_snapshot: 'P4',
    member_target_level_snapshot: 'P5',
    standard_version: { id: 1, label: 'Legacy Baseline v1' },
    summary: {
      total: 0,
      current_required: 0,
      target_progressive: 0,
      assessed: 0,
      gap_items: 0,
      high: 0,
      medium: 0,
      low: 0,
      hold: 0,
      in_plan: 0,
      by_quarter: { Q1: 0, Q2: 0, Q3: 0, Q4: 0 },
      adjustments: 0,
      data_issues: 0,
      existing_formal_plan: false,
      will_create_proposal: false,
      target_is_legacy: null,
    },
    details: [],
  }
}

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
    vi.spyOn(reviewApi, 'getBuddyReviewWorkspace').mockResolvedValue(
      workspaceFixture(7),
    )

    render(
      <MemoryRouter initialEntries={['/mentoring/assessment-review']}>
        <App />
      </MemoryRouter>,
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
    vi.spyOn(reviewApi, 'getBuddyReviewWorkspace').mockResolvedValue(
      workspaceFixture(7),
    )
    const submitReview = vi.spyOn(reviewApi, 'submitReview').mockResolvedValue({
      ok: true,
      assessment_status: '已归档',
      assessment_id: 7,
      revision: 4,
      review: {
        id: 10,
        sequence: 1,
        conclusion: '认可',
        feedback: '符合预期',
        reviewed_by_buddy_id: 2,
      },
      plan: {
        created: true,
        plan_id: 5,
        items_created: 0,
        tasks_created: 0,
        target_is_legacy: null,
      },
      proposal: null,
      idempotent_replayed: false,
    })

    render(
      <MemoryRouter initialEntries={['/mentoring/assessment-review']}>
        <App />
      </MemoryRouter>,
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
      expect(
        screen.getByText(/年度计划已生成（0 项 \/ 0 个任务）/),
      ).toBeTruthy()
    })
    const [assessmentId, reviewId, payload, idemKey] =
      submitReview.mock.calls[0]
    expect(assessmentId).toBe(7)
    expect(reviewId).toBe(10)
    expect(payload).toEqual({
      conclusion: '认可',
      feedback: '符合预期',
      expected_revision: 3,
    })
    expect(typeof idemKey).toBe('string')
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
    vi.spyOn(reviewApi, 'getBuddyReviewWorkspace').mockResolvedValue(
      workspaceFixture(8),
    )
    const submitReview = vi.spyOn(reviewApi, 'submitReview').mockResolvedValue({
      ok: true,
      assessment_status: '建议调整',
      assessment_id: 8,
      revision: 4,
      review: {
        id: 11,
        sequence: 1,
        conclusion: '建议调整',
        feedback: '请补充依据',
        reviewed_by_buddy_id: 2,
      },
      plan: null,
      proposal: null,
      idempotent_replayed: false,
    })

    render(
      <MemoryRouter initialEntries={['/mentoring/assessment-review']}>
        <App />
      </MemoryRouter>,
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
      expect(screen.getByText(/已建议调整，等待成员修改/)).toBeTruthy()
    })
    expect(submitReview.mock.calls[0][2]).toEqual({
      conclusion: '建议调整',
      feedback: '请补充依据',
      expected_revision: 3,
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

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

describe('EvidenceReviewPage', () => {
  beforeEach(() => {
    vi.spyOn(planningApi, 'listPendingEvidenceReviews').mockResolvedValue([])
  })

  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it('renders pending evidence review queue', async () => {
    vi.spyOn(accessApi, 'me').mockResolvedValue({
      id: 2,
      username: 'buddy',
      full_name: 'Buddy',
      roles: ['Buddy'],
    })
    vi.spyOn(planningApi, 'listPendingEvidenceReviews').mockResolvedValue([
      {
        id: 20,
        evidence_id: 10,
        member_id: 1,
        username: 'member',
        learning_task_id: 100,
        l3_code: 'P01-L2A-L3A',
        version_number: 1,
        content: '完成 P01 实践项目',
        evidence_link: 'http://example.com/demo',
        status: '待 Review',
        conclusion: null,
        feedback: null,
        reviewed_at: null,
        submitted_at: '2026-07-16T10:00:00Z',
      },
    ])

    window.history.pushState({}, '', '/mentoring/evidence-review')
    render(<App />)

    await waitFor(() => {
      expect(screen.getByText(/member · P01-L2A-L3A · 版本 1/)).toBeTruthy()
    })
  })

  it('submits approval with correct api call', async () => {
    vi.spyOn(accessApi, 'me').mockResolvedValue({
      id: 2,
      username: 'buddy',
      full_name: 'Buddy',
      roles: ['Buddy'],
    })
    vi.spyOn(planningApi, 'listPendingEvidenceReviews').mockResolvedValue([
      {
        id: 20,
        evidence_id: 10,
        member_id: 1,
        username: 'member',
        learning_task_id: 100,
        l3_code: 'P01-L2A-L3A',
        version_number: 1,
        content: '完成 P01 实践项目',
        evidence_link: 'http://example.com/demo',
        status: '待 Review',
        conclusion: null,
        feedback: null,
        reviewed_at: null,
        submitted_at: '2026-07-16T10:00:00Z',
      },
    ])
    const submitEvidenceReview = vi
      .spyOn(planningApi, 'submitEvidenceReview')
      .mockResolvedValue({ ok: true })

    window.history.pushState({}, '', '/mentoring/evidence-review')
    render(<App />)

    await waitFor(() => {
      expect(screen.getByText(/member · P01-L2A-L3A · 版本 1/)).toBeTruthy()
    })

    fireEvent.click(screen.getByText(/member · P01-L2A-L3A · 版本 1/))

    await waitFor(() => {
      expect(screen.getByLabelText('通过')).toBeTruthy()
    })

    fireEvent.click(screen.getByLabelText('通过'))
    fireEvent.change(screen.getByLabelText('反馈'), {
      target: { value: '符合预期' },
    })
    fireEvent.click(screen.getByRole('button', { name: '提交 Review' }))

    await waitFor(() => {
      expect(screen.getByText('已通过并归档')).toBeTruthy()
    })
    expect(submitEvidenceReview).toHaveBeenCalledWith(20, '通过', '符合预期')
  })
})

describe('evidenceReview api helpers', () => {
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

  it('listPendingEvidenceReviews fetches pending queue', async () => {
    await planningApi.listPendingEvidenceReviews()
    expect(fetch).toHaveBeenCalledWith(
      '/api/planning/evidence-reviews/pending',
      expect.objectContaining({
        method: 'GET',
        credentials: 'include',
      }),
    )
  })

  it('submitEvidenceReview posts conclusion and feedback', async () => {
    await planningApi.submitEvidenceReview(20, '通过', '符合预期')
    expect(fetch).toHaveBeenCalledWith(
      '/api/planning/evidence-reviews/20',
      expect.objectContaining({
        method: 'POST',
        credentials: 'include',
        body: JSON.stringify({
          conclusion: '通过',
          feedback: '符合预期',
        }),
      }),
    )
  })

  it('listEvidenceReviewsForTask fetches task review history', async () => {
    await planningApi.listEvidenceReviewsForTask(100)
    expect(fetch).toHaveBeenCalledWith(
      '/api/planning/learning-tasks/100/evidence-reviews',
      expect.objectContaining({
        method: 'GET',
        credentials: 'include',
      }),
    )
  })
})

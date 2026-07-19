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
import * as assessmentReviewApi from './assessmentReview'
import * as planningApi from './planning'
import { MemoryRouter } from 'react-router-dom'

describe('EvidenceReviewPage', () => {
  beforeEach(() => {
    vi.spyOn(planningApi, 'listPendingEvidenceReviews').mockResolvedValue([])
    vi.spyOn(assessmentReviewApi, 'listPendingReviews').mockResolvedValue([])
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
      assigned_members: [
        { id: 1, username: 'member', full_name: '成员一', is_active: true },
      ],
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

    render(
      <MemoryRouter initialEntries={['/mentoring/evidence-review']}>
        <App />
      </MemoryRouter>
    )
    await waitFor(() => {
      expect(
        screen.getByRole('heading', { name: 'Evidence 版本 1' }),
      ).toBeTruthy()
    })
  })

  it('submits approval with correct api call', async () => {
    vi.spyOn(accessApi, 'me').mockResolvedValue({
      id: 2,
      username: 'buddy',
      full_name: 'Buddy',
      roles: ['Buddy'],
      assigned_members: [
        { id: 1, username: 'member', full_name: '成员一', is_active: true },
      ],
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

    render(
      <MemoryRouter initialEntries={['/mentoring/evidence-review']}>
        <App />
      </MemoryRouter>
    )
    await waitFor(() => {
      expect(screen.getByLabelText('通过')).toBeTruthy()
    })

    fireEvent.click(screen.getByLabelText('通过'))
    fireEvent.change(screen.getByLabelText('反馈'), {
      target: { value: '符合预期' },
    })
    fireEvent.click(screen.getByRole('button', { name: '提交 Review 反馈' }))

    await waitFor(() => {
      expect(screen.getByText('Evidence 已通过，反馈已归入历史。')).toBeTruthy()
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

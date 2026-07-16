/// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { App } from './App'
import * as assessmentReviewApi from './assessmentReview'
import * as planningApi from './planning'

describe('BuddyReviewCenter', () => {
  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it('summarizes assessment and Evidence review queues', async () => {
    vi.spyOn(assessmentReviewApi, 'listPendingReviews').mockResolvedValue([
      {
        id: 1,
        assessment_id: 2,
        sequence: 1,
        buddy_id: 3,
        status: '待复核',
        member_id: 4,
        year: 2026,
        version: 1,
        assessment_status: '待复核',
        submitted_at: null,
      },
    ])
    vi.spyOn(planningApi, 'listPendingEvidenceReviews').mockResolvedValue([
      {
        id: 2,
        evidence_id: 3,
        version_number: 1,
        status: '待 Review',
        conclusion: null,
        feedback: null,
        reviewed_at: null,
        member_id: 4,
        username: 'member',
        l3_code: 'P01-L2A-L3A',
      },
    ])

    window.history.pushState({}, '', '/mentoring/dashboard')
    render(<App />)

    await waitFor(() =>
      expect(
        screen.getByRole('heading', { level: 1, name: 'Buddy 审核中心' }),
      ).toBeTruthy(),
    )
    expect(screen.getAllByText('待复核自评')).toHaveLength(2)
    expect(screen.getAllByText('待 Review Evidence')).toHaveLength(2)
    expect(screen.getByRole('link', { name: '处理自评复核' })).toHaveProperty(
      'href',
      expect.stringContaining('/mentoring/assessment-review'),
    )
  })
})

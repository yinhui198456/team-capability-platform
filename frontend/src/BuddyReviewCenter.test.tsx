/// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { App } from './App'
import * as accessApi from './access'
import * as assessmentApi from './assessment'
import * as assessmentReviewApi from './assessmentReview'
import * as planningApi from './planning'

describe('BuddyReviewCenter', () => {
  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it('summarizes assessment and Evidence review queues', async () => {
    vi.spyOn(accessApi, 'me').mockResolvedValue({
      id: 3,
      username: 'buddy',
      full_name: '辅导员',
      roles: ['Buddy'],
      assigned_members: [
        { id: 4, username: 'member', full_name: '成员甲', is_active: true },
      ],
    })
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
        content: '数据建模 Evidence',
      },
    ])
    vi.spyOn(assessmentApi, 'getAssessmentHistory').mockResolvedValue([
      {
        id: 10,
        assessment_id: 2,
        sequence: 0,
        buddy_id: 3,
        conclusion: '认可',
        feedback: '上一版反馈',
        reviewed_at: '2026-07-01T09:00:00',
        status: '已闭环',
      },
    ])
    vi.spyOn(assessmentApi, 'getAssessment').mockResolvedValue({
      id: 2,
      member_id: 4,
      year: 2026,
      version: 1,
      assessment_type: '年度',
      status: '待复核',
      created_at: '2026-07-01T08:00:00',
      submitted_at: '2026-07-02T08:00:00',
      archived_at: null,
      details: [
        {
          l3_code: 'P01-L2A-L3A',
          current_level: 2,
          target_level: 4,
          gap_value: 2,
        },
      ],
    })
    vi.spyOn(planningApi, 'listEvidenceReviewsForTask').mockResolvedValue([])

    window.history.pushState({}, '', '/mentoring/dashboard')
    render(<App />)

    await waitFor(() =>
      expect(
        screen.getByRole('heading', { level: 1, name: 'Buddy 审核中心' }),
      ).toBeTruthy(),
    )
    expect(screen.getByText('待复核自评')).toBeTruthy()
    expect(screen.getByText('待 Review Evidence')).toBeTruthy()
    expect(screen.getByRole('heading', { name: '辅导成员' })).toBeTruthy()
    expect(screen.getByRole('button', { name: '全部成员' })).toBeTruthy()
    expect(screen.getAllByRole('button', { name: '成员甲' })).toHaveLength(2)
    expect(screen.getByRole('tab', { name: '全部待复核' })).toBeTruthy()
    expect(screen.getByRole('heading', { name: '复核工作区' })).toBeTruthy()
    await waitFor(() => expect(screen.getByText(/上一版反馈/)).toBeTruthy())
    fireEvent.click(screen.getByRole('tab', { name: 'Evidence Review' }))
    await waitFor(() => expect(screen.getByText('数据建模 Evidence')).toBeTruthy())
    expect(
      screen.getByRole('link', { name: '进入 Evidence Review 并填写反馈' }),
    ).toHaveProperty(
      'href',
      expect.stringContaining('/mentoring/evidence-review'),
    )
  })
})

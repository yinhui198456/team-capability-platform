/// @vitest-environment jsdom

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { App } from './App'
import * as accessApi from './access'
import * as assessmentApi from './assessment'
import * as assessmentReviewApi from './assessmentReview'
import * as planningApi from './planning'
import { MemoryRouter } from 'react-router-dom'

describe('BuddyReviewCenter', () => {
  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  function mockBuddyData(
    options: {
      includeEvidence?: boolean
      includeUnmappedHistory?: boolean
      evidenceHistory?: Awaited<
        ReturnType<typeof planningApi.listEvidenceReviewsForTask>
      >
    } = {},
  ) {
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
    vi.spyOn(planningApi, 'listPendingEvidenceReviews').mockResolvedValue(
      options.includeEvidence === false
        ? []
        : [
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
          ],
    )
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
          l2_code: 'P01-L2A',
          l2_name: '数据基础',
          current_level: 2,
          target_level: 4,
          standard_target_applicable: true,
          standard_target_level: 3,
          target_adjusted: true,
          adjusted_target_level: 4,
          target_adjustment_reason: '岗位项目要求',
          gap_value: 2,
        },
      ],
      member_current_level: 'P5',
      member_target_level: 'P6',
      l2_groups: [
        {
          l1_code: 'P01',
          l1_name: '数据基础设施',
          l2_code: 'P01-L2A',
          l2_name: '数据基础',
          l3_count: 1,
          is_empty: false,
          requirements: {
            P4: 'P4 要求',
            P5: 'P5 要求',
            P6: 'P6 职级要求',
            P7: 'P7 要求',
            P8: 'P8 要求',
          },
          details: [
            {
              l3_code: 'P01-L2A-L3A',
              l2_code: 'P01-L2A',
              l2_name: '数据基础',
              current_level: 2,
              target_level: 4,
              standard_target_applicable: true,
              standard_target_level: 3,
              target_adjusted: true,
              adjusted_target_level: 4,
              target_adjustment_reason: '岗位项目要求',
              gap_value: 2,
            },
          ],
        },
        ...(options.includeUnmappedHistory
          ? [
              {
                l1_code: null,
                l1_name: null,
                l2_code: null,
                l2_name: '未映射历史项',
                l3_count: 1,
                is_empty: false,
                details: [
                  {
                    l3_code: 'unknown-legacy-l3',
                    current_level: 1,
                    target_level: 4,
                    standard_target_level: 3,
                    gap_value: 3,
                    evidence_note: '历史依据',
                  },
                ],
              },
            ]
          : []),
      ],
    })
    vi.spyOn(planningApi, 'listEvidenceReviewsForTask').mockResolvedValue(
      options.evidenceHistory ?? [],
    )
    vi.spyOn(
      assessmentReviewApi,
      'getAssessmentReviewSummary',
    ).mockResolvedValue({
      pending_count: 1,
      completed_count: 0,
    })
    vi.spyOn(planningApi, 'getEvidenceReviewSummary').mockResolvedValue({
      pending_count: options.includeEvidence === false ? 0 : 1,
      completed_count: 0,
    })
  }

  it('summarizes assessment and Evidence review queues', async () => {
    mockBuddyData({
      evidenceHistory: [
        {
          id: 12,
          evidence_id: 3,
          version_number: 1,
          status: '通过',
          conclusion: '通过',
          feedback: 'Evidence 历史反馈',
          reviewed_at: '2026-07-02T09:00:00',
        },
      ],
    })

    render(
      <MemoryRouter initialEntries={['/mentoring/dashboard']}>
        <App />
      </MemoryRouter>,
    )
    await waitFor(() =>
      expect(
        screen.getByRole('heading', { level: 1, name: 'Buddy 复核中心' }),
      ).toBeTruthy(),
    )
    expect(screen.getByText('待复核自评')).toBeTruthy()
    expect(screen.getByText('待 Review Evidence')).toBeTruthy()
    expect(screen.getByRole('heading', { name: '辅导成员' })).toBeTruthy()
    expect(screen.getByRole('button', { name: '全部成员' })).toBeTruthy()
    const memberList = screen.getByRole('heading', {
      name: '辅导成员',
    }).parentElement!
    expect(
      within(memberList).getByRole('button', { name: /成员甲/ }),
    ).toBeTruthy()
    expect(within(memberList).queryByText(',')).toBeNull()
    expect(screen.queryByText('’')).toBeNull()
    expect(screen.getByRole('tab', { name: '全部待处理' })).toBeTruthy()
    expect(screen.getByRole('heading', { name: '复核工作区' })).toBeTruthy()
    await waitFor(() => expect(screen.getByText(/上一版反馈/)).toBeTruthy())
    expect(screen.getByText(/二级能力标准：P01-L2A · 数据基础/)).toBeTruthy()
    expect(screen.getByText(/目标职级 P6 要求：P6 职级要求/)).toBeTruthy()
    expect(screen.getByText(/三级达成路径：P01-L2A-L3A/)).toBeTruthy()
    expect(screen.getByText(/标准 3；个人调整 4（岗位项目要求）/)).toBeTruthy()
    fireEvent.click(screen.getByRole('tab', { name: 'Evidence Review' }))
    await waitFor(() =>
      expect(screen.getByText('数据建模 Evidence')).toBeTruthy(),
    )
    expect(
      screen.getByRole('heading', { name: 'Evidence 版本 1' }),
    ).toBeTruthy()
    await waitFor(() =>
      expect(screen.getByText(/Evidence 历史反馈/)).toBeTruthy(),
    )
  })

  it('submits an assessment conclusion in the unified workspace', async () => {
    mockBuddyData({ includeEvidence: false })
    const submitReview = vi
      .spyOn(assessmentReviewApi, 'submitReview')
      .mockResolvedValue({ ok: true })

    render(
      <MemoryRouter initialEntries={['/mentoring/dashboard']}>
        <App />
      </MemoryRouter>,
    )
    await waitFor(() => expect(screen.getByLabelText('认可')).toBeTruthy())
    fireEvent.click(screen.getByLabelText('认可'))
    fireEvent.change(screen.getByLabelText('反馈'), {
      target: { value: '依据充分' },
    })
    fireEvent.click(screen.getByRole('button', { name: '提交复核反馈' }))

    await waitFor(() =>
      expect(screen.getByText('已认可，反馈已归入历史。')).toBeTruthy(),
    )
    expect(submitReview).toHaveBeenCalledWith(2, 1, {
      conclusion: '认可',
      feedback: '依据充分',
    })
  })

  it('keeps unmapped historical paths visible beside current L2 groups', async () => {
    mockBuddyData({ includeEvidence: false, includeUnmappedHistory: true })
    const submitReview = vi
      .spyOn(assessmentReviewApi, 'submitReview')
      .mockResolvedValue({ ok: true })

    render(
      <MemoryRouter initialEntries={['/mentoring/dashboard']}>
        <App />
      </MemoryRouter>,
    )

    await waitFor(() => expect(screen.getByText('未映射历史项')).toBeTruthy())
    expect(screen.getByText(/二级能力标准：P01-L2A/)).toBeTruthy()
    expect(screen.getByText(/unknown-legacy-l3/)).toBeTruthy()
    expect(screen.getByText(/当前掌握度 1 → 标准 3/)).toBeTruthy()
    expect(screen.getByText(/历史依据/)).toBeTruthy()
    fireEvent.click(screen.getByLabelText('认可'))
    fireEvent.change(screen.getByLabelText('反馈'), {
      target: { value: '保留历史项复核' },
    })
    fireEvent.click(screen.getByRole('button', { name: '提交复核反馈' }))
    await waitFor(() => expect(submitReview).toHaveBeenCalled())
  })

  it('submits an Evidence Review in the unified workspace', async () => {
    mockBuddyData()
    const submitEvidenceReview = vi
      .spyOn(planningApi, 'submitEvidenceReview')
      .mockResolvedValue({ ok: true })

    render(
      <MemoryRouter initialEntries={['/mentoring/dashboard']}>
        <App />
      </MemoryRouter>,
    )
    await waitFor(() =>
      expect(screen.getByRole('tab', { name: 'Evidence Review' })).toBeTruthy(),
    )
    fireEvent.click(screen.getByRole('tab', { name: 'Evidence Review' }))
    await waitFor(() => expect(screen.getByLabelText('通过')).toBeTruthy())
    fireEvent.click(screen.getByLabelText('通过'))
    fireEvent.change(screen.getByLabelText('反馈'), {
      target: { value: '输出可验证' },
    })
    fireEvent.click(screen.getByRole('button', { name: '提交 Review 反馈' }))

    await waitFor(() =>
      expect(
        screen.getByText('Evidence 已通过，反馈已归入历史。'),
      ).toBeTruthy(),
    )
    expect(submitEvidenceReview).toHaveBeenCalledWith(2, '通过', '输出可验证')
  })

  it('does not expose a queue item outside the Buddy assignment', async () => {
    mockBuddyData({ includeEvidence: false })
    vi.spyOn(assessmentReviewApi, 'listPendingReviews').mockResolvedValue([])
    vi.spyOn(planningApi, 'listPendingEvidenceReviews').mockResolvedValue([
      {
        id: 9,
        evidence_id: 9,
        version_number: 1,
        status: '待 Review',
        conclusion: null,
        feedback: null,
        reviewed_at: null,
        member_id: 99,
        username: '非负责成员',
        learning_task_id: 9,
        l3_code: 'P01-L2A-L3A',
      },
    ])

    render(
      <MemoryRouter initialEntries={['/mentoring/dashboard']}>
        <App />
      </MemoryRouter>,
    )
    await waitFor(() =>
      expect(screen.getByText('当前范围暂无待处理项。')).toBeTruthy(),
    )
    expect(screen.queryByText('非负责成员')).toBeNull()
    expect(
      screen.getByRole('button', { name: /待 Review Evidence/ }).textContent,
    ).toContain('0')
  })

  it('selects an assessment conclusion by clicking the label text', async () => {
    mockBuddyData({ includeEvidence: false })
    render(
      <MemoryRouter initialEntries={['/mentoring/dashboard']}>
        <App />
      </MemoryRouter>,
    )
    await waitFor(() => expect(screen.getByText('建议调整')).toBeTruthy())
    fireEvent.click(screen.getByText('建议调整'))
    expect(
      (screen.getByLabelText('建议调整') as HTMLInputElement).checked,
    ).toBe(true)
  })

  it('selects an Evidence conclusion by clicking the label text', async () => {
    mockBuddyData()
    render(
      <MemoryRouter initialEntries={['/mentoring/dashboard']}>
        <App />
      </MemoryRouter>,
    )
    await waitFor(() =>
      expect(screen.getByRole('tab', { name: 'Evidence Review' })).toBeTruthy(),
    )
    fireEvent.click(screen.getByRole('tab', { name: 'Evidence Review' }))
    await waitFor(() => expect(screen.getByText('需补充')).toBeTruthy())
    fireEvent.click(screen.getByText('需补充'))
    expect((screen.getByLabelText('需补充') as HTMLInputElement).checked).toBe(
      true,
    )
  })

  it.each(['/mentoring/assessment-review', '/mentoring/evidence-review'])(
    'redirects %s to the unified center',
    async (path) => {
      mockBuddyData({ includeEvidence: false })
      render(
        <MemoryRouter initialEntries={[path]}>
          <App />
        </MemoryRouter>,
      )

      await waitFor(() =>
        expect(
          screen.getByRole('heading', { level: 1, name: 'Buddy 复核中心' }),
        ).toBeTruthy(),
      )
    },
  )
})

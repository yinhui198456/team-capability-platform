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
import { MemoryRouter } from 'react-router-dom'

describe('BuddyReviewCenter', () => {
  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  function workspaceFixture(): assessmentReviewApi.BuddyReviewWorkspace {
    return {
      assessment_id: 2,
      member_id: 4,
      year: 2026,
      version: 1,
      assessment_status: '待复核',
      revision: 3,
      member_current_level_snapshot: 'P5',
      member_target_level_snapshot: 'P6',
      standard_version: { id: 1, label: 'Legacy Baseline v1' },
      summary: {
        total: 1,
        current_required: 1,
        target_progressive: 0,
        assessed: 1,
        gap_items: 1,
        high: 1,
        medium: 0,
        low: 0,
        hold: 0,
        in_plan: 1,
        by_quarter: { Q1: 0, Q2: 1, Q3: 0, Q4: 0 },
        adjustments: 1,
        data_issues: 0,
        existing_formal_plan: false,
        will_create_proposal: false,
        target_is_legacy: null,
      },
      details: [
        {
          id: 1,
          l3_code: 'P01-L2A-L3A',
          l3_name: '数据建模',
          l2_code: 'P01-L2A',
          l2_name: '数据基础',
          l1_code: 'P01',
          l1_name: '数据基础设施',
          scope_type: 'current_required',
          standard_job_level_snapshot: 'P5',
          current_level: 2,
          target_level: 4,
          standard_target_applicable: true,
          standard_target_level: 3,
          target_adjusted: true,
          adjusted_target_level: 4,
          target_adjustment_reason: '岗位项目要求',
          gap_value: 2,
          member_priority: '高',
          include_in_plan: true,
          plan_quarter: 'Q2',
          plan_month: 5,
          data_issue: false,
        },
      ],
    }
  }

  function mockBuddyData(
    options: {
      workspace?: assessmentReviewApi.BuddyReviewWorkspace
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
    vi.spyOn(assessmentReviewApi, 'getBuddyReviewWorkspace').mockResolvedValue(
      options.workspace ?? workspaceFixture(),
    )
    vi.spyOn(
      assessmentReviewApi,
      'getAssessmentReviewSummary',
    ).mockResolvedValue({
      pending_count: 1,
      completed_count: 0,
    })
  }

  it('summarizes the assessment review queue', async () => {
    mockBuddyData()

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
    // summary grid
    expect(screen.getByText('适用 1')).toBeTruthy()
    expect(screen.getByText('必备 1')).toBeTruthy()
    expect(screen.getByText('纳入计划 1')).toBeTruthy()
    // notices
    expect(screen.getByText(/首次认可将原子生成正式年度计划/)).toBeTruthy()
    // grouped detail table: adjustment shown only when it happened
    expect(screen.getByText('数据建模')).toBeTruthy()
    expect(screen.getByText(/3 → 4（岗位项目要求）/)).toBeTruthy()
    // ordinary evidence notes are not part of the main detail
    expect(screen.queryByText('历史依据')).toBeNull()
  })

  it('submits an assessment conclusion with an idempotency key', async () => {
    mockBuddyData()
    const submitReview = vi
      .spyOn(assessmentReviewApi, 'submitReview')
      .mockResolvedValue({
        ok: true,
        assessment_status: '已归档',
        assessment_id: 2,
        revision: 4,
        review: {
          id: 1,
          sequence: 1,
          conclusion: '认可',
          feedback: '依据充分',
          reviewed_by_buddy_id: 3,
        },
        plan: {
          created: true,
          plan_id: 10,
          items_created: 1,
          tasks_created: 1,
          target_is_legacy: null,
        },
        proposal: null,
        idempotent_replayed: false,
      })

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
      expect(
        screen.getByText(/年度计划已生成（1 项 \/ 1 个任务）/),
      ).toBeTruthy(),
    )
    expect(submitReview).toHaveBeenCalledTimes(1)
    const [assessmentId, reviewId, payload, idemKey] =
      submitReview.mock.calls[0]
    expect(assessmentId).toBe(2)
    expect(reviewId).toBe(1)
    expect(payload).toEqual({
      conclusion: '认可',
      feedback: '依据充分',
      expected_revision: 3,
    })
    expect(typeof idemKey).toBe('string')
    expect(idemKey.length).toBeGreaterThan(0)
  })

  it('keeps the idempotency key and local input on a failed submit', async () => {
    mockBuddyData()
    const submitReview = vi
      .spyOn(assessmentReviewApi, 'submitReview')
      .mockRejectedValueOnce(new Error('revision conflict'))
      .mockResolvedValue({
        ok: true,
        assessment_status: '已归档',
        assessment_id: 2,
        revision: 4,
        review: {
          id: 1,
          sequence: 1,
          conclusion: '认可',
          feedback: '依据充分',
          reviewed_by_buddy_id: 3,
        },
        plan: {
          created: true,
          plan_id: 10,
          items_created: 0,
          tasks_created: 0,
          target_is_legacy: null,
        },
        proposal: null,
        idempotent_replayed: false,
      })

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
      expect(screen.getByRole('alert').textContent).toContain(
        'revision conflict',
      ),
    )
    // local input and selection survive the failure
    expect((screen.getByLabelText('认可') as HTMLInputElement).checked).toBe(
      true,
    )
    expect((screen.getByLabelText('反馈') as HTMLTextAreaElement).value).toBe(
      '依据充分',
    )
    fireEvent.click(screen.getByRole('button', { name: '提交复核反馈' }))
    await waitFor(() =>
      expect(
        screen.getByText(/年度计划已生成（0 项 \/ 0 个任务）/),
      ).toBeTruthy(),
    )
    // the retry reused the same idempotency key
    expect(submitReview).toHaveBeenCalledTimes(2)
    const firstKey = submitReview.mock.calls[0][3]
    const secondKey = submitReview.mock.calls[1][3]
    expect(secondKey).toBe(firstKey)
  })

  it('shows the proposal notice for an existing formal plan', async () => {
    const ws = workspaceFixture()
    ws.summary.existing_formal_plan = true
    ws.summary.will_create_proposal = true
    ws.summary.target_is_legacy = true
    mockBuddyData({ workspace: ws })
    render(
      <MemoryRouter initialEntries={['/mentoring/dashboard']}>
        <App />
      </MemoryRouter>,
    )
    await waitFor(() =>
      expect(
        screen.getByText(/本次认可只生成只读变更提案，不修改正式计划/),
      ).toBeTruthy(),
    )
    expect(screen.getByText(/来源为历史计划/)).toBeTruthy()
  })

  it('filters the detail table', async () => {
    const ws = workspaceFixture()
    ws.details.push({
      id: 2,
      l3_code: 'P02-L2B-L3B',
      l3_name: '进阶项',
      l2_code: 'P02-L2B',
      l2_name: '进阶域',
      l1_code: 'P02',
      l1_name: '进阶域L1',
      scope_type: 'target_progressive',
      standard_job_level_snapshot: 'P6',
      current_level: 2,
      target_level: 4,
      standard_target_applicable: true,
      standard_target_level: 4,
      target_adjusted: false,
      gap_value: 2,
      member_priority: '暂缓',
      include_in_plan: false,
      data_issue: false,
    })
    mockBuddyData({ workspace: ws })
    render(
      <MemoryRouter initialEntries={['/mentoring/dashboard']}>
        <App />
      </MemoryRouter>,
    )
    await waitFor(() => expect(screen.getByText('数据建模')).toBeTruthy())
    expect(screen.getByText('进阶项')).toBeTruthy()
    fireEvent.change(screen.getByLabelText('筛选'), {
      target: { value: '暂缓' },
    })
    expect(screen.queryByText('数据建模')).toBeNull()
    expect(screen.getByText('进阶项')).toBeTruthy()
    fireEvent.change(screen.getByLabelText('筛选'), {
      target: { value: '当前职级必备且有Gap' },
    })
    expect(screen.getByText('数据建模')).toBeTruthy()
    expect(screen.queryByText('进阶项')).toBeNull()
  })

  it('searches by L3 code', async () => {
    mockBuddyData()
    render(
      <MemoryRouter initialEntries={['/mentoring/dashboard']}>
        <App />
      </MemoryRouter>,
    )
    await waitFor(() => expect(screen.getByText('数据建模')).toBeTruthy())
    fireEvent.change(screen.getByLabelText('搜索能力项'), {
      target: { value: 'NO-SUCH-CODE' },
    })
    expect(screen.getByText('当前筛选范围暂无能力项。')).toBeTruthy()
  })

  it('does not expose a queue item outside the Buddy assignment', async () => {
    mockBuddyData()
    vi.spyOn(assessmentReviewApi, 'listPendingReviews').mockResolvedValue([
      {
        id: 99,
        assessment_id: 999,
        sequence: 1,
        buddy_id: 3,
        status: '待复核',
        member_id: 42,
        year: 2026,
        version: 1,
        assessment_status: '待复核',
        submitted_at: null,
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
    expect(screen.queryByText('成员 42')).toBeNull()
    // Evidence review lives in its own queue, not in the assessment center.
    expect(screen.queryByRole('tab', { name: '任务成果证明 Review' })).toBeNull()
  })

  it('selects an assessment conclusion by clicking the label text', async () => {
    mockBuddyData()
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

  it('redirects /mentoring/assessment-review to the unified center', async () => {
    mockBuddyData()
    render(
      <MemoryRouter initialEntries={['/mentoring/assessment-review']}>
        <App />
      </MemoryRouter>,
    )

    await waitFor(() =>
      expect(
        screen.getByRole('heading', { level: 1, name: 'Buddy 复核中心' }),
      ).toBeTruthy(),
    )
  })

  // ── P1-5: idempotency key lifecycle bound to the payload fingerprint ──────

  it('uses a new idempotency key when the payload changed after a failure', async () => {
    mockBuddyData()
    const submitReview = vi
      .spyOn(assessmentReviewApi, 'submitReview')
      .mockRejectedValueOnce(new Error('network lost'))
      .mockResolvedValue({
        ok: true,
        assessment_status: '已归档',
        assessment_id: 2,
        revision: 4,
        review: {
          id: 1,
          sequence: 1,
          conclusion: '认可',
          feedback: '依据充分',
          reviewed_by_buddy_id: 3,
        },
        plan: {
          created: true,
          plan_id: 10,
          items_created: 0,
          tasks_created: 0,
          target_is_legacy: null,
        },
        proposal: null,
        idempotent_replayed: false,
      })

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
      expect(screen.getByRole('alert').textContent).toContain('network lost'),
    )
    // The member edits the feedback: a different payload is a new operation.
    fireEvent.change(screen.getByLabelText('反馈'), {
      target: { value: '依据充分（修订）' },
    })
    fireEvent.click(screen.getByRole('button', { name: '提交复核反馈' }))
    await waitFor(() => expect(screen.getByText(/年度计划已生成/)).toBeTruthy())
    expect(submitReview).toHaveBeenCalledTimes(2)
    const firstKey = submitReview.mock.calls[0][3]
    const secondKey = submitReview.mock.calls[1][3]
    expect(secondKey).not.toBe(firstKey)
  })

  it('unchanged payload after a failure keeps the same idempotency key', async () => {
    mockBuddyData()
    const submitReview = vi
      .spyOn(assessmentReviewApi, 'submitReview')
      .mockRejectedValueOnce(new Error('network lost'))
      .mockResolvedValue({
        ok: true,
        assessment_status: '已归档',
        assessment_id: 2,
        revision: 4,
        review: {
          id: 1,
          sequence: 1,
          conclusion: '认可',
          feedback: '依据充分',
          reviewed_by_buddy_id: 3,
        },
        plan: {
          created: true,
          plan_id: 10,
          items_created: 0,
          tasks_created: 0,
          target_is_legacy: null,
        },
        proposal: null,
        idempotent_replayed: true,
      })

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
      expect(screen.getByRole('alert').textContent).toContain('network lost'),
    )
    fireEvent.click(screen.getByRole('button', { name: '提交复核反馈' }))
    await waitFor(() =>
      expect(screen.getByText(/已提交（幂等重放/)).toBeTruthy(),
    )
    expect(submitReview).toHaveBeenCalledTimes(2)
    const firstKey = submitReview.mock.calls[0][3]
    const secondKey = submitReview.mock.calls[1][3]
    expect(secondKey).toBe(firstKey)
  })

  it('revision 409 keeps input, refreshes the workspace and uses a new key', async () => {
    mockBuddyData()
    const submitReview = vi
      .spyOn(assessmentReviewApi, 'submitReview')
      .mockRejectedValueOnce({
        name: 'Error',
        message: 'revision conflict',
        status: 409,
        detail: { code: 'revision_conflict', message: 'revision conflict' },
      })
      .mockResolvedValue({
        ok: true,
        assessment_status: '已归档',
        assessment_id: 2,
        revision: 5,
        review: {
          id: 1,
          sequence: 1,
          conclusion: '认可',
          feedback: '依据充分',
          reviewed_by_buddy_id: 3,
        },
        plan: {
          created: true,
          plan_id: 10,
          items_created: 0,
          tasks_created: 0,
          target_is_legacy: null,
        },
        proposal: null,
        idempotent_replayed: false,
      })
    const workspaceSpy = vi
      .spyOn(assessmentReviewApi, 'getBuddyReviewWorkspace')
      .mockResolvedValue({ ...workspaceFixture(), revision: 4 })
    const initialCalls = workspaceSpy.mock.calls.length

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
      expect(screen.getByRole('alert').textContent).toContain(
        '复核版本已更新，请确认后重新提交。',
      ),
    )
    // The local input survives the 409.
    expect((screen.getByLabelText('认可') as HTMLInputElement).checked).toBe(
      true,
    )
    expect((screen.getByLabelText('反馈') as HTMLTextAreaElement).value).toBe(
      '依据充分',
    )
    // The workspace was refreshed (fresh revision) and the next submit uses a
    // new key and succeeds.
    expect(workspaceSpy.mock.calls.length).toBeGreaterThan(initialCalls)
    fireEvent.click(screen.getByRole('button', { name: '提交复核反馈' }))
    await waitFor(() => expect(screen.getByText(/年度计划已生成/)).toBeTruthy())
    expect(submitReview).toHaveBeenCalledTimes(2)
    const firstKey = submitReview.mock.calls[0][3]
    const secondKey = submitReview.mock.calls[1][3]
    expect(secondKey).not.toBe(firstKey)
    expect(submitReview.mock.calls[1][2]).toMatchObject({
      expected_revision: 4,
    })
  })
})

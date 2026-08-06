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
import { MemoryRouter } from 'react-router-dom'
import type { EvidenceReviewRecord, PendingEvidenceReview } from './planning'

function makePending(
  overrides: Partial<PendingEvidenceReview> = {},
): PendingEvidenceReview {
  return {
    id: 10,
    learning_task_id: 100,
    l3_code: 'P01.01.01',
    l3_name: '数据管道基础',
    l2_code: 'P01.01',
    l2_name: '数据基础',
    version_number: 1,
    content: '完成 P01 实践项目',
    evidence_link: 'http://example.com/demo',
    status: '待 Review',
    submitted_at: '2026-07-16T10:00:00Z',
    created_at: '2026-07-15T10:00:00Z',
    submitted_by: 1,
    description: null,
    evidence_type: 'link',
    url: 'http://example.com/demo',
    file_reference: null,
    file_name: null,
    mime_type: null,
    file_size: null,
    supersedes_evidence_id: null,
    revision: 1,
    member_id: 1,
    username: 'member',
    ...overrides,
  }
}

function mockBuddy() {
  vi.spyOn(accessApi, 'me').mockResolvedValue({
    id: 2,
    username: 'buddy',
    full_name: 'Buddy',
    roles: ['Buddy'],
  })
}

async function renderEvidencePage(queue: PendingEvidenceReview[] = []) {
  mockBuddy()
  vi.spyOn(planningApi, 'getAvailableYears').mockResolvedValue({
    available_years: [2026],
    active_year: 2026,
  })
  vi.spyOn(planningApi, 'listPendingEvidenceReviews').mockResolvedValue(queue)
  if (!vi.isMockFunction(planningApi.listEvidenceReviewsForTask)) {
    vi.spyOn(planningApi, 'listEvidenceReviewsForTask').mockResolvedValue([])
  }
  render(
    <MemoryRouter initialEntries={['/mentoring/evidence-review']}>
      <App />
    </MemoryRouter>,
  )
  await waitFor(() => {
    expect(screen.getByRole('heading', { name: '待验收成果' })).toBeTruthy()
  })
}

describe('EvidenceReviewPage — standalone Buddy evidence queue', () => {
  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it('renders the queue with member, source snapshot and picks the first item', async () => {
    const queue = [
      makePending({ id: 10 }),
      makePending({
        id: 11,
        version_number: 2,
        content: '第二版实现',
        member_id: 5,
        username: 'member2',
        l3_code: 'P02.01.01',
        l3_name: '模型部署流程',
      }),
    ]
    const listHistory = vi
      .spyOn(planningApi, 'listEvidenceReviewsForTask')
      .mockResolvedValue([])
    await renderEvidencePage(queue)
    // Queue rows: member + L2→L3 path + version.
    expect(screen.getAllByText(/member/).length).toBeGreaterThanOrEqual(2)
    expect(screen.getByText(/P01.01 · 数据基础 → P01.01.01/)).toBeTruthy()
    expect(screen.getAllByText(/版本 1|版本 2/).length).toBeGreaterThan(0)
    // First item auto-selected: workspace shows content + link.
    await waitFor(() =>
      expect(screen.getByText('完成 P01 实践项目')).toBeTruthy(),
    )
    expect(screen.getByText('查看任务成果证明链接')).toBeTruthy()
    expect(listHistory).toHaveBeenCalledWith(100)
  })

  it('requires feedback before a 需补充 review', async () => {
    const submit = vi
      .spyOn(planningApi, 'submitEvidenceReview')
      .mockResolvedValue({
        id: 1,
        evidence_id: 10,
        version_number: 1,
        status: '已闭环',
        conclusion: '需补充',
        feedback: '请补充',
        reviewed_at: '2026-07-17T00:00:00Z',
        created_at: '2026-07-17T00:00:00Z',
      })
    await renderEvidencePage([makePending({})])
    await waitFor(() => expect(screen.getByLabelText('需补充')).toBeTruthy())
    fireEvent.click(screen.getByLabelText('需补充'))
    fireEvent.click(screen.getByRole('button', { name: '提交评审结论' }))
    await waitFor(() => {
      expect(
        screen.getByRole('alert').textContent?.includes('需补充必须填写反馈'),
      ).toBeTruthy()
    })
    expect(submit).not.toHaveBeenCalled()
  })

  it('submits approval by evidence id with a fingerprint-bound key', async () => {
    const submit = vi
      .spyOn(planningApi, 'submitEvidenceReview')
      .mockResolvedValue({
        id: 1,
        evidence_id: 10,
        version_number: 1,
        status: '已闭环',
        conclusion: '通过',
        feedback: '符合预期',
        reviewed_at: '2026-07-17T00:00:00Z',
        created_at: '2026-07-17T00:00:00Z',
      })
    await renderEvidencePage([makePending({})])
    await waitFor(() => expect(screen.getByLabelText('通过')).toBeTruthy())
    fireEvent.click(screen.getByLabelText('通过'))
    fireEvent.change(screen.getByLabelText('反馈'), {
      target: { value: '符合预期' },
    })
    fireEvent.click(screen.getByRole('button', { name: '提交评审结论' }))
    await waitFor(() => {
      const msg = screen.getByText(/已通过/)
      expect(msg).toBeTruthy()
      expect(msg.textContent).not.toContain('已归档')
    })
    expect(submit).toHaveBeenCalledTimes(1)
    const [evidenceId, conclusion, feedback, key] = submit.mock.calls[0]
    expect(evidenceId).toBe(10)
    expect(conclusion).toBe('通过')
    expect(feedback).toBe('符合预期')
    expect(key).toBeTruthy()
    // Reviewed item leaves the queue; the immutable result is shown.
    expect(screen.queryByText('完成 P01 实践项目')).toBeNull()
  })

  it('a 403 keeps the item and explains the relationship is invalid', async () => {
    const forbidden = Object.assign(
      new Error('buddy is not assigned to member'),
      {
        status: 403,
        detail: 'buddy is not assigned to member',
      },
    )
    vi.spyOn(planningApi, 'submitEvidenceReview').mockRejectedValue(forbidden)
    await renderEvidencePage([makePending({})])
    await waitFor(() => expect(screen.getByLabelText('通过')).toBeTruthy())
    fireEvent.click(screen.getByLabelText('通过'))
    fireEvent.click(screen.getByRole('button', { name: '提交评审结论' }))
    await waitFor(() => {
      expect(
        screen
          .getByRole('alert')
          .textContent?.includes('辅导关系不存在或已失效'),
      ).toBeTruthy()
    })
    // No fake success: the item is still in the queue.
    expect(screen.queryByText(/已通过/)).toBeNull()
    expect(screen.getByText('完成 P01 实践项目')).toBeTruthy()
  })

  it('a review 409 reloads the queue and reports the state changed', async () => {
    const alreadyReviewed = Object.assign(
      new Error('evidence is not pending review'),
      {
        status: 409,
        detail: {
          code: 'review_already_submitted',
          entity_type: 'evidence_review',
          entity_id: 10,
          field: 'status',
          reason: 'review_already_submitted',
          message: 'evidence is not pending review',
        },
      },
    )
    vi.spyOn(planningApi, 'submitEvidenceReview').mockRejectedValue(
      alreadyReviewed,
    )
    await renderEvidencePage([makePending({})])
    const list = vi.mocked(planningApi.listPendingEvidenceReviews)
    await waitFor(() => expect(screen.getByLabelText('通过')).toBeTruthy())
    fireEvent.click(screen.getByLabelText('通过'))
    fireEvent.click(screen.getByRole('button', { name: '提交评审结论' }))
    await waitFor(() => {
      expect(
        screen.getByRole('alert').textContent?.includes('请确认后重新提交'),
      ).toBeTruthy()
    })
    expect(list).toHaveBeenCalledTimes(2)
  })

  it('a 409 that removes the item clears the form and never auto-submits the next item', async () => {
    const a = makePending({ id: 10 })
    const b = makePending({
      id: 11,
      version_number: 2,
      content: '第二版实现',
      member_id: 5,
      username: 'member2',
    })
    const conflict = Object.assign(
      new Error('evidence is not pending review'),
      {
        status: 409,
        detail: {
          code: 'review_already_submitted',
          entity_type: 'evidence_review',
          entity_id: 10,
          field: 'status',
          reason: 'review_already_submitted',
          message: 'evidence is not pending review',
        },
      },
    )
    const submit = vi
      .spyOn(planningApi, 'submitEvidenceReview')
      .mockRejectedValue(conflict)
    // renderEvidencePage installs the list spy with base [a, b]; the mount
    // effect already consumed the base value, so the next call — the 409
    // queue reload — is the one that must return only B.
    await renderEvidencePage([a, b])
    vi.mocked(planningApi.listPendingEvidenceReviews).mockResolvedValueOnce([b])
    await waitFor(() => expect(screen.getByLabelText('通过')).toBeTruthy())
    fireEvent.click(screen.getByLabelText('通过'))
    fireEvent.change(screen.getByLabelText('反馈'), {
      target: { value: '符合预期' },
    })
    fireEvent.click(screen.getByRole('button', { name: '提交评审结论' }))
    await waitFor(() => {
      expect(
        screen.getByRole('alert').textContent?.includes('已被评审'),
      ).toBeTruthy()
    })
    // The conflict result is bound to A: B is never auto-selected, so A's
    // conclusion cannot be silently replayed against it.
    expect(
      screen.getByText('选择一项待验收成果后查看依据和历史反馈。'),
    ).toBeTruthy()
    expect(screen.queryByText('第二版实现')).toBeNull()
    expect(screen.queryByRole('button', { name: '提交评审结论' })).toBeNull()
    expect(submit).toHaveBeenCalledTimes(1)
    // Explicitly choosing B starts with a clean form.
    fireEvent.click(screen.getByRole('button', { name: /member2/ }))
    await waitFor(() => expect(screen.getByText('第二版实现')).toBeTruthy())
    expect((screen.getByLabelText('通过') as HTMLInputElement).checked).toBe(
      false,
    )
    expect((screen.getByLabelText('反馈') as HTMLTextAreaElement).value).toBe(
      '',
    )
  })

  it('a 409 while the item is still pending keeps it selected and bound', async () => {
    const conflict = Object.assign(
      new Error('evidence is not pending review'),
      {
        status: 409,
        detail: {
          code: 'review_already_submitted',
          entity_type: 'evidence_review',
          entity_id: 10,
          field: 'status',
          reason: 'review_already_submitted',
          message: 'evidence is not pending review',
        },
      },
    )
    const result: EvidenceReviewRecord = {
      id: 1,
      evidence_id: 10,
      version_number: 1,
      status: '已闭环',
      conclusion: '通过',
      feedback: '符合预期',
      reviewed_at: '2026-07-17T00:00:00Z',
      created_at: '2026-07-17T00:00:00Z',
    }
    const submit = vi
      .spyOn(planningApi, 'submitEvidenceReview')
      .mockRejectedValueOnce(conflict)
      .mockResolvedValueOnce(result)
    await renderEvidencePage([makePending({})])
    await waitFor(() => expect(screen.getByLabelText('通过')).toBeTruthy())
    fireEvent.click(screen.getByLabelText('通过'))
    fireEvent.change(screen.getByLabelText('反馈'), {
      target: { value: '符合预期' },
    })
    fireEvent.click(screen.getByRole('button', { name: '提交评审结论' }))
    await waitFor(() => {
      expect(
        screen.getByRole('alert').textContent?.includes('请确认后重新提交'),
      ).toBeTruthy()
    })
    // A is still bound: content and form are preserved.
    expect(screen.getByText('完成 P01 实践项目')).toBeTruthy()
    expect((screen.getByLabelText('通过') as HTMLInputElement).checked).toBe(
      true,
    )
    expect((screen.getByLabelText('反馈') as HTMLTextAreaElement).value).toBe(
      '符合预期',
    )
    // A fresh idempotency key retries the SAME item; success clears it.
    fireEvent.click(screen.getByRole('button', { name: '提交评审结论' }))
    await waitFor(() => expect(submit).toHaveBeenCalledTimes(2))
    expect(submit.mock.calls[1][0]).toBe(10)
    expect(submit.mock.calls[1][3]).not.toBe(submit.mock.calls[0][3])
    await waitFor(() => {
      const msg = screen.getByText(/已通过/)
      expect(msg).toBeTruthy()
      expect(msg.textContent).not.toContain('已归档')
    })
  })

  it('switching items clears the previous item history immediately', async () => {
    const a = makePending({ id: 10 })
    const b = makePending({
      id: 11,
      learning_task_id: 200,
      version_number: 2,
      content: '第二版实现',
      username: 'member2',
    })
    const historyA: EvidenceReviewRecord[] = [
      {
        id: 1,
        evidence_id: 10,
        version_number: 1,
        status: '已闭环',
        conclusion: '需补充',
        feedback: '请补充口径说明',
        reviewed_at: '2026-05-02T00:00:00Z',
        created_at: '2026-05-02T00:00:00Z',
      },
    ]
    const historyB: EvidenceReviewRecord[] = [
      {
        id: 2,
        evidence_id: 11,
        version_number: 2,
        status: '已闭环',
        conclusion: '通过',
        feedback: '第二版通过',
        reviewed_at: '2026-05-03T00:00:00Z',
        created_at: '2026-05-03T00:00:00Z',
      },
    ]
    let resolveB: (value: typeof historyB) => void
    const bDeferred = new Promise<typeof historyB>((resolve) => {
      resolveB = resolve
    })
    vi.spyOn(planningApi, 'listEvidenceReviewsForTask')
      .mockResolvedValueOnce(historyA)
      .mockImplementationOnce(() => bDeferred)
    await renderEvidencePage([a, b])
    await waitFor(() => expect(screen.getByText(/请补充口径说明/)).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: /member2/ }))
    // Stale A history must not show under B while B's history loads.
    expect(screen.queryByText(/请补充口径说明/)).toBeNull()
    expect(screen.getByText('暂无历史评审记录。')).toBeTruthy()
    resolveB!(historyB)
    await waitFor(() => expect(screen.getByText(/第二版通过/)).toBeTruthy())
  })

  it('a history load failure for the current item leaves history empty and shows the error', async () => {
    const a = makePending({ id: 10 })
    const b = makePending({
      id: 11,
      learning_task_id: 200,
      version_number: 2,
      content: '第二版实现',
      username: 'member2',
    })
    const historyA: EvidenceReviewRecord[] = [
      {
        id: 1,
        evidence_id: 10,
        version_number: 1,
        status: '已闭环',
        conclusion: '需补充',
        feedback: '请补充口径说明',
        reviewed_at: '2026-05-02T00:00:00Z',
        created_at: '2026-05-02T00:00:00Z',
      },
    ]
    vi.spyOn(planningApi, 'listEvidenceReviewsForTask')
      .mockResolvedValueOnce(historyA)
      .mockRejectedValueOnce(new Error('history load failed'))
    await renderEvidencePage([a, b])
    await waitFor(() => expect(screen.getByText(/请补充口径说明/)).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: /member2/ }))
    await waitFor(() => {
      expect(
        screen.getByRole('alert').textContent?.includes('history load failed'),
      ).toBeTruthy()
    })
    // No stale A history under B; B's history stays empty.
    expect(screen.queryByText(/请补充口径说明/)).toBeNull()
    expect(screen.getByText('暂无历史评审记录。')).toBeTruthy()
  })

  it('a late history response for the previous item never appears under the current item', async () => {
    const a = makePending({ id: 10 })
    const b = makePending({
      id: 11,
      learning_task_id: 200,
      version_number: 2,
      content: '第二版实现',
      username: 'member2',
    })
    const historyA: EvidenceReviewRecord[] = [
      {
        id: 1,
        evidence_id: 10,
        version_number: 1,
        status: '已闭环',
        conclusion: '需补充',
        feedback: '请补充口径说明',
        reviewed_at: '2026-05-02T00:00:00Z',
        created_at: '2026-05-02T00:00:00Z',
      },
    ]
    const historyB: EvidenceReviewRecord[] = [
      {
        id: 2,
        evidence_id: 11,
        version_number: 2,
        status: '已闭环',
        conclusion: '通过',
        feedback: '第二版通过',
        reviewed_at: '2026-05-03T00:00:00Z',
        created_at: '2026-05-03T00:00:00Z',
      },
    ]
    let resolveA: (value: typeof historyA) => void
    const aDeferred = new Promise<typeof historyA>((resolve) => {
      resolveA = resolve
    })
    let resolveB: (value: typeof historyB) => void
    const bDeferred = new Promise<typeof historyB>((resolve) => {
      resolveB = resolve
    })
    vi.spyOn(planningApi, 'listEvidenceReviewsForTask')
      .mockImplementationOnce(() => aDeferred)
      .mockImplementationOnce(() => bDeferred)
    await renderEvidencePage([a, b])
    // A auto-selected; its history is still in flight. Switch to B.
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /member2/ })).toBeTruthy(),
    )
    fireEvent.click(screen.getByRole('button', { name: /member2/ }))
    resolveB!(historyB)
    await waitFor(() => expect(screen.getByText(/第二版通过/)).toBeTruthy())
    // A's late response arrives: it must be discarded, not shown under B.
    resolveA!(historyA)
    await waitFor(() => {
      expect(screen.queryByText(/请补充口径说明/)).toBeNull()
    })
    expect(screen.getByText(/第二版通过/)).toBeTruthy()
  })

  it('keeps the queue isolated from assessment review semantics', async () => {
    await renderEvidencePage([makePending({})])
    expect(screen.queryByText('自评复核')).toBeNull()
    expect(screen.queryByRole('tab', { name: '全部待处理' })).toBeNull()
    expect(screen.queryByRole('heading', { name: 'Buddy 复核中心' })).toBeNull()
    expect(screen.getByRole('heading', { name: '待验收成果' })).toBeTruthy()
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

  it('submitEvidenceReview posts by evidence id with conclusion, feedback and key', async () => {
    await planningApi.submitEvidenceReview(
      10,
      '需补充',
      '请补充口径说明',
      'rev-key-1',
    )
    expect(fetch).toHaveBeenCalledWith(
      '/api/planning/evidences/10/review',
      expect.objectContaining({
        method: 'POST',
        credentials: 'include',
        body: JSON.stringify({
          conclusion: '需补充',
          feedback: '请补充口径说明',
          idempotency_key: 'rev-key-1',
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

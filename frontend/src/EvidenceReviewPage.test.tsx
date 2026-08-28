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
import type {
  EvidenceReviewRecord,
  EvidenceReviewWorkspace,
  PendingEvidenceReview,
} from './planning'

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
  if (!vi.isMockFunction(planningApi.getEvidenceReviewWorkspace)) {
    vi.spyOn(planningApi, 'getEvidenceReviewWorkspace').mockResolvedValue({
      summary: {
        pending_count: queue.length,
        needs_supplement_count: 0,
        approved_this_month_count: 0,
        average_response_days: null,
      },
      members: [],
      queue,
    })
  }
  if (!vi.isMockFunction(planningApi.listEvidenceReviewsForTask)) {
    vi.spyOn(planningApi, 'listEvidenceReviewsForTask').mockResolvedValue([])
  }
  render(
    <MemoryRouter initialEntries={['/mentoring/evidence-review']}>
      <App />
    </MemoryRouter>,
  )
  await waitFor(() => {
    expect(screen.getByRole('heading', { name: '成果验收' })).toBeTruthy()
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
    expect(screen.getByText('数据管道基础 · 版本 1')).toBeTruthy()
    expect(screen.getAllByText(/版本 1|版本 2/).length).toBeGreaterThan(0)
    // First item auto-selected: workspace shows content + link.
    await waitFor(() =>
      expect(screen.getByText('完成 P01 实践项目')).toBeTruthy(),
    )
    expect(screen.getByText('查看成果文件')).toBeTruthy()
    expect(listHistory).toHaveBeenCalledWith(100)
  })

  it('matches the approved B01 title, history entry and selected-task hierarchy', async () => {
    await renderEvidencePage([
      makePending({
        l3_name: '数据管道基础任务',
        description: '目录重构说明与检查清单',
        content: '成员提交的成果正文',
      }),
    ])
    expect(
      document.querySelector('.evidence-review-page .eyebrow')?.textContent,
    ).toBe('导师指导')
    expect(
      screen.getByText('处理成果验收队列并留下反馈；不审核评级或计划。'),
    ).toBeTruthy()
    const historyButton = screen.getByRole('button', { name: '查看历史反馈' })
    expect(
      screen.getAllByRole('button', { name: '查看历史反馈' }),
    ).toHaveLength(1)
    expect(
      screen
        .getByRole('heading', { name: '成果验收' })
        .closest('header')
        ?.contains(historyButton),
    ).toBe(true)
    expect(
      screen
        .getByRole('heading', { name: '成果验收' })
        .closest('header')
        ?.classList.contains('evidence-review-heading'),
    ).toBe(true)
    expect(
      screen.getByText('member · P01.01.01', { selector: 'small' }),
    ).toBeTruthy()
    expect(
      screen.getByRole('heading', { name: '数据管道基础任务' }),
    ).toBeTruthy()
    expect(screen.getByText('成果 v1')).toBeTruthy()
    expect(
      screen.getByRole('heading', { name: '目录重构说明与检查清单' }),
    ).toBeTruthy()
    expect(screen.getByText('成员提交的成果正文')).toBeTruthy()
    expect(historyButton.className).toBe('evidence-review-history-button')
    expect(
      screen.getByRole('button', { name: '通过' }).getAttribute('aria-pressed'),
    ).toBe('false')
    expect(screen.getByRole('button', { name: '通过' }).className).toBe(
      'evidence-review-decision',
    )
    expect(
      screen
        .getByRole('button', { name: '需补充' })
        .getAttribute('aria-pressed'),
    ).toBe('false')
    expect(screen.getByLabelText('反馈建议').getAttribute('placeholder')).toBe(
      '通过时可填写建议；需补充时请具体说明缺少什么。',
    )
    expect(screen.getByRole('button', { name: '提交验收结果' }).className).toBe(
      'evidence-review-submit-button',
    )
  })

  it('keeps the approved B01 metric, queue and workspace order', async () => {
    await renderEvidencePage([
      makePending(),
      makePending({
        id: 11,
        learning_task_id: 101,
        is_resubmission: true,
        username: 'member2',
      }),
    ])
    const metrics = Array.from(
      document.querySelectorAll(
        '.evidence-review-page .dashboard-grid > article',
      ),
    )
    expect(metrics).toHaveLength(4)
    expect(
      metrics.every((metric) => metric.classList.contains('metric-card')),
    ).toBe(true)
    expect(
      metrics.every(
        (metric) =>
          metric.querySelector('.metric-icon')?.getAttribute('aria-hidden') ===
          'true',
      ),
    ).toBe(true)
    expect(
      metrics.map((metric) => metric.querySelector('div > span')?.textContent),
    ).toEqual(['待验收', '需补充', '本月通过', '平均响应'])
    expect(
      metrics.every(
        (metric) => metric.querySelector('strong')?.tagName === 'STRONG',
      ),
    ).toBe(true)

    const queue = screen
      .getByRole('heading', { name: '待办队列' })
      .closest('aside')
    expect(queue?.querySelector('.status-pill.warning')?.textContent).toBe(
      '待验收',
    )
    expect(queue?.querySelector('.status-pill.error')?.textContent).toBe(
      '补充后重提',
    )

    const workspace = screen.getByRole('article', { name: '验收工作区' })
    expect(
      Array.from(workspace.children).map((child) => child.className),
    ).toEqual([
      'evidence-review-title',
      'evidence-content evidence-review-preview',
      'evidence-review-history',
      'decision-row evidence-review-decision-row',
      'evidence-review-feedback',
      'actions',
    ])
    fireEvent.click(screen.getByRole('button', { name: '查看历史反馈' }))
    expect(document.activeElement?.id).toBe('evidence-history-100')
    expect(screen.queryByText('自评复核')).toBeNull()
    expect(screen.queryByText('驳回')).toBeNull()
    expect(screen.queryByRole('button', { name: /全部成员/ })).toBeNull()
  })

  it('requires a conclusion before submitting without making a request', async () => {
    const submit = vi.spyOn(planningApi, 'submitEvidenceReview')
    await renderEvidencePage([makePending()])
    fireEvent.click(screen.getByRole('button', { name: '提交验收结果' }))
    expect(
      screen
        .getByRole('alert')
        .textContent?.includes('请先选择“通过”或“需补充”'),
    ).toBeTruthy()
    expect(submit).not.toHaveBeenCalled()
  })

  it('shows ordinary and resubmitted items with their approved queue labels', async () => {
    await renderEvidencePage([
      makePending(),
      makePending({ id: 11, is_resubmission: true }),
    ])
    expect(screen.getByRole('heading', { name: '成果验收' })).toBeTruthy()
    expect(screen.getAllByText('待验收').length).toBeGreaterThan(0)
    expect(screen.getAllByText('需补充').length).toBeGreaterThan(0)
    expect(screen.getByText('本月通过')).toBeTruthy()
    expect(screen.getByText('平均响应')).toBeTruthy()
    const queue = screen
      .getByRole('heading', { name: '待办队列' })
      .closest('aside')
    const [ordinary, resubmission] = Array.from(
      queue?.querySelectorAll('button') ?? [],
    )
    const [ordinaryBadge, ordinaryMember, ordinaryTask] = Array.from(
      ordinary.children,
    )
    const [resubmissionBadge] = Array.from(resubmission.children)
    expect(ordinaryBadge.className).toBe('status-pill warning')
    expect(ordinaryMember.tagName).toBe('STRONG')
    expect(ordinaryTask.className).toBe('evidence-review-task')
    expect(resubmissionBadge.className).toBe('status-pill error')
  })

  it('marks an ordinary actionable item as 待验收', async () => {
    await renderEvidencePage([makePending()])
    expect(
      screen
        .getAllByText('待验收')
        .find((node) => node.className === 'status-pill warning'),
    ).toBeTruthy()
  })

  it('keeps the approved two panels for an empty queue without member filtering', async () => {
    await renderEvidencePage([])
    expect(screen.queryByRole('heading', { name: '辅导成员' })).toBeNull()
    expect(screen.getByRole('heading', { name: '待办队列' })).toBeTruthy()
    expect(screen.getByRole('heading', { name: '验收工作区' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: /全部成员/ })).toBeNull()
    expect(screen.getByText('暂无待验收成果。')).toBeTruthy()
    const historyButton = screen.getByRole('button', { name: '查看历史反馈' })
    expect((historyButton as HTMLButtonElement).disabled).toBe(true)
    expect(historyButton.getAttribute('title')).toBe(
      '暂无待验收成果，无法查看历史反馈',
    )
  })

  it('keeps history on the selected task and moves keyboard focus there', async () => {
    await renderEvidencePage([makePending({ learning_task_id: 321 })])
    fireEvent.click(screen.getByRole('button', { name: '查看历史反馈' }))
    expect(document.activeElement?.id).toBe('evidence-history-321')
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
    await waitFor(() =>
      expect(screen.getByRole('button', { name: '需补充' })).toBeTruthy(),
    )
    fireEvent.click(screen.getByRole('button', { name: '需补充' }))
    fireEvent.click(screen.getByRole('button', { name: '提交验收结果' }))
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
    await waitFor(() =>
      expect(screen.getByRole('button', { name: '通过' })).toBeTruthy(),
    )
    fireEvent.click(screen.getByRole('button', { name: '通过' }))
    fireEvent.change(screen.getByLabelText('反馈建议'), {
      target: { value: '符合预期' },
    })
    fireEvent.click(screen.getByRole('button', { name: '提交验收结果' }))
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

  it('refreshes the workspace after success without selecting the next item', async () => {
    const first = makePending({ id: 10 })
    const next = makePending({
      id: 11,
      learning_task_id: 200,
      member_id: 2,
      username: 'member2',
    })
    const workspace = vi.spyOn(planningApi, 'getEvidenceReviewWorkspace')
    workspace
      .mockResolvedValueOnce({
        summary: {
          pending_count: 2,
          needs_supplement_count: 0,
          approved_this_month_count: 0,
          average_response_days: null,
        },
        members: [
          { id: first.member_id, username: first.username, pending_count: 1 },
          { id: next.member_id, username: next.username, pending_count: 1 },
        ],
        queue: [first, next],
      } satisfies EvidenceReviewWorkspace)
      .mockResolvedValueOnce({
        summary: {
          pending_count: 1,
          needs_supplement_count: 0,
          approved_this_month_count: 1,
          average_response_days: 1,
        },
        members: [
          { id: next.member_id, username: next.username, pending_count: 1 },
        ],
        queue: [next],
      } satisfies EvidenceReviewWorkspace)
    vi.spyOn(planningApi, 'submitEvidenceReview').mockResolvedValue({
      id: 1,
      evidence_id: first.id,
      version_number: 1,
      status: '已闭环',
      conclusion: '通过',
      feedback: '',
      reviewed_at: '2026-08-24T00:00:00Z',
      created_at: '2026-08-24T00:00:00Z',
    })
    await renderEvidencePage()
    await waitFor(() =>
      expect(screen.getByRole('button', { name: '通过' })).toBeTruthy(),
    )
    fireEvent.click(screen.getByRole('button', { name: '通过' }))
    fireEvent.click(screen.getByRole('button', { name: '提交验收结果' }))
    await waitFor(() => expect(workspace).toHaveBeenCalledTimes(2))
    expect(
      screen.getByText('选择一项待验收成果后查看依据和历史反馈。'),
    ).toBeTruthy()
    expect(screen.queryByText(next.content!)).toBeNull()
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
    await waitFor(() =>
      expect(screen.getByRole('button', { name: '通过' })).toBeTruthy(),
    )
    fireEvent.click(screen.getByRole('button', { name: '通过' }))
    fireEvent.click(screen.getByRole('button', { name: '提交验收结果' }))
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
    const list = vi.mocked(planningApi.getEvidenceReviewWorkspace)
    await waitFor(() =>
      expect(screen.getByRole('button', { name: '通过' })).toBeTruthy(),
    )
    fireEvent.click(screen.getByRole('button', { name: '通过' }))
    fireEvent.click(screen.getByRole('button', { name: '提交验收结果' }))
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
    vi.mocked(planningApi.getEvidenceReviewWorkspace).mockResolvedValueOnce({
      summary: {
        pending_count: 1,
        needs_supplement_count: 0,
        approved_this_month_count: 0,
        average_response_days: null,
      },
      members: [{ id: b.member_id, username: b.username, pending_count: 1 }],
      queue: [b],
    })
    await waitFor(() =>
      expect(screen.getByRole('button', { name: '通过' })).toBeTruthy(),
    )
    fireEvent.click(screen.getByRole('button', { name: '通过' }))
    fireEvent.change(screen.getByLabelText('反馈建议'), {
      target: { value: '符合预期' },
    })
    fireEvent.click(screen.getByRole('button', { name: '提交验收结果' }))
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
    expect(screen.queryByRole('button', { name: '提交验收结果' })).toBeNull()
    expect(submit).toHaveBeenCalledTimes(1)
    // Explicitly choosing B starts with a clean form.
    fireEvent.click(screen.getAllByRole('button', { name: /member2/ })[0])
    await waitFor(() => expect(screen.getByText('第二版实现')).toBeTruthy())
    expect(
      screen.getByRole('button', { name: '通过' }).getAttribute('aria-pressed'),
    ).toBe('false')
    expect(
      (screen.getByLabelText('反馈建议') as HTMLTextAreaElement).value,
    ).toBe('')
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
    await waitFor(() =>
      expect(screen.getByRole('button', { name: '通过' })).toBeTruthy(),
    )
    fireEvent.click(screen.getByRole('button', { name: '通过' }))
    fireEvent.change(screen.getByLabelText('反馈建议'), {
      target: { value: '符合预期' },
    })
    fireEvent.click(screen.getByRole('button', { name: '提交验收结果' }))
    await waitFor(() => {
      expect(
        screen.getByRole('alert').textContent?.includes('请确认后重新提交'),
      ).toBeTruthy()
    })
    // A is still bound: content and form are preserved.
    expect(screen.getByText('完成 P01 实践项目')).toBeTruthy()
    expect(
      screen.getByRole('button', { name: '通过' }).getAttribute('aria-pressed'),
    ).toBe('true')
    expect(
      (screen.getByLabelText('反馈建议') as HTMLTextAreaElement).value,
    ).toBe('符合预期')
    // A fresh idempotency key retries the SAME item; success clears it.
    fireEvent.click(screen.getByRole('button', { name: '提交验收结果' }))
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
    fireEvent.click(screen.getAllByRole('button', { name: /member2/ })[0])
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
    fireEvent.click(screen.getAllByRole('button', { name: /member2/ })[0])
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
      expect(
        screen.getAllByRole('button', { name: /member2/ })[0],
      ).toBeTruthy(),
    )
    fireEvent.click(screen.getAllByRole('button', { name: /member2/ })[0])
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
    expect(screen.getByRole('heading', { name: '成果验收' })).toBeTruthy()
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

  it('getEvidenceReviewWorkspace scopes the queue to the selected member', async () => {
    await planningApi.getEvidenceReviewWorkspace(7)
    expect(fetch).toHaveBeenCalledWith(
      '/api/planning/evidence-reviews/workspace?member_id=7',
      expect.objectContaining({ method: 'GET', credentials: 'include' }),
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

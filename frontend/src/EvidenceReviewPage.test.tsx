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
import type { PendingEvidenceReview } from './planning'

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
    expect(screen.getByText('查看 Evidence 链接')).toBeTruthy()
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
      expect(screen.getByText(/已通过/)).toBeTruthy()
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
        screen.getByRole('alert').textContent?.includes('已被评审'),
      ).toBeTruthy()
    })
    expect(list).toHaveBeenCalledTimes(2)
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

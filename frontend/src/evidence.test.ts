// Client contract tests against the v0010 backend: task transitions with
// expected_revision + idempotency keys, append-only logs (invalidate, no
// delete), evidence drafts with CAS revision and supersedes chain, and
// evidence reviews submitted by evidence_id.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import * as planningApi from './planning'
import type { ApiError } from './shared/api'

function okResponse(payload: unknown) {
  return {
    ok: true,
    status: 200,
    json: () => Promise.resolve(payload),
  }
}

describe('learning task transition contract', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(okResponse({ id: 7, revision: 1 }))),
    )
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('posts to transitions with to_status, reason, expected_revision, key and revised date', async () => {
    await planningApi.transitionLearningTask(7, {
      to_status: '延期',
      reason: '等待资源',
      expected_revision: 3,
      idempotency_key: 'key-1',
      revised_due_date: '2026-08-31',
    })
    expect(fetch).toHaveBeenCalledWith(
      '/api/planning/learning-tasks/7/transitions',
      expect.objectContaining({
        method: 'POST',
        credentials: 'include',
        body: JSON.stringify({
          to_status: '延期',
          reason: '等待资源',
          expected_revision: 3,
          idempotency_key: 'key-1',
          revised_due_date: '2026-08-31',
        }),
      }),
    )
  })

  it('starts a task without a reason but always with expected_revision', async () => {
    await planningApi.transitionLearningTask(7, {
      to_status: '进行中',
      expected_revision: 0,
    })
    expect(fetch).toHaveBeenCalledWith(
      '/api/planning/learning-tasks/7/transitions',
      expect.objectContaining({
        body: JSON.stringify({ to_status: '进行中', expected_revision: 0 }),
      }),
    )
  })

  it('fetches the append-only transition history', async () => {
    await planningApi.listTaskTransitionHistory(7)
    expect(fetch).toHaveBeenCalledWith(
      '/api/planning/learning-tasks/7/transition-history',
      expect.objectContaining({ method: 'GET', credentials: 'include' }),
    )
  })
})

describe('progress log append-only contract', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(okResponse({ id: 1 }))),
    )
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('createProgressLog carries idempotency_key and correction_of_log_id', async () => {
    await planningApi.createProgressLog(7, {
      record_date: '2026-05-10',
      actual_hours: 3,
      note: '更正',
      idempotency_key: 'log-key-1',
      correction_of_log_id: 5,
    })
    expect(fetch).toHaveBeenCalledWith(
      '/api/planning/learning-tasks/7/progress-logs',
      expect.objectContaining({
        method: 'POST',
        credentials: 'include',
        body: JSON.stringify({
          record_date: '2026-05-10',
          actual_hours: 3,
          note: '更正',
          idempotency_key: 'log-key-1',
          correction_of_log_id: 5,
        }),
      }),
    )
  })

  it('invalidateProgressLog voids a log instead of deleting it', async () => {
    await planningApi.invalidateProgressLog(5, 'void-key-1')
    expect(fetch).toHaveBeenCalledWith(
      '/api/planning/progress-logs/5/invalidate',
      expect.objectContaining({
        method: 'POST',
        credentials: 'include',
        body: JSON.stringify({ idempotency_key: 'void-key-1' }),
      }),
    )
  })

  it('no client helper targets a physical log delete', () => {
    expect(
      typeof (planningApi as Record<string, unknown>).deleteProgressLog,
    ).toBe('undefined')
    expect(
      typeof (planningApi as Record<string, unknown>).updateProgressLog,
    ).toBe('undefined')
  })
})

describe('evidence draft contract', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(okResponse({ id: 10, revision: 0 }))),
    )
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('createEvidence posts v0010 draft fields and a superseded version link', async () => {
    await planningApi.createEvidence(7, {
      content: '补充后的实现说明',
      evidence_link: 'https://example.com/v2',
      description: 'v2 补充',
      supersedes_evidence_id: 9,
    })
    expect(fetch).toHaveBeenCalledWith(
      '/api/planning/learning-tasks/7/evidences',
      expect.objectContaining({
        method: 'POST',
        credentials: 'include',
        body: JSON.stringify({
          content: '补充后的实现说明',
          evidence_link: 'https://example.com/v2',
          description: 'v2 补充',
          supersedes_evidence_id: 9,
        }),
      }),
    )
  })

  it('updateEvidence always sends the CAS expected_revision', async () => {
    await planningApi.updateEvidence(10, { content: '修改草稿' }, 1)
    expect(fetch).toHaveBeenCalledWith(
      '/api/planning/evidences/10',
      expect.objectContaining({
        method: 'PUT',
        credentials: 'include',
        body: JSON.stringify({ content: '修改草稿', expected_revision: 1 }),
      }),
    )
  })

  it('submitEvidence posts the member submit endpoint', async () => {
    await planningApi.submitEvidence(10)
    expect(fetch).toHaveBeenCalledWith(
      '/api/planning/evidences/10/submit',
      expect.objectContaining({ method: 'POST', credentials: 'include' }),
    )
  })

  it('listEvidences fetches by task id', async () => {
    await planningApi.listEvidences(7)
    expect(fetch).toHaveBeenCalledWith(
      '/api/planning/learning-tasks/7/evidences',
      expect.objectContaining({ method: 'GET', credentials: 'include' }),
    )
  })
})

describe('evidence review contract', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(okResponse({ id: 1 }))),
    )
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('submits a review by evidence_id with conclusion, feedback and key', async () => {
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

  it('lists the immutable review history for a task', async () => {
    await planningApi.listEvidenceReviewsForTask(7)
    expect(fetch).toHaveBeenCalledWith(
      '/api/planning/learning-tasks/7/evidence-reviews',
      expect.objectContaining({ method: 'GET', credentials: 'include' }),
    )
  })
})

describe('structured error mapping', () => {
  it('maps a 409 envelope to code/field while keeping the message', () => {
    const error: ApiError = Object.assign(new Error('task revision conflict'), {
      status: 409,
      detail: {
        code: 'task_revision_conflict',
        entity_type: 'learning_task',
        entity_id: 7,
        field: 'revision',
        reason: 'task_revision_conflict',
        message: 'learning task revision conflict',
      },
    })
    const mapped = planningApi.parseApiErrorDetail(error)
    expect(mapped).toMatchObject({
      status: 409,
      code: 'task_revision_conflict',
      field: 'revision',
      message: 'learning task revision conflict',
    })
    expect(mapped.isConflict).toBe(true)
  })

  it('maps a 422 completion-gate error to its field', () => {
    const error: ApiError = Object.assign(new Error('gate'), {
      status: 422,
      detail: {
        code: 'completion_gate_failed',
        entity_type: 'learning_task',
        entity_id: 7,
        field: 'actual_hours',
        reason: 'completion_gate_failed',
        message: 'task requires aggregated actual_hours > 0 from valid logs',
      },
    })
    const mapped = planningApi.parseApiErrorDetail(error)
    expect(mapped.code).toBe('completion_gate_failed')
    expect(mapped.field).toBe('actual_hours')
    expect(mapped.isConflict).toBe(false)
  })

  it('maps a plain 403 to a clear permission state', () => {
    const error: ApiError = Object.assign(
      new Error('buddy is not assigned to member'),
      {
        status: 403,
        detail: 'buddy is not assigned to member',
      },
    )
    const mapped = planningApi.parseApiErrorDetail(error)
    expect(mapped.status).toBe(403)
    expect(mapped.code).toBeNull()
    expect(mapped.isConflict).toBe(false)
  })
})

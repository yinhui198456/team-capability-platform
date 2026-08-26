/** Issue #63: Learning-execution-evidence loop — cross-role real-API E2E.

  Covers the chains that previously had only unit/mock coverage:
  - Member: annual plan detail, restricted date editing with expected_revision,
    task six-state transitions, append-only logs + actual_hours aggregation,
    void/correction, Evidence draft → version submit, completion gate.
  - Buddy: independent Evidence Review queue, 需补充/通过, immutable history,
    superseded versions excluded, strict isolation from the retired assessment workflow.
  - Failure paths: 401/403, structured 422, terminal freeze, 409 conflict
    recovery in the UI (input preserved, refresh revision, retry),
    idempotency of logs/transitions/reviews.

  Isolation contract (same as issue-61/62 specs):
  - Each scenario owns a FIXED unique year per attempt (E2E-63-NN →
    YEAR_BASE+NN+40·retry, YEAR_BASE defaults to 2310 and can be shifted via
    E2E63_YEAR_BASE for local reruns on a persistent volume), independent of
    execution order, retries and worker restarts.
  - Writes go through the REAL API (page.request shares the cookie jar of the
    logged-in page); nothing is page-routed away except in the dedicated
    error/loading-state viewport test.
 */

import { expect, test } from '@playwright/test'
import type { APIRequestContext, Page } from '@playwright/test'

import { loginAs } from '../fixtures/auth'

const BACKEND = process.env.PLAYWRIGHT_BACKEND_URL ?? 'http://localhost:18001'

/** Fixed unique year per scenario AND per attempt: a retried test must get a
  fresh fixture, because a stateful shared DB keeps partial writes from the
  failed attempt (issue-62's draft-reuse pattern cannot rewind task states).
  CI always runs on a fresh database; for LOCAL reruns against a persistent
  volume, shift the whole range with E2E63_YEAR_BASE (e.g. 2710). */
const YEAR_BASE = Number(process.env.E2E63_YEAR_BASE ?? 2310)

function yearFor(tag: string, retry: number): number {
  const n = Number(tag.replace('E2E-63-', ''))
  if (!Number.isInteger(n) || n < 1 || n > 40) {
    throw new Error(`unexpected scenario tag: ${tag}`)
  }
  if (!Number.isInteger(retry) || retry < 0 || retry > 5) {
    throw new Error(`unexpected retry: ${retry}`)
  }
  return YEAR_BASE + n + retry * 40
}

/** Today's ISO date — logs reject future dates even for future plan years. */
function todayIso(): string {
  return new Date().toISOString().slice(0, 10)
}

// ── assessment seed helpers (same shapes as issue-62 spec) ──────────────────

interface DraftState {
  id: number
  revision: number
}

async function ensureDraft(
  request: APIRequestContext,
  year: number,
): Promise<DraftState> {
  const previewResp = await request.get(
    `${BACKEND}/api/assessments/scope-preview?year=${year}&assessment_type=年度`,
  )
  if (!previewResp.ok()) {
    throw new Error(`scope-preview failed: ${previewResp.status()}`)
  }
  const preview = await previewResp.json()
  const listResp = await request.get(`${BACKEND}/api/assessments`)
  if (!listResp.ok()) {
    throw new Error(`list assessments failed: ${listResp.status()}`)
  }
  const list = await listResp.json()
  const existing = list.find(
    (a: { year: number; assessment_type: string }) =>
      a.year === year && a.assessment_type === '年度',
  )
  if (existing && existing.status !== '已归档') {
    const getResp = await request.get(
      `${BACKEND}/api/assessments/${existing.id}`,
    )
    const assessment = await getResp.json()
    return { id: assessment.id, revision: assessment.revision }
  }
  const createResp = await request.post(`${BACKEND}/api/assessments`, {
    data: { year, assessment_type: '年度', scope_token: preview.scope_token },
  })
  if (!createResp.ok()) {
    throw new Error(`create assessment failed: ${createResp.status()}`)
  }
  const created = await createResp.json()
  return { id: created.id, revision: 1 }
}

interface ScopeSnapshot {
  l3_code: string
  l3_node_id: number | null
  standard_target_applicable: boolean
  target_level?: number | null
}

/** Fill one plan-bound draft detail, then explicitly generate its task. */
async function fillDraftAndGenerate(
  request: APIRequestContext,
  draft: DraftState,
): Promise<{ l3Code: string }> {
  const getResp = await request.get(`${BACKEND}/api/assessments/${draft.id}`)
  const assessment = await getResp.json()
  const applicable = assessment.details.filter(
    (d: ScopeSnapshot) => d.standard_target_applicable === true,
  )
  if (applicable.length === 0) {
    throw new Error('scope has no applicable details')
  }
  const picked = applicable[0]
  const target = picked.target_level ?? 4
  const payload = assessment.details.map((snapshot: ScopeSnapshot) => {
    const isPicked = snapshot.l3_code === picked.l3_code
    return {
      l3_code: snapshot.l3_code,
      l3_node_id: snapshot.l3_node_id,
      current_level:
        snapshot.standard_target_applicable === true
          ? isPicked
            ? Math.max(0, target - 1)
            : 3
          : null,
      ...(isPicked
        ? {
            member_priority: '高',
            include_in_plan: true,
            plan_month: `${assessment.year}-05`,
          }
        : {}),
    }
  })
  const saveResp = await request.put(
    `${BACKEND}/api/assessments/${draft.id}/draft`,
    { data: { details: payload, expected_revision: draft.revision } },
  )
  if (!saveResp.ok()) {
    throw new Error(
      `save draft failed: ${saveResp.status()} ${await saveResp.text()}`,
    )
  }
  const saved = await saveResp.json()
  const generateResp = await request.post(
    `${BACKEND}/api/assessments/${draft.id}/generate-plan-items`,
    {
      data: {
        l3_codes: [picked.l3_code],
        expected_revision: saved.revision,
      },
      headers: {
        'Idempotency-Key': `e2e-63-generate-${draft.id}-${picked.l3_code}`,
      },
    },
  )
  if (!generateResp.ok()) {
    throw new Error(
      `generate failed: ${generateResp.status()} ${await generateResp.text()}`,
    )
  }
  return { l3Code: picked.l3_code }
}

interface SeedResult {
  l3Code: string
  itemId: number
  itemRevision: number
  taskId: number
  taskRevision: number
}

/** member-login → draft → explicit generation → plan/item/task ids for `year`. */
async function seedExecution(page: Page, year: number): Promise<SeedResult> {
  const request = page.request
  await loginAs(page, 'member')
  const draft = await ensureDraft(request, year)
  const { l3Code } = await fillDraftAndGenerate(request, draft)
  const planResp = await request.get(
    `${BACKEND}/api/planning/annual-plan?year=${year}`,
  )
  if (!planResp.ok()) {
    throw new Error(`annual-plan failed: ${planResp.status()}`)
  }
  const plan = await planResp.json()
  const item = plan.items.find(
    (candidate: { l3_code: string }) => candidate.l3_code === l3Code,
  )
  if (!item) {
    throw new Error(`plan item ${l3Code} not found`)
  }
  const tasksResp = await request.get(`${BACKEND}/api/planning/learning-tasks`)
  const tasks = await tasksResp.json()
  const task = tasks.find(
    (candidate: { plan_item_id: number }) => candidate.plan_item_id === item.id,
  )
  if (!task) {
    throw new Error(`learning task for item ${item.id} not found`)
  }
  return {
    l3Code,
    itemId: item.id,
    itemRevision: item.revision,
    taskId: task.id,
    taskRevision: task.revision,
  }
}

async function transitionTask(
  request: APIRequestContext,
  taskId: number,
  toStatus: string,
  extra: Record<string, unknown> = {},
): Promise<{ status: number; body: Record<string, unknown> | null }> {
  const resp = await request.post(
    `${BACKEND}/api/planning/learning-tasks/${taskId}/transitions`,
    { data: { to_status: toStatus, ...extra } },
  )
  let body: Record<string, unknown> | null = null
  try {
    body = await resp.json()
  } catch {
    body = null
  }
  return { status: resp.status(), body }
}

const STRANGER_BUDDY = { username: 'e2e63_buddy_ro', password: '123456' }

/** Create (idempotently) a Buddy user with no member relationships. */
async function ensureStrangerBuddy(page: Page): Promise<void> {
  await loginAs(page, 'admin')
  const createResp = await page.request.post(`${BACKEND}/api/system/users`, {
    data: {
      username: STRANGER_BUDDY.username,
      full_name: 'E2E63 Stranger Buddy',
      password: STRANGER_BUDDY.password,
      is_active: true,
      roles: ['Buddy'],
      current_level: null,
      target_level: null,
    },
  })
  // 201 on first run, 422 (already exists) on retries — both acceptable
  expect([200, 201, 422]).toContain(createResp.status())
}

async function createEvidence(
  request: APIRequestContext,
  taskId: number,
  marker: string,
  supersedeId?: number,
): Promise<{ id: number; revision: number; version_number: number }> {
  const resp = await request.post(
    `${BACKEND}/api/planning/learning-tasks/${taskId}/evidences`,
    {
      data: {
        content: `E2E-63 evidence ${marker}`,
        description: `描述 ${marker}`,
        evidence_type: 'link',
        url: `https://example.com/${marker}`,
        evidence_link: `https://example.com/${marker}`,
        ...(supersedeId ? { supersedes_evidence_id: supersedeId } : {}),
      },
    },
  )
  if (!resp.ok()) {
    throw new Error(
      `create evidence failed: ${resp.status()} ${await resp.text()}`,
    )
  }
  return resp.json()
}

async function submitEvidence(
  request: APIRequestContext,
  evidenceId: number,
): Promise<void> {
  const resp = await request.post(
    `${BACKEND}/api/planning/evidences/${evidenceId}/submit`,
  )
  if (!resp.ok()) {
    throw new Error(
      `submit evidence failed: ${resp.status()} ${await resp.text()}`,
    )
  }
}

/** Select this scenario's queue entry by its unique evidence content marker. */
async function selectQueueItemByMarker(
  page: Page,
  marker: string,
): Promise<void> {
  const candidates = page.locator('.evidence-review-queue button')
  // after goto/reload the queue fetch is still in flight — wait for the
  // list to render before counting, otherwise count() is 0 and the loop
  // exits immediately
  await candidates.first().waitFor({ timeout: 15_000 })
  const count = await candidates.count()
  for (let i = 0; i < count; i += 1) {
    await candidates.nth(i).click()
    // the workspace re-renders asynchronously after each selection — poll
    // instead of reading textContent synchronously
    try {
      await expect(page.locator('.evidence-content')).toContainText(marker, {
        timeout: 2_000,
      })
      return
    } catch {
      // not this candidate — try the next one
    }
  }
  throw new Error(`queue item with marker ${marker} not found`)
}

// ── E2E-63-01: member execution chain ────────────────────────────────────────

test('E2E-63-01 Member 执行链：日期约束、六态迁移、日志聚合与作废更正、Evidence 提交与完成门禁', async ({
  page,
}, testInfo) => {
  test.setTimeout(120_000)
  const request = page.request
  const year = yearFor('E2E-63-01', testInfo.retry)
  const seed = await seedExecution(page, year)

  // ── retired date UI is no longer part of M03; retain API constraints ──
  const outsideMonth = await request.put(
    `${BACKEND}/api/planning/plan-items/${seed.itemId}`,
    {
      data: {
        plan_start_date: `${year}-04-15`,
        plan_end_date: `${year}-06-15`,
        expected_revision: seed.itemRevision,
      },
    },
  )
  expect(outsideMonth.status()).toBe(422)
  const outsideQuarter = await request.put(
    `${BACKEND}/api/planning/plan-items/${seed.itemId}`,
    {
      data: {
        plan_start_date: `${year}-03-31`,
        plan_end_date: `${year}-05-20`,
        expected_revision: seed.itemRevision,
      },
    },
  )
  expect(outsideQuarter.status()).toBe(422)
  const legalEdit = await request.put(
    `${BACKEND}/api/planning/plan-items/${seed.itemId}`,
    {
      data: {
        plan_start_date: `${year}-04-15`,
        plan_end_date: `${year}-05-20`,
        expected_revision: seed.itemRevision,
      },
    },
  )
  expect(legalEdit.status()).toBe(200)
  const planAfterEdit = await (
    await request.get(`${BACKEND}/api/planning/annual-plan?year=${year}`)
  ).json()
  const edited = planAfterEdit.items.find(
    (candidate: { id: number }) => candidate.id === seed.itemId,
  )
  expect(edited.plan_start_date).toBe(`${year}-04-15`)
  expect(edited.plan_end_date).toBe(`${year}-05-20`)
  expect(edited.revision).toBe(seed.itemRevision + 1)

  // ── six-state transitions: 未开始 → 进行中, invalid targets rejected ──
  const badTransition = await transitionTask(request, seed.taskId, '已完成')
  expect(badTransition.status).toBe(422)
  const started = await transitionTask(request, seed.taskId, '进行中')
  expect(started.status).toBe(200)
  // terminal states and unknown targets stay rejected with structured 422
  const unknown = await transitionTask(request, seed.taskId, '待开始')
  expect(unknown.status).toBe(422)

  // ── append-only logs: aggregation, invalidate, correction ──
  const log1Resp = await request.post(
    `${BACKEND}/api/planning/learning-tasks/${seed.taskId}/progress-logs`,
    {
      data: {
        record_date: todayIso(),
        actual_hours: 2,
        note: 'E2E-63-01 第一段',
      },
    },
  )
  expect(log1Resp.status()).toBe(200)
  const log1 = await log1Resp.json()
  const log2Resp = await request.post(
    `${BACKEND}/api/planning/learning-tasks/${seed.taskId}/progress-logs`,
    {
      data: {
        record_date: todayIso(),
        actual_hours: 3,
        note: 'E2E-63-01 第二段',
      },
    },
  )
  expect(log2Resp.status()).toBe(200)
  let taskRow = await (
    await request.get(`${BACKEND}/api/planning/learning-tasks/${seed.taskId}`)
  ).json()
  expect(Number(taskRow.actual_hours)).toBe(5)
  // void log1, then post its correction with fewer hours
  const voidResp = await request.post(
    `${BACKEND}/api/planning/progress-logs/${log1.id}/invalidate`,
    { data: {} },
  )
  expect(voidResp.status()).toBe(200)
  const correctionResp = await request.post(
    `${BACKEND}/api/planning/learning-tasks/${seed.taskId}/progress-logs`,
    {
      data: {
        record_date: todayIso(),
        actual_hours: 1,
        note: 'E2E-63-01 更正第一段',
        correction_of_log_id: log1.id,
      },
    },
  )
  expect(correctionResp.status()).toBe(200)
  taskRow = await (
    await request.get(`${BACKEND}/api/planning/learning-tasks/${seed.taskId}`)
  ).json()
  expect(Number(taskRow.actual_hours)).toBe(4)
  // voided entry stays in the append-only history
  const logs = await (
    await request.get(
      `${BACKEND}/api/planning/learning-tasks/${seed.taskId}/progress-logs`,
    )
  ).json()
  const voided = logs.find((entry: { id: number }) => entry.id === log1.id)
  expect(voided.invalidated_at).toBeTruthy()

  // ── evidence draft → CAS update → submit; completion gate stays closed ──
  const evidence = await createEvidence(request, seed.taskId, 'E2E-63-01-v1')
  expect(evidence.version_number).toBe(1)
  const putResp = await request.put(
    `${BACKEND}/api/planning/evidences/${evidence.id}`,
    {
      data: {
        content: 'E2E-63-01-v1 updated',
        expected_revision: evidence.revision,
      },
    },
  )
  expect(putResp.status()).toBe(200)
  // stale revision is a structured 409, never a silent success
  const staleResp = await request.put(
    `${BACKEND}/api/planning/evidences/${evidence.id}`,
    {
      data: {
        content: 'stale write',
        expected_revision: evidence.revision,
      },
    },
  )
  expect(staleResp.status()).toBe(409)
  await submitEvidence(request, evidence.id)

  // completion gate: all fields set + hours logged, but no approved evidence
  const fieldsResp = await request.put(
    `${BACKEND}/api/planning/learning-tasks/${seed.taskId}`,
    {
      data: {
        review_conclusion: 'E2E-63-01 复盘结论',
        completion_quality: '达到预期',
        next_action: 'E2E-63-01 下一步',
        expected_revision: taskRow.revision,
      },
    },
  )
  expect(fieldsResp.status()).toBe(200)
  const gated = await transitionTask(request, seed.taskId, '已完成')
  expect(gated.status).toBe(422)
  expect(
    (gated.body as { detail?: { code?: string } } | null)?.detail?.code,
  ).toBeTruthy()
})

// ── E2E-63-02: buddy evidence review loop ────────────────────────────────────

test('E2E-63-02 Buddy Evidence Review 真实闭环：需补充 → 新版本 → 通过 → 历史不可变与完成解锁', async ({
  page,
}, testInfo) => {
  test.setTimeout(120_000)
  const request = page.request
  const year = yearFor('E2E-63-02', testInfo.retry)
  const seed = await seedExecution(page, year)
  const started = await transitionTask(request, seed.taskId, '进行中')
  expect(started.status).toBe(200)
  // markers carry the attempt's year: leftover queue entries from earlier
  // local runs on the persistent volume are textually identical otherwise
  // and the selector could pick a stale year instead of this attempt's
  const v1Marker = `E2E-63-02-v1-${year}`
  const v2Marker = `E2E-63-02-v2-${year}`
  const v1 = await createEvidence(request, seed.taskId, v1Marker)
  await submitEvidence(request, v1.id)

  // ── buddy queue shows the pending version; 需补充 requires feedback ──
  await loginAs(page, 'buddy')
  await page.goto('/mentoring/evidence-review')
  await expect(page.getByRole('heading', { name: '成果验收' })).toBeVisible()
  await selectQueueItemByMarker(page, v1Marker)
  await page.getByRole('button', { name: '需补充' }).click()
  // client gate: empty feedback blocked before any request
  await page.getByRole('button', { name: '提交验收结果' }).click()
  await expect(page.getByRole('alert')).toContainText('需补充必须填写反馈')
  await page.getByLabel('反馈建议').fill('E2E-63-02 请补充口径说明')
  await page.getByRole('button', { name: '提交验收结果' }).click()
  await expect(page.getByText('已要求补充，等待成员提交新版本。')).toBeVisible()

  // ── member submits v2 superseding v1; queue shows only the current version ──
  await loginAs(page, 'member')
  const v1Row = await (
    await request.get(`${BACKEND}/api/planning/evidences/${v1.id}`)
  ).json()
  expect(v1Row.status).toBe('需补充')
  const v2 = await createEvidence(request, seed.taskId, v2Marker, v1.id)
  expect(v2.version_number).toBe(2)
  await submitEvidence(request, v2.id)
  await loginAs(page, 'buddy')
  const buddyPending = await (
    await request.get(`${BACKEND}/api/planning/evidence-reviews/pending`)
  ).json()
  const pendingIds = buddyPending.map((entry: { id: number }) => entry.id)
  expect(pendingIds).toContain(v2.id)
  expect(pendingIds).not.toContain(v1.id)

  // same-URL goto does not remount the page: force a real reload so the
  // queue effect refetches and sees v2
  await page.goto('/mentoring/evidence-review')
  await page.reload()
  await selectQueueItemByMarker(page, v2Marker)
  // dual-role buddy accounts load the review history through the buddy path:
  // v1's 需补充 feedback is visible (regression: member-path 403 hid it)
  await expect(page.getByText(/请补充口径说明/).first()).toBeVisible()
  await page.getByRole('button', { name: '通过' }).click()
  await page.getByLabel('反馈建议').fill('E2E-63-02 第二版通过')
  await page.getByRole('button', { name: '提交验收结果' }).click()
  await expect(page.getByText(/已通过/).first()).toBeVisible()

  // immutable history: both reviews recorded, second review attempt → 409
  const reviews = await (
    await request.get(
      `${BACKEND}/api/planning/learning-tasks/${seed.taskId}/evidence-reviews`,
    )
  ).json()
  const ours = reviews.filter(
    (entry: { evidence_id: number }) =>
      entry.evidence_id === v1.id || entry.evidence_id === v2.id,
  )
  expect(ours).toHaveLength(2)
  const conclusions = ours
    .map((entry: { conclusion: string }) => entry.conclusion)
    .sort()
  expect(conclusions).toEqual(['通过', '需补充'].sort())
  const secondReview = await request.post(
    `${BACKEND}/api/planning/evidences/${v2.id}/review`,
    { data: { conclusion: '需补充', feedback: '重复评审' } },
  )
  expect(secondReview.status()).toBe(409)

  // ── gate unlocked: completion fields + approved evidence → 已完成; then frozen ──
  await loginAs(page, 'member')
  let taskRow = await (
    await request.get(`${BACKEND}/api/planning/learning-tasks/${seed.taskId}`)
  ).json()
  const logResp = await request.post(
    `${BACKEND}/api/planning/learning-tasks/${seed.taskId}/progress-logs`,
    {
      data: {
        record_date: todayIso(),
        actual_hours: 2,
        note: 'E2E-63-02 工时',
      },
    },
  )
  expect(logResp.status()).toBe(200)
  const fieldsResp = await request.put(
    `${BACKEND}/api/planning/learning-tasks/${seed.taskId}`,
    {
      data: {
        review_conclusion: 'E2E-63-02 复盘结论',
        completion_quality: '超出预期',
        next_action: 'E2E-63-02 下一步',
        expected_revision: taskRow.revision,
      },
    },
  )
  expect(fieldsResp.status()).toBe(200)
  const completed = await transitionTask(request, seed.taskId, '已完成')
  expect(completed.status).toBe(200)

  // terminal freeze: no further transitions, approved evidence immutable
  const frozen = await transitionTask(request, seed.taskId, '取消', {
    reason: 'E2E-63-02 不应生效',
  })
  expect(frozen.status).toBe(422)
  const approvedRow = await (
    await request.get(`${BACKEND}/api/planning/evidences/${v2.id}`)
  ).json()
  const putApproved = await request.put(
    `${BACKEND}/api/planning/evidences/${v2.id}`,
    {
      data: {
        content: 'tamper',
        expected_revision: approvedRow.revision,
      },
    },
  )
  expect(putApproved.status()).toBe(422)
  taskRow = await (
    await request.get(`${BACKEND}/api/planning/learning-tasks/${seed.taskId}`)
  ).json()
  expect(taskRow.status).toBe('已完成')
})

// ── E2E-63-03: authn/authz failure paths ─────────────────────────────────────

test('E2E-63-03 权限边界：401/403、非当前 Buddy 拒审、角色路由隔离', async ({
  page,
}, testInfo) => {
  test.setTimeout(120_000)
  const request = page.request
  const year = yearFor('E2E-63-03', testInfo.retry)
  const seed = await seedExecution(page, year)
  const started = await transitionTask(request, seed.taskId, '进行中')
  expect(started.status).toBe(200)
  const evidence = await createEvidence(request, seed.taskId, 'E2E-63-03-v1')
  await submitEvidence(request, evidence.id)

  // member (not a Buddy) cannot review evidence
  const memberReview = await request.post(
    `${BACKEND}/api/planning/evidences/${evidence.id}/review`,
    { data: { conclusion: '通过' } },
  )
  expect(memberReview.status()).toBe(403)

  // a Buddy with no relationship to this member cannot review either
  await ensureStrangerBuddy(page)
  const strangerLogin = await request.post(`${BACKEND}/api/auth/login`, {
    data: STRANGER_BUDDY,
  })
  expect(strangerLogin.status()).toBe(200)
  const strangerPending = await request.get(
    `${BACKEND}/api/planning/evidence-reviews/pending`,
  )
  expect(strangerPending.status()).toBe(200)
  expect(await strangerPending.json()).toEqual([])
  const strangerReview = await request.post(
    `${BACKEND}/api/planning/evidences/${evidence.id}/review`,
    { data: { conclusion: '通过' } },
  )
  expect(strangerReview.status()).toBe(403)

  // role route isolation: member is redirected away from the buddy page
  await loginAs(page, 'member')
  await page.goto('/mentoring/evidence-review')
  await page.waitForURL((url) => url.pathname === '/dashboard/member')

  // unauthenticated: API 401 and UI redirects to login
  await page.request.post('/api/auth/logout')
  const anon = await request.get(
    `${BACKEND}/api/planning/evidence-reviews/pending`,
  )
  expect(anon.status()).toBe(401)
  await page.goto('/growth/annual-plan')
  await page.waitForURL((url) => url.pathname === '/login')
})

// ── E2E-63-04: 409 conflict recovery + idempotency ───────────────────────────

test('E2E-63-04 409 CAS 恢复与日志、迁移幂等', async ({ page }, testInfo) => {
  test.setTimeout(120_000)
  const request = page.request
  const year = yearFor('E2E-63-04', testInfo.retry)
  const seed = await seedExecution(page, year)

  // M03/M04/M05 no longer offer plan-date editing; retain real API CAS.
  const bump = await request.put(
    `${BACKEND}/api/planning/plan-items/${seed.itemId}`,
    {
      data: {
        plan_start_date: `${year}-04-01`,
        plan_end_date: `${year}-05-31`,
        expected_revision: seed.itemRevision,
      },
    },
  )
  expect(bump.status()).toBe(200)
  const stale = await request.put(
    `${BACKEND}/api/planning/plan-items/${seed.itemId}`,
    {
      data: {
        plan_start_date: `${year}-04-10`,
        plan_end_date: `${year}-05-20`,
        expected_revision: seed.itemRevision,
      },
    },
  )
  expect(stale.status()).toBe(409)
  const bumped = await bump.json()
  const retry = await request.put(
    `${BACKEND}/api/planning/plan-items/${seed.itemId}`,
    {
      data: {
        plan_start_date: `${year}-04-10`,
        plan_end_date: `${year}-05-20`,
        expected_revision: bumped.revision,
      },
    },
  )
  expect(retry.status()).toBe(200)
  const planRow = await (
    await request.get(`${BACKEND}/api/planning/annual-plan?year=${year}`)
  ).json()
  const item = planRow.items.find(
    (candidate: { id: number }) => candidate.id === seed.itemId,
  )
  expect(item.plan_start_date).toBe(`${year}-04-10`)
  expect(item.plan_end_date).toBe(`${year}-05-20`)
  expect(item.revision).toBe(seed.itemRevision + 2)

  // idempotent log writes: same key retried after a lost response writes once
  const started = await transitionTask(request, seed.taskId, '进行中')
  expect(started.status).toBe(200)
  const logKey = `e2e-63-04-log-${year}`
  const first = await request.post(
    `${BACKEND}/api/planning/learning-tasks/${seed.taskId}/progress-logs`,
    {
      data: {
        record_date: todayIso(),
        actual_hours: 2,
        note: 'E2E-63-04 幂等日志',
        idempotency_key: logKey,
      },
    },
  )
  expect(first.status()).toBe(200)
  const replay = await request.post(
    `${BACKEND}/api/planning/learning-tasks/${seed.taskId}/progress-logs`,
    {
      data: {
        record_date: todayIso(),
        actual_hours: 2,
        note: 'E2E-63-04 幂等日志',
        idempotency_key: logKey,
      },
    },
  )
  expect(replay.status()).toBe(200)
  const logs = await (
    await request.get(
      `${BACKEND}/api/planning/learning-tasks/${seed.taskId}/progress-logs`,
    )
  ).json()
  const keyed = logs.filter(
    (entry: { idempotency_key: string | null }) =>
      entry.idempotency_key === logKey,
  )
  expect(keyed).toHaveLength(1)
  const taskRow = await (
    await request.get(`${BACKEND}/api/planning/learning-tasks/${seed.taskId}`)
  ).json()
  expect(Number(taskRow.actual_hours)).toBe(2)

  // idempotent transition: same key replayed does not duplicate history
  const pauseKey = `e2e-63-04-pause-${year}`
  const pause1 = await transitionTask(request, seed.taskId, '暂停', {
    reason: 'E2E-63-04 暂停',
    idempotency_key: pauseKey,
  })
  expect(pause1.status).toBe(200)
  const pause2 = await transitionTask(request, seed.taskId, '暂停', {
    reason: 'E2E-63-04 暂停',
    idempotency_key: pauseKey,
  })
  expect(pause2.status).toBe(200)
  const history = await (
    await request.get(
      `${BACKEND}/api/planning/learning-tasks/${seed.taskId}/transition-history`,
    )
  ).json()
  const pauses = history.filter(
    (entry: { to_status: string }) => entry.to_status === '暂停',
  )
  expect(pauses).toHaveLength(1)
})

// ── E2E-63-05: three viewports, semantic checks + empty/error states ─────────

test('E2E-63-05 三视口：Member 计划页与 Buddy 验收页无横向溢出、空态与错误态可见', async ({
  page,
}, testInfo) => {
  test.setTimeout(120_000)
  const year = yearFor('E2E-63-05', testInfo.retry)
  const seed = await seedExecution(page, year)

  const viewports = [
    { width: 1440, height: 900 },
    { width: 1024, height: 768 },
    { width: 768, height: 900 },
  ]

  const expectNoHorizontalOverflow = async () => {
    const overflow = await page.evaluate(
      () =>
        document.documentElement.scrollWidth -
        document.documentElement.clientWidth,
    )
    expect(overflow).toBeLessThanOrEqual(1)
  }

  await loginAs(page, 'member')
  for (const viewport of viewports) {
    await page.setViewportSize(viewport)
    await page.goto(`/growth/annual-plan?year=${year}&month=5`)
    await expect(
      page.getByRole('heading', { name: '月度计划时间轴' }),
    ).toBeVisible()
    await expect(page.getByText(seed.l3Code).first()).toBeVisible()
    await expectNoHorizontalOverflow()
    // CTA-A-v1: bind the M04 filter entry to this exact M03 year/month card;
    // never follow a task-specific link that would add task_id.
    const mayTimelineRow = page.locator('.growth-timeline-row', {
      has: page.getByRole('button', { name: `${year}年05月`, exact: true }),
    })
    await mayTimelineRow
      .locator('#growth-month-5')
      .getByRole('link', { name: '查看本月任务', exact: true })
      .click()
    await expect(page).toHaveURL(
      new RegExp(`/growth/tasks\\?year=${year}&month=5$`),
    )
    await expect(page.getByRole('heading', { name: '学习任务' })).toBeVisible()
    await expect(page.getByText(seed.l3Code).first()).toBeVisible()
    await expectNoHorizontalOverflow()
  }

  await loginAs(page, 'buddy')
  for (const viewport of viewports) {
    await page.setViewportSize(viewport)
    await page.goto('/mentoring/evidence-review')
    await expect(page.getByRole('heading', { name: '成果验收' })).toBeVisible()
    await expect(page.getByLabel('验收工作区')).toBeVisible()
    await expectNoHorizontalOverflow()
  }

  // real empty state: a buddy without any relationship sees an empty queue
  await ensureStrangerBuddy(page)
  await page.request.post('/api/auth/logout')
  await page.goto('/login')
  await page.getByLabel('用户名').fill(STRANGER_BUDDY.username)
  await page.getByLabel('密码').fill(STRANGER_BUDDY.password)
  await page.getByRole('button', { name: '登录' }).click()
  await page.waitForURL((url) => url.pathname === '/mentoring/evidence-review')
  await page.setViewportSize(viewports[0])
  await expect(page.locator('.evidence-review-queue button')).toHaveCount(0)
  await expectNoHorizontalOverflow()

  // error state: a failed queue load surfaces an alert, not a silent blank
  await loginAs(page, 'buddy')
  await page.route('**/api/planning/evidence-reviews/workspace', (route) =>
    route.fulfill({ status: 500, body: 'boom' }),
  )
  await page.goto('/mentoring/evidence-review')
  await expect(page.getByRole('alert')).toBeVisible()
  await page.unroute('**/api/planning/evidence-reviews/workspace')

  // loading state is visible while the queue request is in flight
  await page.route(
    '**/api/planning/evidence-reviews/workspace',
    async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 800))
      await route.continue()
    },
  )
  await page.goto('/mentoring/evidence-review')
  await expect(page.getByText('加载中…')).toBeVisible()
  await expect(page.getByRole('heading', { name: '成果验收' })).toBeVisible()
})

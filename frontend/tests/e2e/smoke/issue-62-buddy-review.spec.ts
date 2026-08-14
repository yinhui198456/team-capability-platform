/** Issue #62: Buddy Review atomic plan generation — E2E scenarios.

  Isolation contract (same as issue-61 spec):
  - Each scenario owns a FIXED unique year (E2E-62-NN → 2260+NN), independent
    of execution order, retries and worker restarts.
  - Drafts are looked up by the exact business key (member, year, '年度') and
    reused with their real revision instead of blindly re-created.
  - Scenarios run through the REAL API (request fixture) and verify the UI for
    the Buddy workspace; nothing is page-routed away.
 */

import { expect, test } from '@playwright/test'

import { loginAs } from '../fixtures/auth'

const BACKEND = process.env.PLAYWRIGHT_BACKEND_URL ?? 'http://localhost:18001'

type ApiRequest = Parameters<Parameters<typeof test>[1]>[0]['page']['request']

function yearFor(tag: string): number {
  const n = Number(tag.replace('E2E-62-', ''))
  if (!Number.isInteger(n) || n < 1 || n > 40) {
    throw new Error(`unexpected scenario tag: ${tag}`)
  }
  return 2260 + n
}

interface DraftState {
  id: number
  revision: number
}

async function ensureDraft(
  page: Parameters<Parameters<typeof test>[1]>[0]['page'],
  request: ApiRequest,
  year: number,
  member: string,
  assessmentType = '年度',
): Promise<DraftState> {
  const previewResp = await request.get(
    `${BACKEND}/api/assessments/scope-preview?year=${year}&assessment_type=${assessmentType}`,
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
    (a: { member_id: number; year: number; assessment_type: string }) =>
      a.year === year && a.assessment_type === assessmentType,
  )
  if (existing && existing.status !== '已归档') {
    const getResp = await request.get(
      `${BACKEND}/api/assessments/${existing.id}`,
    )
    const assessment = await getResp.json()
    return { id: assessment.id, revision: assessment.revision }
  }
  const createResp = await request.post(`${BACKEND}/api/assessments`, {
    data: {
      year,
      assessment_type: assessmentType,
      scope_token: preview.scope_token,
    },
  })
  if (!createResp.ok()) {
    throw new Error(`create assessment failed: ${createResp.status()}`)
  }
  const created = await createResp.json()
  return { id: created.id, revision: 1 }
}

interface DesiredDetail {
  l3_code: string
  current_level: number | null
  target_level: number | null
  member_priority?: string | null
  include_in_plan?: boolean | null
  plan_quarter?: string | null
  plan_month?: number | null
}

/** Pick the first N applicable details from the real assessment scope. */
interface ScopeSnapshot {
  l3_code: string
  l3_node_id: number | null
  standard_target_applicable: boolean
}

async function pickApplicableDetails(
  assessment: { details: ScopeSnapshot[] },
  count: number,
): Promise<Array<{ l3_code: string; l3_node_id: number | null }>> {
  const applicable = assessment.details.filter(
    (d) => d.standard_target_applicable === true,
  )
  if (applicable.length < count) {
    throw new Error(
      `scope has only ${applicable.length} applicable details, need ${count}`,
    )
  }
  return applicable
    .slice(0, count)
    .map((d) => ({ l3_code: d.l3_code, l3_node_id: d.l3_node_id }))
}

async function fillDetails(
  page: Parameters<Parameters<typeof test>[1]>[0]['page'],

  request: ApiRequest,
  draft: DraftState,
  details: DesiredDetail[],
): Promise<number> {
  const getResp = await request.get(`${BACKEND}/api/assessments/${draft.id}`)
  const assessment = await getResp.json()
  const desired = new Map(details.map((d) => [d.l3_code, d]))
  const payload = assessment.details.map((snapshot: ScopeSnapshot) => {
    const wanted = desired.get(snapshot.l3_code)
    if (!wanted) {
      return {
        l3_code: snapshot.l3_code,
        l3_node_id: snapshot.l3_node_id,
        current_level: snapshot.standard_target_applicable === true ? 3 : null,
      }
    }
    return {
      l3_code: wanted.l3_code,
      l3_node_id: snapshot.l3_node_id,
      current_level: wanted.current_level,
      member_priority: wanted.member_priority ?? null,
      include_in_plan: wanted.include_in_plan ?? null,
      plan_quarter: wanted.plan_quarter ?? null,
      plan_month: wanted.plan_month ?? null,
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
  const submitResp = await request.post(
    `${BACKEND}/api/assessments/${draft.id}/submit`,
    { data: { expected_revision: saved.revision } },
  )
  if (!submitResp.ok()) {
    throw new Error(
      `submit failed: ${submitResp.status()} ${await submitResp.text()}`,
    )
  }
  const submitted = await submitResp.json()
  return submitted.revision
}

/** Issue #178 member-driven flow: fill ONLY the picked rows (others cleared
 *  to unassessed NULL) and save WITHOUT submitting — no review is created. */
async function fillSelectionOnly(
  page: Parameters<Parameters<typeof test>[1]>[0]['page'],

  request: ApiRequest,
  draft: DraftState,
  picks: Array<{
    current_level: number
    target_level: number
    member_priority: string
    include_in_plan: boolean
    plan_quarter?: string
    plan_month?: number
  }>,
): Promise<PickedDetail[]> {
  const getResp = await request.get(`${BACKEND}/api/assessments/${draft.id}`)
  const assessment = await getResp.json()
  const picked = await pickApplicableDetails(assessment, picks.length)
  const details = assessment.details.map((snapshot: ScopeSnapshot) => {
    const index = picked.findIndex(
      (detail) => detail.l3_code === snapshot.l3_code,
    )
    if (index === -1) {
      return {
        l3_code: snapshot.l3_code,
        l3_node_id: snapshot.l3_node_id,
        current_level: null,
      }
    }
    const pick = picks[index]
    // Derive a current level that guarantees a positive gap against the
    // frozen scope target, so the plan choice is not auto-cleared.
    const target = snapshot.target_level ?? pick.target_level
    const currentLevel = Math.min(pick.current_level, Math.max(0, target - 1))
    return {
      l3_code: snapshot.l3_code,
      l3_node_id: snapshot.l3_node_id,
      current_level: currentLevel,
      member_priority: pick.member_priority,
      include_in_plan: pick.include_in_plan,
      plan_quarter: pick.plan_quarter ?? null,
      plan_month: pick.plan_month ?? null,
    }
  })
  const saveResp = await request.put(
    `${BACKEND}/api/assessments/${draft.id}/draft`,
    { data: { details, expected_revision: draft.revision } },
  )
  if (!saveResp.ok()) {
    throw new Error(
      `save draft failed: ${saveResp.status()} ${await saveResp.text()}`,
    )
  }
  return picked
}

async function pendingReviewId(
  page: Parameters<Parameters<typeof test>[1]>[0]['page'],

  request: ApiRequest,
  assessmentId: number,
): Promise<number> {
  const resp = await request.get(`${BACKEND}/api/assessments/reviews/pending`)
  if (!resp.ok()) {
    throw new Error(`pending reviews failed: ${resp.status()}`)
  }
  const pending = await resp.json()
  const review = pending.find(
    (r: { assessment_id: number }) => r.assessment_id === assessmentId,
  )
  if (!review) {
    throw new Error(`no pending review for assessment ${assessmentId}`)
  }
  return review.id
}

interface ReviewResult {
  status: number
  body: Record<string, unknown> | null
}

async function submitReview(
  page: Parameters<Parameters<typeof test>[1]>[0]['page'],

  request: ApiRequest,
  assessmentId: number,
  reviewId: number,
  payload: {
    conclusion: '认可' | '建议调整'
    feedback?: string
    expected_revision: number
  },
  idempotencyKey?: string,
): Promise<ReviewResult> {
  const resp = await request.post(
    `${BACKEND}/api/assessments/${assessmentId}/reviews/${reviewId}`,
    {
      data: payload,
      headers: idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {},
    },
  )
  let body: Record<string, unknown> | null = null
  try {
    body = await resp.json()
  } catch {
    body = null
  }
  return { status: resp.status(), body }
}

interface PickedDetail {
  l3_code: string
  l3_node_id: number | null
}

/** Pick applicable details for a draft and build member decisions. */
async function pickAndFill(
  page: Parameters<Parameters<typeof test>[1]>[0]['page'],

  request: ApiRequest,
  draft: DraftState,
  picks: Array<{
    current_level: number
    target_level: number
    member_priority: string
    include_in_plan: boolean
    plan_quarter?: string
    plan_month?: number
  }>,
): Promise<number> {
  const getResp = await request.get(`${BACKEND}/api/assessments/${draft.id}`)
  const assessment = await getResp.json()
  const picked = await pickApplicableDetails(assessment, picks.length)
  const details = picked.map((detail: PickedDetail, index: number) => {
    const pick = picks[index]
    const snapshot = assessment.details.find(
      (d) => d.l3_code === detail.l3_code,
    )
    // Derive a current level that guarantees a positive gap against the
    // frozen scope target, so the plan choice is not auto-cleared on submit.
    const target = snapshot?.target_level ?? pick.target_level
    const currentLevel =
      pick.include_in_plan && target != null
        ? Math.min(pick.current_level, Math.max(0, target - 1))
        : pick.current_level
    return {
      l3_code: detail.l3_code,
      current_level: currentLevel,
      target_level: pick.target_level,
      member_priority: pick.member_priority,
      include_in_plan: pick.include_in_plan,
      plan_quarter: pick.plan_quarter ?? null,
      plan_month: pick.plan_month ?? null,
    }
  })
  return fillDetails(page, request, draft, details)
}

test.describe('Issue #62 Buddy Review atomic plan generation', () => {
  test('E2E-62-01 建议调整闭环：自评已生成计划，调整、重提和认可不重复写入', async ({
    page,
  }) => {
    const request = page.request
    const year = yearFor('E2E-62-01')
    await loginAs(page, 'member')
    const draft = await ensureDraft(page, request, year, 'member')
    const revision = await pickAndFill(page, request, draft, [
      {
        current_level: 2,
        target_level: 4,
        member_priority: '高',
        include_in_plan: true,
        plan_quarter: 'Q2',
        plan_month: 5,
      },
    ])
    const planBeforeReviewResp = await request.get(
      `${BACKEND}/api/planning/annual-plan?year=${year}`,
    )
    expect(planBeforeReviewResp.ok()).toBeTruthy()
    const planBeforeReview = await planBeforeReviewResp.json()
    expect(planBeforeReview.items.length).toBeGreaterThanOrEqual(1)

    await loginAs(page, 'buddy')
    const reviewId = await pendingReviewId(page, request, draft.id)
    const adjust = await submitReview(page, request, draft.id, reviewId, {
      conclusion: '建议调整',
      feedback: '请补充说明',
      expected_revision: revision,
    })
    expect(adjust.status).toBe(200)
    expect(adjust.body.assessment_status).toBe('建议调整')
    expect(adjust.body.plan).toBeNull()
    // Weak management: the plan was already generated on self-submit.
    // A Buddy adjustment must not delete or duplicate it.
    await loginAs(page, 'member')
    const planResp = await request.get(
      `${BACKEND}/api/planning/annual-plan?year=${year}`,
    )
    const plan = await planResp.json()
    expect(plan.id).toBe(planBeforeReview.id)
    expect(plan.items).toHaveLength(planBeforeReview.items.length)

    // Resubmitting the same assessment reuses the existing plan without
    // creating duplicate plan items or learning tasks.
    const getResp = await request.get(`${BACKEND}/api/assessments/${draft.id}`)
    const afterAdjust = await getResp.json()
    const resubmitResp = await request.post(
      `${BACKEND}/api/assessments/${draft.id}/submit`,
      { data: { expected_revision: afterAdjust.revision } },
    )
    expect(resubmitResp.ok()).toBeTruthy()
    const resubmitted = await resubmitResp.json()
    expect(resubmitted.plan_generation.created_items).toBe(0)
    expect(resubmitted.plan_generation.created_tasks).toBe(0)

    // buddy approves the new round → plan already exists (created=false)
    await loginAs(page, 'buddy')
    const newReviewId = await pendingReviewId(page, request, draft.id)
    const approve = await submitReview(page, request, draft.id, newReviewId, {
      conclusion: '认可',
      feedback: '已确认',
      expected_revision: resubmitted.revision,
    })
    expect(approve.status).toBe(200)
    expect(approve.body.assessment_status).toBe('已归档')
    // Issue #82: plan already created by self-submit
    expect(approve.body.plan.created).toBe(false)
    expect(approve.body.plan.plan_id).toBeDefined()
    // plan reads happen as the member (the annual-plan endpoint is member-scoped)
    await loginAs(page, 'member')
    const planAfter = await (
      await request.get(`${BACKEND}/api/planning/annual-plan?year=${year}`)
    ).json()
    expect(planAfter.source_assessment_id).toBe(draft.id)
    expect(planAfter.planning_source_type).toBe('assessment_approval')
    expect(planAfter.id).toBe(planBeforeReview.id)
    expect(planAfter.items).toHaveLength(planBeforeReview.items.length)
  })

  test('E2E-62-02 首次认可零纳入项生成计划壳', async ({ page }) => {
    const request = page.request
    const year = yearFor('E2E-62-02')
    await loginAs(page, 'member')
    const draft = await ensureDraft(page, request, year, 'member')
    const revision = await pickAndFill(page, request, draft, [
      {
        current_level: 3,
        target_level: 3,
        member_priority: '中',
        include_in_plan: false,
      },
    ])
    // Issue #82: plan shell created on self-submit
    await loginAs(page, 'member')
    const planAfterSubmit = await (
      await request.get(`${BACKEND}/api/planning/annual-plan?year=${year}`)
    ).json()
    expect(planAfterSubmit.source_assessment_id).toBe(draft.id)
    expect(planAfterSubmit.items.length).toBe(0)

    await loginAs(page, 'buddy')
    const reviewId = await pendingReviewId(page, request, draft.id)
    const approve = await submitReview(page, request, draft.id, reviewId, {
      conclusion: '认可',
      feedback: '零项计划壳',
      expected_revision: revision,
    })
    expect(approve.status).toBe(200)
    // Issue #82: plan already exists (created by self-submit)
    expect(approve.body.plan.created).toBe(false)
    expect(approve.body.plan.plan_id).toBeDefined()
    await loginAs(page, 'member')
    const plan = await (
      await request.get(`${BACKEND}/api/planning/annual-plan?year=${year}`)
    ).json()
    expect(plan.source_assessment_id).toBe(draft.id)
    expect(plan.items.length).toBe(0)
  })

  test('E2E-62-03 首次认可生成多项 Item/Task，来源快照完整', async ({
    page,
  }) => {
    const request = page.request
    const year = yearFor('E2E-62-03')
    await loginAs(page, 'member')
    const draft = await ensureDraft(page, request, year, 'member')
    const revision = await pickAndFill(page, request, draft, [
      {
        current_level: 2,
        target_level: 4,
        member_priority: '高',
        include_in_plan: true,
        plan_quarter: 'Q2',
        plan_month: 5,
      },
      {
        current_level: 1,
        target_level: 3,
        member_priority: '中',
        include_in_plan: true,
        plan_quarter: 'Q3',
        plan_month: 8,
      },
    ])
    // Issue #82: verify plan created on self-submit with 2 items
    await loginAs(page, 'member')
    const planAfterSubmit = await (
      await request.get(`${BACKEND}/api/planning/annual-plan?year=${year}`)
    ).json()
    expect(planAfterSubmit.items.length).toBe(2)

    await loginAs(page, 'buddy')
    const reviewId = await pendingReviewId(page, request, draft.id)
    const approve = await submitReview(page, request, draft.id, reviewId, {
      conclusion: '认可',
      feedback: '两项纳入',
      expected_revision: revision,
    })
    expect(approve.status).toBe(200)
    // Issue #82: plan already exists (created by self-submit)
    expect(approve.body.plan.created).toBe(false)
    expect(approve.body.plan.plan_id).toBeDefined()
    await loginAs(page, 'member')
    const plan = await (
      await request.get(`${BACKEND}/api/planning/annual-plan?year=${year}`)
    ).json()
    expect(plan.items.length).toBe(2)
    for (const item of plan.items) {
      expect(item.source_assessment_id).toBe(draft.id)
      expect(item.source_assessment_detail_id).not.toBeNull()
      expect(item.capability_standard_version_id).not.toBeNull()
      expect(item.planning_snapshot_id).not.toBeNull()
      expect(item.planning_source_type).toBe('assessment_approval')
      expect(item.include_in_plan).toBe(true)
      expect(item.gap_value).toBeGreaterThan(0)
      expect(item.priority).toBeTruthy()
      expect(item.plan_quarter).toBeTruthy()
      expect(item.plan_month).toBeGreaterThan(0)
    }
  })

  test('E2E-62-04 后续认可只生成 Change Proposal，正式计划不变', async ({
    page,
  }) => {
    const request = page.request
    const year = yearFor('E2E-62-04')
    await loginAs(page, 'member')
    const first = await ensureDraft(page, request, year, 'member')
    const firstRevision = await pickAndFill(page, request, first, [
      {
        current_level: 2,
        target_level: 4,
        member_priority: '高',
        include_in_plan: true,
        plan_quarter: 'Q2',
        plan_month: 5,
      },
    ])
    // Issue #82: first plan created on self-submit
    const planAfterFirstSubmit = await (
      await request.get(`${BACKEND}/api/planning/annual-plan?year=${year}`)
    ).json()
    expect(planAfterFirstSubmit.source_assessment_id).toBe(first.id)

    await loginAs(page, 'buddy')
    const review1 = await pendingReviewId(page, request, first.id)
    const approve1 = await submitReview(page, request, first.id, review1, {
      conclusion: '认可',
      feedback: '首次认可',
      expected_revision: firstRevision,
    })
    expect(approve1.status).toBe(200)
    // Issue #82: plan already exists
    expect(approve1.body.plan.created).toBe(false)

    // second assessment (年中更新) same member+year
    await loginAs(page, 'member')
    const second = await ensureDraft(page, request, year, 'member', '年中更新')
    const secondRevision = await pickAndFill(page, request, second, [
      {
        current_level: 3,
        target_level: 4,
        member_priority: '中',
        include_in_plan: true,
        plan_quarter: 'Q3',
        plan_month: 8,
      },
    ])
    const planBefore = await (
      await request.get(`${BACKEND}/api/planning/annual-plan?year=${year}`)
    ).json()
    await loginAs(page, 'buddy')
    const review2 = await pendingReviewId(page, request, second.id)
    const approve2 = await submitReview(page, request, second.id, review2, {
      conclusion: '认可',
      feedback: '后续认可',
      expected_revision: secondRevision,
    })
    expect(approve2.status).toBe(200)
    expect(approve2.body.plan).toBeNull()
    expect(approve2.body.proposal.created).toBe(true)
    expect(approve2.body.proposal.target_is_legacy).toBe(false)

    await loginAs(page, 'member')
    const proposals = await (
      await request.get(`${BACKEND}/api/planning/change-proposals?year=${year}`)
    ).json()
    expect(proposals.length).toBe(1)
    expect(proposals[0].source_assessment_id).toBe(second.id)
    expect(proposals[0].target_annual_growth_plan_id).toBe(planBefore.id)
    expect(proposals[0].status).toBe('待处理')
    expect(proposals[0].details.length).toBe(1)

    const planAfter = await (
      await request.get(`${BACKEND}/api/planning/annual-plan?year=${year}`)
    ).json()
    expect(planAfter.items.length).toBe(planBefore.items.length)
  })

  test('E2E-62-05 幂等重放：同 key 同 payload 返回首次响应，不重复写入', async ({
    page,
  }) => {
    const request = page.request
    const year = yearFor('E2E-62-05')
    await loginAs(page, 'member')
    const draft = await ensureDraft(page, request, year, 'member')
    const revision = await pickAndFill(page, request, draft, [
      {
        current_level: 3,
        target_level: 3,
        member_priority: '中',
        include_in_plan: false,
      },
    ])
    // Issue #82: plan created on self-submit
    await loginAs(page, 'member')
    const planAfterSubmit = await (
      await request.get(`${BACKEND}/api/planning/annual-plan?year=${year}`)
    ).json()
    expect(planAfterSubmit).toBeDefined()

    await loginAs(page, 'buddy')
    const reviewId = await pendingReviewId(page, request, draft.id)
    const payload = {
      conclusion: '认可' as const,
      feedback: '幂等',
      expected_revision: revision,
    }
    const first = await submitReview(
      page,
      request,
      draft.id,
      reviewId,
      payload,
      'e2e-idem-key-1',
    )
    expect(first.status).toBe(200)
    expect(first.body.idempotent_replayed).toBe(false)
    // Issue #82: plan already exists (created by self-submit)
    expect(first.body.plan.created).toBe(false)
    const second = await submitReview(
      page,
      request,
      draft.id,
      reviewId,
      payload,
      'e2e-idem-key-1',
    )
    expect(second.status).toBe(200)
    expect(second.body.idempotent_replayed).toBe(true)
    expect(second.body.plan.plan_id).toBe(first.body.plan.plan_id)
    // single plan row
    await loginAs(page, 'member')
    const plan = await (
      await request.get(`${BACKEND}/api/planning/annual-plan?year=${year}`)
    ).json()
    expect(plan.items.length).toBe(0)
  })

  test('E2E-62-06 无幂等 key 的重复提交返回 409，不二次写入', async ({
    page,
  }) => {
    const request = page.request
    const year = yearFor('E2E-62-06')
    await loginAs(page, 'member')
    const draft = await ensureDraft(page, request, year, 'member')
    const revision = await pickAndFill(page, request, draft, [
      {
        current_level: 3,
        target_level: 3,
        member_priority: '中',
        include_in_plan: false,
      },
    ])
    // Issue #82: plan created on self-submit
    await loginAs(page, 'member')
    const planAfterSubmit = await (
      await request.get(`${BACKEND}/api/planning/annual-plan?year=${year}`)
    ).json()
    expect(planAfterSubmit).toBeDefined()

    await loginAs(page, 'buddy')
    const reviewId = await pendingReviewId(page, request, draft.id)
    const first = await submitReview(page, request, draft.id, reviewId, {
      conclusion: '认可',
      feedback: '首次',
      expected_revision: revision,
    })
    expect(first.status).toBe(200)
    // Issue #82: plan already exists
    expect(first.body.plan.created).toBe(false)
    const second = await submitReview(page, request, draft.id, reviewId, {
      conclusion: '认可',
      feedback: '重复',
      expected_revision: revision,
    })
    expect(second.status).toBe(409)
    expect(
      (second.body as { detail?: { code?: string } } | null)?.detail?.code,
    ).toBe('assessment_already_reviewed')
  })

  test('E2E-62-07 按所选 L3 生成任务：Buddy 看板无自评复核队列', async ({
    page,
  }) => {
    const request = page.request
    const year = yearFor('E2E-62-07')
    await loginAs(page, 'member')
    const draft = await ensureDraft(page, request, year, 'member')
    const [picked] = await fillSelectionOnly(page, request, draft, [
      {
        current_level: 2,
        target_level: 4,
        member_priority: '高',
        include_in_plan: true,
        plan_quarter: 'Q2',
        plan_month: 5,
      },
    ])

    // Issue #178: the member generates tasks for the included L3 on the
    // assessment page — the persisted 纳入年度计划=是 decision is the only
    // selection; no full-form submit, no review queue entry.
    await page.goto(`/capability/assessment?year=${year}`)
    await page.getByRole('button', { name: '生成学习任务' }).click()
    await expect(page.getByText(/已生成 \d+ 个学习任务/)).toBeVisible()
    const plan = await (
      await request.get(`${BACKEND}/api/planning/annual-plan?year=${year}`)
    ).json()
    expect(
      plan.items.some(
        (item: { l3_code: string }) => item.l3_code === picked.l3_code,
      ),
    ).toBe(true)
    // generation creates no Assessment Review and never transitions status:
    // the Buddy-only review queue is a #178-removed surface, so the member
    // has no access to it (403) and the draft stays a draft.
    const pendingResp = await request.get(
      `${BACKEND}/api/assessments/reviews/pending`,
    )
    expect(pendingResp.status()).toBe(403)
    const fresh = await (
      await request.get(`${BACKEND}/api/assessments/${draft.id}`)
    ).json()
    expect(fresh.status).toBe('草稿')

    // Buddy board: member overview + evidence entry, no assessment queue.
    await loginAs(page, 'buddy')
    await page.goto('/mentoring/dashboard')
    await expect(
      page.getByRole('heading', { name: '辅导成员看板' }),
    ).toBeVisible()
    await expect(
      page.getByRole('heading', { name: '辅导成员', exact: true }),
    ).toBeVisible()
    await expect(page.locator('.member-row').first()).toBeVisible()
    await expect(
      page.getByRole('heading', { name: '待验收成果' }),
    ).toBeVisible()
    await expect(page.getByText('待复核自评')).toHaveCount(0)
    await expect(
      page.getByRole('button', { name: '提交复核反馈' }),
    ).toHaveCount(0)
    await page.getByRole('link', { name: '前往成果验收' }).click()
    await expect(page).toHaveURL(/\/mentoring\/evidence-review$/)
    await expect(
      page.getByRole('heading', { name: '待验收成果' }),
    ).toBeVisible()
  })

  test('E2E-62-08 生成响应丢失：服务端已提交但浏览器未收到响应，同选择重试幂等复用', async ({
    page,
  }) => {
    const request = page.request
    const year = yearFor('E2E-62-08')
    await loginAs(page, 'member')
    const draft = await ensureDraft(page, request, year, 'member')
    const [picked] = await fillSelectionOnly(page, request, draft, [
      {
        current_level: 2,
        target_level: 4,
        member_priority: '高',
        include_in_plan: true,
        plan_quarter: 'Q2',
        plan_month: 5,
      },
    ])

    // P2-1: the first request REALLY reaches the backend and commits, but the
    // client response is suppressed — the browser sees a gateway failure.
    // The retry with the same selection then reuses the same plan items:
    // no second write anywhere.
    let call = 0
    await page.route(
      '**/api/assessments/*/generate-plan-items',
      async (route) => {
        call += 1
        if (call === 1) {
          await route.fetch()
          await route.fulfill({
            status: 504,
            contentType: 'application/json',
            body: JSON.stringify({ detail: 'gateway timeout' }),
          })
          return
        }
        await route.continue()
      },
    )
    await page.goto(`/capability/assessment?year=${year}`)
    await page.getByRole('button', { name: '生成学习任务' }).click()
    // no success message yet — the response was lost
    await expect(page.getByText(/已生成/)).toHaveCount(0)
    // unchanged persisted selection -> retry reuses the existing plan items
    await page.getByRole('button', { name: '生成学习任务' }).click()
    await expect(page.getByText(/已生成 \d+ 个学习任务/)).toBeVisible()
    expect(call).toBeGreaterThanOrEqual(2)
    // exactly one item and one task, no review, status untouched
    await loginAs(page, 'member')
    const plan = await (
      await request.get(`${BACKEND}/api/planning/annual-plan?year=${year}`)
    ).json()
    expect(plan.items.length).toBe(1)
    expect(plan.items[0].l3_code).toBe(picked.l3_code)
    const tasks = await (
      await request.get(`${BACKEND}/api/planning/learning-tasks`)
    ).json()
    expect(
      tasks.filter((t: { plan_item_id: number }) =>
        plan.items.some((i: { id: number }) => i.id === t.plan_item_id),
      ),
    ).toHaveLength(1)
    // The Buddy-only review queue is a #178-removed surface — no access.
    const pendingResp = await request.get(
      `${BACKEND}/api/assessments/reviews/pending`,
    )
    expect(pendingResp.status()).toBe(403)
    const fresh = await (
      await request.get(`${BACKEND}/api/assessments/${draft.id}`)
    ).json()
    expect(fresh.status).toBe('草稿')
  })

  test('E2E-62-09 生成请求失败后重试成功，不重复写入', async ({ page }) => {
    const request = page.request
    const year = yearFor('E2E-62-09')
    await loginAs(page, 'member')
    const draft = await ensureDraft(page, request, year, 'member')
    const [picked] = await fillSelectionOnly(page, request, draft, [
      {
        current_level: 2,
        target_level: 4,
        member_priority: '高',
        include_in_plan: true,
        plan_quarter: 'Q2',
        plan_month: 5,
      },
    ])

    // The first request never reaches the server; the retry succeeds and
    // writes exactly once.
    let call = 0
    await page.route(
      '**/api/assessments/*/generate-plan-items',
      async (route) => {
        call += 1
        if (call === 1) {
          await route.abort('failed')
          return
        }
        await route.continue()
      },
    )
    await page.goto(`/capability/assessment?year=${year}`)
    await page.getByRole('button', { name: '生成学习任务' }).click()
    await expect(page.getByText(/已生成/)).toHaveCount(0)
    await page.getByRole('button', { name: '生成学习任务' }).click()
    await expect(page.getByText(/已生成 \d+ 个学习任务/)).toBeVisible()
    expect(call).toBeGreaterThanOrEqual(2)
    // exactly one plan item for the selection — no duplicates
    await loginAs(page, 'member')
    const plan = await (
      await request.get(`${BACKEND}/api/planning/annual-plan?year=${year}`)
    ).json()
    expect(plan.items.length).toBe(1)
    expect(plan.items[0].l3_code).toBe(picked.l3_code)
    // No Assessment Review is created — the Buddy-only queue is #178-removed.
    const pendingResp = await request.get(
      `${BACKEND}/api/assessments/reviews/pending`,
    )
    expect(pendingResp.status()).toBe(403)
  })

  test('E2E-62-10 生成时草稿版本冲突：提示重新加载，刷新后重试成功', async ({
    page,
  }) => {
    const request = page.request
    const year = yearFor('E2E-62-10')
    await loginAs(page, 'member')
    const draft = await ensureDraft(page, request, year, 'member')
    const [picked] = await fillSelectionOnly(page, request, draft, [
      {
        current_level: 2,
        target_level: 4,
        member_priority: '高',
        include_in_plan: true,
        plan_quarter: 'Q2',
        plan_month: 5,
      },
    ])

    await page.goto(`/capability/assessment?year=${year}`)
    // A dirty edit in the UI: generation first persists the changed row.
    await page.getByLabel(`当前等级 ${picked.l3_code}`).selectOption('0')
    // Meanwhile another writer bumps the draft revision behind the page.
    const getResp = await request.get(`${BACKEND}/api/assessments/${draft.id}`)
    const fresh = await getResp.json()
    const other = fresh.details.find(
      (detail: { l3_code: string; standard_target_applicable: boolean }) =>
        detail.l3_code !== picked.l3_code &&
        detail.standard_target_applicable === true,
    )!
    const bumped = await request.patch(
      `${BACKEND}/api/assessments/${draft.id}/draft`,
      {
        data: {
          expected_revision: fresh.revision,
          details: [
            {
              l3_node_id: other.l3_node_id,
              l3_code: other.l3_code,
              current_level: 1,
            },
          ],
        },
      },
    )
    expect(bumped.ok()).toBeTruthy()
    // Generation hits the stale revision -> 409 with a reload hint.
    await page.getByRole('button', { name: '生成学习任务' }).click()
    await expect(
      page.getByText('数据冲突：草稿已被其他操作更新，请重新加载后再生成。'),
    ).toBeVisible()
    // Reload brings a fresh revision; the persisted selection survives and
    // the retry succeeds and writes once.
    await page.reload()
    await expect(page.getByLabel('评估摘要')).toBeVisible()
    await page.getByRole('button', { name: '生成学习任务' }).click()
    await expect(page.getByText(/已生成 \d+ 个学习任务/)).toBeVisible()
    // exactly one plan item for the selection; no duplicates anywhere
    await loginAs(page, 'member')
    const plan = await (
      await request.get(`${BACKEND}/api/planning/annual-plan?year=${year}`)
    ).json()
    expect(plan.items.length).toBe(1)
    expect(plan.items[0].l3_code).toBe(picked.l3_code)
  })
})

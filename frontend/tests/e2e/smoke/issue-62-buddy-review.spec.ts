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
    data: { year, assessment_type: assessmentType, scope_token: preview.scope_token },
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
  test('E2E-62-01 建议调整闭环：调整后零计划写入，重新提交后认可生成计划', async ({
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
    // zero plan writes
    const planResp = await request.get(
      `${BACKEND}/api/planning/annual-plan?year=${year}`,
    )
    const plan = await planResp.json()
    expect(plan).toBeNull()

    // member resubmits after 建议调整
    await loginAs(page, 'member')
    const getResp = await request.get(`${BACKEND}/api/assessments/${draft.id}`)
    const afterAdjust = await getResp.json()
    const resubmitResp = await request.post(
      `${BACKEND}/api/assessments/${draft.id}/submit`,
      { data: { expected_revision: afterAdjust.revision } },
    )
    expect(resubmitResp.ok()).toBeTruthy()
    const resubmitted = await resubmitResp.json()

    // buddy approves the new round → plan generated
    await loginAs(page, 'buddy')
    const newReviewId = await pendingReviewId(page, request, draft.id)
    const approve = await submitReview(page, request, draft.id, newReviewId, {
      conclusion: '认可',
      feedback: '已确认',
      expected_revision: resubmitted.revision,
    })
    expect(approve.status).toBe(200)
    expect(approve.body.assessment_status).toBe('已归档')
    expect(approve.body.plan.created).toBe(true)
    expect(approve.body.plan.items_created).toBeGreaterThanOrEqual(1)
    // plan reads happen as the member (the annual-plan endpoint is member-scoped)
    await loginAs(page, 'member')
    const planAfter = await (
      await request.get(`${BACKEND}/api/planning/annual-plan?year=${year}`)
    ).json()
    expect(planAfter.source_assessment_id).toBe(draft.id)
    expect(planAfter.planning_source_type).toBe('assessment_approval')
    expect(planAfter.items.length).toBe(approve.body.plan.items_created)
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
    await loginAs(page, 'buddy')
    const reviewId = await pendingReviewId(page, request, draft.id)
    const approve = await submitReview(page, request, draft.id, reviewId, {
      conclusion: '认可',
      feedback: '零项计划壳',
      expected_revision: revision,
    })
    expect(approve.status).toBe(200)
    expect(approve.body.plan.created).toBe(true)
    expect(approve.body.plan.items_created).toBe(0)
    expect(approve.body.plan.tasks_created).toBe(0)
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
    await loginAs(page, 'buddy')
    const reviewId = await pendingReviewId(page, request, draft.id)
    const approve = await submitReview(page, request, draft.id, reviewId, {
      conclusion: '认可',
      feedback: '两项纳入',
      expected_revision: revision,
    })
    expect(approve.status).toBe(200)
    expect(approve.body.plan.items_created).toBe(2)
    expect(approve.body.plan.tasks_created).toBe(2)
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
    await loginAs(page, 'buddy')
    const review1 = await pendingReviewId(page, request, first.id)
    const approve1 = await submitReview(page, request, first.id, review1, {
      conclusion: '认可',
      feedback: '首次认可',
      expected_revision: firstRevision,
    })
    expect(approve1.status).toBe(200)

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
    expect(plan.items.length).toBe(first.body.plan.items_created)
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
    await loginAs(page, 'buddy')
    const reviewId = await pendingReviewId(page, request, draft.id)
    const first = await submitReview(page, request, draft.id, reviewId, {
      conclusion: '认可',
      feedback: '首次',
      expected_revision: revision,
    })
    expect(first.status).toBe(200)
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

  test('E2E-62-07 Buddy 工作区 UI：汇总、提示与提交', async ({
    page,
  }) => {
    const request = page.request
    const year = yearFor('E2E-62-07')
    await loginAs(page, 'member')
    const draft = await ensureDraft(page, request, year, 'member')
    await pickAndFill(page, request, draft, [
      {
        current_level: 2,
        target_level: 4,
        member_priority: '高',
        include_in_plan: true,
        plan_quarter: 'Q2',
        plan_month: 5,
      },
    ])
    await loginAs(page, 'buddy')
    await page.goto('/mentoring/dashboard')
    await expect(
      page.getByRole('heading', { name: 'Buddy 复核中心' }),
    ).toBeVisible()
    // summary grid + first-approval notice
    await expect(
      page.getByText(/首次认可将原子生成正式年度计划/).first(),
    ).toBeVisible()
    // detail table shows the frozen facts
    await expect(page.getByText('高').first()).toBeVisible()
    // submit approve via the UI with real API
    await page.getByLabel('认可').first().click()
    await page.getByLabel('反馈').first().fill('UI 认可')
    await page.getByRole('button', { name: '提交复核反馈' }).first().click()
    await expect(page.getByText(/年度计划已生成/).first()).toBeVisible()
  })
})

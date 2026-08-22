/** Issue #62: 显式生成学习任务（#194 兼容改造）— E2E scenarios.

  Issue #194 将“提交自评并自动生成学习任务”废止为三个独立动作：
  保存能力评级 → 加入/移出计划草稿（include_in_plan）→ 显式生成所选学习任务
  （POST /generate-plan-items，Idempotency-Key 前缀 generate-plan-items:）。
  原 10 个场景以“Buddy 自评复核认可 → 自动生成计划”为主线（已废止），现按
  新合同重写：每条场景保留原意图（零写入、幂等重放、冲突恢复、权限边界、
  工作区 UI），断言对象改为显式生成、唯一核去重与退役端点的 422/410 零写入。

  Isolation contract (same as issue-61 spec):
  - Each scenario owns a FIXED unique year (E2E-62-NN → 2260+NN), independent
    of execution order, retries and worker restarts.
  - Drafts are looked up by the exact business key (member, year, '年度') and
    reused with their real revision instead of blindly re-created.
  - Scenarios run through the REAL API (request fixture) and verify the UI for
    the surviving Buddy workspace (Evidence Review); nothing is page-routed
    away.
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
  member_priority?: string | null
  include_in_plan?: boolean | null
  plan_month?: string | null // Issue #194: YYYY-MM
}

/** Pick the first N applicable details from the real assessment scope. */
interface ScopeSnapshot {
  l3_code: string
  l3_node_id: number | null
  standard_target_applicable: boolean
  target_level?: number | null
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

/** Full-replacement save (PUT) — the first of the three independent
  actions.  plan_quarter must never be sent (#194: derived server-side). */
async function fillDetails(
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
  // Success path only: keep the shared draft state's revision in sync so a
  // later save/generate in the same scenario never sends a stale revision.
  // Real conflict scenarios capture a stale value explicitly instead.
  draft.revision = saved.revision
  return saved.revision
}

interface PickSpec {
  current_level: number
  member_priority: string
  include_in_plan: boolean | null
  plan_month?: string // Issue #194: YYYY-MM
}

interface PickedDetail {
  l3_code: string
  l3_node_id: number | null
}

/** Pick applicable details for a draft, build member decisions, save. */
async function pickAndFill(
  request: ApiRequest,
  draft: DraftState,
  picks: PickSpec[],
): Promise<{ codes: string[]; revision: number }> {
  const getResp = await request.get(`${BACKEND}/api/assessments/${draft.id}`)
  const assessment = await getResp.json()
  const picked = await pickApplicableDetails(assessment, picks.length)
  const details = picked.map((detail: PickedDetail, index: number) => {
    const pick = picks[index]
    const snapshot = assessment.details.find(
      (d: ScopeSnapshot) => d.l3_code === detail.l3_code,
    )
    // Clamp to a positive gap against the frozen scope target so the plan
    // choice is never auto-cleared (#194: gap-zero rows cannot plan).
    const target = snapshot?.target_level ?? 4
    const currentLevel =
      pick.include_in_plan && target != null
        ? Math.min(pick.current_level, Math.max(0, target - 1))
        : pick.current_level
    return {
      l3_code: detail.l3_code,
      current_level: currentLevel,
      member_priority: pick.member_priority,
      include_in_plan: pick.include_in_plan,
      ...(pick.plan_month ? { plan_month: pick.plan_month } : {}),
    }
  })
  const revision = await fillDetails(request, draft, details)
  return { codes: picked.map((d) => d.l3_code), revision }
}

interface ApiResult {
  status: number
  body: Record<string, unknown> | null
}

/** Issue #194: explicit generation of the selected plan items (idempotent:
  same key + same payload replays the stored first response, same key +
  different payload → 409). */
async function generatePlan(
  request: ApiRequest,
  draft: DraftState,
  revision: number,
  codes: string[],
  idempotencyKey?: string,
): Promise<ApiResult> {
  const resp = await request.post(
    `${BACKEND}/api/assessments/${draft.id}/generate-plan-items`,
    {
      data: { expected_revision: revision, l3_codes: codes },
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

/** Annual plan for the year, or null when generation never created one. */
async function annualPlanOf(
  request: ApiRequest,
  year: number,
): Promise<Record<string, unknown> | null> {
  const resp = await request.get(
    `${BACKEND}/api/planning/annual-plan?year=${year}`,
  )
  if (!resp.ok()) {
    throw new Error(`annual-plan failed: ${resp.status()}`)
  }
  return (await resp.json()) as Record<string, unknown> | null
}

function detailOf(
  result: ApiResult,
): { code?: string; reason?: string; message?: string } | null {
  return (
    (result.body?.detail as
      { code?: string; reason?: string; message?: string } | undefined) ?? null
  )
}

test.describe('Issue #62 兼容改造：显式生成学习任务（#194；原自评复核认可自动生成已废止）', () => {
  test('E2E-62-01 生成前未就绪零写入，完善后生成成功（原建议调整闭环）', async ({
    page,
  }) => {
    const request = page.request
    const year = yearFor('E2E-62-01')
    await loginAs(page, 'member')
    const draft = await ensureDraft(page, request, year, 'member')
    // 未选择纳入 → 显式生成被拒（not_in_plan），零计划写入。
    const undecided = await pickAndFill(request, draft, [
      { current_level: 2, member_priority: '高', include_in_plan: null },
    ])
    const rejected = await generatePlan(
      request,
      draft,
      undecided.revision,
      undecided.codes,
    )
    expect(rejected.status).toBe(422)
    expect(detailOf(rejected)?.reason).toBe('not_in_plan')
    expect(await annualPlanOf(request, year)).toBeNull()

    // 完善（纳入 + 月份）→ 生成成功，计划与 Item 落库。
    const decided = await pickAndFill(request, draft, [
      {
        current_level: 2,
        member_priority: '高',
        include_in_plan: true,
        plan_month: `${year}-05`,
      },
    ])
    const ok = await generatePlan(
      request,
      draft,
      decided.revision,
      decided.codes,
    )
    expect(ok.status).toBe(200)
    expect(ok.body?.created).toEqual(decided.codes)
    const plan = await annualPlanOf(request, year)
    expect(plan).not.toBeNull()
    expect(
      (plan?.items as Array<Record<string, unknown>> | undefined)?.length,
    ).toBe(1)
  })

  test('E2E-62-02 空选择被拒零写入；单纳入显式生成创建计划（原零纳入计划壳）', async ({
    page,
  }) => {
    const request = page.request
    const year = yearFor('E2E-62-02')
    await loginAs(page, 'member')
    const draft = await ensureDraft(page, request, year, 'member')
    // 零纳入项：空选择被 l3_codes 最小长度校验拒绝，零写入。
    const revision = await fillDetails(request, draft, [])
    const empty = await generatePlan(request, draft, revision, [])
    expect(empty.status).toBe(422)
    expect(await annualPlanOf(request, year)).toBeNull()

    // 单纳入 → 生成成功：计划、Item 与 1:1 学习任务创建。
    const { codes, revision: decided } = await pickAndFill(request, draft, [
      {
        current_level: 2,
        member_priority: '高',
        include_in_plan: true,
        plan_month: `${year}-05`,
      },
    ])
    const ok = await generatePlan(request, draft, decided, codes)
    expect(ok.status).toBe(200)
    expect(ok.body?.annual_plan_id).toBeDefined()
    expect(ok.body?.created).toEqual(codes)
    const plan = await annualPlanOf(request, year)
    const item = (
      plan?.items as Array<Record<string, unknown>> | undefined
    )?.[0]
    expect(item?.l3_code).toBe(codes[0])
    const tasks = await (
      await request.get(`${BACKEND}/api/planning/learning-tasks`)
    ).json()
    expect(
      tasks.some((t: { plan_item_id: number }) => t.plan_item_id === item?.id),
    ).toBe(true)
  })

  test('E2E-62-03 首次生成多项 Item/Task，来源快照完整', async ({ page }) => {
    const request = page.request
    const year = yearFor('E2E-62-03')
    await loginAs(page, 'member')
    const draft = await ensureDraft(page, request, year, 'member')
    const { codes, revision } = await pickAndFill(request, draft, [
      {
        current_level: 2,
        member_priority: '高',
        include_in_plan: true,
        plan_month: `${year}-05`,
      },
      {
        current_level: 1,
        member_priority: '中',
        include_in_plan: true,
        plan_month: `${year}-06`,
      },
    ])
    const ok = await generatePlan(request, draft, revision, codes)
    expect(ok.status).toBe(200)
    expect(ok.body?.created).toEqual(codes)
    const plan = await annualPlanOf(request, year)
    const items = (plan?.items ?? []) as Array<Record<string, unknown>>
    expect(items.length).toBe(2)
    for (const item of items) {
      expect(item.source_assessment_id).toBe(draft.id)
      expect(item.source_assessment_detail_id).not.toBeNull()
      expect(item.capability_standard_version_id).not.toBeNull()
      expect(item.planning_snapshot_id).not.toBeNull()
      expect(item.planning_source_type).toBe('assessment_approval')
      expect(item.include_in_plan).toBe(true)
      expect(item.gap_value).toBeGreaterThan(0)
      expect(item.priority).toBeTruthy()
      expect(item.status).toBe('未开始')
      // Issue #194: plan_month is TEXT 'YYYY-MM'; plan_quarter derived.
      expect(item.plan_month).toMatch(/^[0-9]{4}-(0[1-9]|1[0-2])$/)
      expect(item.plan_quarter).toMatch(/^Q[1-4]$/)
      // frozen source snapshot from the planning template
      expect(item.l3_name).toBeTruthy()
      expect(item.learning_task_content).toBeTruthy()
      expect(item.estimated_hours).toBeTruthy()
    }
    // 1:1 learning task per generated item
    const tasks = await (
      await request.get(`${BACKEND}/api/planning/learning-tasks`)
    ).json()
    for (const item of items) {
      expect(
        tasks.some((t: { plan_item_id: number }) => t.plan_item_id === item.id),
      ).toBe(true)
    }
  })

  test('E2E-62-04 草稿修改后再次生成不重复写入，正式计划不变（原后续认可）', async ({
    page,
  }) => {
    const request = page.request
    const year = yearFor('E2E-62-04')
    await loginAs(page, 'member')
    const draft = await ensureDraft(page, request, year, 'member')
    const { codes, revision } = await pickAndFill(request, draft, [
      {
        current_level: 2,
        member_priority: '高',
        include_in_plan: true,
        plan_month: `${year}-05`,
      },
    ])
    const first = await generatePlan(request, draft, revision, codes)
    expect(first.status).toBe(200)
    const planBefore = await annualPlanOf(request, year)
    const itemBefore = (planBefore?.items as Array<Record<string, unknown>>)[0]
    const itemRevisionBefore = itemBefore.revision

    // 草稿后续修改（revision 前进）后再生成同一 code → 唯一核去重：
    // created 为空、existing 返回、正式计划（Item 数与 revision）不变。
    // 注意：full-replacement 空数组会把所选 code 的 include/month 清空
    // （新合同下变未选择 → generate 422），故复用同一首项配置保存以推进
    // revision，保持合法正 Gap + include=true + YYYY-MM。
    const { revision: revised } = await pickAndFill(request, draft, [
      {
        current_level: 2,
        member_priority: '高',
        include_in_plan: true,
        plan_month: `${year}-05`,
      },
    ])
    const again = await generatePlan(request, draft, revised, codes)
    expect(again.status).toBe(200)
    expect(again.body?.created).toEqual([])
    expect(again.body?.existing).toEqual(codes)
    const planAfter = await annualPlanOf(request, year)
    expect((planAfter?.items as Array<Record<string, unknown>>)?.length).toBe(1)
    expect(
      (planAfter?.items as Array<Record<string, unknown>>)[0].revision,
    ).toBe(itemRevisionBefore)
  })

  test('E2E-62-05 幂等重放：同 key 同 payload 返回首次响应，不重复写入', async ({
    page,
  }) => {
    const request = page.request
    const year = yearFor('E2E-62-05')
    await loginAs(page, 'member')
    const draft = await ensureDraft(page, request, year, 'member')
    const { codes, revision } = await pickAndFill(request, draft, [
      {
        current_level: 2,
        member_priority: '高',
        include_in_plan: true,
        plan_month: `${year}-05`,
      },
    ])
    const key = `generate-plan-items:e2e62-05-${year}`
    const first = await generatePlan(request, draft, revision, codes, key)
    expect(first.status).toBe(200)
    const replay = await generatePlan(request, draft, revision, codes, key)
    expect(replay.status).toBe(200)
    expect(replay.body).toEqual(first.body)
    expect((await annualPlanOf(request, year))?.items?.length).toBe(1)
  })

  test('E2E-62-06 无幂等 key 的重复生成由唯一核去重，零新增（原重复提交 409）', async ({
    page,
  }) => {
    const request = page.request
    const year = yearFor('E2E-62-06')
    await loginAs(page, 'member')
    const draft = await ensureDraft(page, request, year, 'member')
    const { codes, revision } = await pickAndFill(request, draft, [
      {
        current_level: 2,
        member_priority: '高',
        include_in_plan: true,
        plan_month: `${year}-05`,
      },
    ])
    const first = await generatePlan(request, draft, revision, codes)
    expect(first.status).toBe(200)
    expect(first.body?.created).toEqual(codes)
    const again = await generatePlan(request, draft, revision, codes)
    expect(again.status).toBe(200)
    expect(again.body?.created).toEqual([])
    expect(again.body?.existing).toEqual(codes)
    expect((await annualPlanOf(request, year))?.items?.length).toBe(1)
  })

  test('E2E-62-07 Buddy 旧复核工作区退役：路由重定向、写端点 410 零写入、证据评审保留', async ({
    page,
  }) => {
    const request = page.request
    const year = yearFor('E2E-62-07')
    await loginAs(page, 'member')
    const draft = await ensureDraft(page, request, year, 'member')
    // 非 Buddy 调用旧复核写端点 → 403（权限先于退役判断）。
    const asMember = await request.post(
      `${BACKEND}/api/assessments/${draft.id}/reviews/1`,
      { data: { conclusion: '认可', feedback: 'x', expected_revision: 1 } },
    )
    expect(asMember.status()).toBe(403)

    await loginAs(page, 'buddy')
    // 旧复核工作区路由重定向到证据评审；复核中心不再渲染。
    await page.goto('/mentoring/dashboard')
    await expect(page).toHaveURL(/\/mentoring\/evidence-review$/)
    await expect(
      page.getByRole('heading', { name: '待验收成果' }),
    ).toBeVisible()
    await expect(page.getByText('数据范围：负责成员')).toBeVisible()
    await expect(page.getByText('Buddy 复核中心')).toHaveCount(0)
    // 旧复核写端点稳定 410 且零写入（Buddy 且有负责关系）。
    const asBuddy = await request.post(
      `${BACKEND}/api/assessments/${draft.id}/reviews/1`,
      { data: { conclusion: '认可', feedback: 'x', expected_revision: 1 } },
    )
    expect(asBuddy.status()).toBe(410)
    const retired = await asBuddy.json()
    expect(retired.detail.code).toBe('assessment_review_write_disabled')
    // 只读队列端点保持可用。
    const pending = await request.get(
      `${BACKEND}/api/assessments/reviews/pending`,
    )
    expect(pending.status()).toBe(200)
  })

  test('E2E-62-08 响应丢失后同 key 异 payload → 409；换新 key 成功且首次结果保留', async ({
    page,
  }) => {
    const request = page.request
    const year = yearFor('E2E-62-08')
    await loginAs(page, 'member')
    const draft = await ensureDraft(page, request, year, 'member')
    const { codes, revision } = await pickAndFill(request, draft, [
      {
        current_level: 2,
        member_priority: '高',
        include_in_plan: true,
        plan_month: `${year}-05`,
      },
    ])
    const key = `generate-plan-items:e2e62-08-${year}`
    const first = await generatePlan(request, draft, revision, codes, key)
    expect(first.status).toBe(200)
    expect(first.body?.created).toEqual(codes)

    // “响应丢失后前端刷新 revision 重试”：同 key、同 l3_codes、新 revision
    // → fingerprint 不同 → 409 拒绝，提示换新 key。
    // revision 前进时保持所选 code 合法（full-replacement 空数组会清空
    // include/month → 422），复用同一首项配置保存。
    const { revision: revised } = await pickAndFill(request, draft, [
      {
        current_level: 2,
        member_priority: '高',
        include_in_plan: true,
        plan_month: `${year}-05`,
      },
    ])
    const conflict = await generatePlan(request, draft, revised, codes, key)
    expect(conflict.status).toBe(409)
    expect(detailOf(conflict)?.code).toBe('idempotency_key_reused')

    // 换新 key 重试：首次生成结果保留（existing），不重复写入。
    const retry = await generatePlan(
      request,
      draft,
      revised,
      codes,
      `generate-plan-items:e2e62-08b-${year}`,
    )
    expect(retry.status).toBe(200)
    expect(retry.body?.created).toEqual([])
    expect(retry.body?.existing).toEqual(codes)
    expect((await annualPlanOf(request, year))?.items?.length).toBe(1)
  })

  test('E2E-62-09 失败不消耗幂等 key：修复后同 key 重试成功并可重放', async ({
    page,
  }) => {
    const request = page.request
    const year = yearFor('E2E-62-09')
    await loginAs(page, 'member')
    const draft = await ensureDraft(page, request, year, 'member')
    const key = `generate-plan-items:e2e62-09-${year}`
    // 未就绪（未选择纳入）→ 422，幂等 key 未被占用。
    const undecided = await pickAndFill(request, draft, [
      { current_level: 2, member_priority: '高', include_in_plan: null },
    ])
    const failed = await generatePlan(
      request,
      draft,
      undecided.revision,
      undecided.codes,
      key,
    )
    expect(failed.status).toBe(422)
    expect(detailOf(failed)?.reason).toBe('not_in_plan')
    expect(await annualPlanOf(request, year)).toBeNull()

    // 修复（纳入 + 月份）后同 key 重试成功。
    const decided = await pickAndFill(request, draft, [
      {
        current_level: 2,
        member_priority: '高',
        include_in_plan: true,
        plan_month: `${year}-05`,
      },
    ])
    const ok = await generatePlan(
      request,
      draft,
      decided.revision,
      decided.codes,
      key,
    )
    expect(ok.status).toBe(200)
    expect(ok.body?.created).toEqual(decided.codes)
    // 同 key 同 payload 重放 → 首次响应，单次写入。
    const replay = await generatePlan(
      request,
      draft,
      decided.revision,
      decided.codes,
      key,
    )
    expect(replay.status).toBe(200)
    expect(replay.body).toEqual(ok.body)
    expect((await annualPlanOf(request, year))?.items?.length).toBe(1)
  })

  test('E2E-62-10 409 版本冲突：刷新 revision 后重试成功（原工作区刷新）', async ({
    page,
  }) => {
    const request = page.request
    const year = yearFor('E2E-62-10')
    await loginAs(page, 'member')
    const draft = await ensureDraft(page, request, year, 'member')
    // 捕获保存前的 revision 作为过期值（fillDetails 成功后共享状态会同步）。
    const staleRevision = draft.revision
    const { codes, revision } = await pickAndFill(request, draft, [
      {
        current_level: 2,
        member_priority: '高',
        include_in_plan: true,
        plan_month: `${year}-05`,
      },
    ])
    // 过期 revision → 409 revision conflict，零写入。
    const stale = await generatePlan(request, draft, staleRevision, codes)
    expect(stale.status).toBe(409)
    expect(await annualPlanOf(request, year)).toBeNull()

    // 刷新（读取当前 revision）→ 同 payload 重试成功。
    const getResp = await request.get(`${BACKEND}/api/assessments/${draft.id}`)
    const fresh = (await getResp.json()).revision
    expect(fresh).toBe(revision)
    const ok = await generatePlan(request, draft, fresh, codes)
    expect(ok.status).toBe(200)
    expect(ok.body?.created).toEqual(codes)
    expect((await annualPlanOf(request, year))?.items?.length).toBe(1)
  })
})

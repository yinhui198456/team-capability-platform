/** Issue #61: Assessment field refactor — E2E smoke tests.

  Isolation contract:
  - Each scenario owns a FIXED unique year (E2E-NN → 2200+NN), independent of
    execution order, retries, and worker restarts.
  - ensureFreshDraft looks up the exact business key (member, year, '年度'):
    reuses an existing open draft with its real revision, otherwise creates.
    It never blindly re-creates over an open draft.
  - Every test reads its draft back in a finally block; drafts remain isolated
    by their fixed scenario year.

  Issue #194 contract: plan_month is TEXT 'YYYY-MM'; plan_quarter is derived
  server-side and never sent. The three independent actions are save rating,
  maintain the draft, and explicit generate-plan-items.
 */

import { expect, test } from '@playwright/test'

import { loginAs } from '../fixtures/auth'

const BACKEND = process.env.PLAYWRIGHT_BACKEND_URL ?? 'http://localhost:18001'

// ── helpers ────────────────────────────────────────────────────────────────

type ApiRequest = Parameters<Parameters<typeof test>[1]>[0]['request']

/** Deterministic per-scenario year: E2E-01 → 2201, …, E2E-18 → 2218. */
function yearFor(tag: string): number {
  const n = Number(tag.replace('E2E-', ''))
  if (!Number.isInteger(n) || n < 1 || n > 18) {
    throw new Error(`unexpected scenario tag: ${tag}`)
  }
  return 2200 + n
}

interface DraftState {
  id: number
  revision: number
}

interface Detail {
  l3_node_id: number
  l3_code: string
  current_level: number | null
  target_level: number | null
  member_priority: string | null
  include_in_plan: boolean | null
  plan_quarter: string | null
  plan_month: string | null // Issue #194: YYYY-MM
}

interface AutoClearedEntry {
  l3_node_id?: number
  l3_code: string
  fields: string[]
}

/**
 * Ensure a draft exists for the exact business key (member, year, '年度').
 *  1. Preview scope.
 *  2. Look up an existing open draft by business key; reuse with real
 *     revision when found.
 *  3. Otherwise create exactly once.
 */
async function ensureFreshDraft(
  request: ApiRequest,
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
    (a: { year: number; assessment_type: string; status: string }) =>
      a.year === year &&
      a.assessment_type === '年度' &&
      ['草稿', '建议调整'].includes(a.status),
  )
  if (existing) {
    // Reuse the exact business key with its real revision.
    const getResp = await request.get(
      `${BACKEND}/api/assessments/${existing.id}`,
    )
    if (!getResp.ok()) {
      throw new Error(`read existing draft failed: ${getResp.status()}`)
    }
    const detail = await getResp.json()
    return { id: existing.id, revision: detail.revision ?? 1 }
  }

  const createResp = await request.post(`${BACKEND}/api/assessments`, {
    data: {
      year,
      assessment_type: '年度',
      scope_token: preview.scope_token,
    },
  })
  if (!createResp.ok()) {
    const body = await createResp.text()
    throw new Error(
      `create draft failed: ${createResp.status()} ${body.slice(0, 200)}`,
    )
  }
  const draft = await createResp.json()
  return { id: draft.id, revision: draft.revision ?? 1 }
}

async function getAllDetails(
  request: ApiRequest,
  assessmentId: number,
): Promise<Detail[]> {
  const resp = await request.get(`${BACKEND}/api/assessments/${assessmentId}`)
  const assessment = await resp.json()
  return assessment.details as Detail[]
}

async function getFirstDetail(
  request: ApiRequest,
  assessmentId: number,
): Promise<Detail> {
  const details = await getAllDetails(request, assessmentId)
  expect(details.length).toBeGreaterThan(0)
  return details[0]
}

/**
 * Drafts are intentionally retained: the fixed scenario year lets later runs
 * safely reuse the exact draft without the retired submit workflow.
 */
async function cleanupDraft(
  request: ApiRequest,
  state: DraftState,
): Promise<void> {
  try {
    const getResp = await request.get(`${BACKEND}/api/assessments/${state.id}`)
    if (!getResp.ok()) return
    const detail = await getResp.json()
    if (!['草稿', '建议调整'].includes(detail.status)) {
      console.warn(`unexpected assessment status: ${detail.status}`)
    }
  } catch {
    // best-effort readback
  }
}

// ── tests ──────────────────────────────────────────────────────────────────

test.describe('Issue #61 — assessment field refactor', () => {
  test('E2E-01: Full self-assessment flow with plan selection', async ({
    page,
  }) => {
    const year = yearFor('E2E-01')
    await loginAs(page, 'member')
    const state = await ensureFreshDraft(page.request, year)
    try {
      // The same business key must reject a second open draft.
      const previewResp = await page.request.get(
        `${BACKEND}/api/assessments/scope-preview?year=${year}&assessment_type=年度`,
      )
      const preview = await previewResp.json()
      const dupResp = await page.request.post(`${BACKEND}/api/assessments`, {
        data: {
          year,
          assessment_type: '年度',
          scope_token: preview.scope_token,
        },
      })
      expect(dupResp.status()).toBe(409)
      const dupBody = await dupResp.json()
      expect(dupBody.detail.code).toBe('open_draft_exists')

      const detail = await getFirstDetail(page.request, state.id)
      const currentLevel = Math.max(0, (detail.target_level ?? 1) - 1)

      // fill: positive gap, priority=低, include_in_plan=true, 5月 (YYYY-MM)
      const patchResp = await page.request.patch(
        `${BACKEND}/api/assessments/${state.id}/draft`,
        {
          data: {
            expected_revision: state.revision,
            details: [
              {
                l3_node_id: detail.l3_node_id,
                l3_code: detail.l3_code,
                current_level: currentLevel,
                member_priority: '低',
                include_in_plan: true,
                plan_month: `${year}-05`,
              },
            ],
          },
        },
      )
      expect(patchResp.ok()).toBeTruthy()
      state.revision++

      // verify saved
      const verify = await page.request.get(
        `${BACKEND}/api/assessments/${state.id}`,
      )
      expect(verify.ok()).toBeTruthy()
      const saved = (await verify.json()).details.find(
        (d: { l3_code: string }) => d.l3_code === detail.l3_code,
      )
      expect(saved.current_level).toBe(currentLevel)
      expect(saved.member_priority).toBe('低')
      expect(saved.include_in_plan).toBe(true)
      expect(saved.plan_quarter).toBe('Q2')
    } finally {
      await cleanupDraft(page.request, state)
    }
  })

  test('E2E-02: 暂缓 + include_in_plan conflict returns 422', async ({
    page,
  }) => {
    const year = yearFor('E2E-02')
    await loginAs(page, 'member')
    const state = await ensureFreshDraft(page.request, year)
    try {
      const detail = await getFirstDetail(page.request, state.id)
      const currentLevel = Math.max(0, (detail.target_level ?? 1) - 1)

      const patchResp = await page.request.patch(
        `${BACKEND}/api/assessments/${state.id}/draft`,
        {
          data: {
            expected_revision: state.revision,
            details: [
              {
                l3_node_id: detail.l3_node_id,
                l3_code: detail.l3_code,
                current_level: currentLevel,
                member_priority: '暂缓',
                include_in_plan: true,
                plan_month: `${year}-01`,
              },
            ],
          },
        },
      )
      expect(patchResp.status()).toBe(422)
      expect((await patchResp.json()).detail.reason).toBe('hold_plan_mutex')

      // zero writes: revision and stored state unchanged
      const verify = await page.request.get(
        `${BACKEND}/api/assessments/${state.id}`,
      )
      const saved = await verify.json()
      expect(saved.revision).toBe(state.revision)
    } finally {
      await cleanupDraft(page.request, state)
    }
  })

  test('E2E-03: Gap-zero auto-clears plan fields', async ({ page }) => {
    const year = yearFor('E2E-03')
    await loginAs(page, 'member')
    const state = await ensureFreshDraft(page.request, year)
    try {
      const detail = await getFirstDetail(page.request, state.id)
      expect(detail.target_level).not.toBeNull()

      const patchResp = await page.request.patch(
        `${BACKEND}/api/assessments/${state.id}/draft`,
        {
          data: {
            expected_revision: state.revision,
            details: [
              {
                l3_node_id: detail.l3_node_id,
                l3_code: detail.l3_code,
                current_level: detail.target_level,
                member_priority: '高',
                include_in_plan: true,
                plan_month: `${year}-08`,
              },
            ],
          },
        },
      )
      expect(patchResp.ok()).toBeTruthy()

      const verify = await page.request.get(
        `${BACKEND}/api/assessments/${state.id}`,
      )
      const saved = (await verify.json()).details.find(
        (d: { l3_code: string }) => d.l3_code === detail.l3_code,
      )
      expect(saved.member_priority).toBeNull()
      expect(saved.include_in_plan).toBeNull()
      expect(saved.plan_quarter).toBeNull()
      expect(saved.plan_month).toBeNull()
    } finally {
      await cleanupDraft(page.request, state)
    }
  })

  test('E2E-04: plan_month uses the assessment year', async ({ page }) => {
    const year = yearFor('E2E-04')
    await loginAs(page, 'member')
    const state = await ensureFreshDraft(page.request, year)
    try {
      const detail = await getFirstDetail(page.request, state.id)
      const currentLevel = Math.max(0, (detail.target_level ?? 1) - 1)

      const patchResp = await page.request.patch(
        `${BACKEND}/api/assessments/${state.id}/draft`,
        {
          data: {
            expected_revision: state.revision,
            details: [
              {
                l3_node_id: detail.l3_node_id,
                l3_code: detail.l3_code,
                current_level: currentLevel,
                member_priority: '中',
                include_in_plan: true,
                plan_month: `${year}-05`,
              },
            ],
          },
        },
      )
      expect(patchResp.ok()).toBeTruthy()
      const saved = (
        await (
          await page.request.get(`${BACKEND}/api/assessments/${state.id}`)
        ).json()
      ).details.find((d: { l3_code: string }) => d.l3_code === detail.l3_code)
      expect(saved.plan_month).toBe(`${year}-05`)
      expect(saved.plan_quarter).toBe('Q2')
    } finally {
      await cleanupDraft(page.request, state)
    }
  })

  test('E2E-05: Revision 409 preserves local state (zero write)', async ({
    page,
  }) => {
    const year = yearFor('E2E-05')
    await loginAs(page, 'member')
    const state = await ensureFreshDraft(page.request, year)
    try {
      const detail = await getFirstDetail(page.request, state.id)

      // first save
      await page.request.patch(`${BACKEND}/api/assessments/${state.id}/draft`, {
        data: {
          expected_revision: state.revision,
          details: [
            {
              l3_node_id: detail.l3_node_id,
              l3_code: detail.l3_code,
              current_level: 2,
            },
          ],
        },
      })
      state.revision++

      // stale revision → 409
      const conflictResp = await page.request.patch(
        `${BACKEND}/api/assessments/${state.id}/draft`,
        {
          data: {
            expected_revision: state.revision - 1, // stale
            details: [
              {
                l3_node_id: detail.l3_node_id,
                l3_code: detail.l3_code,
                current_level: 3,
              },
            ],
          },
        },
      )
      expect(conflictResp.status()).toBe(409)

      // zero writes: stored level stays 2
      const verify = await page.request.get(
        `${BACKEND}/api/assessments/${state.id}`,
      )
      const saved = (await verify.json()).details.find(
        (d: { l3_code: string }) => d.l3_code === detail.l3_code,
      )
      expect(saved.current_level).toBe(2)
    } finally {
      await cleanupDraft(page.request, state)
    }
  })

  test('E2E-06: ratings save without evidence', async ({ page }) => {
    const year = yearFor('E2E-06')
    await loginAs(page, 'member')
    const state = await ensureFreshDraft(page.request, year)
    try {
      const allDetails = await getAllDetails(page.request, state.id)

      // Ratings-only saves normalize untouched plan fields to null.
      const patchDetails = allDetails.map((d) => ({
        l3_node_id: d.l3_node_id,
        l3_code: d.l3_code,
        current_level: d.target_level ?? 4,
      }))
      const patchResp = await page.request.patch(
        `${BACKEND}/api/assessments/${state.id}/draft`,
        {
          data: { expected_revision: state.revision, details: patchDetails },
        },
      )
      expect(patchResp.ok()).toBeTruthy()
      state.revision++
      const saved = (
        await (
          await page.request.get(`${BACKEND}/api/assessments/${state.id}`)
        ).json()
      ).details.find(
        (d: { l3_code: string }) => d.l3_code === allDetails[0].l3_code,
      )
      expect(saved.current_level).toBe(allDetails[0].target_level ?? 4)
      expect(saved.member_priority).toBeNull()
      expect(saved.include_in_plan).toBeNull()
    } finally {
      await cleanupDraft(page.request, state)
    }
  })

  test('E2E-07: Priority NOT auto-generated on draft creation', async ({
    page,
  }) => {
    const year = yearFor('E2E-07')
    await loginAs(page, 'member')
    const state = await ensureFreshDraft(page.request, year)
    try {
      const getResp = await page.request.get(
        `${BACKEND}/api/assessments/${state.id}`,
      )
      const assessment = await getResp.json()
      for (const d of assessment.details) {
        expect(d.member_priority).toBeNull()
        expect(d.include_in_plan).toBeNull()
      }
    } finally {
      await cleanupDraft(page.request, state)
    }
  })

  test('E2E-08: plan_candidate in PUT returns 422 deprecated_field', async ({
    page,
  }) => {
    const year = yearFor('E2E-08')
    await loginAs(page, 'member')
    const state = await ensureFreshDraft(page.request, year)
    try {
      const detail = await getFirstDetail(page.request, state.id)

      const patchResp = await page.request.patch(
        `${BACKEND}/api/assessments/${state.id}/draft`,
        {
          data: {
            expected_revision: state.revision,
            details: [
              {
                l3_node_id: detail.l3_node_id,
                l3_code: detail.l3_code,
                current_level: 2,
                plan_candidate: true,
              },
            ],
          },
        },
      )
      expect(patchResp.status()).toBe(422)
      const body = await patchResp.json()
      expect(body.detail.code).toBe('deprecated_field')
    } finally {
      await cleanupDraft(page.request, state)
    }
  })

  test('E2E-09: Legacy gap write blocked for scope-v1', async ({ page }) => {
    const year = yearFor('E2E-09')
    await loginAs(page, 'member')
    const state = await ensureFreshDraft(page.request, year)
    try {
      const detail = await getFirstDetail(page.request, state.id)
      const currentLevel = Math.max(0, (detail.target_level ?? 1) - 1)

      // save with gap>0 to generate a gap row
      await page.request.patch(`${BACKEND}/api/assessments/${state.id}/draft`, {
        data: {
          expected_revision: state.revision,
          details: [
            {
              l3_node_id: detail.l3_node_id,
              l3_code: detail.l3_code,
              current_level: currentLevel,
              member_priority: '高',
              include_in_plan: true,
              plan_month: `${year}-05`,
            },
          ],
        },
      })
      state.revision++

      // try direct gap update → should be blocked
      const gapsResp = await page.request.get(
        `${BACKEND}/api/gaps?assessment_id=${state.id}`,
      )
      const gaps = await gapsResp.json()
      if (gaps.length > 0) {
        const gapId = gaps[0].id
        const updateResp = await page.request.put(
          `${BACKEND}/api/gaps/${gapId}`,
          { data: { priority: '高', plan_candidate: true } },
        )
        expect(updateResp.status()).toBe(422)
        const body = await updateResp.json()
        expect(body.detail.code).toBe('legacy_gap_write_disabled')
      }
    } finally {
      await cleanupDraft(page.request, state)
    }
  })

  test('E2E-10: include_in_plan tri-state: NULL→FALSE→TRUE→NULL roundtrip', async ({
    page,
  }) => {
    const year = yearFor('E2E-10')
    await loginAs(page, 'member')
    const state = await ensureFreshDraft(page.request, year)
    try {
      const detail = await getFirstDetail(page.request, state.id)
      const currentLevel = Math.max(0, (detail.target_level ?? 1) - 1)

      // Establish a positive-gap baseline from the frozen target first.
      await page.request.patch(`${BACKEND}/api/assessments/${state.id}/draft`, {
        data: {
          expected_revision: state.revision,
          details: [
            {
              l3_node_id: detail.l3_node_id,
              l3_code: detail.l3_code,
              current_level: currentLevel,
              member_priority: '中',
              include_in_plan: false,
            },
          ],
        },
      })
      state.revision++
      const v1 = await page.request.get(
        `${BACKEND}/api/assessments/${state.id}`,
      )
      const s1 = (await v1.json()).details.find(
        (d: { l3_code: string }) => d.l3_code === detail.l3_code,
      )
      expect(s1.include_in_plan).toBe(false)
      expect(s1.plan_quarter).toBeNull()

      // FALSE → TRUE
      await page.request.patch(`${BACKEND}/api/assessments/${state.id}/draft`, {
        data: {
          expected_revision: state.revision,
          details: [
            {
              l3_node_id: detail.l3_node_id,
              l3_code: detail.l3_code,
              include_in_plan: true,
              plan_month: `${year}-12`,
            },
          ],
        },
      })
      state.revision++
      const v2 = await page.request.get(
        `${BACKEND}/api/assessments/${state.id}`,
      )
      const s2 = (await v2.json()).details.find(
        (d: { l3_code: string }) => d.l3_code === detail.l3_code,
      )
      expect(s2.include_in_plan).toBe(true)
      expect(s2.plan_quarter).toBe('Q4')

      // TRUE → NULL (explicit)
      await page.request.patch(`${BACKEND}/api/assessments/${state.id}/draft`, {
        data: {
          expected_revision: state.revision,
          details: [
            {
              l3_node_id: detail.l3_node_id,
              l3_code: detail.l3_code,
              include_in_plan: null,
            },
          ],
        },
      })
      state.revision++
      const v3 = await page.request.get(
        `${BACKEND}/api/assessments/${state.id}`,
      )
      const s3 = (await v3.json()).details.find(
        (d: { l3_code: string }) => d.l3_code === detail.l3_code,
      )
      expect(s3.include_in_plan).toBeNull()
      expect(s3.plan_quarter).toBeNull()
    } finally {
      await cleanupDraft(page.request, state)
    }
  })

  test('E2E-11: All items filled with valid plan → explicit generation succeeds', async ({
    page,
  }) => {
    const year = yearFor('E2E-11')
    await loginAs(page, 'member')
    const state = await ensureFreshDraft(page.request, year)
    try {
      const allDetails = await getAllDetails(page.request, state.id)

      const plannedDetails = allDetails.filter((d) => d.target_level !== null)
      expect(plannedDetails.length).toBeGreaterThan(0)

      // Fill every applicable item with a positive-gap plan selection.
      const patchDetails = plannedDetails.map((d) => ({
        l3_node_id: d.l3_node_id,
        l3_code: d.l3_code,
        current_level: Math.max(0, (d.target_level ?? 1) - 1),
        member_priority: '低',
        include_in_plan: true,
        plan_month: `${year}-05`,
      }))
      const patchResp = await page.request.patch(
        `${BACKEND}/api/assessments/${state.id}/draft`,
        {
          data: { expected_revision: state.revision, details: patchDetails },
        },
      )
      expect(patchResp.ok()).toBeTruthy()
      state.revision++

      const genResp = await page.request.post(
        `${BACKEND}/api/assessments/${state.id}/generate-plan-items`,
        {
          headers: { 'Idempotency-Key': `generate-plan-items:e2e-11-${year}` },
          data: {
            expected_revision: state.revision,
            l3_codes: plannedDetails.map((d) => d.l3_code),
          },
        },
      )
      expect(genResp.status()).toBe(200)
      const generated = await genResp.json()
      expect(generated.created.length + generated.existing.length).toBe(
        plannedDetails.length,
      )
    } finally {
      await cleanupDraft(page.request, state)
    }
  })

  test('E2E-12: Structured plan error includes l3_node_id, l3_code, field', async ({
    page,
  }) => {
    const year = yearFor('E2E-12')
    await loginAs(page, 'member')
    const state = await ensureFreshDraft(page.request, year)
    try {
      const allDetails = await getAllDetails(page.request, state.id)
      const applicable = allDetails.filter((d) => d.target_level !== null)
      expect(applicable.length).toBeGreaterThanOrEqual(2)
      const blocked = applicable[0]

      // Close every other applicable item so the blocked row is the only
      // plan-validation failure.
      const others = applicable.filter((d) => d.l3_code !== blocked.l3_code)
      const fillResp = await page.request.patch(
        `${BACKEND}/api/assessments/${state.id}/draft`,
        {
          data: {
            expected_revision: state.revision,
            details: others.map((d) => ({
              l3_node_id: d.l3_node_id,
              l3_code: d.l3_code,
              current_level: d.target_level,
            })),
          },
        },
      )
      expect(fillResp.ok()).toBeTruthy()
      state.revision++

      const conflictResp = await page.request.patch(
        `${BACKEND}/api/assessments/${state.id}/draft`,
        {
          data: {
            expected_revision: state.revision,
            details: [
              {
                l3_node_id: blocked.l3_node_id,
                l3_code: blocked.l3_code,
                current_level: Math.max(0, (blocked.target_level ?? 1) - 1),
                member_priority: '暂缓',
                include_in_plan: true,
              },
            ],
          },
        },
      )
      expect(conflictResp.status()).toBe(422)
      const body = await conflictResp.json()
      expect(body.detail.reason).toBe('hold_plan_mutex')
      expect(body.detail.l3_code).toBe(blocked.l3_code)
      expect(body.detail.l3_node_id).toBe(blocked.l3_node_id)
      expect(body.detail.field).toBe('include_in_plan')
      expect(body.detail.message).toBeDefined()
    } finally {
      await cleanupDraft(page.request, state)
    }
  })

  test('E2E-13: PATCH preserves unset fields', async ({ page }) => {
    const year = yearFor('E2E-13')
    await loginAs(page, 'member')
    const state = await ensureFreshDraft(page.request, year)
    try {
      const detail = await getFirstDetail(page.request, state.id)
      const currentLevel = Math.max(0, (detail.target_level ?? 1) - 1)
      const nextLevel = Math.max(0, currentLevel - 1)

      // Establish a positive gap from the frozen target with a full plan
      // selection.
      const first = await page.request.patch(
        `${BACKEND}/api/assessments/${state.id}/draft`,
        {
          data: {
            expected_revision: state.revision,
            details: [
              {
                l3_node_id: detail.l3_node_id,
                l3_code: detail.l3_code,
                current_level: currentLevel,
                member_priority: '中',
                include_in_plan: true,
                plan_month: `${year}-06`,
              },
            ],
          },
        },
      )
      expect(first.ok()).toBeTruthy()
      state.revision++

      // PATCH only current_level — omitted fields must keep their DB values.
      const second = await page.request.patch(
        `${BACKEND}/api/assessments/${state.id}/draft`,
        {
          data: {
            expected_revision: state.revision,
            details: [
              {
                l3_node_id: detail.l3_node_id,
                l3_code: detail.l3_code,
                current_level: nextLevel,
              },
            ],
          },
        },
      )
      expect(second.ok()).toBeTruthy()
      const secondBody = await second.json()
      // The frozen target remains above the replacement rating, so no
      // auto-clear may fire.
      expect(secondBody.auto_cleared).toEqual([])
      state.revision++

      const verify = await page.request.get(
        `${BACKEND}/api/assessments/${state.id}`,
      )
      const saved = (await verify.json()).details.find(
        (d: { l3_code: string }) => d.l3_code === detail.l3_code,
      )
      expect(saved.current_level).toBe(nextLevel)
      expect(saved.member_priority).toBe('中') // preserved from first PATCH
      expect(saved.include_in_plan).toBe(true)
      expect(saved.plan_quarter).toBe('Q2')
      expect(saved.plan_month).toBe(`${year}-06`)
    } finally {
      await cleanupDraft(page.request, state)
    }
  })

  test('E2E-14: PATCH explicit null clears field', async ({ page }) => {
    const year = yearFor('E2E-14')
    await loginAs(page, 'member')
    const state = await ensureFreshDraft(page.request, year)
    try {
      const detail = await getFirstDetail(page.request, state.id)
      const currentLevel = Math.max(0, (detail.target_level ?? 1) - 1)

      // First set a value with a positive frozen-target gap, include=NO.
      const first = await page.request.patch(
        `${BACKEND}/api/assessments/${state.id}/draft`,
        {
          data: {
            expected_revision: state.revision,
            details: [
              {
                l3_node_id: detail.l3_node_id,
                l3_code: detail.l3_code,
                current_level: currentLevel,
                member_priority: '高',
                include_in_plan: false,
              },
            ],
          },
        },
      )
      expect(first.ok()).toBeTruthy()
      state.revision++

      // now explicitly set priority to null
      const second = await page.request.patch(
        `${BACKEND}/api/assessments/${state.id}/draft`,
        {
          data: {
            expected_revision: state.revision,
            details: [
              {
                l3_node_id: detail.l3_node_id,
                l3_code: detail.l3_code,
                member_priority: null,
              },
            ],
          },
        },
      )
      expect(second.ok()).toBeTruthy()
      state.revision++

      const verify = await page.request.get(
        `${BACKEND}/api/assessments/${state.id}`,
      )
      const saved = (await verify.json()).details.find(
        (d: { l3_code: string }) => d.l3_code === detail.l3_code,
      )
      expect(saved.member_priority).toBeNull()
      // current_level should still be 0 (was not cleared)
      expect(saved.current_level).toBe(0)
    } finally {
      await cleanupDraft(page.request, state)
    }
  })

  test('E2E-15: current_level=0 vs NULL distinct semantic', async ({
    page,
  }) => {
    const year = yearFor('E2E-15')
    await loginAs(page, 'member')
    const state = await ensureFreshDraft(page.request, year)
    try {
      // 1. Read and pin the initial state of two distinct rows.
      const allDetails = await getAllDetails(page.request, state.id)
      expect(allDetails.length).toBeGreaterThanOrEqual(2)
      const dA = allDetails[0]
      const dB = allDetails[1]

      // 2. Establish a provable NULL initial state for BOTH rows via a
      //    legal explicit-clear PATCH (current_level: null).
      const clearResp = await page.request.patch(
        `${BACKEND}/api/assessments/${state.id}/draft`,
        {
          data: {
            expected_revision: state.revision,
            details: [
              {
                l3_node_id: dA.l3_node_id,
                l3_code: dA.l3_code,
                current_level: null,
              },
              {
                l3_node_id: dB.l3_node_id,
                l3_code: dB.l3_code,
                current_level: null,
              },
            ],
          },
        },
      )
      expect(clearResp.ok()).toBeTruthy()
      state.revision++

      const afterClear = await page.request.get(
        `${BACKEND}/api/assessments/${state.id}`,
      )
      const clearedDetails = (await afterClear.json()).details as Detail[]
      const clearedA = clearedDetails.find((d) => d.l3_code === dA.l3_code)
      const clearedB = clearedDetails.find((d) => d.l3_code === dB.l3_code)
      expect(clearedA?.current_level).toBeNull()
      expect(clearedB?.current_level).toBeNull()
      const baselineAssessed = clearedDetails.filter(
        (d) => d.current_level !== null,
      ).length

      // 3. Set dA to explicit 0.
      const zeroResp = await page.request.patch(
        `${BACKEND}/api/assessments/${state.id}/draft`,
        {
          data: {
            expected_revision: state.revision,
            details: [
              {
                l3_node_id: dA.l3_node_id,
                l3_code: dA.l3_code,
                current_level: 0,
                member_priority: '中',
                include_in_plan: false,
              },
            ],
          },
        },
      )
      expect(zeroResp.ok()).toBeTruthy()
      state.revision++

      // 4. Precise readback: A === 0 (assessed), B === null (unassessed).
      const verify = await page.request.get(
        `${BACKEND}/api/assessments/${state.id}`,
      )
      const savedDetails = (await verify.json()).details as Detail[]
      const savedA = savedDetails.find((d) => d.l3_code === dA.l3_code)
      const savedB = savedDetails.find((d) => d.l3_code === dB.l3_code)
      expect(savedA?.current_level).toBe(0)
      expect(savedB?.current_level).toBeNull()

      // 5. Summary semantics: 0 counts as assessed, NULL as unassessed.
      const assessedCount = savedDetails.filter(
        (d) => d.current_level !== null,
      ).length
      const unassessedCount = savedDetails.filter(
        (d) => d.current_level === null,
      ).length
      expect(assessedCount).toBe(baselineAssessed + 1)
      expect(unassessedCount).toBe(savedDetails.length - baselineAssessed - 1)
    } finally {
      await cleanupDraft(page.request, state)
    }
  })

  test('E2E-16: 暂缓 auto-sets include_in_plan=false', async ({ page }) => {
    const year = yearFor('E2E-16')
    await loginAs(page, 'member')
    const state = await ensureFreshDraft(page.request, year)
    try {
      const detail = await getFirstDetail(page.request, state.id)
      const currentLevel = Math.max(0, (detail.target_level ?? 1) - 1)

      // 1. Existing plan item: 高 priority, include_in_plan=true, 5月.
      const setup = await page.request.patch(
        `${BACKEND}/api/assessments/${state.id}/draft`,
        {
          data: {
            expected_revision: state.revision,
            details: [
              {
                l3_node_id: detail.l3_node_id,
                l3_code: detail.l3_code,
                current_level: currentLevel,
                member_priority: '高',
                include_in_plan: true,
                plan_month: `${year}-05`,
              },
            ],
          },
        },
      )
      expect(setup.ok()).toBeTruthy()
      state.revision++

      // 2. PATCH only member_priority=暂缓 → server auto-clears the plan.
      const hold = await page.request.patch(
        `${BACKEND}/api/assessments/${state.id}/draft`,
        {
          data: {
            expected_revision: state.revision,
            details: [
              {
                l3_node_id: detail.l3_node_id,
                l3_code: detail.l3_code,
                member_priority: '暂缓',
              },
            ],
          },
        },
      )
      expect(hold.ok()).toBeTruthy()
      const holdBody = await hold.json()
      const cleared = (holdBody.auto_cleared as AutoClearedEntry[]).find(
        (entry) => entry.l3_code === detail.l3_code,
      )
      expect(cleared).toBeDefined()
      expect(cleared?.l3_node_id).toBe(detail.l3_node_id)
      expect(cleared?.fields).toEqual(
        expect.arrayContaining(['include_in_plan', 'plan_month']),
      )
      expect(cleared?.fields).not.toContain('plan_quarter')
      state.revision++

      // 3. Server final state: include=false, quarter/month null.
      const verify = await page.request.get(
        `${BACKEND}/api/assessments/${state.id}`,
      )
      const saved = (await verify.json()).details.find(
        (d: { l3_code: string }) => d.l3_code === detail.l3_code,
      )
      expect(saved.member_priority).toBe('暂缓')
      expect(saved.include_in_plan).toBe(false)
      expect(saved.plan_quarter).toBeNull()
      expect(saved.plan_month).toBeNull()

      // 4. Explicit 暂缓 + include_in_plan=true → 422, zero writes.
      const conflict = await page.request.patch(
        `${BACKEND}/api/assessments/${state.id}/draft`,
        {
          data: {
            expected_revision: state.revision,
            details: [
              {
                l3_node_id: detail.l3_node_id,
                l3_code: detail.l3_code,
                member_priority: '暂缓',
                include_in_plan: true,
                plan_month: `${year}-08`,
              },
            ],
          },
        },
      )
      expect(conflict.status()).toBe(422)
      const afterConflict = await page.request.get(
        `${BACKEND}/api/assessments/${state.id}`,
      )
      const finalState = await afterConflict.json()
      expect(finalState.revision).toBe(state.revision)
      const finalDetail = finalState.details.find(
        (d: { l3_code: string }) => d.l3_code === detail.l3_code,
      )
      expect(finalDetail.member_priority).toBe('暂缓')
      expect(finalDetail.include_in_plan).toBe(false)
      expect(finalDetail.plan_quarter).toBeNull()
      expect(finalDetail.plan_month).toBeNull()
    } finally {
      await cleanupDraft(page.request, state)
    }
  })

  test('E2E-17: scope-v1 identity — PUT coverage and l3_node_id rules', async ({
    page,
  }) => {
    const year = yearFor('E2E-17')
    await loginAs(page, 'member')
    const state = await ensureFreshDraft(page.request, year)
    try {
      const allDetails = await getAllDetails(page.request, state.id)
      expect(allDetails.length).toBeGreaterThanOrEqual(2)
      const first = allDetails[0]
      const untouched = allDetails[1]

      // 1. PUT supports a sparse ratings save.
      const subsetPut = await page.request.put(
        `${BACKEND}/api/assessments/${state.id}/draft`,
        {
          data: {
            expected_revision: state.revision,
            details: [
              {
                l3_node_id: first.l3_node_id,
                l3_code: first.l3_code,
                current_level: 1,
              },
            ],
          },
        },
      )
      expect(subsetPut.status()).toBe(200)
      const subsetBody = await subsetPut.json()
      expect(subsetBody.revision).toBe(state.revision + 1)
      state.revision = subsetBody.revision

      const afterSubset = await page.request.get(
        `${BACKEND}/api/assessments/${state.id}`,
      )
      const savedAfterSubset = await afterSubset.json()
      expect(savedAfterSubset.revision).toBe(state.revision)
      const savedFirstAfterSubset = savedAfterSubset.details.find(
        (d: { l3_code: string }) => d.l3_code === first.l3_code,
      )
      const savedUntouchedAfterSubset = savedAfterSubset.details.find(
        (d: { l3_code: string }) => d.l3_code === untouched.l3_code,
      )
      expect(savedFirstAfterSubset.current_level).toBe(1)
      expect(savedUntouchedAfterSubset.current_level).toBe(
        untouched.current_level,
      )

      // 2. PUT missing l3_node_id → 422 l3_node_id_required.
      const noNodePut = await page.request.put(
        `${BACKEND}/api/assessments/${state.id}/draft`,
        {
          data: {
            expected_revision: state.revision,
            details: allDetails.map((d) => ({
              l3_code: d.l3_code,
              current_level: 1,
            })),
          },
        },
      )
      expect(noNodePut.status()).toBe(422)
      const noNodePutBody = await noNodePut.json()
      expect(noNodePutBody.detail.code).toBe('l3_node_id_required')

      // 3. PATCH missing l3_node_id → 422 l3_node_id_required.
      const noNodePatch = await page.request.patch(
        `${BACKEND}/api/assessments/${state.id}/draft`,
        {
          data: {
            expected_revision: state.revision,
            details: [{ l3_code: first.l3_code, current_level: 1 }],
          },
        },
      )
      expect(noNodePatch.status()).toBe(422)
      const noNodePatchBody = await noNodePatch.json()
      expect(noNodePatchBody.detail.code).toBe('l3_node_id_required')
      expect(noNodePatchBody.detail.field).toBe('l3_node_id')
      expect(noNodePatchBody.detail.message).toBeDefined()

      // 4. PATCH unknown l3_node_id → 422 l3_node_id_not_found.
      const unknownPatch = await page.request.patch(
        `${BACKEND}/api/assessments/${state.id}/draft`,
        {
          data: {
            expected_revision: state.revision,
            details: [
              {
                l3_node_id: first.l3_node_id + 900000,
                l3_code: first.l3_code,
                current_level: 1,
              },
            ],
          },
        },
      )
      expect(unknownPatch.status()).toBe(422)
      const unknownBody = await unknownPatch.json()
      expect(unknownBody.detail.code).toBe('l3_node_id_not_found')
      expect(unknownBody.detail.l3_node_id).toBe(first.l3_node_id + 900000)

      // 5. PATCH duplicate l3_node_id → 422 duplicate_detail.
      const dupPatch = await page.request.patch(
        `${BACKEND}/api/assessments/${state.id}/draft`,
        {
          data: {
            expected_revision: state.revision,
            details: [
              {
                l3_node_id: first.l3_node_id,
                l3_code: first.l3_code,
                current_level: 1,
              },
              {
                l3_node_id: first.l3_node_id,
                l3_code: first.l3_code,
                current_level: 2,
              },
            ],
          },
        },
      )
      expect(dupPatch.status()).toBe(422)
      const dupBody = await dupPatch.json()
      expect(dupBody.detail.code).toBe('duplicate_detail')

      // 6. All rejected identity writes preserve the sparse-save state.
      const verify = await page.request.get(
        `${BACKEND}/api/assessments/${state.id}`,
      )
      const saved = await verify.json()
      expect(saved.revision).toBe(state.revision)
      const savedFirst = saved.details.find(
        (d: { l3_code: string }) => d.l3_code === first.l3_code,
      )
      expect(savedFirst.current_level).toBe(1)
    } finally {
      await cleanupDraft(page.request, state)
    }
  })

  test('E2E-18: l3_code_mismatch — wrong code for node_id returns 422', async ({
    page,
  }) => {
    const year = yearFor('E2E-18')
    await loginAs(page, 'member')
    const state = await ensureFreshDraft(page.request, year)
    try {
      const allDetails = await getAllDetails(page.request, state.id)
      expect(allDetails.length).toBeGreaterThanOrEqual(2)
      const detail = allDetails[0]
      const wrongL3Code = allDetails[1].l3_code

      // correct node_id but a different detail's code → structured 422
      const patchResp = await page.request.patch(
        `${BACKEND}/api/assessments/${state.id}/draft`,
        {
          data: {
            expected_revision: state.revision,
            details: [
              {
                l3_node_id: detail.l3_node_id,
                l3_code: wrongL3Code,
                current_level: 2,
              },
            ],
          },
        },
      )
      expect(patchResp.status()).toBe(422)
      const body = await patchResp.json()
      expect(body.detail.code).toBe('l3_code_mismatch')
      expect(body.detail.l3_node_id).toBe(detail.l3_node_id)
      expect(body.detail.l3_code).toBe(wrongL3Code)
      expect(body.detail.field).toBe('l3_code')
      expect(body.detail.reason).toBeDefined()
      expect(body.detail.message).toBeDefined()

      // zero writes: revision and stored state unchanged
      const verify = await page.request.get(
        `${BACKEND}/api/assessments/${state.id}`,
      )
      const saved = await verify.json()
      expect(saved.revision).toBe(state.revision)
      const savedDetail = saved.details.find(
        (d: { l3_code: string }) => d.l3_code === detail.l3_code,
      )
      expect(savedDetail.current_level).toBe(detail.current_level)
    } finally {
      await cleanupDraft(page.request, state)
    }
  })
})

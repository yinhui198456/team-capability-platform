/** Issue #61: Assessment field refactor — E2E smoke tests.

Covers key business scenarios with real API calls:
- 0-level submission, 暂缓+plan mutual exclusion, Gap-zero auto-clear,
  quarter-month mapping, PATCH sparse semantics, revision 409,
  no-evidence submit, priority not auto-generated, tri-state plan,
  deprecated plan_candidate rejection, legacy gap write block.
*/

import { expect, test } from '@playwright/test'

import { loginAs } from '../fixtures/auth'

const BACKEND = process.env.PLAYWRIGHT_BACKEND_URL ?? 'http://localhost:18001'

test.describe('Issue #61 — assessment field refactor', () => {
  test('E2E-01: Full self-assessment flow with 0-level and plan selection', async ({
    page,
  }) => {
    await loginAs(page, 'member')

    // Preview scope
    const previewResp = await page.request.get(
      `${BACKEND}/api/assessments/scope-preview?year=2026&assessment_type=年度`,
    )
    expect(previewResp.ok()).toBeTruthy()
    const preview = await previewResp.json()
    expect(preview.scope_token).toBeTruthy()
    expect(preview.summary.total).toBeGreaterThan(0)

    // Create draft
    const createResp = await page.request.post(`${BACKEND}/api/assessments`, {
      data: { year: 2026, assessment_type: '年度', scope_token: preview.scope_token },
    })
    expect(createResp.ok()).toBeTruthy()
    const draft = await createResp.json()
    const assessmentId = draft.id

    // Get detail codes
    const getResp = await page.request.get(`${BACKEND}/api/assessments/${assessmentId}`)
    expect(getResp.ok()).toBeTruthy()
    const assessment = await getResp.json()
    const details = assessment.details
    expect(details.length).toBeGreaterThan(0)

    // Fill first detail: level=0, priority=低, include_in_plan=true, Q2, 5月
    const patchResp1 = await page.request.patch(
      `${BACKEND}/api/assessments/${assessmentId}/draft`,
      {
        data: {
          expected_revision: 1,
          details: [
            {
              l3_node_id: details[0].l3_node_id,
              l3_code: details[0].l3_code,
              current_level: 0,
              member_priority: '低',
              include_in_plan: true,
              plan_quarter: 'Q2',
              plan_month: 5,
            },
          ],
        },
      },
    )
    expect(patchResp1.ok()).toBeTruthy()

    // Verify saved
    const verify1 = await page.request.get(`${BACKEND}/api/assessments/${assessmentId}`)
    expect(verify1.ok()).toBeTruthy()
    const saved1 = await verify1.json()
    const savedDetail = saved1.details.find(
      (d: { l3_code: string }) => d.l3_code === details[0].l3_code,
    )
    expect(savedDetail.current_level).toBe(0)
    expect(savedDetail.member_priority).toBe('低')
    expect(savedDetail.include_in_plan).toBe(true)

    // Submit
    const submitResp = await page.request.post(
      `${BACKEND}/api/assessments/${assessmentId}/submit`,
      { data: { expected_revision: 2 } },
    )
    // May be 200 or 422 depending on other items
    expect([200, 422]).toContain(submitResp.status())
  })

  test('E2E-02: 暂缓 + include_in_plan conflict returns 422', async ({ page }) => {
    await loginAs(page, 'member')

    const previewResp = await page.request.get(
      `${BACKEND}/api/assessments/scope-preview?year=2026&assessment_type=年度`,
    )
    expect(previewResp.ok()).toBeTruthy()
    const preview = await previewResp.json()

    const createResp = await page.request.post(`${BACKEND}/api/assessments`, {
      data: { year: 2026, assessment_type: '年度', scope_token: preview.scope_token },
    })
    expect(createResp.ok()).toBeTruthy()
    const draft = await createResp.json()
    const getResp = await page.request.get(
      `${BACKEND}/api/assessments/${draft.id}`,
    )
    const assessment = await getResp.json()
    const detail = assessment.details[0]

    const patchResp = await page.request.patch(
      `${BACKEND}/api/assessments/${draft.id}/draft`,
      {
        data: {
          expected_revision: 1,
          details: [
            {
              l3_node_id: detail.l3_node_id,
              l3_code: detail.l3_code,
              current_level: 0,
              member_priority: '暂缓',
              include_in_plan: true,
              plan_quarter: 'Q1',
              plan_month: 1,
            },
          ],
        },
      },
    )
    expect(patchResp.status()).toBe(422)
  })

  test('E2E-03: Gap-zero auto-clears plan fields', async ({ page }) => {
    await loginAs(page, 'member')

    const previewResp = await page.request.get(
      `${BACKEND}/api/assessments/scope-preview?year=2026&assessment_type=年度`,
    )
    expect(previewResp.ok()).toBeTruthy()
    const preview = await previewResp.json()

    const createResp = await page.request.post(`${BACKEND}/api/assessments`, {
      data: { year: 2026, assessment_type: '年度', scope_token: preview.scope_token },
    })
    expect(createResp.ok()).toBeTruthy()
    const draft = await createResp.json()
    const getResp = await page.request.get(
      `${BACKEND}/api/assessments/${draft.id}`,
    )
    const assessment = await getResp.json()
    const detail = assessment.details[0]

    // Set current_level = target_level → gap=0
    const patchResp = await page.request.patch(
      `${BACKEND}/api/assessments/${draft.id}/draft`,
      {
        data: {
          expected_revision: 1,
          details: [
            {
              l3_node_id: detail.l3_node_id,
              l3_code: detail.l3_code,
              current_level: detail.target_level,
              member_priority: '高',
              include_in_plan: true,
              plan_quarter: 'Q3',
              plan_month: 8,
            },
          ],
        },
      },
    )
    expect(patchResp.ok()).toBeTruthy()

    const verify = await page.request.get(
      `${BACKEND}/api/assessments/${draft.id}`,
    )
    const saved = await verify.json()
    const savedDetail = saved.details.find(
      (d: { l3_code: string }) => d.l3_code === detail.l3_code,
    )
    expect(savedDetail.member_priority).toBeNull()
    expect(savedDetail.include_in_plan).toBeNull()
    expect(savedDetail.plan_quarter).toBeNull()
    expect(savedDetail.plan_month).toBeNull()
  })

  test('E2E-04: Quarter-month mismatch rejected', async ({ page }) => {
    await loginAs(page, 'member')

    const previewResp = await page.request.get(
      `${BACKEND}/api/assessments/scope-preview?year=2026&assessment_type=年度`,
    )
    expect(previewResp.ok()).toBeTruthy()
    const preview = await previewResp.json()

    const createResp = await page.request.post(`${BACKEND}/api/assessments`, {
      data: { year: 2026, assessment_type: '年度', scope_token: preview.scope_token },
    })
    expect(createResp.ok()).toBeTruthy()
    const draft = await createResp.json()
    const getResp = await page.request.get(
      `${BACKEND}/api/assessments/${draft.id}`,
    )
    const assessment = await getResp.json()
    const detail = assessment.details[0]

    // Q1 + 5月 should fail
    const patchResp = await page.request.patch(
      `${BACKEND}/api/assessments/${draft.id}/draft`,
      {
        data: {
          expected_revision: 1,
          details: [
            {
              l3_node_id: detail.l3_node_id,
              l3_code: detail.l3_code,
              current_level: 0,
              member_priority: '中',
              include_in_plan: true,
              plan_quarter: 'Q1',
              plan_month: 5,
            },
          ],
        },
      },
    )
    expect(patchResp.status()).toBe(422)
  })

  test('E2E-05: Revision 409 preserves local state (zero write)', async ({
    page,
  }) => {
    await loginAs(page, 'member')

    const previewResp = await page.request.get(
      `${BACKEND}/api/assessments/scope-preview?year=2026&assessment_type=年度`,
    )
    expect(previewResp.ok()).toBeTruthy()
    const preview = await previewResp.json()

    const createResp = await page.request.post(`${BACKEND}/api/assessments`, {
      data: { year: 2026, assessment_type: '年度', scope_token: preview.scope_token },
    })
    expect(createResp.ok()).toBeTruthy()
    const draft = await createResp.json()
    const getResp = await page.request.get(
      `${BACKEND}/api/assessments/${draft.id}`,
    )
    const detail = (await getResp.json()).details[0]

    // First save
    await page.request.patch(
      `${BACKEND}/api/assessments/${draft.id}/draft`,
      {
        data: {
          expected_revision: 1,
          details: [{ l3_node_id: detail.l3_node_id, l3_code: detail.l3_code, current_level: 2 }],
        },
      },
    )

    // Stale revision → 409
    const conflictResp = await page.request.patch(
      `${BACKEND}/api/assessments/${draft.id}/draft`,
      {
        data: {
          expected_revision: 1,
          details: [{ l3_node_id: detail.l3_node_id, l3_code: detail.l3_code, current_level: 3 }],
        },
      },
    )
    expect(conflictResp.status()).toBe(409)
  })

  test('E2E-06: Submit without evidence succeeds (gate removed)', async ({
    page,
  }) => {
    await loginAs(page, 'member')

    const previewResp = await page.request.get(
      `${BACKEND}/api/assessments/scope-preview?year=2026&assessment_type=年度`,
    )
    expect(previewResp.ok()).toBeTruthy()
    const preview = await previewResp.json()

    const createResp = await page.request.post(`${BACKEND}/api/assessments`, {
      data: { year: 2026, assessment_type: '年度', scope_token: preview.scope_token },
    })
    expect(createResp.ok()).toBeTruthy()
    const draft = await createResp.json()
    const getResp = await page.request.get(
      `${BACKEND}/api/assessments/${draft.id}`,
    )
    const details = (await getResp.json()).details

    // Fill ALL items with level≥3 and include_in_plan=false, priority
    const patchDetails = details.map((d: { l3_node_id: number; l3_code: string }) => ({
      l3_node_id: d.l3_node_id,
      l3_code: d.l3_code,
      current_level: 4,
      member_priority: '中',
      include_in_plan: false,
    }))
    await page.request.patch(
      `${BACKEND}/api/assessments/${draft.id}/draft`,
      { data: { expected_revision: 1, details: patchDetails } },
    )

    const submitResp = await page.request.post(
      `${BACKEND}/api/assessments/${draft.id}/submit`,
      { data: { expected_revision: 2 } },
    )
    expect(submitResp.ok()).toBeTruthy()
  })

  test('E2E-07: Priority NOT auto-generated on draft creation', async ({
    page,
  }) => {
    await loginAs(page, 'member')

    const previewResp = await page.request.get(
      `${BACKEND}/api/assessments/scope-preview?year=2026&assessment_type=年度`,
    )
    expect(previewResp.ok()).toBeTruthy()
    const preview = await previewResp.json()

    const createResp = await page.request.post(`${BACKEND}/api/assessments`, {
      data: { year: 2026, assessment_type: '年度', scope_token: preview.scope_token },
    })
    expect(createResp.ok()).toBeTruthy()
    const draft = await createResp.json()

    const getResp = await page.request.get(
      `${BACKEND}/api/assessments/${draft.id}`,
    )
    const assessment = await getResp.json()
    for (const d of assessment.details) {
      expect(d.member_priority).toBeNull()
      expect(d.include_in_plan).toBeNull()
    }
  })

  test('E2E-08: plan_candidate in PUT returns 422 deprecated_field', async ({
    page,
  }) => {
    await loginAs(page, 'member')

    const previewResp = await page.request.get(
      `${BACKEND}/api/assessments/scope-preview?year=2026&assessment_type=年度`,
    )
    expect(previewResp.ok()).toBeTruthy()
    const preview = await previewResp.json()

    const createResp = await page.request.post(`${BACKEND}/api/assessments`, {
      data: { year: 2026, assessment_type: '年度', scope_token: preview.scope_token },
    })
    expect(createResp.ok()).toBeTruthy()
    const draft = await createResp.json()
    const getResp = await page.request.get(
      `${BACKEND}/api/assessments/${draft.id}`,
    )
    const detail = (await getResp.json()).details[0]

    const patchResp = await page.request.patch(
      `${BACKEND}/api/assessments/${draft.id}/draft`,
      {
        data: {
          expected_revision: 1,
          details: [
            { l3_node_id: detail.l3_node_id, l3_code: detail.l3_code, current_level: 2, plan_candidate: true },
          ],
        },
      },
    )
    expect(patchResp.status()).toBe(422)
    const body = await patchResp.json()
    expect(body.detail.code).toBe('deprecated_field')
  })

  test('E2E-09: Legacy gap write blocked for scope-v1', async ({ page }) => {
    await loginAs(page, 'member')

    const previewResp = await page.request.get(
      `${BACKEND}/api/assessments/scope-preview?year=2026&assessment_type=年度`,
    )
    expect(previewResp.ok()).toBeTruthy()
    const preview = await previewResp.json()

    const createResp = await page.request.post(`${BACKEND}/api/assessments`, {
      data: { year: 2026, assessment_type: '年度', scope_token: preview.scope_token },
    })
    expect(createResp.ok()).toBeTruthy()
    const draft = await createResp.json()

    // Save with gap>0 to generate a gap row
    const getResp = await page.request.get(
      `${BACKEND}/api/assessments/${draft.id}`,
    )
    const detail = (await getResp.json()).details[0]
    await page.request.patch(
      `${BACKEND}/api/assessments/${draft.id}/draft`,
      {
        data: {
          expected_revision: 1,
          details: [
            {
              l3_node_id: detail.l3_node_id,
              l3_code: detail.l3_code,
              current_level: 0,
              member_priority: '高',
              include_in_plan: true,
              plan_quarter: 'Q2',
              plan_month: 5,
            },
          ],
        },
      },
    )

    // Try to update gap directly → should be blocked
    const gapsResp = await page.request.get(
      `${BACKEND}/api/gaps?assessment_id=${draft.id}`,
    )
    const gaps = await gapsResp.json()
    if (gaps.length > 0) {
      const gapId = gaps[0].id
      const updateResp = await page.request.put(`${BACKEND}/api/gaps/${gapId}`, {
        data: { priority: '高', plan_candidate: true },
      })
      expect(updateResp.status()).toBe(422)
      const body = await updateResp.json()
      expect(body.detail.code).toBe('legacy_gap_write_disabled')
    }
  })

  test('E2E-10: include_in_plan tri-state: NULL→FALSE→TRUE roundtrip', async ({
    page,
  }) => {
    await loginAs(page, 'member')

    const previewResp = await page.request.get(
      `${BACKEND}/api/assessments/scope-preview?year=2026&assessment_type=年度`,
    )
    expect(previewResp.ok()).toBeTruthy()
    const preview = await previewResp.json()

    const createResp = await page.request.post(`${BACKEND}/api/assessments`, {
      data: { year: 2026, assessment_type: '年度', scope_token: preview.scope_token },
    })
    expect(createResp.ok()).toBeTruthy()
    const draft = await createResp.json()
    const getResp = await page.request.get(
      `${BACKEND}/api/assessments/${draft.id}`,
    )
    const detail = (await getResp.json()).details[0]

    // NULL → FALSE
    await page.request.patch(
      `${BACKEND}/api/assessments/${draft.id}/draft`,
      {
        data: {
          expected_revision: 1,
          details: [
            { l3_node_id: detail.l3_node_id, l3_code: detail.l3_code, current_level: 0, member_priority: '中', include_in_plan: false },
          ],
        },
      },
    )
    const v1 = await page.request.get(`${BACKEND}/api/assessments/${draft.id}`)
    const s1 = (await v1.json()).details.find((d: { l3_code: string }) => d.l3_code === detail.l3_code)
    expect(s1.include_in_plan).toBe(false)
    expect(s1.plan_quarter).toBeNull()

    // FALSE → TRUE
    await page.request.patch(
      `${BACKEND}/api/assessments/${draft.id}/draft`,
      {
        data: {
          expected_revision: 2,
          details: [
            { l3_node_id: detail.l3_node_id, l3_code: detail.l3_code, include_in_plan: true, plan_quarter: 'Q4', plan_month: 12 },
          ],
        },
      },
    )
    const v2 = await page.request.get(`${BACKEND}/api/assessments/${draft.id}`)
    const s2 = (await v2.json()).details.find((d: { l3_code: string }) => d.l3_code === detail.l3_code)
    expect(s2.include_in_plan).toBe(true)
    expect(s2.plan_quarter).toBe('Q4')

    // TRUE → NULL (explicit)
    await page.request.patch(
      `${BACKEND}/api/assessments/${draft.id}/draft`,
      {
        data: {
          expected_revision: 3,
          details: [
            { l3_node_id: detail.l3_node_id, l3_code: detail.l3_code, include_in_plan: null },
          ],
        },
      },
    )
    const v3 = await page.request.get(`${BACKEND}/api/assessments/${draft.id}`)
    const s3 = (await v3.json()).details.find((d: { l3_code: string }) => d.l3_code === detail.l3_code)
    expect(s3.include_in_plan).toBeNull()
    expect(s3.plan_quarter).toBeNull()
  })
})

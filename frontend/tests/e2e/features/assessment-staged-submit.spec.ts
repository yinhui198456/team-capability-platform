/** PR #81 round 1 — staged self-assessment workflow: real-API E2E.

  Isolation contract (mirrors issue-61 smoke):
  - Owns a FIXED unique year (2029) independent of execution order/retries.
  - ensureFreshDraft reuses an existing open draft with its real revision,
    otherwise creates exactly once via the scope-preview token.
  - The scenario submits the draft (closes it) so no open draft is left
    behind; a rerun on the same stack re-creates for the same business key.
 */

import { expect, test } from '@playwright/test'

import { loginAs } from '../fixtures/auth'

const BACKEND = process.env.PLAYWRIGHT_BACKEND_URL ?? 'http://localhost:18001'
const YEAR = 2029

test('staged submit: undecided gaps + unassessed advanced submit and surface as follow-up', async ({
  page,
}) => {
  await loginAs(page, 'member')
  const request = page.request

  // 1. Preview scope and ensure exactly one open draft for the year.
  const previewResp = await request.get(
    `${BACKEND}/api/assessments/scope-preview?year=${YEAR}&assessment_type=年度`,
  )
  expect(previewResp.ok()).toBeTruthy()
  const preview = await previewResp.json()

  const listResp = await request.get(`${BACKEND}/api/assessments`)
  expect(listResp.ok()).toBeTruthy()
  const list = await listResp.json()
  const existing = list.find(
    (a: { year: number; assessment_type: string; status: string }) =>
      a.year === YEAR &&
      a.assessment_type === '年度' &&
      ['草稿', '建议调整'].includes(a.status),
  )
  let assessmentId: number
  let revision: number
  if (existing) {
    assessmentId = existing.id
    const getResp = await request.get(
      `${BACKEND}/api/assessments/${assessmentId}`,
    )
    expect(getResp.ok()).toBeTruthy()
    revision = (await getResp.json()).revision ?? 1
  } else {
    const createResp = await request.post(`${BACKEND}/api/assessments`, {
      data: {
        year: YEAR,
        assessment_type: '年度',
        scope_token: preview.scope_token,
      },
    })
    expect(createResp.ok()).toBeTruthy()
    const draft = await createResp.json()
    assessmentId = draft.id
    revision = draft.revision ?? 1
  }

  // 2. Classify the scope; assess ONLY current-role REQUIRED items (level 0
  //    guarantees a positive gap), leave ADVANCED unassessed, and leave
  //    every plan decision undecided.
  const getResp = await request.get(
    `${BACKEND}/api/assessments/${assessmentId}`,
  )
  expect(getResp.ok()).toBeTruthy()
  const assessment = await getResp.json()
  const details: Array<{
    l3_code: string
    l3_node_id: number | null
    scope_type: string | null
  }> = assessment.details
  const required = details.filter((d) => d.scope_type !== 'target_progressive')
  const advanced = details.filter((d) => d.scope_type === 'target_progressive')
  expect(required.length).toBeGreaterThan(0)
  expect(advanced.length).toBeGreaterThan(0)

  const payload = details.map((d) => {
    const item: Record<string, unknown> = { l3_code: d.l3_code }
    if (d.l3_node_id != null) item.l3_node_id = d.l3_node_id
    if (d.scope_type !== 'target_progressive') item.current_level = 0
    return item
  })
  const putResp = await request.put(
    `${BACKEND}/api/assessments/${assessmentId}/draft`,
    { data: { details: payload, expected_revision: revision } },
  )
  expect(putResp.ok()).toBeTruthy()
  const saved = await putResp.json()

  // 3. Submit: positive gaps with NO priority / plan decision and unassessed
  //    ADVANCED items must not block.
  const submitResp = await request.post(
    `${BACKEND}/api/assessments/${assessmentId}/submit`,
    { data: { expected_revision: saved.revision ?? revision + 1 } },
  )
  expect(submitResp.ok()).toBeTruthy()

  // 4. Personal workspace follow-up: accurate counts per category.
  const dashResp = await request.get(
    `${BACKEND}/api/planning/member-dashboard?year=${YEAR}`,
  )
  expect(dashResp.ok()).toBeTruthy()
  const dashboard = await dashResp.json()
  expect(dashboard.follow_up.assessment_id).toBe(assessmentId)
  expect(dashboard.follow_up.assessment_status).toBe('待复核')
  expect(dashboard.follow_up.required_incomplete).toBe(0)
  expect(dashboard.follow_up.advanced_unassessed).toBe(advanced.length)
  expect(dashboard.follow_up.gaps_waiting_planning).toBe(required.length)
  expect(dashboard.follow_up.review_return).toBe(false)

  // 5. Visible UI: the member workspace renders the follow-up card with
  //    deep links for advanced work, backlog gaps and review/return work.
  await page.goto(`/dashboard/member?year=${YEAR}`)
  await expect(page.getByText('成长待办')).toBeVisible()
  await expect(page.getByRole('link', { name: /进阶能力待评估/ })).toBeVisible()
  await expect(page.getByRole('link', { name: /Gap 待规划/ })).toBeVisible()
  await expect(page.getByRole('link', { name: /自评待复核/ })).toBeVisible()

  // 6. The deep link lands on the assessment page scoped to the category.
  await page.goto(
    `/capability/assessment?year=${YEAR}&focus=advanced-unassessed`,
  )
  await expect(page).toHaveURL(/focus=advanced-unassessed/)
  await expect(page.getByText('能力自评与 Gap 分析')).toBeVisible()
  await expect(page.getByLabel('状态筛选')).toHaveValue('未评估')
})

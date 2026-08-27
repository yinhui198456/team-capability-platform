import { expect, test, type Page } from '@playwright/test'

import { DEMO_PASSWORD } from '../fixtures/auth'

// Seed data: full 310-L3 Legacy Baseline v1.
// P4→P4: 143 required + 0 progressive = 143.
// P4→P5: 143 required + 95 progressive = 238.
// P4→P6: 143 required + 146 progressive = 289.
// P4→P7: 143 required + 161 progressive = 304.

async function adminCookie(page: Page): Promise<string> {
  const response = await page.request.post('/api/auth/login', {
    data: { username: 'admin', password: DEMO_PASSWORD },
  })
  expect(response.ok()).toBeTruthy()
  const setCookie = response.headers()['set-cookie'] ?? ''
  const match = setCookie.match(/tcp_session=([^;]+)/)
  expect(match).toBeTruthy()
  return `tcp_session=${match![1]}`
}

let userSequence = 0

async function createMember(
  page: Page,
  cookie: string,
  current: string | null,
  target: string | null,
): Promise<string> {
  userSequence += 1
  const username = `scope-member-${Date.now()}-${userSequence}`
  const response = await page.request.post('/api/system/users', {
    headers: { Cookie: cookie },
    data: {
      username,
      full_name: username,
      password: DEMO_PASSWORD,
      is_active: true,
      roles: ['Member'],
      current_level: current,
      target_level: target,
    },
  })
  expect(response.ok()).toBeTruthy()
  return username
}

async function setLevels(
  page: Page,
  cookie: string,
  username: string,
  current: string | null,
  target: string | null,
) {
  const listResponse = await page.request.get('/api/system/users', {
    headers: { Cookie: cookie },
  })
  const users = (await listResponse.json()) as Array<{
    id: number
    username: string
  }>
  const user = users.find((item) => item.username === username)
  expect(user).toBeTruthy()
  const response = await page.request.put(`/api/system/users/${user!.id}`, {
    headers: { Cookie: cookie },
    data: {
      full_name: username,
      is_active: true,
      roles: ['Member'],
      current_level: current,
      target_level: target,
    },
  })
  expect(response.ok()).toBeTruthy()
}

async function loginUser(page: Page, username: string) {
  await page.goto('/login')
  await page.getByLabel('用户名').fill(username)
  await page.getByLabel('密码').fill(DEMO_PASSWORD)
  await page.getByRole('button', { name: '登录' }).click()
  await page.waitForURL('**/dashboard/member**')
}

async function openDraftCount(page: Page): Promise<number> {
  const response = await page.request.get('/api/assessments')
  expect(response.ok()).toBeTruthy()
  const assessments = (await response.json()) as Array<{ status: string }>
  return assessments.filter(
    (item) => item.status === '草稿' || item.status === '建议调整',
  ).length
}

test.describe('Issue #60 assessment scope snapshots', () => {
  test('P4→P5 preview, confirm, header and scope filter', async ({ page }) => {
    const cookie = await adminCookie(page)
    const username = await createMember(page, cookie, 'P4', 'P5')
    await loginUser(page, username)
    await page.goto('/capability/assessment')

    await page.getByRole('button', { name: '预览评估范围' }).click()
    const preview = page.getByTestId('scope-preview')
    await expect(preview).toContainText('当前 P4 → 年度目标 P5')
    await expect(preview).toContainText('Legacy Baseline v1')
    await expect(preview).toContainText('适用 238')
    await expect(preview).toContainText('必备 143')
    await expect(preview).toContainText('进阶 95')

    await page.getByRole('button', { name: '确认创建年度自评草稿' }).click()
    await expect(page.getByTestId('assessment-table')).toBeVisible()

    const domainNav = page.getByRole('navigation', {
      name: '一级能力域导航',
    })
    await expect(
      domainNav.getByRole('button', { name: '全部能力域' }),
    ).toBeVisible()
    await expect(page.getByTestId('assessment-table')).toBeVisible()
  })

  test('P4→P4 same level produces zero progressive items', async ({ page }) => {
    const cookie = await adminCookie(page)
    const username = await createMember(page, cookie, 'P4', 'P4')
    await loginUser(page, username)
    await page.goto('/capability/assessment')
    await page.getByRole('button', { name: '预览评估范围' }).click()
    const preview = page.getByTestId('scope-preview')
    await expect(preview).toContainText('当前 P4 → 年度目标 P4')
    await expect(preview).toContainText('适用 143')
    await expect(preview).toContainText('进阶 0')
  })

  test('P4→P7 multi level uses only endpoint cells', async ({ page }) => {
    const cookie = await adminCookie(page)
    const username = await createMember(page, cookie, 'P4', 'P7')
    await loginUser(page, username)
    await page.goto('/capability/assessment')
    await page.getByRole('button', { name: '预览评估范围' }).click()
    const preview = page.getByTestId('scope-preview')
    await expect(preview).toContainText('当前 P4 → 年度目标 P7')
    await expect(preview).toContainText('适用 304')
    await expect(preview).toContainText('必备 143')
    await expect(preview).toContainText('进阶 161')
  })

  test('scope change between preview and create requires re-confirmation', async ({
    page,
  }) => {
    const cookie = await adminCookie(page)
    const username = await createMember(page, cookie, 'P4', 'P5')
    await loginUser(page, username)
    await page.goto('/capability/assessment')
    await page.getByRole('button', { name: '预览评估范围' }).click()
    await expect(page.getByTestId('scope-preview')).toBeVisible()

    // level changes after the preview was taken
    await setLevels(page, cookie, username, 'P4', 'P6')
    await page.getByRole('button', { name: '确认创建年度自评草稿' }).click()
    await expect(page.getByRole('alert')).toContainText(
      '评估范围已变化，请根据最新范围重新确认',
    )
    const fresh = page.getByTestId('scope-preview')
    await expect(fresh).toContainText('当前 P4 → 年度目标 P6')
    await page.getByRole('button', { name: '按最新范围重新确认创建' }).click()
    await expect(page.getByTestId('assessment-table')).toBeVisible()
  })

  test('missing member level blocks preview with a structured error', async ({
    page,
  }) => {
    const cookie = await adminCookie(page)
    const username = await createMember(page, cookie, null, 'P5')
    await loginUser(page, username)
    await page.goto('/capability/assessment')
    await page.getByRole('button', { name: '预览评估范围' }).click()
    await expect(page.getByText(/current_level is required/)).toBeVisible()
    await expect(page.getByRole('button', { name: /确认创建/ })).toHaveCount(0)
  })

  test('regressed member levels block preview with a structured error', async ({
    page,
  }) => {
    const cookie = await adminCookie(page)
    const username = await createMember(page, cookie, 'P7', 'P5')
    await loginUser(page, username)
    await page.goto('/capability/assessment')
    await page.getByRole('button', { name: '预览评估范围' }).click()
    await expect(
      page.getByText(/current_level cannot exceed target_level/),
    ).toBeVisible()
    await expect(page.getByRole('button', { name: /确认创建/ })).toHaveCount(0)
  })

  test('empty scope disables creation with an understandable hint', async ({
    page,
  }) => {
    const cookie = await adminCookie(page)
    const username = await createMember(page, cookie, 'P8', 'P8')
    await page.route('**/api/assessments/scope-preview**', (route) =>
      route.fulfill({
        status: 200,
        json: {
          member_id: 1,
          year: 2026,
          assessment_type: '年度',
          member_current_level: 'P8',
          member_target_level: 'P8',
          standard_version: { id: 1, label: 'Legacy Baseline v1' },
          scope_version: 'scope-v1',
          items: [],
          summary: {
            total: 0,
            current_required: 0,
            target_progressive: 0,
            by_l1: [],
          },
          empty_scope: true,
          scope_token: '0'.repeat(64),
          open_draft_id: null,
        },
      }),
    )
    await loginUser(page, username)
    await page.goto('/capability/assessment')
    await page.getByRole('button', { name: '预览评估范围' }).click()
    await expect(page.getByRole('alert')).toContainText(
      '当前职级与目标职级下没有可评估的能力项，无法创建评估',
    )
    await expect(page.getByRole('button', { name: /确认创建/ })).toHaveCount(0)
  })

  test('double confirmation creates exactly one open draft', async ({
    page,
  }) => {
    const cookie = await adminCookie(page)
    const username = await createMember(page, cookie, 'P4', 'P5')
    await loginUser(page, username)
    await page.goto('/capability/assessment')
    await page.getByRole('button', { name: '预览评估范围' }).click()
    const button = page.getByRole('button', {
      name: '确认创建年度自评草稿',
    })
    await button.dblclick()
    await expect(page.getByTestId('assessment-table')).toBeVisible()
    expect(await openDraftCount(page)).toBe(1)
    // navigating back shows the existing draft, not another create button
    await page.goto('/dashboard/member')
    await page.goto('/capability/assessment')
    await expect(page.getByTestId('assessment-table')).toBeVisible()
    await expect(
      page.getByRole('button', { name: '预览评估范围' }),
    ).toHaveCount(0)
  })

  test('dashboard shows the open assessment snapshot and a drift hint', async ({
    page,
  }) => {
    const cookie = await adminCookie(page)
    const username = await createMember(page, cookie, 'P4', 'P5')
    await loginUser(page, username)
    await page.goto('/capability/assessment')
    await page.getByRole('button', { name: '预览评估范围' }).click()
    await page.getByRole('button', { name: '确认创建年度自评草稿' }).click()
    await expect(page.getByTestId('assessment-table')).toBeVisible()

    await page.goto('/dashboard/member')
    const levels = page.getByTestId('dashboard-levels')
    await expect(levels).toContainText('当前职级 P4')
    await expect(levels).toContainText('年度目标 P5')

    await setLevels(page, cookie, username, 'P4', 'P6')
    await page.goto('/dashboard/member')
    await expect(page.getByTestId('dashboard-level-drift')).toContainText(
      '成员职级已变化，当前评估仍按创建时快照执行',
    )
    await expect(page.getByTestId('dashboard-levels')).toContainText(
      '年度目标 P5',
    )
  })

  test('history page shows frozen level and version snapshots', async ({
    page,
  }) => {
    const cookie = await adminCookie(page)
    const username = await createMember(page, cookie, 'P4', 'P5')
    await loginUser(page, username)
    await page.goto('/capability/assessment')
    await page.getByRole('button', { name: '预览评估范围' }).click()
    await page.getByRole('button', { name: '确认创建年度自评草稿' }).click()
    await expect(page.getByTestId('assessment-table')).toBeVisible()

    await page.goto('/capability/assessment/history')
    const snapshot = page.locator('[data-testid^="history-snapshot-"]').first()
    await expect(snapshot).toContainText('当前 P4 → 年度目标 P5')
    await expect(snapshot).toContainText('Legacy Baseline v1')
    await expect(snapshot).toContainText('scope-v1')

    await page.getByRole('button', { name: /版本/ }).first().click()
    await expect(page.getByText(/当前职级必备/).first()).toBeVisible()
    await expect(page.getByText(/目标职级进阶/).first()).toBeVisible()
    await expect(page.getByText(/P4 标准/).first()).toBeVisible()
  })

  test('legacy assessment preserves M02 denominator and history isolation', async ({
    page,
  }) => {
    const cookie = await adminCookie(page)
    const username = await createMember(page, cookie, 'P4', 'P5')
    const legacyDetail = {
      id: 1,
      l3_code: 'P01.01.01',
      l3_name: '历史路径',
      l1_code: 'P01',
      l1_name: '数据基础设施',
      l2_code: 'P01.01',
      l2_name: '数据基础',
      l3_node_id: null,
      scope_type: null,
      standard_job_level_snapshot: null,
      current_level: null,
      target_level: 3,
      standard_target_applicable: true,
      standard_target_level: 3,
      target_adjusted: false,
      adjusted_target_level: null,
      target_adjustment_reason: null,
      gap_value: null,
      evidence_note: null,
      plan_candidate: false,
      recommended_start_level: 'P4',
    }
    const legacyAssessment = {
      id: 91,
      member_id: 1,
      year: 2026,
      version: 1,
      assessment_type: '年度',
      status: '草稿',
      created_at: '2026-01-01T00:00:00Z',
      submitted_at: null,
      archived_at: null,
      revision: 1,
      member_current_level: 'P4',
      member_target_level: 'P5',
      member_current_level_snapshot: null,
      member_target_level_snapshot: null,
      capability_standard_version_id: null,
      assessment_scope_version: null,
      standard_version_label: null,
      scope_summary: null,
      details: [
        legacyDetail,
        {
          ...legacyDetail,
          id: 2,
          l3_code: 'P01.01.02',
          standard_target_applicable: false,
          standard_target_level: null,
          target_level: null,
        },
      ],
      l2_groups: [
        {
          l1_code: 'P01',
          l1_name: '数据基础设施',
          l2_code: 'P01.01',
          l2_name: '数据基础',
          l3_count: 2,
          is_empty: false,
          requirements: {
            P4: 'P4 要求',
            P5: null,
            P6: null,
            P7: null,
            P8: null,
          },
          details: [],
        },
      ],
      gap_summary: {
        total_gaps: 0,
        avg_gap: 0,
        high_priority: 0,
        medium_priority: 0,
        low_priority: 0,
      },
    }
    await page.route('**/api/assessments?*', (route) =>
      route.fulfill({ status: 200, json: [legacyAssessment] }),
    )
    await page.route('**/api/assessments', (route) =>
      route.fulfill({ status: 200, json: [legacyAssessment] }),
    )
    await page.route('**/api/assessments/91', (route) =>
      route.fulfill({ status: 200, json: legacyAssessment }),
    )
    await loginUser(page, username)
    await page.goto('/capability/assessment')

    // Not-applicable legacy detail stays out of the M02 denominator.
    await expect(page.getByLabel('评估摘要')).toContainText('三级能力项 1')
    await expect(page.getByTestId('scope-filter')).toHaveCount(0)
    await expect(
      page.getByRole('navigation', { name: '一级能力域导航' }),
    ).toBeVisible()
    await expect(page.getByText('历史路径').first()).toBeVisible()

    // history renders the missing-snapshot label without fabricating values
    await page.goto('/capability/assessment/history')
    await expect(page.getByText('历史快照缺失').first()).toBeVisible()
    await page.getByRole('button', { name: /版本/ }).first().click()
    await expect(page.getByText(/历史未分类/).first()).toBeVisible()
  })
})

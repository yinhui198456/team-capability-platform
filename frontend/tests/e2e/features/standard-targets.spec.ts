import { expect, test, type Page, type Route } from '@playwright/test'

import { currentMemberId, loginAs, logout } from '../fixtures/auth'

const l3 = {
  id: 101,
  code: 'P01.01.01',
  name: '标准目标测试能力',
  p4_description: null,
  p5_description: null,
  p6_description: null,
  p7_description: null,
  p8_description: null,
  recommended_start_level: 'P6',
  materials_text: '',
  expected_output: null,
  estimated_hours: null,
  output_type: null,
  notes: null,
  resources: [],
  unmatched_materials: [],
}

// --- shared fixtures ---------------------------------------------------------

type L3Fixture = {
  id: number
  code: string
  name: string
  recommended_start_level?: string
}

function l3Fixture(id: number, code: string, name: string): L3Fixture {
  return { id, code, name, recommended_start_level: 'P4' }
}

function catalogDomain(
  code: string,
  name: string,
  l2s: Array<{ code: string; name: string; l3s: L3Fixture[] }>,
) {
  return {
    code,
    name,
    overview: null,
    children: l2s.map((l2) => ({
      code: l2.code,
      name: l2.name,
      p4_description: null,
      p5_description: null,
      p6_description: null,
      p7_description: null,
      p8_description: null,
      children: l2.l3s.map((node) => ({
        id: node.id,
        code: node.code,
        name: node.name,
        recommended_start_level: node.recommended_start_level ?? 'P4',
        materials_text: '',
        expected_output: null,
        estimated_hours: null,
        output_type: null,
        notes: null,
        resources: [],
        unmatched_materials: [],
      })),
    })),
  }
}

function matrixItemsFor(
  node: L3Fixture,
  l1: { code: string; name: string },
  l2: { code: string; name: string },
  levels?: Partial<
    Record<string, { applicable: boolean; target: number | null }>
  >,
) {
  return ['P4', 'P5', 'P6', 'P7', 'P8'].map((job_level, index) => {
    const override = levels?.[job_level]
    const applicable = override?.applicable ?? true
    return {
      l3_node_id: node.id,
      l1_code: l1.code,
      l1_name: l1.name,
      l2_code: l2.code,
      l2_name: l2.name,
      l3_code: node.code,
      l3_name: node.name,
      job_level,
      applicable,
      target_level: applicable ? (override?.target ?? index + 1) : null,
      source: 'copied',
    }
  })
}

const draft11 = {
  id: 11,
  model_id: 1,
  version_no: 2,
  label: '标准版本 v2',
  status: '草稿',
  revision: 3,
  published_at: null,
}

function makeModel(domains: ReturnType<typeof catalogDomain>[]) {
  return { id: 1, code: 'test-model', version: '1', domains }
}

async function mockLearningResources(page: Page) {
  await page.route('**/api/learning-resources**', (route) =>
    route.fulfill({ status: 200, json: [] }),
  )
}

async function mockCatalogModel(
  page: Page,
  model: ReturnType<typeof makeModel>,
) {
  await page.route('**/api/capability-model', (route) =>
    route.fulfill({ status: 200, json: model }),
  )
}

const noDrift = {
  has_drift: false,
  added_enabled_l3: [],
  disabled_l3: [],
  renamed_or_moved_l3: [],
}

test.describe('capability standard targets', () => {
  test('Leader edits a versioned L3×P4–P8 matrix by stable node identity', async ({
    page,
  }) => {
    let saved: Record<string, unknown> | null = null
    const draft = {
      id: 11,
      model_id: 1,
      version_no: 2,
      label: '标准版本 v2',
      status: '草稿',
      revision: 3,
      published_at: null,
    }
    await page.route('**/api/capability-model', async (route) => {
      await route.fulfill({
        status: 200,
        json: {
          id: 1,
          code: 'test-model',
          version: '1',
          domains: [
            {
              code: 'P01',
              name: '数据基础设施',
              overview: null,
              children: [{ code: 'P01.01', name: '测试分类', children: [l3] }],
            },
          ],
        },
      })
    })
    await page.route('**/api/capability-standard-versions**', async (route) => {
      const url = new URL(route.request().url())
      if (route.request().method() === 'PUT') {
        saved = route.request().postDataJSON()
        await route.fulfill({ status: 200, json: { revision: 4 } })
        return
      }
      if (url.pathname.endsWith('/catalog-drift')) {
        await route.fulfill({
          status: 200,
          json: {
            has_drift: false,
            added_enabled_l3: [],
            disabled_l3: [],
            renamed_or_moved_l3: [],
          },
        })
        return
      }
      if (url.pathname.endsWith('/11')) {
        await route.fulfill({
          status: 200,
          json: {
            version: draft,
            items: ['P4', 'P5', 'P6', 'P7', 'P8'].map((job_level, index) => ({
              l3_node_id: 101,
              l1_code: 'P01',
              l1_name: '数据基础设施',
              l2_code: 'P01.01',
              l2_name: '测试分类',
              l3_code: l3.code,
              l3_name: l3.name,
              job_level,
              applicable: true,
              target_level: index + 1,
              source: 'copied',
            })),
          },
        })
        return
      }
      await route.fulfill({ status: 200, json: [draft] })
    })
    await page.route('**/api/learning-resources**', (route) =>
      route.fulfill({ status: 200, json: [] }),
    )

    await loginAs(page, 'leader')
    await page.goto('/capability/standards')
    await page.getByRole('button', { name: /P01\.01.*测试分类/ }).click()
    const cells = page.getByTestId('standard-l2-P01.01').getByRole('combobox')
    await expect(cells).toHaveCount(5)
    await cells.nth(0).selectOption('4')

    await expect.poll(() => saved).not.toBeNull()
    expect(saved).toMatchObject({
      expected_revision: 3,
      items: [
        {
          l3_node_id: 101,
          l3_code: 'P01.01.01',
          job_level: 'P4',
          applicable: true,
          target_level: 4,
        },
      ],
    })
  })

  test('Member sees snapshots and submits only personal adjustment inputs', async ({
    page,
  }) => {
    let saved: Record<string, unknown> | null = null
    // The mocked draft must belong to the signed-in member: the page's owner
    // gate compares assessment.member_id against the real /api/me id, so the
    // fixture derives it from the session instead of a hardcoded id.
    await loginAs(page, 'member')
    const memberId = await currentMemberId(page)
    const assessment = {
      id: 900,
      member_id: memberId,
      year: 2026,
      version: 1,
      assessment_type: '年度',
      status: '草稿',
      created_at: '2026-07-27T00:00:00Z',
      submitted_at: null,
      archived_at: null,
      details: [
        {
          id: 1,
          l3_code: 'P01.01.01',
          l3_name: '适用能力',
          l1_code: 'P01',
          l2_code: 'P01.01',
          l2_name: '测试分类',
          current_level: 2,
          standard_target_applicable: true,
          standard_target_level: 4,
          standard_job_level_snapshot: 'P4',
          target_adjusted: false,
          adjusted_target_level: null,
          target_adjustment_reason: null,
          target_level: 4,
          gap_value: 2,
          evidence_note: '已有依据',
          plan_candidate: false,
          recommended_start_level: 'P4',
        },
        {
          id: 2,
          l3_code: 'P01.01.02',
          l3_name: '不适用能力',
          l1_code: 'P01',
          l2_code: 'P01.01',
          l2_name: '测试分类',
          current_level: null,
          standard_target_applicable: false,
          standard_target_level: null,
          standard_job_level_snapshot: 'P6',
          target_adjusted: false,
          adjusted_target_level: null,
          target_adjustment_reason: null,
          target_level: null,
          gap_value: null,
          evidence_note: null,
          plan_candidate: false,
          recommended_start_level: 'P6',
        },
      ],
      gap_summary: {
        total_gaps: 1,
        avg_gap: 2,
        high_priority: 0,
        medium_priority: 1,
        low_priority: 0,
      },
    }
    await page.route(/\/api\/assessments$/, (route) =>
      route.fulfill({ status: 200, json: [assessment] }),
    )
    await page.route(/\/api\/assessments\/900(?:\/draft)?$/, async (route) => {
      if (route.request().method() === 'PATCH') {
        saved = route.request().postDataJSON()
        await route.fulfill({ status: 200, json: { ok: true } })
        return
      }
      await route.fulfill({ status: 200, json: assessment })
    })

    await page.goto('/capability/assessment')
    await expect(page.getByText('4 · P4 标准')).toBeVisible()
    await expect(page.getByText('不适用', { exact: true })).toBeVisible()
    // N/A row has no adjustment entry point
    await expect(
      page.locator('#row-2').getByRole('button', { name: '调整个人目标' }),
    ).toHaveCount(0)

    const okRow = page.locator('#row-1')
    await okRow.getByRole('button', { name: '调整个人目标' }).click()
    await page.getByLabel('启用个人调整 P01.01.01').check()
    await page.getByLabel('调整目标 P01.01.01').selectOption('5')
    await page.getByLabel('调整原因 P01.01.01').fill('晋升准备')
    await page.getByRole('button', { name: '保存草稿' }).click()

    await expect.poll(() => saved).not.toBeNull()
    const details = saved?.details as Array<Record<string, unknown>>
    expect(details[0]).toMatchObject({
      target_adjusted: true,
      adjusted_target_level: 5,
      target_adjustment_reason: '晋升准备',
    })
    expect(details[0]).not.toHaveProperty('target_level')
    expect(details[0]).not.toHaveProperty('standard_target_level')
  })

  test('a non-owner viewer sees the draft read-only without edit controls', async ({
    page,
  }) => {
    // The owner id comes from the real member session — never hardcoded.
    await loginAs(page, 'member')
    const ownerId = await currentMemberId(page)
    await logout(page)
    await loginAs(page, 'buddy')

    const assessment = {
      id: 901,
      member_id: ownerId,
      year: 2026,
      version: 1,
      assessment_type: '年度',
      status: '草稿',
      created_at: '2026-07-27T00:00:00Z',
      submitted_at: null,
      archived_at: null,
      details: [
        {
          id: 1,
          l3_code: 'P01.01.01',
          l3_name: '适用能力',
          l1_code: 'P01',
          l2_code: 'P01.01',
          l2_name: '测试分类',
          current_level: 2,
          standard_target_applicable: true,
          standard_target_level: 4,
          standard_job_level_snapshot: 'P4',
          target_adjusted: false,
          adjusted_target_level: null,
          target_adjustment_reason: null,
          target_level: 4,
          gap_value: 2,
          evidence_note: '已有依据',
          plan_candidate: false,
          recommended_start_level: 'P4',
        },
      ],
      gap_summary: {
        total_gaps: 1,
        avg_gap: 2,
        high_priority: 0,
        medium_priority: 1,
        low_priority: 0,
      },
    }
    await page.route(/\/api\/assessments$/, (route) =>
      route.fulfill({ status: 200, json: [assessment] }),
    )
    await page.route(/\/api\/assessments\/901$/, (route) =>
      route.fulfill({ status: 200, json: assessment }),
    )

    await page.goto('/capability/assessment')
    await expect(page.getByText(/当前账号仅可查看本评估/)).toBeVisible()
    await expect(
      page.locator('#row-1').getByRole('button', { name: '调整个人目标' }),
    ).toHaveCount(0)
    await expect(page.getByRole('button', { name: '保存草稿' })).toHaveCount(0)
    await expect(page.getByRole('button', { name: '提交自评' })).toHaveCount(0)
  })

  test('Leader inspects, copies and blocks an invalid draft without route ambiguity', async ({
    page,
  }) => {
    const requests: string[] = []
    const draft = {
      id: 12,
      model_id: 1,
      version_no: 2,
      label: '标准版本 v2',
      status: '草稿',
      revision: 3,
      published_at: null,
    }
    await page.route('**/api/capability-model', (route) =>
      route.fulfill({
        status: 200,
        json: {
          id: 1,
          code: 'test-model',
          version: '1',
          domains: [
            {
              code: 'P01',
              name: '数据基础设施',
              overview: null,
              children: [{ code: 'P01.01', name: '测试分类', children: [l3] }],
            },
          ],
        },
      }),
    )
    await page.route('**/api/capability-standard-versions**', async (route) => {
      const request = route.request()
      const url = new URL(request.url())
      const { pathname } = url
      requests.push(`${request.method()} ${pathname}`)
      if (pathname.endsWith('/validation')) {
        await route.fulfill({
          status: 200,
          json: {
            valid: false,
            issues: [
              {
                l3_code: l3.code,
                job_level: 'P8',
                message: 'target cannot decrease',
              },
            ],
          },
        })
        return
      }
      if (pathname.endsWith('/publish-preview')) {
        await route.fulfill({
          status: 200,
          json: {
            can_publish: false,
            validation: {
              valid: false,
              issues: [
                {
                  l3_code: l3.code,
                  job_level: 'P8',
                  message: 'target cannot decrease',
                },
              ],
            },
          },
        })
        return
      }
      if (pathname.endsWith('/copy-previous-level')) {
        await route.fulfill({ status: 200, json: { revision: 4 } })
        return
      }
      if (pathname.endsWith('/publish') && request.method() === 'POST') {
        await route.fulfill({
          status: 422,
          json: { detail: { message: 'standard version is invalid' } },
        })
        return
      }
      if (pathname.endsWith('/catalog-drift')) {
        await route.fulfill({
          status: 200,
          json: {
            has_drift: false,
            added_enabled_l3: [],
            disabled_l3: [],
            renamed_or_moved_l3: [],
          },
        })
        return
      }
      if (pathname.endsWith('/12')) {
        await route.fulfill({
          status: 200,
          json: {
            version: draft,
            items: ['P4', 'P5', 'P6', 'P7', 'P8'].map((job_level, index) => ({
              l3_node_id: 101,
              l1_code: 'P01',
              l1_name: '数据基础设施',
              l2_code: 'P01.01',
              l2_name: '测试分类',
              l3_code: l3.code,
              l3_name: l3.name,
              job_level,
              applicable: true,
              target_level: index + 1,
              source: 'copied',
            })),
          },
        })
        return
      }
      await route.fulfill({ status: 200, json: [draft] })
    })
    await page.route('**/api/learning-resources**', (route) =>
      route.fulfill({ status: 200, json: [] }),
    )
    await loginAs(page, 'leader')
    await page.goto('/capability/standards')

    await page.getByRole('button', { name: '检查草稿' }).click()
    await expect(page.getByRole('alert')).toContainText(
      '草稿存在需要修复的矩阵项',
    )
    await expect(page.getByLabel('矩阵检查问题')).toContainText(
      'P01.01.01 · P8',
    )
    await page.getByRole('button', { name: '预览发布' }).click()
    // Expand L2 section and select L3 checkbox for copy
    await page.getByRole('button', { name: /P01\.01.*测试分类/ }).click()
    await page
      .getByRole('checkbox', { name: /选择 P01\.01\.01 用于复制/ })
      .check()
    await page.getByRole('button', { name: /复制 P7 → P8/ }).click()
    page.once('dialog', (dialog) => dialog.accept())
    await page.getByRole('button', { name: '检查并发布' }).click()
    await expect(page.getByRole('alert')).toContainText(
      'standard version is invalid',
    )
    expect(requests).toContain(
      'GET /api/capability-standard-versions/12/validation',
    )
    expect(requests).toContain(
      'GET /api/capability-standard-versions/12/publish-preview',
    )
    expect(requests).toContain(
      'POST /api/capability-standard-versions/12/copy-previous-level',
    )
    expect(requests).toContain(
      'POST /api/capability-standard-versions/12/publish',
    )
  })
})

test.describe('Issue #59 422 precise positioning by stable node identity', () => {
  test('Leader navigates to the exact invalid matrix cell by stable node identity', async ({
    page,
  }) => {
    const issueL3 = l3Fixture(202, 'P02.03.04', '跨域问题路径')
    const otherL3 = l3Fixture(201, 'P02.03.01', '其他路径')
    const homeL3 = l3Fixture(101, 'P01.01.01', '首页路径')
    const model = makeModel([
      catalogDomain('P01', '数据基础设施', [
        { code: 'P01.01', name: '测试分类', l3s: [homeL3] },
      ]),
      catalogDomain('P02', 'AI Infra', [
        { code: 'P02.03', name: '问题分类', l3s: [otherL3, issueL3] },
      ]),
    ])
    await mockCatalogModel(page, model)
    await page.route(
      '**/api/capability-standard-versions**',
      async (route: Route) => {
        const url = new URL(route.request().url())
        const { pathname } = url
        if (pathname.endsWith('/validation')) {
          await route.fulfill({
            status: 200,
            json: {
              valid: false,
              issues: [
                {
                  l3_node_id: 202,
                  l3_code: 'P02.03.04',
                  job_level: 'P6',
                  message: '目标掌握度不能低于上一职级',
                },
              ],
            },
          })
          return
        }
        if (pathname.endsWith('/catalog-drift')) {
          await route.fulfill({ status: 200, json: noDrift })
          return
        }
        if (pathname.endsWith('/11')) {
          await route.fulfill({
            status: 200,
            json: {
              version: draft11,
              items: [
                ...matrixItemsFor(
                  homeL3,
                  { code: 'P01', name: '数据基础设施' },
                  { code: 'P01.01', name: '测试分类' },
                ),
                ...matrixItemsFor(
                  otherL3,
                  { code: 'P02', name: 'AI Infra' },
                  { code: 'P02.03', name: '问题分类' },
                ),
                ...matrixItemsFor(
                  issueL3,
                  { code: 'P02', name: 'AI Infra' },
                  { code: 'P02.03', name: '问题分类' },
                ),
              ],
            },
          })
          return
        }
        await route.fulfill({ status: 200, json: [draft11] })
      },
    )
    await mockLearningResources(page)

    await loginAs(page, 'leader')
    await page.goto('/capability/standards')
    await page.getByRole('button', { name: '检查草稿' }).click()

    const issueLink = page
      .getByLabel('矩阵检查问题')
      .getByRole('button', { name: /P02\.03\.04 · P6/ })
    await expect(issueLink).toContainText('目标掌握度不能低于上一职级')
    await issueLink.click()

    // correct domain activated, correct L2 expanded
    await expect(page.getByRole('tab', { name: /P02/ })).toHaveAttribute(
      'aria-selected',
      'true',
    )
    await expect(page.getByTestId('standard-l2-P02.03')).toBeVisible()

    // target cell focused, visible, invalid, styled, correct id
    const targetCell = page.locator('#cell-202-P6')
    await expect(targetCell).toBeVisible()
    await expect(targetCell).toBeFocused()
    await expect(targetCell).toHaveAttribute('aria-invalid', 'true')
    await expect(targetCell).toHaveClass(/invalidCell/)
    await expect(targetCell).toHaveAttribute(
      'title',
      '目标掌握度不能低于上一职级',
    )
  })

  test('issue navigation still works after the L3 code is renamed', async ({
    page,
  }) => {
    // Catalog shows the renamed code; matrix keeps the old code snapshot.
    const renamedL3 = l3Fixture(202, 'P02.03.04-renamed', '改名后的路径')
    const model = makeModel([
      catalogDomain('P01', '数据基础设施', [
        {
          code: 'P01.01',
          name: '测试分类',
          l3s: [l3Fixture(101, 'P01.01.01', '首页路径')],
        },
      ]),
      catalogDomain('P02', 'AI Infra', [
        { code: 'P02.03', name: '问题分类', l3s: [renamedL3] },
      ]),
    ])
    await mockCatalogModel(page, model)
    await page.route(
      '**/api/capability-standard-versions**',
      async (route: Route) => {
        const { pathname } = new URL(route.request().url())
        if (pathname.endsWith('/validation')) {
          await route.fulfill({
            status: 200,
            json: {
              valid: false,
              issues: [
                {
                  l3_node_id: 202,
                  l3_code: 'P02.03.04',
                  job_level: 'P6',
                  message: '目标掌握度不能低于上一职级',
                },
              ],
            },
          })
          return
        }
        if (pathname.endsWith('/catalog-drift')) {
          await route.fulfill({ status: 200, json: noDrift })
          return
        }
        if (pathname.endsWith('/11')) {
          await route.fulfill({
            status: 200,
            json: {
              version: draft11,
              items: matrixItemsFor(
                l3Fixture(202, 'P02.03.04', '旧路径名'),
                { code: 'P02', name: 'AI Infra' },
                { code: 'P02.03', name: '问题分类' },
              ),
            },
          })
          return
        }
        await route.fulfill({ status: 200, json: [draft11] })
      },
    )
    await mockLearningResources(page)

    await loginAs(page, 'leader')
    await page.goto('/capability/standards')
    await page.getByRole('button', { name: '检查草稿' }).click()
    await page
      .getByLabel('矩阵检查问题')
      .getByRole('button', { name: /P02\.03\.04 · P6/ })
      .click()

    const targetCell = page.locator('#cell-202-P6')
    await expect(targetCell).toBeVisible()
    await expect(targetCell).toBeFocused()
    await expect(targetCell).toHaveAttribute('aria-invalid', 'true')
    // displayed with the renamed catalog name
    await expect(page.getByText(/改名后的路径/)).toBeVisible()
  })
})

test.describe('Issue #59 new L3 five-cell configuration closure', () => {
  test('Leader configures all five cells for a newly enabled L3 and passes publish preview', async ({
    page,
  }) => {
    const existingL3 = l3Fixture(101, 'P01.01.01', '已有路径')
    const newL3 = l3Fixture(202, 'P01.01.02', '新增启用路径')
    const model = makeModel([
      catalogDomain('P01', '数据基础设施', [
        { code: 'P01.01', name: '测试分类', l3s: [existingL3, newL3] },
      ]),
    ])
    await mockCatalogModel(page, model)

    let addedNodes: unknown[] = [
      { l3_node_id: 202, l3_code: 'P01.01.02', l3_name: '新增启用路径' },
    ]
    let matrixCells: unknown[] = matrixItemsFor(
      existingL3,
      { code: 'P01', name: '数据基础设施' },
      { code: 'P01.01', name: '测试分类' },
    )
    const saved: Array<Record<string, unknown>> = []
    let previewServed = false

    await page.route(
      '**/api/capability-standard-versions**',
      async (route: Route) => {
        const request = route.request()
        const { pathname } = new URL(request.url())
        if (request.method() === 'PUT') {
          const body = request.postDataJSON() as {
            expected_revision: number
            items: Array<Record<string, unknown>>
          }
          saved.push(body)
          const item = body.items[0]
          matrixCells = [
            ...matrixCells,
            {
              l3_node_id: item.l3_node_id,
              l1_code: 'P01',
              l1_name: '数据基础设施',
              l2_code: 'P01.01',
              l2_name: '测试分类',
              l3_code: item.l3_code,
              l3_name: '新增启用路径',
              job_level: item.job_level,
              applicable: item.applicable,
              target_level: item.target_level,
              source: 'explicit',
            },
          ]
          const filledCount = new Set(
            (matrixCells as Array<{ l3_node_id: number }>)
              .filter((cell) => cell.l3_node_id === 202)
              .map((cell) => JSON.stringify(cell)),
          ).size
          if (filledCount >= 5) addedNodes = []
          await route.fulfill({ status: 200, json: { revision: 4 } })
          return
        }
        if (pathname.endsWith('/catalog-drift')) {
          await route.fulfill({
            status: 200,
            json: {
              has_drift: addedNodes.length > 0,
              added_enabled_l3: addedNodes,
              disabled_l3: [],
              renamed_or_moved_l3: [],
            },
          })
          return
        }
        if (pathname.endsWith('/publish-preview')) {
          previewServed = true
          await route.fulfill({
            status: 200,
            json: {
              can_publish: addedNodes.length === 0,
              catalog_drift: {
                has_drift: addedNodes.length > 0,
                added_enabled_l3: addedNodes,
                disabled_l3: [],
                renamed_or_moved_l3: [],
              },
              validation: {
                valid: addedNodes.length === 0,
                issues:
                  addedNodes.length === 0
                    ? []
                    : [
                        {
                          l3_node_id: 202,
                          l3_code: 'P01.01.02',
                          job_level: null,
                          message: 'L3 must have P4–P8 cells',
                        },
                      ],
              },
            },
          })
          return
        }
        if (pathname.endsWith('/reconcile-catalog')) {
          await route.fulfill({
            status: 200,
            json: {
              version_id: 11,
              revision: 3,
              noop: true,
              drift: {
                has_drift: addedNodes.length > 0,
                added_enabled_l3: addedNodes,
                disabled_l3: [],
                renamed_or_moved_l3: [],
              },
            },
          })
          return
        }
        if (pathname.endsWith('/11')) {
          await route.fulfill({
            status: 200,
            json: { version: draft11, items: matrixCells },
          })
          return
        }
        await route.fulfill({ status: 200, json: [draft11] })
      },
    )
    await mockLearningResources(page)

    await loginAs(page, 'leader')
    await page.goto('/capability/standards')

    // drift banner visible, reconcile does not auto-fill
    await expect(page.getByText(/目录发生漂移/)).toBeVisible()
    await page.getByRole('button', { name: '协调目录' }).click()
    await expect(page.getByText(/目录发生漂移/)).toBeVisible()

    // new L3 shows five pending cells — never "不适用"
    await page.getByRole('button', { name: /P01\.01.*测试分类/ }).click()
    for (const level of ['P4', 'P5', 'P6', 'P7', 'P8']) {
      await expect(page.locator(`#cell-202-${level}`)).toHaveValue('pending')
    }

    // incomplete five cells still block publish preview
    await page.getByRole('button', { name: '预览发布' }).click()
    await expect(page.getByRole('alert')).toContainText(
      '草稿存在需要修复的矩阵项',
    )
    expect(previewServed).toBe(true)

    // configure each cell explicitly
    const selections: Record<string, string> = {
      P4: 'na',
      P5: '2',
      P6: '3',
      P7: '4',
      P8: '5',
    }
    for (const [level, value] of Object.entries(selections)) {
      await page.locator(`#cell-202-${level}`).selectOption(value)
      await expect(page.locator(`#cell-202-${level}`)).toHaveValue(value)
    }

    // every request carries full identity and revision
    expect(saved).toHaveLength(5)
    for (const body of saved) {
      expect(body.expected_revision).toBe(3)
      const item = (body.items as Array<Record<string, unknown>>)[0]
      expect(item.l3_node_id).toBe(202)
      expect(item.l3_code).toBe('P01.01.02')
      expect(typeof item.job_level).toBe('string')
      expect(typeof item.applicable).toBe('boolean')
    }
    expect((saved[0].items as never[])[0]).toMatchObject({
      job_level: 'P4',
      applicable: false,
      target_level: null,
    })
    expect((saved[4].items as never[])[0]).toMatchObject({
      job_level: 'P8',
      applicable: true,
      target_level: 5,
    })

    // drift cleared, publish preview now passes
    await expect(page.getByText(/目录发生漂移/)).toHaveCount(0)
    await page.getByRole('button', { name: '预览发布' }).click()
    await expect(page.getByRole('alert')).toHaveCount(0)
  })
})

test.describe('Issue #59 copy previous level scenarios', () => {
  async function setupCopyScenario(
    page: Page,
    saved: { current: Record<string, unknown> | null },
  ) {
    const first = l3Fixture(101, 'P01.01.01', '路径一')
    const second = l3Fixture(102, 'P01.01.02', '路径二')
    const model = makeModel([
      catalogDomain('P01', '数据基础设施', [
        { code: 'P01.01', name: '测试分类', l3s: [first, second] },
      ]),
    ])
    await mockCatalogModel(page, model)
    await page.route(
      '**/api/capability-standard-versions**',
      async (route: Route) => {
        const request = route.request()
        const { pathname } = new URL(request.url())
        if (pathname.endsWith('/copy-previous-level')) {
          saved.current = request.postDataJSON()
          await route.fulfill({ status: 200, json: { revision: 4 } })
          return
        }
        if (pathname.endsWith('/catalog-drift')) {
          await route.fulfill({ status: 200, json: noDrift })
          return
        }
        if (pathname.endsWith('/11')) {
          await route.fulfill({
            status: 200,
            json: {
              version: draft11,
              items: [
                ...matrixItemsFor(
                  first,
                  { code: 'P01', name: '数据基础设施' },
                  { code: 'P01.01', name: '测试分类' },
                ),
                ...matrixItemsFor(
                  second,
                  { code: 'P01', name: '数据基础设施' },
                  { code: 'P01.01', name: '测试分类' },
                ),
              ],
            },
          })
          return
        }
        await route.fulfill({ status: 200, json: [draft11] })
      },
    )
    await mockLearningResources(page)
    await loginAs(page, 'leader')
    await page.goto('/capability/standards')
    await page.getByRole('button', { name: /P01\.01.*测试分类/ }).click()
  }

  test('empty selection issues no copy request', async ({ page }) => {
    const saved = { current: null as Record<string, unknown> | null }
    await setupCopyScenario(page, saved)
    const button = page.getByRole('button', { name: /复制 P7 → P8/ })
    await expect(button).toBeDisabled()
    await expect(page.getByText(/已选：/)).toContainText('0')
    expect(saved.current).toBeNull()
  })

  test('single L3 copy sends only the selected node id', async ({ page }) => {
    const saved = { current: null as Record<string, unknown> | null }
    await setupCopyScenario(page, saved)
    await page
      .getByRole('checkbox', { name: /选择 P01\.01\.01 用于复制/ })
      .check()
    await expect(page.getByText(/已选：/)).toContainText('1')
    await page.getByRole('button', { name: /复制 P7 → P8/ }).click()
    await expect.poll(() => saved.current).not.toBeNull()
    expect(saved.current).toMatchObject({
      from_level: 'P7',
      to_level: 'P8',
      l3_node_ids: [101],
    })
  })

  test('multiple L3 copy sends exactly the selected node ids', async ({
    page,
  }) => {
    const saved = { current: null as Record<string, unknown> | null }
    await setupCopyScenario(page, saved)
    await page
      .getByRole('checkbox', { name: /选择 P01\.01\.01 用于复制/ })
      .check()
    await page
      .getByRole('checkbox', { name: /选择 P01\.01\.02 用于复制/ })
      .check()
    await page.getByRole('button', { name: /复制 P7 → P8/ }).click()
    await expect.poll(() => saved.current).not.toBeNull()
    const ids = (saved.current as { l3_node_ids: number[] }).l3_node_ids
    expect([...ids].sort()).toEqual([101, 102])
  })

  test('changing the source level derives the target level immediately', async ({
    page,
  }) => {
    const saved = { current: null as Record<string, unknown> | null }
    await setupCopyScenario(page, saved)
    const sourceSelect = page.getByLabel(/来源职级/)
    await expect(sourceSelect).toHaveValue('P7')
    await expect(page.getByText(/目标职级：/)).toContainText('P8')
    await sourceSelect.selectOption('P4')
    await expect(page.getByText(/目标职级：/)).toContainText('P5')
    await expect(
      page.getByRole('button', { name: /复制 P4 → P5/ }),
    ).toBeVisible()
    await page
      .getByRole('checkbox', { name: /选择 P01\.01\.01 用于复制/ })
      .check()
    await page.getByRole('button', { name: /复制 P4 → P5/ }).click()
    await expect.poll(() => saved.current).not.toBeNull()
    expect(saved.current).toMatchObject({
      from_level: 'P4',
      to_level: 'P5',
      l3_node_ids: [101],
    })
  })

  test('copy success clears the selection and restores the button', async ({
    page,
  }) => {
    const saved = { current: null as Record<string, unknown> | null }
    await setupCopyScenario(page, saved)
    await page
      .getByRole('checkbox', { name: /选择 P01\.01\.01 用于复制/ })
      .check()
    await page.getByRole('button', { name: /复制 P7 → P8/ }).click()
    await expect.poll(() => saved.current).not.toBeNull()
    await expect(page.getByText(/已选：/)).toContainText('0')
    await expect(
      page.getByRole('button', { name: /复制 P7 → P8/ }),
    ).toBeDisabled()
  })
})

test.describe('Issue #59 409 revision conflict reload', () => {
  test('Leader reloads the latest draft after a revision conflict', async ({
    page,
  }) => {
    let matrixRevision = 3
    const requests: Array<{ expected_revision: number }> = []
    await mockCatalogModel(
      page,
      makeModel([
        catalogDomain('P01', '数据基础设施', [
          {
            code: 'P01.01',
            name: '测试分类',
            l3s: [l3Fixture(101, 'P01.01.01', '首页路径')],
          },
        ]),
      ]),
    )
    await page.route(
      '**/api/capability-standard-versions**',
      async (route: Route) => {
        const request = route.request()
        const { pathname } = new URL(request.url())
        if (request.method() === 'PUT') {
          const body = request.postDataJSON() as { expected_revision: number }
          requests.push(body)
          // First write simulates a concurrent edit: backend moved to
          // revision 4 while the page still holds revision 3.
          if (requests.length === 1) {
            matrixRevision = 4
            await route.fulfill({
              status: 409,
              json: {
                detail: {
                  code: 'standard_revision_conflict',
                  message: 'standard revision conflict',
                  issues: [],
                },
              },
            })
            return
          }
          if (body.expected_revision !== matrixRevision) {
            await route.fulfill({
              status: 409,
              json: {
                detail: {
                  code: 'standard_revision_conflict',
                  message: 'standard revision conflict',
                  issues: [],
                },
              },
            })
            return
          }
          await route.fulfill({
            status: 200,
            json: { revision: matrixRevision + 1 },
          })
          return
        }
        if (pathname.endsWith('/catalog-drift')) {
          await route.fulfill({ status: 200, json: noDrift })
          return
        }
        if (pathname.endsWith('/11')) {
          await route.fulfill({
            status: 200,
            json: {
              version: { ...draft11, revision: matrixRevision },
              items: matrixItemsFor(
                l3Fixture(101, 'P01.01.01', '首页路径'),
                { code: 'P01', name: '数据基础设施' },
                { code: 'P01.01', name: '测试分类' },
              ),
            },
          })
          return
        }
        await route.fulfill({
          status: 200,
          json: [{ ...draft11, revision: matrixRevision }],
        })
      },
    )
    await mockLearningResources(page)

    await loginAs(page, 'leader')
    await page.goto('/capability/standards')
    await page.getByRole('button', { name: /P01\.01.*测试分类/ }).click()

    // first edit: conflict, backend bumps revision to 4
    await page.locator('#cell-101-P4').selectOption('4')
    await expect(page.getByRole('alert')).toContainText(
      '草稿已被其他操作修改，正在重新加载最新版本',
    )
    // page reloaded matrix with revision=4
    await expect(page.getByText(/修订号：4/)).toBeVisible()

    // next edit uses the fresh revision
    await page.locator('#cell-101-P5').selectOption('5')
    await expect.poll(() => requests.length).toBe(2)
    expect(requests[0].expected_revision).toBe(3)
    expect(requests[1].expected_revision).toBe(4)
    // no permanent busy state, domain retained
    await expect(page.getByTestId('standard-l2-P01.01')).toBeVisible()
    await expect(page.locator('#cell-101-P5')).toBeEnabled()
  })
})

test.describe('Issue #59 publish closure', () => {
  test('Leader publishes a valid standard version and exits draft mode', async ({
    page,
  }) => {
    let published = false
    let publishCalls = 0
    await mockCatalogModel(
      page,
      makeModel([
        catalogDomain('P01', '数据基础设施', [
          {
            code: 'P01.01',
            name: '测试分类',
            l3s: [l3Fixture(101, 'P01.01.01', '首页路径')],
          },
        ]),
      ]),
    )
    await page.route(
      '**/api/capability-standard-versions**',
      async (route: Route) => {
        const request = route.request()
        const { pathname } = new URL(request.url())
        if (pathname.endsWith('/catalog-drift')) {
          await route.fulfill({ status: 200, json: noDrift })
          return
        }
        if (pathname.endsWith('/publish') && request.method() === 'POST') {
          publishCalls += 1
          published = true
          await route.fulfill({
            status: 200,
            json: { version_id: 11, revision: 4, status: '已发布' },
          })
          return
        }
        if (pathname.endsWith('/11')) {
          await route.fulfill({
            status: 200,
            json: {
              version: draft11,
              items: matrixItemsFor(
                l3Fixture(101, 'P01.01.01', '首页路径'),
                { code: 'P01', name: '数据基础设施' },
                { code: 'P01.01', name: '测试分类' },
              ),
            },
          })
          return
        }
        await route.fulfill({
          status: 200,
          json: published
            ? [
                {
                  ...draft11,
                  status: '已发布',
                  published_at: '2026-07-30T00:00:00Z',
                },
              ]
            : [draft11],
        })
      },
    )
    await mockLearningResources(page)

    await loginAs(page, 'leader')
    await page.goto('/capability/standards')

    page.once('dialog', (dialog) => dialog.accept())
    await page.getByRole('button', { name: '检查并发布' }).click()

    // draft UI gone, published label visible
    await expect(page.getByText(/标准版本 v2（草稿）/)).toHaveCount(0)
    await expect(page.getByText(/修订号：/)).toHaveCount(0)
    await expect(page.getByRole('button', { name: '协调目录' })).toHaveCount(0)
    await expect(
      page.getByRole('button', { name: /复制 P7 → P8/ }),
    ).toHaveCount(0)
    await expect(page.getByRole('button', { name: '检查并发布' })).toHaveCount(
      0,
    )
    await expect(page.getByText(/当前已发布版本/)).toBeVisible()
    expect(publishCalls).toBe(1)
  })
})

test.describe('Issue #59 read-only roles in the L3 drawer', () => {
  const drawerL3 = l3Fixture(101, 'P01.01.01', '只读路径')

  async function setupDrawerScenario(
    page: Page,
    user: { roles: string[]; current_level?: string; target_level?: string },
  ) {
    const model = makeModel([
      catalogDomain('P01', '数据基础设施', [
        { code: 'P01.01', name: '测试分类', l3s: [drawerL3] },
      ]),
    ])
    await mockCatalogModel(page, model)
    await page.route('**/api/auth/me', (route) =>
      route.fulfill({
        status: 200,
        json: {
          id: 3,
          username: 'member',
          full_name: 'Member',
          roles: user.roles,
          current_level: user.current_level ?? null,
          target_level: user.target_level ?? null,
        },
      }),
    )
    await page.route(
      '**/api/capability-standard-versions/published?model_id=1',
      (route) =>
        route.fulfill({
          status: 200,
          json: {
            version: {
              id: 1,
              model_id: 1,
              version_no: 1,
              label: 'Legacy Baseline v1',
              status: '已发布',
              published_at: '2026-07-20T00:00:00Z',
            },
            items: matrixItemsFor(
              drawerL3,
              { code: 'P01', name: '数据基础设施' },
              { code: 'P01.01', name: '测试分类' },
              {
                P4: { applicable: true, target: 2 },
                P5: { applicable: true, target: 3 },
                P6: { applicable: true, target: 4 },
                P7: { applicable: false, target: null },
                P8: { applicable: false, target: null },
              },
            ),
          },
        }),
    )
    await page.route(
      '**/api/capability-standard-versions?model_id=1',
      (route) =>
        route.fulfill({
          status: 200,
          json: [
            {
              id: 1,
              model_id: 1,
              version_no: 1,
              label: 'Legacy Baseline v1',
              status: '已发布',
              published_at: '2026-07-20T00:00:00Z',
            },
          ],
        }),
    )
    await mockLearningResources(page)
  }

  async function openDrawer(page: Page) {
    await page.goto('/capability/model')
    await page.getByTestId('l2-toggle-P01.01').click()
    await page.getByTestId('l3-row-P01.01.01').click()
    await expect(page.getByTestId('published-standard')).toBeVisible()
  }

  test('Member sees current and target markers on distinct levels', async ({
    page,
  }) => {
    await setupDrawerScenario(page, {
      roles: ['Member'],
      current_level: 'P5',
      target_level: 'P7',
    })
    await loginAs(page, 'member')
    await openDrawer(page)

    await expect(page.getByTestId('member-current-level')).toContainText(
      'P5 当前',
    )
    await expect(page.getByTestId('member-target-level')).toContainText(
      'P7 目标',
    )
    const standard = page.getByTestId('published-standard')
    await expect(standard).toContainText('Legacy Baseline v1')
    await expect(standard).toContainText('2026')
    await expect(standard).toContainText('来源：')
    await expect(standard).toContainText('不适用')
    // no draft metadata or edit controls
    await expect(page.getByText(/草稿/)).toHaveCount(0)
    await expect(page.getByRole('button', { name: '编辑节点' })).toHaveCount(0)
  })

  test('Member with current == target sees both markers on the same cell', async ({
    page,
  }) => {
    await setupDrawerScenario(page, {
      roles: ['Member'],
      current_level: 'P6',
      target_level: 'P6',
    })
    await loginAs(page, 'member')
    await openDrawer(page)

    const currentCell = page.getByTestId('member-current-level')
    await expect(currentCell).toContainText('P6')
    await expect(currentCell).toContainText('当前')
    await expect(currentCell).toContainText('目标')
    await expect(page.getByTestId('member-target-level')).toHaveCount(0)
  })

  test('Buddy sees the published matrix with no personal markers', async ({
    page,
  }) => {
    await setupDrawerScenario(page, { roles: ['Buddy'] })
    await loginAs(page, 'buddy')
    await openDrawer(page)

    const standard = page.getByTestId('published-standard')
    await expect(standard).toContainText('Legacy Baseline v1')
    await expect(standard).toContainText('目标掌握度 2 / 5')
    await expect(standard).toContainText('目标掌握度 4 / 5')
    await expect(page.getByTestId('member-current-level')).toHaveCount(0)
    await expect(page.getByTestId('member-target-level')).toHaveCount(0)
    // no cell carries the personal markers
    await expect(standard.locator('strong', { hasText: '当前' })).toHaveCount(0)
    await expect(standard.locator('strong', { hasText: '目标' })).toHaveCount(0)
  })

  test('Admin sees the published matrix with no personal markers', async ({
    page,
  }) => {
    await setupDrawerScenario(page, { roles: ['Admin'] })
    await loginAs(page, 'admin')
    await openDrawer(page)

    const standard = page.getByTestId('published-standard')
    await expect(standard).toContainText('Legacy Baseline v1')
    await expect(page.getByTestId('member-current-level')).toHaveCount(0)
    await expect(page.getByTestId('member-target-level')).toHaveCount(0)
    await expect(standard).not.toContainText('修订号')
    await expect(page.getByRole('button', { name: '编辑节点' })).toHaveCount(0)
  })
})

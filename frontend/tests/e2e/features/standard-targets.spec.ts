import { expect, test } from '@playwright/test'

import { loginAs } from '../fixtures/auth'

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
    const assessment = {
      id: 900,
      member_id: 3,
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

    await loginAs(page, 'member')
    await page.goto('/capability/assessment')
    await expect(page.getByText('标准 4')).toBeVisible()
    await expect(page.getByText('不适用', { exact: true })).toBeVisible()
    await expect(page.getByLabel('申请调整 P01.01.02')).toBeDisabled()

    await page.getByLabel('申请调整 P01.01.01').check()
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

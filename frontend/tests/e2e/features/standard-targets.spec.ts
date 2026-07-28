import { expect, test } from '@playwright/test'

import { loginAs } from '../fixtures/auth'

const l3 = {
  code: 'P01.01.01',
  name: '标准目标测试能力',
  p4_description: null,
  p5_description: null,
  p6_description: null,
  p7_description: null,
  p8_description: null,
  recommended_start_level: 'P6',
  standard_target_overrides: { P7: 3 },
  materials_text: '',
  expected_output: null,
  estimated_hours: null,
  resources: [],
  unmatched_materials: [],
}

test.describe('capability standard targets', () => {
  test('Leader maintains three-state overrides with lower levels disabled', async ({
    page,
  }) => {
    let saved: Record<string, unknown> | null = null
    await page.route('**/api/capability-model**', async (route) => {
      if (route.request().method() === 'PUT') {
        saved = route.request().postDataJSON()
        await route.fulfill({ status: 200, json: { ...l3, ...saved } })
        return
      }
      await route.fulfill({
        status: 200,
        json: {
          code: 'test-model',
          version: '1',
          domains: [
            {
              code: 'P01',
              name: '数据基础设施',
              p4_description: null,
              p5_description: null,
              p6_description: null,
              p7_description: null,
              p8_description: null,
              children: [{ code: 'P01.01', name: '测试分类', children: [l3] }],
            },
          ],
        },
      })
    })
    await page.route('**/api/learning-resources**', (route) =>
      route.fulfill({ status: 200, json: [] }),
    )

    await loginAs(page, 'leader')
    await page.goto('/capability/model#P01.01.01')
    await page.getByRole('button', { name: '编辑节点' }).click()

    await expect(page.getByLabel('P4 标准目标')).toBeDisabled()
    await expect(page.getByLabel('P5 标准目标')).toBeDisabled()
    await expect(page.getByLabel('P7 标准目标')).toHaveValue('3')
    await page.getByLabel('P6 标准目标').selectOption('__na__')
    await page.getByLabel('P7 标准目标').selectOption('4')
    await page.getByRole('button', { name: '保存' }).click()

    await expect.poll(() => saved).not.toBeNull()
    expect(saved?.standard_target_overrides).toEqual({ P6: null, P7: 4 })
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
})

import { expect, test } from '@playwright/test'

import { loginAs } from '../fixtures/auth'

const draft = {
  id: 700,
  member_id: 3,
  year: 2026,
  version: 1,
  assessment_type: '年度',
  status: '草稿',
  created_at: '2026-07-29T00:00:00Z',
  submitted_at: null,
  archived_at: null,
  revision: 1,
  details: [
    {
      id: 1,
      l3_code: 'P01.01.01',
      l3_name: '历史目标快照示例',
      l1_code: 'P01',
      l1_name: '数据基础设施',
      l2_code: 'P01.01',
      l2_name: '数据基础',
      current_level: 2,
      target_level: 3,
      standard_target_applicable: true,
      standard_target_level: null,
      target_adjusted: false,
      adjusted_target_level: null,
      target_adjustment_reason: null,
      target_snapshot_source: 'legacy_preserved',
      target_compatibility_error: '历史明细缺少目标快照',
      gap_value: 1,
      evidence_note: '历史依据',
      plan_candidate: false,
    },
  ],
  gap_summary: {
    total_gaps: 1,
    avg_gap: 1,
    high_priority: 0,
    medium_priority: 1,
    low_priority: 0,
  },
}

const preview = {
  assessment_id: 700,
  status: '草稿',
  revision: 1,
  member_current_level: { value: 'P4', source: 'assessment_snapshot' },
  member_target_level: { value: 'P5', source: 'assessment_snapshot' },
  standard_version: {
    id: 1,
    version_no: 1,
    status: '已发布',
    source: 'legacy_derived',
  },
  summary: {
    rebuild_count: 1,
    preserve_count: 0,
    not_applicable_count: 0,
    unrepairable_count: 0,
    actionable_count: 1,
  },
  details: [{ l3_code: 'P01.01.01', action: 'rebuild', reason: null }],
  unrepairable_details: [],
}

test.describe('Issue #58 draft target snapshot repair', () => {
  test('previews then confirms one whole-draft repair and reloads', async ({
    page,
  }) => {
    let executed = 0
    let reloaded = false
    let detailReads = 0
    await page.route('**/api/assessments**', async (route) => {
      const { pathname } = new URL(route.request().url())
      if (pathname === '/api/assessments') {
        await route.fulfill({
          status: 200,
          json: [{ ...draft, details: undefined }],
        })
      } else if (pathname.endsWith('/draft-target-repair/preview')) {
        await route.fulfill({ status: 200, json: preview })
      } else if (pathname.endsWith('/draft-target-repair')) {
        executed += 1
        expect(route.request().postDataJSON()).toEqual({ expected_revision: 1 })
        await route.fulfill({
          status: 200,
          json: {
            result: 'repaired',
            assessment_id: 700,
            old_revision: 1,
            revision: 2,
            audit_id: 9,
            summary: preview.summary,
            unrepairable_details: [],
          },
        })
      } else if (pathname === '/api/assessments/700') {
        detailReads += 1
        reloaded = detailReads > 1
        await route.fulfill({
          status: 200,
          json: {
            ...draft,
            revision: detailReads > 1 ? 2 : 1,
            details: draft.details.map((detail) => ({
              ...detail,
              standard_target_level: detailReads > 1 ? 3 : null,
              target_snapshot_source:
                detailReads > 1
                  ? 'legacy_baseline_v1_repaired'
                  : 'legacy_preserved',
              target_compatibility_error:
                detailReads > 1 ? null : '历史明细缺少目标快照',
            })),
          },
        })
      } else {
        await route.fallback()
      }
    })

    await loginAs(page, 'member')
    await page.goto('/capability/assessment')
    await expect(
      page.getByRole('alert', { name: '草稿目标快照需要兼容修复' }),
    ).toBeVisible()
    await page.getByRole('button', { name: '查看修复影响' }).click()
    await expect(page.getByTestId('draft-repair-preview')).toContainText(
      '将重建 1 条明细',
    )
    await page.getByRole('button', { name: '确认修复草稿' }).click()
    await expect.poll(() => executed).toBe(1)
    await expect.poll(() => reloaded).toBe(true)
    await expect(
      page.getByText('草稿目标快照已修复，已重新加载评估。'),
    ).toBeVisible()
  })

  test('does not offer confirmation when any detail is unrepairable', async ({
    page,
  }) => {
    let executed = 0
    await page.route(/\/api\/assessments(?:\?.*)?$/, async (route) => {
      await route.fulfill({
        status: 200,
        json: [{ ...draft, details: undefined }],
      })
    })
    await page.route(/\/api\/assessments\/700$/, async (route) => {
      await route.fulfill({ status: 200, json: draft })
    })
    await page.route(
      '**/api/assessments/700/draft-target-repair/preview',
      async (route) => {
        await route.fulfill({
          status: 200,
          json: {
            ...preview,
            summary: { ...preview.summary, unrepairable_count: 1 },
            unrepairable_details: [
              {
                l3_code: 'legacy-unknown',
                action: 'unrepairable',
                reason: 'L3 无法唯一映射到 Legacy Baseline v1',
              },
            ],
          },
        })
      },
    )
    await page.route(
      '**/api/assessments/700/draft-target-repair',
      async (route) => {
        executed += 1
        await route.abort()
      },
    )

    await loginAs(page, 'member')
    await page.goto('/capability/assessment')
    await page.getByRole('button', { name: '查看修复影响' }).click()
    await expect(page.getByText('legacy-unknown')).toBeVisible()
    await expect(page.getByText('本次不会写入任何数据。')).toBeVisible()
    await expect(
      page.getByRole('button', { name: '确认修复草稿' }),
    ).toHaveCount(0)
    expect(executed).toBe(0)
  })
})

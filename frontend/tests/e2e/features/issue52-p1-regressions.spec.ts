import { expect, test } from '@playwright/test'

import { loginAs } from '../fixtures/auth'
import {
  mockBuddyReviewData,
  mockBuddyReviewWorkspaceRoutes,
} from '../fixtures/buddy-review-mock'
import { mockTeamAnalyticsData } from '../fixtures/team-analytics-mock'

const rangeHours = {
  raw: '4–6h',
  min_hours: 4,
  max_hours: 6,
  is_valid: true,
  is_range: true,
}

const unparsedHours = '约半天'

test.describe('Issue #52 P1 regressions', () => {
  test('keeps an unmapped historic L3 in the Buddy review workspace', async ({
    page,
  }) => {
    await mockBuddyReviewData(page)
    await mockBuddyReviewWorkspaceRoutes(page)
    await loginAs(page, 'buddy')
    await page.goto('/mentoring/dashboard')

    // Issue #62 workspace: frozen facts in the summary grid and grouped table
    await expect(page.getByText('适用 3')).toBeVisible()
    await expect(page.getByText('未映射历史项')).toBeVisible()
    await expect(page.getByText(/unknown-legacy-l3/).first()).toBeVisible()
    await expect(page.getByText('数据管道基础', { exact: true })).toBeVisible()
    // personal adjustment shown only when it happened
    await expect(page.getByText(/3 → 4（岗位项目要求/)).toBeVisible()
  })

  test('labels team aggregates as L3 mastery rather than job-level attainment', async ({
    page,
  }) => {
    await mockTeamAnalyticsData(page)
    await loginAs(page, 'leader')
    await page.goto('/operations/analytics')

    await expect(page.getByText('L3 掌握度实际 vs 目标')).toBeVisible()
    await expect(page.getByText('成员 L3 掌握度达成率')).toBeVisible()
    await expect(
      page.getByText(
        '以上指标基于三级达成路径的当前掌握度与目标掌握度聚合，不代表二级能力标准 P4–P8 岗位职级达成率。',
      ),
    ).toBeVisible()
    await expect(page.getByText('4–6 h').first()).toBeVisible()
    await expect(page.getByText('46 h', { exact: true })).not.toBeVisible()
  })

  test('keeps an estimated-hour range through the annual plan and member dashboard', async ({
    page,
  }) => {
    await page.route(
      /\/api\/planning\/member-dashboard\?year=\d+$/,
      async (route) => {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            year: 2026,
            assessment: {
              id: 1,
              status: '已归档',
              submitted_at: '2026-01-01T00:00:00Z',
              archived_at: null,
              review_status: '已闭环',
              review_conclusion: '认可',
            },
            annual_plan_status: '执行中',
            summary: {
              annual_actual_hours: 0,
              annual_planned_hours: 4,
              annual_planned_hours_min: 4,
              annual_planned_hours_max: 6,
              annual_planned_hours_has_values: true,
              annual_planned_hours_has_unparsed: false,
              current_month_actual_hours: 0,
              current_month_planned_hours: 4,
              current_month_planned_hours_min: 4,
              current_month_planned_hours_max: 6,
              current_month_planned_hours_has_values: true,
              current_month_planned_hours_has_unparsed: false,
              completed_task_count: 0,
              pending_evidence_count: 0,
            },
            plan_progress: {
              total: 1,
              未开始: 0,
              进行中: 1,
              '待 Evidence Review': 0,
              已完成: 0,
              延期: 0,
            },
            domain_radar: [{ domain_code: 'P01', score: 2 }],
            gaps: [],
            current_tasks: [
              {
                id: 1,
                plan_item_id: 1,
                l3_code: 'P01.01.01',
                l3_name: '区间达成路径',
                status: '进行中',
                actual_start_date: null,
                actual_end_date: null,
                actual_hours: 0,
                completion_quality: null,
                review_conclusion: null,
                next_action: null,
                plan_item_current_level: 1,
                plan_item_target_level: 3,
                plan_item_priority: '中',
                plan_item_learning_material: null,
                plan_item_learning_task_content: '区间任务',
                plan_item_expected_output: null,
                plan_item_estimated_hours: '4–6h',
                plan_item_estimated_hours_parsed: rangeHours,
                plan_item_target_month: 7,
              },
            ],
          }),
        })
      },
    )
    await page.route(
      /\/api\/planning\/annual-plan\?year=\d+$/,
      async (route) => {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            id: 1,
            member_id: 3,
            year: 2026,
            plan_cycle: 12,
            status: '执行中',
            start_date: null,
            end_date: null,
            created_at: '2026-01-01T00:00:00Z',
            estimated_hours_summary: {
              min_hours: 4,
              max_hours: 6,
              has_values: true,
              has_unparsed: false,
            },
            items: [
              {
                id: 1,
                annual_growth_plan_id: 1,
                growth_goal_id: 1,
                l3_code: 'P01.01.01',
                l3_name: '区间达成路径',
                current_level: 1,
                target_level: 3,
                priority: '中',
                learning_material: null,
                learning_task_content: '区间任务',
                expected_output: null,
                estimated_hours: '4–6h',
                estimated_hours_parsed: rangeHours,
                plan_start_date: null,
                plan_end_date: null,
                target_month: 7,
                status: '进行中',
              },
            ],
          }),
        })
      },
    )

    await loginAs(page, 'member')
    await page.goto('/dashboard/member')
    await expect(page.getByText('全年计划时长')).toBeVisible()
    await expect(page.getByText('4–6 h').first()).toBeVisible()
    await expect(page.getByTestId('current-tasks-table')).toContainText('4–6 h')

    await page.goto('/growth/annual-plan')
    await expect(
      page.getByRole('heading', { name: '年度成长计划' }),
    ).toBeVisible()
    await expect(page.getByText('4–6 h').first()).toBeVisible()
    await expect(page.getByText('46 h', { exact: true })).not.toBeVisible()
  })

  test('shows raw text and unparsed warning for unparseable estimated hours', async ({
    page,
  }) => {
    await page.route(
      /\/api\/planning\/annual-plan\?year=\d+$/,
      async (route) => {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            id: 1,
            member_id: 3,
            year: 2026,
            plan_cycle: 12,
            status: '执行中',
            start_date: null,
            end_date: null,
            created_at: '2026-01-01T00:00:00Z',
            estimated_hours_summary: {
              min_hours: 0,
              max_hours: 0,
              has_values: false,
              has_unparsed: true,
            },
            items: [
              {
                id: 1,
                annual_growth_plan_id: 1,
                growth_goal_id: 1,
                l3_code: 'P01.01.01',
                l3_name: '文本耗时路径',
                current_level: 1,
                target_level: 3,
                priority: '中',
                learning_material: null,
                learning_task_content: '文本任务',
                expected_output: null,
                estimated_hours: unparsedHours,
                estimated_hours_parsed: {
                  raw: unparsedHours,
                  min_hours: null,
                  max_hours: null,
                  is_valid: false,
                  is_range: false,
                },
                plan_start_date: null,
                plan_end_date: null,
                target_month: 7,
                status: '进行中',
              },
            ],
          }),
        })
      },
    )

    await loginAs(page, 'member')
    await page.goto('/growth/annual-plan')
    await expect(
      page.getByRole('heading', { name: '年度成长计划' }),
    ).toBeVisible()
    await expect(page.getByText(unparsedHours)).toBeVisible()
    await expect(
      page.getByText('部分计划项耗时为文本，未计入汇总'),
    ).toBeVisible()
    await expect(page.getByText('46 h', { exact: true })).not.toBeVisible()
  })
})

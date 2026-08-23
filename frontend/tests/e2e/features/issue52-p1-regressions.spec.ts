import { expect, test } from '@playwright/test'

import { loginAs } from '../fixtures/auth'
import { mockBuddyReviewData } from '../fixtures/buddy-review-mock'
import { mockTeamAnalyticsData } from '../fixtures/team-analytics-mock'
import { mockMemberDashboard } from '../../../src/__fixtures__/memberDashboard'

const rangeHours = {
  raw: '4–6h',
  min_hours: 4,
  max_hours: 6,
  is_valid: true,
  is_range: true,
}

const unparsedHours = '约半天'

test.describe('Issue #52 P1 regressions', () => {
  test('legacy Buddy review route redirects to evidence review; pending evidence stays visible', async ({
    page,
  }) => {
    await mockBuddyReviewData(page)
    await loginAs(page, 'buddy')
    // Issue #194 P1-3: 旧复核工作区已退役，路由重定向到证据评审。
    await page.goto('/mentoring/dashboard')
    await expect(page).toHaveURL(/\/mentoring\/evidence-review$/)
    await expect(page.getByRole('heading', { name: '成果验收' })).toBeVisible()
    // 待验收证据保持可见（mock 数据：P01.01.01 数据管道基础）。
    // 标题渲染在组合段落内，按验收工作区约束并用包含语义匹配。
    const workspace = page.locator('.buddy-workspace')
    await expect(workspace.getByText(/数据管道基础/).first()).toBeVisible()
    await expect(workspace.getByText(/P01\.01\.01/).first()).toBeVisible()
    await expect(page.getByText('Buddy 复核中心')).toHaveCount(0)
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

  test('keeps an estimated-hour range in the member dashboard', async ({
    page,
  }) => {
    const dashboard = {
      ...mockMemberDashboard,
      summary: {
        ...mockMemberDashboard.summary,
        annual_planned_hours: 4,
        annual_planned_hours_min: 4,
        annual_planned_hours_max: 6,
        annual_planned_hours_has_values: true,
        annual_planned_hours_has_unparsed: false,
        current_month_planned_hours: 4,
        current_month_planned_hours_min: 4,
        current_month_planned_hours_max: 6,
        current_month_planned_hours_has_values: true,
        current_month_planned_hours_has_unparsed: false,
      },
      current_tasks: [
        {
          ...mockMemberDashboard.current_tasks[0],
          plan_item_estimated_hours: '4–6h',
          plan_item_estimated_hours_parsed: rangeHours,
        },
      ],
    }
    await page.route(
      /\/api\/planning\/member-dashboard\?year=\d+$/,
      async (route) => {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(dashboard),
        })
      },
    )

    await loginAs(page, 'member')
    await page.goto('/dashboard/member')
    await expect(page.getByText('全年计划时长')).toBeVisible()
    await expect(page.getByText('4–6 h').first()).toBeVisible()
    await expect(page.getByTestId('current-tasks-table')).toContainText('4–6 h')
    await expect(page.getByText('46 h', { exact: true })).not.toBeVisible()
  })

  test('shows raw text and unparsed warning in the member dashboard', async ({
    page,
  }) => {
    const dashboard = {
      ...mockMemberDashboard,
      summary: {
        ...mockMemberDashboard.summary,
        annual_planned_hours: 0,
        annual_planned_hours_min: null,
        annual_planned_hours_max: null,
        annual_planned_hours_has_values: false,
        annual_planned_hours_has_unparsed: true,
      },
      current_tasks: [
        {
          ...mockMemberDashboard.current_tasks[0],
          plan_item_estimated_hours: unparsedHours,
          plan_item_estimated_hours_parsed: {
            raw: unparsedHours,
            min_hours: null,
            max_hours: null,
            is_valid: false,
            is_range: false,
          },
        },
      ],
    }
    await page.route(
      /\/api\/planning\/member-dashboard\?year=\d+$/,
      async (route) => {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(dashboard),
        })
      },
    )

    await loginAs(page, 'member')
    await page.goto('/dashboard/member')
    await expect(page.getByText(unparsedHours)).toBeVisible()
    await expect(
      page.getByText('部分计划项耗时为文本，未计入汇总'),
    ).toBeVisible()
    await expect(page.getByText('46 h', { exact: true })).not.toBeVisible()
  })
})

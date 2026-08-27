import { expect, test } from '@playwright/test'

import { loginAs } from '../fixtures/auth'
import { mockEvidenceReviewWorkspace } from '../fixtures/buddy-review-mock'
import { mockTeamAnalyticsData } from '../fixtures/team-analytics-mock'

test.describe('Issue #52 P1 regressions', () => {
  test('keeps an unmapped historic L3 isolated in Evidence Review', async ({
    page,
  }) => {
    await mockEvidenceReviewWorkspace(page)
    await page.route('/api/planning/evidence-reviews/workspace*', (route) =>
      route.fulfill({
        status: 200,
        json: {
          summary: {
            pending_count: 1,
            needs_supplement_count: 0,
            approved_this_month_count: 0,
            average_response_days: null,
          },
          members: [{ id: 3, username: 'member', pending_count: 1 }],
          queue: [
            {
              id: 499,
              learning_task_id: 599,
              version_number: 1,
              status: '待 Review',
              revision: 1,
              member_id: 3,
              username: 'member',
              l3_code: 'unknown-legacy-l3',
              l3_name: null,
              description: '历史成果仍可验收。',
              content: '历史 L3 不映射到当前能力树。',
              evidence_link: null,
              is_resubmission: false,
            },
          ],
        },
      }),
    )
    await page.route(
      '/api/planning/learning-tasks/599/evidence-reviews',
      (route) => route.fulfill({ status: 200, json: [] }),
    )
    await loginAs(page, 'buddy')
    await page.goto('/mentoring/dashboard')

    await expect(page).toHaveURL(/\/mentoring\/evidence-review$/)
    await expect(page.getByRole('heading', { name: '成果验收' })).toBeVisible()
    await expect(
      page.getByText('unknown-legacy-l3', { exact: true }),
    ).toBeVisible()
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
})

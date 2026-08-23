import { expect, test, type Page } from '@playwright/test'

import { mockAssessment } from '../../../src/__fixtures__/assessmentMock'
import { loginAs } from '../fixtures/auth'

const viewports = [
  { name: '1440x900', width: 1440, height: 900 },
  { name: '1024x800', width: 1024, height: 800 },
  { name: '768x900', width: 768, height: 900 },
] as const

const item = {
  id: 1,
  annual_growth_plan_id: 1,
  growth_goal_id: null,
  l3_code: 'P01.01.01',
  l1_code: 'P01',
  l1_name: '数据基础设施',
  l2_code: 'P01.01',
  l2_name: '数据工程',
  l3_name: '数据管道基础',
  current_level: 2,
  target_level: 4,
  priority: '高',
  learning_material: '数据工程手册',
  learning_task_content: '完成数据管道基础文档与演练。',
  expected_output: '数据管道文档',
  estimated_hours: '8',
  estimated_hours_parsed: { is_valid: true, min_hours: 8 },
  plan_start_date: null,
  plan_end_date: null,
  target_month: 9,
  plan_month: '2026-09',
  status: '进行中',
  revision: 1,
}
const task = {
  id: 9,
  plan_item_id: 1,
  l3_code: item.l3_code,
  l3_name: item.l3_name,
  l2_code: item.l2_code,
  l2_name: item.l2_name,
  status: '进行中',
  actual_start_date: '2026-09-01',
  actual_end_date: null,
  actual_hours: 4,
  completion_quality: null,
  review_conclusion: null,
  next_action: '完成演练',
  revision: 1,
  actual_started_at: null,
  actual_completed_at: null,
  delay_reason: null,
  pause_reason: null,
  cancel_reason: null,
  revised_due_date: null,
  plan_item_current_level: 2,
  plan_item_target_level: 4,
  plan_item_priority: '高',
  plan_item_learning_material: item.learning_material,
  plan_item_learning_task_content: item.learning_task_content,
  plan_item_expected_output: item.expected_output,
  plan_item_estimated_hours: '8',
  plan_item_estimated_hours_parsed: item.estimated_hours_parsed,
  plan_item_target_month: 9,
}
const plan = {
  id: 1,
  member_id: 1,
  year: 2026,
  status: '执行中',
  items: [item],
}

async function mockMember(page: Page, proposal: 'pending' | 'none' | 'error') {
  let authenticated = false
  let allowProposalSuccess = proposal !== 'error'
  const member = {
    id: 1,
    username: 'member',
    full_name: 'Member',
    roles: ['Member'],
    primary_buddy: null,
    assigned_members: [],
  }
  await page.route('**/api/**', (route) => route.abort('blockedbyclient'))
  await page.route('/api/auth/login', async (route) => {
    authenticated = true
    await route.fulfill({ json: member })
  })
  await page.route(
    '/api/auth/me',
    async (route) =>
      await route.fulfill(
        authenticated ? { json: member } : { status: 401, json: {} },
      ),
  )
  await page.route(
    '/api/planning/available-years',
    async (route) =>
      await route.fulfill({
        json: { available_years: [2026], active_year: 2026 },
      }),
  )
  await page.route(
    '/api/planning/annual-plan?year=2026',
    async (route) => await route.fulfill({ json: plan }),
  )
  await page.route(
    '/api/planning/learning-tasks',
    async (route) => await route.fulfill({ json: [task] }),
  )
  await page.route(
    '/api/planning/learning-tasks/9',
    async (route) => await route.fulfill({ json: task }),
  )
  await page.route(
    '/api/planning/learning-tasks/9/progress-logs',
    async (route) =>
      await route.fulfill({
        json: [
          {
            id: 1,
            task_id: 9,
            record_date: '2026-09-03',
            actual_hours: 4,
            note: '完成基础演练',
            recorder_id: 1,
            created_at: '2026-09-03T00:00:00Z',
            invalidated_at: null,
            invalidated_by: null,
            correction_of_log_id: null,
            idempotency_key: null,
          },
        ],
      }),
  )
  await page.route(
    '/api/planning/learning-tasks/9/evidences',
    async (route) => await route.fulfill({ json: [] }),
  )
  await page.route(
    '/api/planning/learning-tasks/9/evidence-reviews',
    async (route) => await route.fulfill({ json: [] }),
  )
  await page.route(
    '/api/planning/learning-tasks/9/transition-history',
    async (route) => await route.fulfill({ json: [] }),
  )
  await page.route(
    '/api/planning/change-proposals?year=2026',
    async (route) => {
      if (!allowProposalSuccess)
        return route.fulfill({
          status: 500,
          json: { detail: 'mock proposal failure' },
        })
      await route.fulfill({
        json:
          proposal === 'pending'
            ? [
                {
                  id: 1,
                  details: [
                    {
                      id: 2,
                      l3_code: item.l3_code,
                      requirement_decision: null,
                    },
                  ],
                },
              ]
            : [],
      })
    },
  )
  return {
    allowProposalSuccess: () => {
      allowProposalSuccess = true
    },
  }
}

async function mockEditableAssessmentDraft(page: Page) {
  const detail = {
    ...mockAssessment,
    revision: 1,
    details: mockAssessment.details.map((row) => ({
      ...row,
      include_in_plan: null,
      member_priority: null,
      plan_month: null,
      plan_quarter: null,
      standard_target_applicable: true,
      standard_target_level: row.target_level,
      target_adjusted: false,
      adjusted_target_level: null,
      target_adjustment_reason: null,
    })),
  }
  await page.route('/api/assessments', async (route) =>
    route.fulfill({ json: [{ ...detail, details: undefined }] }),
  )
  await page.route(`/api/assessments/${detail.id}`, async (route) =>
    route.fulfill({ json: detail }),
  )
  await page.route(`/api/assessments/${detail.id}/draft`, async (route) =>
    route.fulfill({ json: { revision: 2, auto_cleared: [] } }),
  )
}

for (const viewport of viewports) {
  test(`M02 editable selected draft-complete ${viewport.name}`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport)
    await mockMember(page, 'none')
    await mockEditableAssessmentDraft(page)
    await loginAs(page, 'member')
    await page.goto('/capability/assessment?year=2026')
    await expect(
      page.getByRole('heading', { name: '能力评级与提升计划' }),
    ).toBeVisible()
    await page.getByRole('button', { name: '加入提升计划 P01.01.01' }).click()
    const month = page.locator('input[type="month"]').first()
    await month.fill('2026-09')
    const control = page.getByTestId('plan-month-control-P01.01.01')
    await expect(control).toContainText('2026-09')
    await control.click({ position: { x: 2, y: 2 } })
    await expect(month).toBeFocused()
    await page.keyboard.press('Escape')
    await expect(page.getByTestId('assessment-content-area')).toContainText(
      '计划月份已完整',
    )
    if (viewport.width <= 1024) {
      const geometry = await page.evaluate(() => {
        const content = document.querySelector(
          '[data-testid="assessment-content-area"]',
        )!
        const main = document.querySelector(
          '[data-testid="assessment-main-area"]',
        )!
        const footer = document.querySelector('[aria-label="计划草稿操作"]')!
        const rows = [...document.querySelectorAll('[id^="row-"]')]
        return {
          contentOverflow: getComputedStyle(content).overflowY,
          footerTop: footer.getBoundingClientRect().top,
          lastRowBottom: Math.max(
            ...rows.map((row) => row.getBoundingClientRect().bottom),
          ),
          mainOverflow: getComputedStyle(main).overflowY,
        }
      })
      expect(geometry.contentOverflow).toBe('visible')
      expect(geometry.mainOverflow).toBe('visible')
      expect(geometry.footerTop).toBeGreaterThanOrEqual(geometry.lastRowBottom)
    }
    await expect(page).toHaveScreenshot(
      `issue-194-m02-editable-draft-complete-${viewport.name}.png`,
      { fullPage: false, maxDiffPixelRatio: 0.05 },
    )
  })

  test(`M04 default/pending/progress ${viewport.name}`, async ({ page }) => {
    await page.setViewportSize(viewport)
    await mockMember(page, 'pending')
    await loginAs(page, 'member')
    await page.goto('/growth/tasks?year=2026')
    await expect(page.getByRole('heading', { name: '学习任务' })).toBeVisible()
    await expect(page.getByTestId('task-progress')).toContainText('50%')
    await expect(page.getByTestId('task-card-enter')).toBeVisible()
    if (viewport.width === 768) {
      expect(
        await page
          .locator('.task-summary')
          .evaluate(
            (node) =>
              getComputedStyle(node).gridTemplateColumns.split(' ').length,
          ),
      ).toBe(1)
    }
    await expect(page).toHaveScreenshot(
      `issue-194-m04-default-pending-progress-${viewport.name}.png`,
      { fullPage: false, maxDiffPixelRatio: 0.05 },
    )
  })
  for (const state of ['pending', 'none', 'error'] as const) {
    test(`M05 ${state}${state === 'error' ? '-retry' : ''} ${viewport.name}`, async ({
      page,
    }) => {
      await page.setViewportSize(viewport)
      const mock = await mockMember(page, state)
      await loginAs(page, 'member')
      await page.goto('/growth/tasks/9?year=2026')
      await expect(
        page.getByRole('heading', { name: item.l3_name }),
      ).toBeVisible()
      if (state === 'pending') {
        await expect(page.getByTestId('pending-requirement')).toBeVisible()
        await expect(page.getByText('能力要求已更新，等待你确认')).toBeVisible()
      }
      if (state === 'none')
        await expect(
          page.getByText('当前任务没有待确认的能力要求变化。'),
        ).toBeVisible()
      if (state === 'error') {
        const retry = page.getByRole('button', { name: '重新加载要求变化' })
        await expect(retry).toBeVisible()
        await expect(page).toHaveScreenshot(
          `issue-194-m05-${state}-${viewport.name}.png`,
          { fullPage: false, maxDiffPixelRatio: 0.05 },
        )
        mock.allowProposalSuccess()
        await retry.click()
        await expect(
          page.getByText('当前任务没有待确认的能力要求变化。'),
        ).toBeVisible()
        return
      }
      await expect(page).toHaveScreenshot(
        `issue-194-m05-${state}-${viewport.name}.png`,
        { fullPage: false, maxDiffPixelRatio: 0.05 },
      )
    })
  }
}

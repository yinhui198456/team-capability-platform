import { expect, test, type Page } from '@playwright/test'

import { loginAs } from '../fixtures/auth'
import {
  capabilityMapModel,
  capabilityMapResourceDetail,
  capabilityMapResources,
} from '../fixtures/capability-map-mock'

const member = {
  id: 52,
  username: 'member',
  full_name: 'Issue #52 Member',
  roles: ['Member'],
}

async function mockMemberAuth(page: Page) {
  let authenticated = false
  await page.route('**/api/auth/login', async (route) => {
    authenticated = true
    await route.fulfill({ status: 200, json: member })
  })
  await page.route('**/api/auth/me', async (route) => {
    await route.fulfill(
      authenticated
        ? { status: 200, json: member }
        : { status: 401, json: { detail: 'Unauthorized' } },
    )
  })
}

test('Issue #52 growth goals show L2 standard and L3 path at 1440x900', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await mockMemberAuth(page)
  await page.route('**/api/planning/annual-plan-eligibility', (route) =>
    route.fulfill({ status: 200, json: { eligible: true, reason: null } }),
  )
  await page.route('**/api/planning/eligible-gaps', (route) =>
    route.fulfill({
      status: 200,
      json: [
        {
          id: 52,
          assessment_id: 1,
          l3_code: 'P01.01.01',
          l1_code: 'P01',
          l1_name: 'P01 能力域',
          l2_code: 'P01.01',
          l2_name: 'Data Infra 产品体系认知',
          l3_name: 'TDC / TDH / ArgoDB / TDS 产品定位',
          current_level: 2,
          target_level: 4,
          gap_value: 2,
          priority: '高',
          plan_candidate: true,
        },
      ],
    }),
  )
  await page.route('**/api/planning/growth-goals', (route) =>
    route.fulfill({ status: 200, json: [] }),
  )

  await loginAs(page, 'member')
  await page.goto('/growth/goals')
  await expect(
    page.getByRole('heading', { name: '成长目标', exact: true }),
  ).toBeVisible()
  await expect(
    page.getByText(
      'P01.01 · Data Infra 产品体系认知 → P01.01.01 · TDC / TDH / ArgoDB / TDS 产品定位',
    ),
  ).toBeVisible()
  await expect(
    page.getByText('掌握度提升：当前 2 → 目标 4（Gap 2）'),
  ).toBeVisible()
  await expect(page).toHaveScreenshot('issue52-growth-goals-1440x900.png', {
    fullPage: false,
    maxDiffPixels: 1500,
  })
})

test('Issue #52 learning resources show L2 and L3 context at 1440x900', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await mockMemberAuth(page)
  await page.route('**/api/capability-model**', (route) =>
    route.fulfill({ status: 200, json: capabilityMapModel }),
  )
  await page.route('**/api/learning-resources**', (route) =>
    route.fulfill({ status: 200, json: capabilityMapResources }),
  )
  await page.route('**/api/learning-resources/ISSUE52-M001', (route) =>
    route.fulfill({ status: 200, json: capabilityMapResourceDetail }),
  )

  await loginAs(page, 'member')
  await page.goto('/operations/resources')
  await expect(page.getByRole('heading', { name: '学习资源' })).toBeVisible()
  await page.getByLabel('资源详情').selectOption('ISSUE52-M001')
  await expect(
    page.getByRole('link', {
      name: 'P02.03 · P02 能力标准 3 → P02.03.07 · 跨域搜索目标达成路径',
      exact: true,
    }),
  ).toBeVisible()
  await expect(page).toHaveScreenshot(
    'issue52-learning-resources-1440x900.png',
    {
      fullPage: false,
      maxDiffPixels: 1500,
    },
  )
})

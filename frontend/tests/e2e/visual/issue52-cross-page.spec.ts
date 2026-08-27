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

test('Issue #52 growth-goals route redirects to the M03 timeline', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await mockMemberAuth(page)
  await page.route('**/api/planning/annual-plan*', (route) =>
    route.fulfill({ status: 200, json: null }),
  )

  await loginAs(page, 'member')
  await page.goto('/growth/goals')
  await expect(
    page.getByRole('heading', { name: '月度计划时间轴', exact: true }),
  ).toBeVisible()
  const taskList = page.getByRole('link', { name: '查看任务列表' })
  await expect(taskList).toHaveAttribute('href', /\/growth\/tasks\?year=\d+$/)
  await expect(taskList).not.toHaveAttribute('href', /task_id=/)
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

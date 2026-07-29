import { expect, test, type Page } from '@playwright/test'

import { loginAs } from '../fixtures/auth'
import { capabilityMapModel } from '../fixtures/capability-map-mock'

const VIEWPORTS = [
  { name: '1440x900', width: 1440, height: 900 },
  { name: '1920x1080', width: 1920, height: 1080 },
] as const

async function mockCapabilityMap(
  page: Page,
  role: 'member' | 'leader' = 'member',
) {
  let currentUser: Record<string, unknown> | null = null
  await page.route('**/api/auth/login', async (route) => {
    currentUser = {
      id: role === 'leader' ? 1 : 2,
      username: role,
      full_name: `Issue #52 ${role}`,
      roles: [role === 'leader' ? 'Leader' : 'Member'],
    }
    await route.fulfill({ status: 200, json: currentUser })
  })
  await page.route('**/api/auth/me', async (route) => {
    if (currentUser) {
      await route.fulfill({ status: 200, json: currentUser })
      return
    }
    await route.fulfill({ status: 401, json: { detail: 'Unauthorized' } })
  })
  await page.route('**/api/capability-model**', (route) =>
    route.fulfill({ status: 200, json: capabilityMapModel }),
  )
  await page.route('**/api/learning-resources**', (route) =>
    route.fulfill({ status: 200, json: [] }),
  )
}

for (const viewport of VIEWPORTS) {
  test(`capability map visual baseline ${viewport.name}`, async ({ page }) => {
    await page.setViewportSize(viewport)
    let currentUser: Record<string, unknown> | null = null
    await page.route('**/api/auth/login', async (route) => {
      currentUser = {
        id: 2,
        username: 'member',
        full_name: 'Issue #52 Member',
        roles: ['Member'],
      }
      await route.fulfill({ status: 200, json: currentUser })
    })
    await page.route('**/api/auth/me', async (route) => {
      if (currentUser) {
        await route.fulfill({ status: 200, json: currentUser })
        return
      }
      await route.fulfill({ status: 401, json: { detail: 'Unauthorized' } })
    })
    await page.route('**/api/capability-model**', (route) =>
      route.fulfill({ status: 200, json: capabilityMapModel }),
    )
    await page.route('**/api/learning-resources**', (route) =>
      route.fulfill({ status: 200, json: [] }),
    )
    await loginAs(page, 'member')
    await page.goto('/capability/model')

    await expect(
      page.getByTestId('capability-domain-content-P01'),
    ).toBeVisible()
    await expect(
      page.getByRole('tablist', { name: '能力域导航' }),
    ).toBeVisible()
    await expect(page.locator('[data-testid^="l2-group-"]')).toHaveCount(10)
    await expect(
      page.locator('[data-testid^="l2-level-summary-"]'),
    ).toHaveCount(0)
    const scrollWidth = await page.evaluate(
      () => document.documentElement.scrollWidth,
    )
    expect(scrollWidth).toBeLessThanOrEqual(viewport.width)
    const pageWidth = await page
      .getByTestId('capability-map-page')
      .evaluate((element) => element.getBoundingClientRect().width)
    const contentWidth = await page
      .locator('.app-content')
      .evaluate((element) => element.getBoundingClientRect().width)
    expect(pageWidth).toBeGreaterThan(contentWidth * 0.85)
    await expect(page).toHaveScreenshot(`capability-map-${viewport.name}.png`, {
      maxDiffPixelRatio: 0.05,
      fullPage: true,
    })
  })
}

test('capability map Drawer visual evidence 1440x900', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await mockCapabilityMap(page)
  await loginAs(page, 'member')
  await page.goto('/capability/model')
  await page.getByTestId('l2-toggle-P01.01').click()
  await page.getByTestId('l3-row-P01.01.01').click()
  await expect(page.getByRole('dialog', { name: 'P01.01.01' })).toBeVisible()
  await expect(page).toHaveScreenshot('capability-map-drawer-1440x900.png', {
    maxDiffPixelRatio: 0.05,
    fullPage: true,
  })
})

test('capability map L2 P4-P8 visual evidence 1440x900', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await mockCapabilityMap(page)
  await loginAs(page, 'member')
  await page.goto('/capability/model')
  await page.getByTestId('l2-toggle-P01.01').click()
  await page.getByTestId('l2-level-summary-P01.01-P5').click()
  await expect(
    page.getByTestId('l2-level-inline-description-P01.01-P5'),
  ).toBeVisible()
  await expect(page).toHaveScreenshot('capability-map-l2-level-1440x900.png', {
    maxDiffPixelRatio: 0.05,
    fullPage: true,
  })
})

test('capability map empty L3 path visual evidence 1440x900', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await mockCapabilityMap(page)
  await loginAs(page, 'member')
  await page.goto('/capability/model')
  await page.getByTestId('capability-domain-tab-P02').click()
  await page.getByTestId('l2-toggle-P02.07').click()
  await expect(page.getByText('三级达成路径待补充')).toBeVisible()
  await expect(page).toHaveScreenshot('capability-map-empty-l2-1440x900.png', {
    maxDiffPixelRatio: 0.05,
    fullPage: true,
  })
})

test('capability map Leader edit layout evidence 1440x900', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await mockCapabilityMap(page, 'leader')
  await loginAs(page, 'leader')
  await page.goto('/capability/model')
  await page.getByTestId('l2-toggle-P01.01').click()
  await expect(page.getByTestId('l3-edit-P01.01.01')).toBeVisible()
  await expect(page).toHaveScreenshot('capability-map-leader-1440x900.png', {
    maxDiffPixelRatio: 0.05,
    fullPage: true,
  })
})

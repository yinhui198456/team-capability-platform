import { expect, test } from '@playwright/test'

import { loginAs } from '../fixtures/auth'
import { capabilityMapModel } from '../fixtures/capability-map-mock'

const VIEWPORTS = [
  { name: '1440x900', width: 1440, height: 900 },
  { name: '1920x1080', width: 1920, height: 1080 },
] as const

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
    await expect(page.locator('[data-testid^="l2-group-"]')).toHaveCount(4)
    await expect(page.locator('[data-testid^="level-summary-"]')).toHaveCount(5)
    const scrollWidth = await page.evaluate(
      () => document.documentElement.scrollWidth,
    )
    expect(scrollWidth).toBeLessThanOrEqual(viewport.width)
    await expect(page).toHaveScreenshot(`capability-map-${viewport.name}.png`, {
      maxDiffPixelRatio: 0.05,
      fullPage: true,
    })
  })
}

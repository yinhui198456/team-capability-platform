import { expect, test } from '@playwright/test'

import { loginAs } from '../fixtures/auth'

test.describe('smoke', () => {
  test('anonymous capability model page shows six domains', async ({ page }) => {
    const response = await page.request.get('/api/capability-model')
    expect(response.ok()).toBeTruthy()
    const payload = await response.json()
    expect(payload.domains).toHaveLength(6)
  })

  test('member can log in and load dashboard', async ({ page }) => {
    await loginAs(page, 'member')
    await page.goto('/dashboard/member')
    await expect(page.getByText('我的成长总览')).toBeVisible()
  })
})

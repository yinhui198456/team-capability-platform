import { expect, test } from '@playwright/test'

import { loginAs } from '../fixtures/auth'

const backendURL = process.env.PLAYWRIGHT_BACKEND_URL ?? 'http://localhost:18001'
const year = new Date().getFullYear()

test.describe('e2e smoke', () => {
  test('backend readiness endpoint returns ready', async ({ request }) => {
    const response = await request.get(`${backendURL}/ready`)
    expect(response.ok()).toBeTruthy()
    const payload = await response.json()
    expect(payload.status).toBe('ready')
  })

  test('capability model exposes six domains anonymously', async ({ page }) => {
    const response = await page.request.get('/api/capability-model')
    expect(response.ok()).toBeTruthy()
    const payload = await response.json()
    expect(payload.domains).toHaveLength(6)
  })

  test('member login creates a valid session', async ({ page }) => {
    await loginAs(page, 'member')
    const response = await page.request.get('/api/auth/me')
    expect(response.ok()).toBeTruthy()
    const payload = await response.json()
    expect(payload.username).toBe('member')
    expect(payload.roles).toContain('Member')
  })

  test('member profile loads with assessments and annual plan', async ({ page }) => {
    await loginAs(page, 'member')
    const response = await page.request.get(`/api/planning/profiles?year=${year}`)
    expect(response.ok()).toBeTruthy()
    const payload = await response.json()
    expect(payload.member.username).toBe('member')
    expect(payload.assessments).toBeTruthy()
    expect(payload.annual_plan).not.toBeNull()
    expect(payload.statistics.total_learning_hours).toBeGreaterThanOrEqual(0)
  })

  test('logout clears the session', async ({ page }) => {
    await loginAs(page, 'member')
    const logoutResponse = await page.request.post('/api/auth/logout')
    expect(logoutResponse.ok()).toBeTruthy()
    const payload = await logoutResponse.json()
    expect(payload.ok).toBe(true)

    const meResponse = await page.request.get('/api/auth/me')
    expect(meResponse.status()).toBe(401)
  })

  test.describe('role smoke', () => {
    const roles = [
      { role: 'member' as const, expectedRole: 'Member' },
      { role: 'buddy' as const, expectedRole: 'Buddy' },
      { role: 'leader' as const, expectedRole: 'Leader' },
      { role: 'admin' as const, expectedRole: 'Admin' },
    ] as const

    for (const { role, expectedRole } of roles) {
      test(`${role} login returns correct role`, async ({ page }) => {
        await loginAs(page, role)
        const response = await page.request.get('/api/auth/me')
        expect(response.ok()).toBeTruthy()
        const payload = await response.json()
        expect(payload.roles).toContain(expectedRole)
      })
    }
  })
})

import { expect, test, type Page } from '@playwright/test'

import { DEMO_PASSWORD } from '../fixtures/auth'

test.setTimeout(90000)

const viewports = [
  { name: '1280x800', width: 1280, height: 800 },
  { name: '1440x900', width: 1440, height: 900 },
  { name: '1920x1080', width: 1920, height: 1080 },
] as const

async function adminCookie(page: Page): Promise<string> {
  const response = await page.request.post('/api/auth/login', {
    data: { username: 'admin', password: DEMO_PASSWORD },
  })
  const setCookie = response.headers()['set-cookie'] ?? ''
  const match = setCookie.match(/tcp_session=([^;]+)/)
  return `tcp_session=${match![1]}`
}

async function ensureMember(
  page: Page,
  cookie: string,
  username: string,
  current: string,
  target: string,
) {
  const response = await page.request.post('/api/system/users', {
    headers: { Cookie: cookie },
    data: {
      username,
      full_name: 'Scope Visual Member',
      password: DEMO_PASSWORD,
      is_active: true,
      roles: ['Member'],
      current_level: current,
      target_level: target,
    },
  })
  // 201 created or 422 duplicate (stable visual fixtures reuse one user)
  expect([200, 201, 422]).toContain(response.status())
}

async function loginUser(page: Page, username: string) {
  await page.goto('/login')
  await page.getByLabel('用户名').fill(username)
  await page.getByLabel('密码').fill(DEMO_PASSWORD)
  await page.getByRole('button', { name: '登录' }).click()
  await page.waitForURL('**/dashboard/member**')
}

for (const viewport of viewports) {
  test(`Issue #60 scope preview card at ${viewport.name}`, async ({ page }) => {
    await page.setViewportSize(viewport)
    const cookie = await adminCookie(page)
    await ensureMember(page, cookie, 'scope-visual-preview', 'P4', 'P5')
    await loginUser(page, 'scope-visual-preview')
    await page.goto('/capability/assessment')
    await page.getByRole('button', { name: '预览评估范围' }).click()
    await expect(page.getByTestId('scope-preview')).toBeVisible()
    await expect(page).toHaveScreenshot(
      `assessment-scope-preview-${viewport.name}.png`,
      { maxDiffPixelRatio: 0.05, fullPage: true },
    )
  })

  test(`Issue #60 scoped draft header at ${viewport.name}`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport)
    const cookie = await adminCookie(page)
    await ensureMember(page, cookie, 'scope-visual-header', 'P4', 'P5')
    await loginUser(page, 'scope-visual-header')
    await page.goto('/capability/assessment')
    const previewButton = page.getByRole('button', { name: '预览评估范围' })
    const needsCreate = await previewButton
      .waitFor({ state: 'visible', timeout: 30000 })
      .then(() => true)
      .catch(() => false)
    if (needsCreate) {
      await expect(async () => {
        if (
          !(await page
            .getByTestId('scope-preview')
            .isVisible()
            .catch(() => false))
        ) {
          await previewButton.click()
        }
        await expect(page.getByTestId('scope-preview')).toBeVisible({
          timeout: 2000,
        })
      }).toPass()
      await page.getByRole('button', { name: '确认创建年度自评草稿' }).click()
    }
    await expect(page.getByTestId('scope-header')).toBeVisible({
      timeout: 15000,
    })
    await expect(page).toHaveScreenshot(
      `assessment-scope-header-${viewport.name}.png`,
      { maxDiffPixelRatio: 0.05, fullPage: true },
    )
  })

  test(`Issue #60 dashboard self-assessment card at ${viewport.name}`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport)
    const cookie = await adminCookie(page)
    await ensureMember(page, cookie, 'scope-visual-dashboard', 'P4', 'P5')
    await loginUser(page, 'scope-visual-dashboard')
    await page.goto('/dashboard/member')
    await expect(page.getByTestId('self-assessment-cta')).toBeVisible()
    await expect(page.getByTestId('dashboard-levels')).toBeVisible()
    await expect(page).toHaveScreenshot(
      `assessment-scope-dashboard-${viewport.name}.png`,
      { maxDiffPixelRatio: 0.05, fullPage: true },
    )
  })
}

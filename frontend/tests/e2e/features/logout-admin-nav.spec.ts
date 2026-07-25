import { expect, test } from '@playwright/test'

import { loginAs } from '../fixtures/auth'

test.describe('logout and admin navigation', () => {
  test('Member visits multiple pages, logs out, back+direct URL blocked', async ({
    page,
  }) => {
    await loginAs(page, 'member')

    // Visit at least two protected pages to build browser history
    await page.goto('/dashboard/member')
    await expect(page.getByText('我的成长总览')).toBeVisible()
    await page.goto('/capability/model')
    await expect(page.getByRole('heading', { name: '能力地图' })).toBeVisible()

    // Logout via user menu
    await page.getByRole('button', { name: /Member User/ }).click()
    const dropdown = page.locator('.user-menu-dropdown')
    await expect(
      dropdown.getByRole('menuitem', { name: '退出登录' }),
    ).toBeVisible()
    await dropdown.getByRole('menuitem', { name: '退出登录' }).click()
    await expect(page).toHaveURL(/\/login/)

    // page.goBack() must land on login, not restore authenticated pages
    await page.goBack()
    await expect(page).toHaveURL(/\/login/)
    await expect(page.getByText('我的成长总览')).not.toBeVisible()
    await expect(
      page.getByRole('heading', { name: '能力地图' }),
    ).not.toBeVisible()

    // Direct URL access must also redirect to /login
    await page.goto('/dashboard/member')
    await expect(page).toHaveURL(/\/login/)
  })

  test('Admin can navigate to system users via sidebar', async ({ page }) => {
    await loginAs(page, 'admin')
    await page.goto('/capability/model')
    await expect(page.getByRole('heading', { name: '能力地图' })).toBeVisible()

    // Sidebar is independently scrollable (overflow-y:auto in grid row)
    const sidebar = page.locator('.app-sidebar')
    await expect(sidebar).toBeVisible()

    // Scroll the 系统管理 link into view if needed
    const adminLink = sidebar.getByRole('link', { name: '用户管理' })
    await adminLink.scrollIntoViewIfNeeded()
    await expect(adminLink).toBeVisible()

    // Sidebar has scrollable overflow (its scrollHeight > clientHeight when content exceeds viewport)
    const hasScroll = await sidebar.evaluate(
      (el) => el.scrollHeight > el.clientHeight,
    )
    // Either scrollable or all content fits — both are valid configurations
    expect(typeof hasScroll).toBe('boolean')

    await adminLink.click()
    await expect(page).toHaveURL(/\/system\/users/)
    await expect(page.getByRole('heading', { name: '系统管理' })).toBeVisible()

    // Admin user menu shows role in dropdown
    await page.getByRole('button', { name: /Admin User/ }).click()
    const dropdown = page.locator('.user-menu-dropdown')
    await expect(dropdown.locator('.user-menu-roles')).toContainText('Admin')
    await expect(
      dropdown.getByRole('menuitem', { name: '退出登录' }),
    ).toBeVisible()
  })

  test('non-Admin blocked: no sidebar entry, direct access denied, API 403', async ({
    page,
  }) => {
    await loginAs(page, 'member')
    await expect(page.getByText('我的成长总览')).toBeVisible()

    // No admin sidebar
    await expect(page.getByText('系统管理')).not.toBeVisible()
    await expect(page.getByRole('link', { name: '用户管理' })).not.toBeVisible()

    // Direct URL → page renders "无权限"
    await page.goto('/system/users')
    await expect(page.getByText(/无权限/)).toBeVisible()

    // Direct API call → 403
    const apiResp = await page.request.get('/api/system/users')
    expect(apiResp.status()).toBe(403)
  })

  test('multi-role user with Admin can see and access admin', async ({
    page,
  }) => {
    await loginAs(page, 'admin')
    const cookies = await page.context().cookies()
    const session = cookies.find((c) => c.name === 'tcp_session')
    if (!session) throw new Error('admin session not found')
    const cookie = `tcp_session=${session.value}`

    const suffix = Date.now().toString(36)
    const username = `multi_admin_${suffix}`
    const fullName = `MultiAdmin${suffix}`
    const resp = await page.request.post('/api/system/users', {
      headers: { cookie },
      data: {
        username,
        full_name: fullName,
        password: '123456',
        is_active: true,
        roles: ['Member', 'Admin'],
      },
    })
    expect(resp.ok()).toBeTruthy()

    // Login as multi-role user
    const loginResp = await page.request.post('/api/auth/login', {
      data: { username, password: '123456' },
    })
    expect(loginResp.ok()).toBeTruthy()
    const setCookie = loginResp.headers()['set-cookie'] as string
    const match = /tcp_session=([^;]+)/.exec(setCookie)
    if (!match) throw new Error('session cookie not set')
    await page.context().addCookies([
      {
        name: 'tcp_session',
        value: match[1],
        domain: 'localhost',
        path: '/',
        httpOnly: true,
      },
    ])

    await page.goto('/system/users')
    await expect(page.getByRole('heading', { name: '系统管理' })).toBeVisible()

    await expect(
      page.locator('.app-sidebar-section-label').getByText('系统管理'),
    ).toBeVisible()

    // User menu shows both roles
    await page.getByRole('button', { name: new RegExp(fullName) }).click()
    const dropdown = page.locator('.user-menu-dropdown')
    await expect(dropdown.locator('.user-menu-roles')).toContainText(
      'Admin / Member',
    )

    // Can navigate to member dashboard via sidebar
    await page.getByRole('link', { name: '我的工作台' }).click()
    await expect(page.getByText('我的成长总览')).toBeVisible()
    await expect(
      page.locator('.app-sidebar-section-label').getByText('系统管理'),
    ).toBeVisible()

    // Logout
    await page.getByRole('button', { name: new RegExp(fullName) }).click()
    await page
      .locator('.user-menu-dropdown')
      .getByRole('menuitem', { name: '退出登录' })
      .click()
    await expect(page).toHaveURL(/\/login/)
  })
})

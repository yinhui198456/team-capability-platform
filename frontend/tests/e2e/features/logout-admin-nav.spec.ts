import { expect, test } from '@playwright/test'

import { loginAs } from '../fixtures/auth'

test.describe('logout and admin navigation', () => {
  test('Member can logout and cannot access protected pages', async ({
    page,
  }) => {
    await loginAs(page, 'member')
    await expect(page.getByText('我的成长总览')).toBeVisible()

    // Open user menu
    await page.getByRole('button', { name: /Member User/ }).click()
    const dropdown = page.locator('.user-menu-dropdown')
    await expect(
      dropdown.getByRole('menuitem', { name: '退出登录' }),
    ).toBeVisible()
    // Check role label inside dropdown
    await expect(dropdown.locator('.user-menu-roles')).toContainText('Member')

    // Logout
    await dropdown.getByRole('menuitem', { name: '退出登录' }).click()
    await expect(page).toHaveURL(/\/login/)

    // logout uses replace:true; back goes to blank page, not authenticated page
    // Direct URL access must redirect to login
    await page.goto('/dashboard/member')
    await expect(page).toHaveURL(/\/login/)
  })

  test('Admin can navigate to system users via sidebar', async ({ page }) => {
    await loginAs(page, 'admin')
    await page.goto('/capability/model')
    await expect(page.getByRole('heading', { name: '能力地图' })).toBeVisible()

    // Sidebar should have 系统管理 section
    await expect(page.getByText('系统管理')).toBeVisible()
    const sidebarLink = page.getByRole('link', { name: '用户管理' })
    await expect(sidebarLink).toBeVisible()

    // Click sidebar link
    await sidebarLink.click()
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

  test('non-Admin users do not see admin sidebar entry', async ({ page }) => {
    await loginAs(page, 'member')
    await expect(page.getByText('我的成长总览')).toBeVisible()

    await expect(page.getByText('系统管理')).not.toBeVisible()
    await expect(page.getByRole('link', { name: '用户管理' })).not.toBeVisible()

    // Direct URL access is blocked by route guard
    await page.goto('/system/users')
    await expect(page.getByText(/无权限/)).toBeVisible()
  })

  test('multi-role user with Admin can see and access admin', async ({
    page,
  }) => {
    // Create multi-role user via API
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

    // Admin priority: default route is /system/users
    await page.goto('/system/users')
    await expect(page.getByRole('heading', { name: '系统管理' })).toBeVisible()

    // Sidebar must show 系统管理 label
    await expect(
      page.locator('.app-sidebar-section-label').getByText('系统管理'),
    ).toBeVisible()

    // User menu shows both roles in dropdown
    await page.getByRole('button', { name: new RegExp(fullName) }).click()
    const dropdown = page.locator('.user-menu-dropdown')
    await expect(dropdown.locator('.user-menu-roles')).toContainText(
      'Admin / Member',
    )

    // Can navigate to member dashboard via sidebar
    await page.getByRole('link', { name: '我的工作台' }).click()
    await expect(page.getByText('我的成长总览')).toBeVisible()

    // 系统管理 still visible in sidebar (user still has Admin)
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

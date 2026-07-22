import { expect, test } from '@playwright/test'

import { loginAs } from '../fixtures/auth'

test.describe('登录后默认路由', () => {
  test('纯 Member 账号进入我的工作台', async ({ page }) => {
    await loginAs(page, 'member')
    await expect(page).toHaveURL(/\/dashboard\/member/)
  })

  test('Buddy 兼任 Member 仍进入 Buddy 复核中心', async ({ page }) => {
    await loginAs(page, 'buddy')
    await expect(page).toHaveURL(/\/mentoring\/dashboard/)
  })

  test('Leader 兼任 Member 仍进入团队能力分析', async ({ page }) => {
    await loginAs(page, 'leader')
    await expect(page).toHaveURL(/\/operations\/analytics/)
  })

  test('Admin 兼任 Member/Leader 仍进入用户管理', async ({ page }) => {
    await loginAs(page, 'admin')
    await expect(page).toHaveURL(/\/system\/users/)
  })
})

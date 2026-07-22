import type { Page } from '@playwright/test'

export type Role = 'member' | 'buddy' | 'leader' | 'admin'

const credentials: Record<
  Role | 'member2',
  { username: string; password: string }
> = {
  member: { username: 'member', password: '123456' },
  member2: { username: 'member2', password: '123456' },
  buddy: { username: 'buddy', password: '123456' },
  leader: { username: 'leader', password: '123456' },
  admin: { username: 'admin', password: '123456' },
}

export type ExtendedRole = Role | 'member2'

const defaultRoutes: Record<ExtendedRole, string> = {
  member: '/dashboard/member',
  member2: '/dashboard/member',
  buddy: '/mentoring/dashboard',
  leader: '/operations/analytics',
  admin: '/system/users',
}

export async function loginAs(page: Page, role: ExtendedRole): Promise<void> {
  const { username, password } = credentials[role]
  await page.goto('/login')
  await page.getByLabel('用户名').fill(username)
  await page.getByLabel('密码').fill(password)
  await page.getByRole('button', { name: '登录' }).click()
  await page.waitForURL((url) => url.pathname === defaultRoutes[role])
}

export async function logout(page: Page): Promise<void> {
  await page.goto('/logout')
}

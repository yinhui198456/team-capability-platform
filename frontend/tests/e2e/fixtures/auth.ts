import type { Page } from '@playwright/test'

export type Role = 'member' | 'buddy' | 'leader' | 'admin'

// Demo-account password is supplied at runtime (TCP_E2E_DEMO_PASSWORD must
// match the DEMO_SEED_PASSWORD the stack was seeded with). No repository-known
// default; fail immediately when missing or whitespace-only so tests never
// attempt empty-password logins.
const rawDemoPassword = process.env.TCP_E2E_DEMO_PASSWORD ?? ''

if (!rawDemoPassword.trim()) {
  throw new Error(
    'TCP_E2E_DEMO_PASSWORD is required for E2E demo logins; set it to the DEMO_SEED_PASSWORD used when seeding the stack',
  )
}

// Export the exact raw environment value: leading/trailing whitespace is part
// of the credential and must stay identical to DEMO_SEED_PASSWORD.
export const DEMO_PASSWORD = rawDemoPassword

const credentials: Record<
  Role | 'member2',
  { username: string; password: string }
> = {
  member: { username: 'member', password: DEMO_PASSWORD },
  member2: { username: 'member2', password: DEMO_PASSWORD },
  buddy: { username: 'buddy', password: DEMO_PASSWORD },
  leader: { username: 'leader', password: DEMO_PASSWORD },
  admin: { username: 'admin', password: DEMO_PASSWORD },
}

export type ExtendedRole = Role | 'member2'

// Issue #194 P1-3: Buddy 默认页改为 Evidence Review（自评复核退役）。
const defaultRoutes: Record<ExtendedRole, string> = {
  member: '/dashboard/member',
  member2: '/dashboard/member',
  buddy: '/mentoring/evidence-review',
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

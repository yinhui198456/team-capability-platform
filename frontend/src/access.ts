import { request } from './shared/api'

export type User = {
  id: number
  username: string
  full_name: string
  roles: string[]
  assigned_members?: Array<{
    id: number
    username: string
    full_name: string
    is_active: boolean
  }>
}

export async function login(username: string, password: string): Promise<User> {
  return request<User>(
    '/api/auth/login',
    { method: 'POST' },
    { username, password },
  )
}

export type LogoutResult = { ok: true } | { ok: false; retryable: boolean }

export async function logout(): Promise<LogoutResult> {
  try {
    const resp = await fetch('/api/auth/logout', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    })
    // 2xx or 401 (already expired) → both mean session is gone
    if (resp.ok || resp.status === 401) return { ok: true }
    // 5xx → retryable
    return { ok: false, retryable: true }
  } catch {
    // network error → retryable
    return { ok: false, retryable: true }
  }
}

export async function me(): Promise<User> {
  return request<User>('/api/auth/me', { method: 'GET' })
}

export function defaultRouteFor(roles: string[]): string {
  if (roles.includes('Admin')) return '/system/users'
  if (roles.includes('Leader')) return '/operations/analytics'
  if (roles.includes('Buddy')) return '/mentoring/dashboard'
  if (roles.includes('Member')) return '/dashboard/member'
  return '/capability/model'
}

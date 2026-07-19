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
  return request<User>('/api/auth/login', { method: 'POST' }, { username, password })
}

export async function logout(): Promise<void> {
  await request<void>('/api/auth/logout', { method: 'POST' }, {})
}

export async function me(): Promise<User> {
  return request<User>('/api/auth/me', { method: 'GET' })
}

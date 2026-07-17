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

async function post<T>(path: string, body: object): Promise<T> {
  const response = await fetch(path, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!response.ok) {
    const payload = await response.json().catch(() => ({ detail: '请求失败' }))
    throw new Error(payload.detail ?? '请求失败')
  }
  return response.json() as Promise<T>
}

async function get<T>(path: string): Promise<T> {
  const response = await fetch(path, {
    method: 'GET',
    credentials: 'include',
  })
  if (!response.ok) {
    const payload = await response.json().catch(() => ({ detail: '请求失败' }))
    throw new Error(payload.detail ?? '请求失败')
  }
  return response.json() as Promise<T>
}

export async function login(username: string, password: string): Promise<User> {
  return post<User>('/api/auth/login', { username, password })
}

export async function logout(): Promise<void> {
  await fetch('/api/auth/logout', {
    method: 'POST',
    credentials: 'include',
  })
}

export async function me(): Promise<User> {
  return get<User>('/api/auth/me')
}

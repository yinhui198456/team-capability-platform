export type SystemUser = {
  id: number
  username: string
  full_name: string
  is_active: boolean
  roles: string[]
}

export type SystemConfig = {
  code: string
  name: string
  value: string
  value_type: string
  description: string
  enabled: boolean
}

export type SystemUserInput = {
  full_name: string
  is_active: boolean
  roles: string[]
}

export type SystemUserCreateInput = SystemUserInput & {
  username: string
  password: string
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    credentials: 'include',
    ...init,
    headers: { 'Content-Type': 'application/json', ...init?.headers },
  })
  if (!response.ok) {
    const payload = await response.json().catch(() => ({ detail: '请求失败' }))
    throw new Error(payload.detail ?? '请求失败')
  }
  return response.json() as Promise<T>
}

export function getSystemUsers(): Promise<SystemUser[]> {
  return request<SystemUser[]>('/api/system/users')
}

export function getSystemRoles(): Promise<string[]> {
  return request<string[]>('/api/system/roles')
}

export function createSystemUser(
  body: SystemUserCreateInput,
): Promise<SystemUser> {
  return request<SystemUser>('/api/system/users', {
    method: 'POST',
    body: JSON.stringify(body),
  })
}

export function updateSystemUser(
  userId: number,
  body: SystemUserInput,
): Promise<SystemUser> {
  return request<SystemUser>(`/api/system/users/${userId}`, {
    method: 'PUT',
    body: JSON.stringify(body),
  })
}

export function getSystemConfigs(): Promise<SystemConfig[]> {
  return request<SystemConfig[]>('/api/system/settings')
}

export function updateSystemConfig(
  code: string,
  body: Pick<SystemConfig, 'value' | 'enabled'>,
): Promise<SystemConfig> {
  return request<SystemConfig>(`/api/system/settings/${code}`, {
    method: 'PUT',
    body: JSON.stringify(body),
  })
}

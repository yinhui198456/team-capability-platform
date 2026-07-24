import { request } from './shared/api'

export type SystemUser = {
  id: number
  username: string
  full_name: string
  is_active: boolean
  roles: string[]
  current_level: string | null
  target_level: string | null
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
  current_level?: string | null
  target_level?: string | null
}

export type SystemUserCreateInput = SystemUserInput & {
  username: string
  password: string
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
  return request<SystemUser>('/api/system/users', { method: 'POST' }, body)
}

export function updateSystemUser(
  userId: number,
  body: SystemUserInput,
): Promise<SystemUser> {
  return request<SystemUser>(
    `/api/system/users/${userId}`,
    { method: 'PUT' },
    body,
  )
}

export function getSystemConfigs(): Promise<SystemConfig[]> {
  return request<SystemConfig[]>('/api/system/settings')
}

export function updateSystemConfig(
  code: string,
  body: Pick<SystemConfig, 'value' | 'enabled'>,
): Promise<SystemConfig> {
  return request<SystemConfig>(
    `/api/system/settings/${code}`,
    { method: 'PUT' },
    body,
  )
}

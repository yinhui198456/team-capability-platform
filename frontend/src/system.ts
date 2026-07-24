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

// ── Buddy relationship management ──

export type BuddyRelationship = {
  id: number
  member_id: number
  buddy_id: number
  buddy_name: string
  effective_date: string
  expiry_date: string | null
  is_primary: boolean
}

export type AvailableBuddy = {
  id: number
  username: string
  full_name: string
}

export type BuddyRelationshipCreateInput = {
  member_id: number
  buddy_id: number
  effective_date: string
  expiry_date: string | null
}

export type BuddyRelationshipUpdateInput = {
  buddy_id: number
  effective_date: string
  expiry_date: string | null
}

export function getBuddyRelationships(
  memberId: number,
): Promise<BuddyRelationship[]> {
  return request<BuddyRelationship[]>(
    `/api/system/buddy-relationships/${memberId}`,
  )
}

export function getAvailableBuddies(): Promise<AvailableBuddy[]> {
  return request<AvailableBuddy[]>("/api/system/available-buddies")
}

export function createBuddyRelationship(
  body: BuddyRelationshipCreateInput,
): Promise<BuddyRelationship> {
  return request<BuddyRelationship>(
    "/api/system/buddy-relationships",
    { method: "POST" },
    body,
  )
}

export function updateBuddyRelationship(
  relationshipId: number,
  body: BuddyRelationshipUpdateInput,
): Promise<BuddyRelationship> {
  return request<BuddyRelationship>(
    `/api/system/buddy-relationships/${relationshipId}`,
    { method: "PUT" },
    body,
  )
}

export function endBuddyRelationship(
  relationshipId: number,
  endDate: string,
): Promise<BuddyRelationship> {
  return request<BuddyRelationship>(
    `/api/system/buddy-relationships/${relationshipId}/end`,
    { method: "POST" },
    { end_date: endDate },
  )
}

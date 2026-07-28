import { useCallback, useEffect, useState } from 'react'

import { request } from './shared/api'
import { me, type User } from './access'
import { useAuth } from './AuthContext'

const DOMAIN_CODES = new Set(['P01', 'P02', 'P03', 'C01', 'C02', 'C03'])

export type ResourceSummary = {
  material_code: string
  name: string
  material_type: string
  status: string
}

export type JobLevel = 'P4' | 'P5' | 'P6' | 'P7' | 'P8'

export type L3Node = {
  code: string
  name: string
  recommended_start_level: string | null
  standard_target_overrides?: Partial<Record<JobLevel, number | null>>
  materials_text: string
  expected_output: string | null
  estimated_hours: string | null
  output_type: string | null
  notes: string | null
  resources: ResourceSummary[]
  unmatched_materials: string[]
}

export type L2Node = {
  code: string
  name: string
  p4_description: string | null
  p5_description: string | null
  p6_description: string | null
  p7_description: string | null
  p8_description: string | null
  children: L3Node[]
}

export type Domain = {
  code: string
  name: string
  category?: string | null
  overview: string | null
  children: L2Node[]
}

export type CapabilityModel = {
  code: string
  version: string
  domains: Domain[]
}

export type Resource = {
  material_code: string
  name: string
  material_type: string
  source_text: string | null
  purpose: string | null
  status: string
  l3_count: number
}

export type ResourceDetail = {
  material_code: string
  name: string
  material_type: string
  source_text: string | null
  purpose: string | null
  status: string
  l3_nodes: Array<{
    code: string
    name: string
    l1_code: string
    l1_name: string
    l2_code: string
    l2_name: string
  }>
}

export function useCatalog<T>(path: string | null) {
  const [data, setData] = useState<T | null>(null)
  const [error, setError] = useState('')
  const [version, setVersion] = useState(0)
  const refresh = useCallback(() => setVersion((v) => v + 1), [])

  useEffect(() => {
    let active = true
    setError('')
    if (!path) {
      setData(null)
      return () => {
        active = false
      }
    }
    request<T>(path).then(
      (value) => active && setData(value),
      () => active && setError('目录数据暂不可用，请稍后重试。'),
    )
    return () => {
      active = false
    }
  }, [path, version])

  return { data, error, refresh }
}

export function useMe() {
  const auth = useAuth()
  const hasProvider = auth.hasProvider

  const [directUser, setDirectUser] = useState<User | null>(null)
  const [directLoading, setDirectLoading] = useState(!hasProvider)

  useEffect(() => {
    if (hasProvider) return
    let active = true
    setDirectLoading(true)
    me().then(
      (value) => {
        if (!active) return
        setDirectUser(value)
        setDirectLoading(false)
      },
      () => {
        if (!active) return
        setDirectUser(null)
        setDirectLoading(false)
      },
    )
    return () => {
      active = false
    }
  }, [hasProvider])

  const user = hasProvider ? auth.user : directUser
  const loading = hasProvider ? auth.loading : directLoading
  return { user, loading, isLeader: user?.roles.includes('Leader') ?? false }
}

export function enabledDomains(model: CapabilityModel | null) {
  return model?.domains.filter((domain) => DOMAIN_CODES.has(domain.code)) ?? []
}

export function allL3(model: CapabilityModel | null) {
  return enabledDomains(model).flatMap((domain) =>
    domain.children.flatMap((l2) => l2.children),
  )
}

export function resourcePath(name: string, status: string, l3Code: string) {
  const parameters = new URLSearchParams()
  if (name) parameters.set('name', name)
  if (status) parameters.set('status', status)
  if (l3Code) parameters.set('l3_code', l3Code)
  const query = parameters.toString()
  return `/api/learning-resources${query ? `?${query}` : ''}`
}

export async function updateCapabilityNode(
  nodeCode: string,
  body: object,
): Promise<object> {
  return request<object>(
    `/api/capability-model/nodes/${nodeCode}`,
    { method: 'PUT' },
    body,
  )
}

export async function createLearningResource(body: object): Promise<object> {
  return request<object>('/api/learning-resources', { method: 'POST' }, body)
}

export async function updateLearningResource(
  materialCode: string,
  body: object,
): Promise<object> {
  return request<object>(
    `/api/learning-resources/${materialCode}`,
    { method: 'PUT' },
    body,
  )
}

export async function archiveLearningResource(
  materialCode: string,
): Promise<object> {
  return request<object>(`/api/learning-resources/${materialCode}/archive`, {
    method: 'POST',
  })
}

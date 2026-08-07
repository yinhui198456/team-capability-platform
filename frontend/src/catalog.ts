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
  id?: number
  code: string
  name: string
  l1_code?: string
  l1_name?: string
  l2_code?: string
  l2_name?: string
  recommended_start_level: string | null
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
  id?: number
  code: string
  version: string
  domains: Domain[]
}

export type PublishedStandardMatrix = {
  version: {
    id: number
    model_id: number
    version_no: number
    label: string
    status: '已发布'
    published_at: string | null
  }
  items: Array<{
    l3_node_id: number
    l3_code: string
    job_level: JobLevel
    applicable: boolean
    target_level: number | null
    source: 'legacy_derived' | 'copied' | 'explicit'
  }>
}

export type StandardVersion = {
  id: number
  model_id: number
  version_no: number
  label: string
  status: '草稿' | '已发布' | '已归档'
  revision?: number
  change_summary?: string | null
  published_at: string | null
}

export type StandardMatrixItem = {
  l3_node_id: number
  l1_code: string
  l1_name: string
  l2_code: string
  l2_name: string
  l3_code: string
  l3_name: string
  job_level: JobLevel
  applicable: boolean
  target_level: number | null
  source: 'legacy_derived' | 'copied' | 'explicit'
}

export type StandardMatrix = {
  version: StandardVersion
  items: StandardMatrixItem[]
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
  const roles = user?.roles ?? []
  return {
    user,
    loading,
    roles,
    isLeader: roles.includes('Leader'),
    isAdmin: roles.includes('Admin'),
    isBuddy: roles.includes('Buddy'),
    isMember: roles.includes('Member'),
  }
}

export function enabledDomains(model: CapabilityModel | null) {
  return model?.domains.filter((domain) => DOMAIN_CODES.has(domain.code)) ?? []
}

export function allL3(model: CapabilityModel | null) {
  return enabledDomains(model).flatMap((domain) =>
    domain.children.flatMap((l2) => l2.children),
  )
}

export function allL3WithContext(model: CapabilityModel | null): L3Node[] {
  return enabledDomains(model).flatMap((domain) =>
    domain.children.flatMap((l2) =>
      l2.children.map((l3) => ({
        ...l3,
        l1_code: domain.code,
        l1_name: domain.name,
        l2_code: l2.code,
        l2_name: l2.name,
      })),
    ),
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

export async function createStandardDraft(
  modelId: number,
  changeSummary: string,
): Promise<StandardVersion> {
  return request<StandardVersion>(
    '/api/capability-standard-versions/drafts',
    { method: 'POST' },
    {
      model_id: modelId,
      change_summary: changeSummary || null,
    },
  )
}

export async function updateStandardMatrix(
  versionId: number,
  expectedRevision: number,
  item: Pick<
    StandardMatrixItem,
    'l3_node_id' | 'l3_code' | 'job_level' | 'applicable' | 'target_level'
  >,
): Promise<{ revision: number }> {
  return request(
    `/api/capability-standard-versions/${versionId}/matrix`,
    { method: 'PUT' },
    {
      expected_revision: expectedRevision,
      items: [item],
    },
  )
}

export async function reconcileStandardCatalog(
  versionId: number,
  expectedRevision: number,
) {
  return request(
    `/api/capability-standard-versions/${versionId}/reconcile-catalog`,
    { method: 'POST' },
    {
      expected_revision: expectedRevision,
    },
  )
}

export async function copyStandardPreviousLevel(
  versionId: number,
  expectedRevision: number,
  fromLevel: JobLevel,
  toLevel: JobLevel,
  l3NodeIds: number[],
) {
  return request<{ revision: number }>(
    `/api/capability-standard-versions/${versionId}/copy-previous-level`,
    { method: 'POST' },
    {
      expected_revision: expectedRevision,
      from_level: fromLevel,
      to_level: toLevel,
      l3_node_ids: l3NodeIds,
    },
  )
}

export async function validateStandardVersion(versionId: number) {
  return request<{
    valid: boolean
    issues: Array<{
      l3_code?: string | null
      job_level?: string | null
      message: string
    }>
  }>(`/api/capability-standard-versions/${versionId}/validation`)
}

export async function previewStandardPublish(versionId: number) {
  return request<{
    can_publish: boolean
    validation: {
      valid: boolean
      issues: Array<{
        l3_code?: string | null
        job_level?: string | null
        message: string
      }>
    }
  }>(`/api/capability-standard-versions/${versionId}/publish-preview`)
}

export async function abandonStandardDraft(
  versionId: number,
  expectedRevision: number,
) {
  return request(
    `/api/capability-standard-versions/${versionId}/abandon`,
    { method: 'POST' },
    { expected_revision: expectedRevision },
  )
}

export async function publishStandardVersion(
  versionId: number,
  expectedRevision: number,
) {
  return request(
    `/api/capability-standard-versions/${versionId}/publish`,
    { method: 'POST' },
    {
      expected_revision: expectedRevision,
    },
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

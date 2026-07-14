import { useEffect, useState } from 'react'

const DOMAIN_CODES = new Set(['P01', 'P02', 'P03', 'C01', 'C02', 'C03'])

export type ResourceSummary = {
  material_code: string
  name: string
  material_type: string
  status: string
}

export type L3Node = {
  code: string
  name: string
  recommended_start_level: string | null
  materials_text: string
  expected_output: string | null
  estimated_hours: number | null
  resources: ResourceSummary[]
  unmatched_materials: string[]
}

export type L2Node = { code: string; name: string; children: L3Node[] }

export type Domain = {
  code: string
  name: string
  p4_description: string | null
  p5_description: string | null
  p6_description: string | null
  p7_description: string | null
  p8_description: string | null
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

export type ResourceDetail = Resource & {
  l3_nodes: Array<{
    code: string
    name: string
    l1_code: string
    l1_name: string
    l2_code: string
    l2_name: string
  }>
}

async function get<T>(path: string): Promise<T> {
  const response = await fetch(path)
  if (!response.ok) throw new Error('目录数据暂不可用')
  return response.json() as Promise<T>
}

export function useCatalog<T>(path: string | null) {
  const [data, setData] = useState<T | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    let active = true
    setError('')
    if (!path) {
      setData(null)
      return () => {
        active = false
      }
    }
    get<T>(path).then(
      (value) => active && setData(value),
      () => active && setError('目录数据暂不可用，请稍后重试。'),
    )
    return () => {
      active = false
    }
  }, [path])

  return { data, error }
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

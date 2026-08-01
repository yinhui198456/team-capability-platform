import { request } from './shared/api'

export type Gap = {
  id: number
  assessment_id: number
  member_id: number
  l3_code: string
  current_level: number
  target_level: number
  gap_value: number
  priority: '高' | '中' | '低'
  /** @deprecated use include_in_plan instead */
  plan_candidate: boolean
  member_priority?: '高' | '中' | '低' | '暂缓' | null
  include_in_plan?: boolean | null
}

export type UpdateGapPayload = {
  priority: '高' | '中' | '低'
  plan_candidate: boolean
}

export async function listGaps(assessmentId?: number): Promise<Gap[]> {
  const path = assessmentId
    ? `/api/gaps?assessment_id=${assessmentId}`
    : '/api/gaps'
  return request<Gap[]>(path, { method: 'GET' })
}

export async function updateGap(
  id: number,
  payload: UpdateGapPayload,
): Promise<{ ok: boolean }> {
  return request<{ ok: boolean }>(`/api/gaps/${id}`, { method: 'PUT' }, payload)
}

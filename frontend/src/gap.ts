export type Gap = {
  id: number
  assessment_id: number
  member_id: number
  l3_code: string
  current_level: number
  target_level: number
  gap_value: number
  priority: '高' | '中' | '低'
  plan_candidate: boolean
}

export type UpdateGapPayload = {
  priority: '高' | '中' | '低'
  plan_candidate: boolean
}

async function request<T>(
  path: string,
  options: RequestInit = {},
  body?: object,
): Promise<T> {
  const response = await fetch(path, {
    ...options,
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers ?? {}),
    },
    body: body ? JSON.stringify(body) : options.body,
  })
  if (!response.ok) {
    const payload = await response.json().catch(() => ({ detail: '请求失败' }))
    throw new Error(payload.detail ?? '请求失败')
  }
  return response.json() as Promise<T>
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

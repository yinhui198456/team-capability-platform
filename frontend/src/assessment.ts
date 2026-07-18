export type Assessment = {
  id: number
  member_id: number
  year: number
  version: number
  assessment_type: string
  status: string
  created_at: string
  submitted_at: string | null
  archived_at: string | null
  details?: AssessmentDetail[]
  gap_summary?: GapSummary
}

export type AssessmentDetail = {
  id?: number
  l3_code: string
  l3_name?: string
  current_level: number
  target_level: number
  gap_value?: number
  evidence_note?: string
  plan_candidate?: boolean
  recommended_start_level?: string
  l1_code?: string
  l1_name?: string
}

export type GapSummary = {
  total_gaps: number
  avg_gap: number
  high_priority: number
  medium_priority: number
  low_priority: number
}

export type AssessmentReview = {
  id: number
  assessment_id: number
  sequence: number
  buddy_id: number | null
  conclusion: string | null
  feedback: string | null
  reviewed_at: string | null
  status: string
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

export async function createAssessment(
  year: number,
  assessmentType = '年度',
): Promise<{ id: number }> {
  return request<{ id: number }>(
    '/api/assessments',
    { method: 'POST' },
    { year, assessment_type: assessmentType },
  )
}

export async function listAssessments(): Promise<Assessment[]> {
  return request<Assessment[]>('/api/assessments', { method: 'GET' })
}

export async function getAssessment(id: number): Promise<Assessment> {
  return request<Assessment>(`/api/assessments/${id}`, { method: 'GET' })
}

export async function saveDraft(
  id: number,
  details: AssessmentDetail[],
): Promise<{ ok: boolean }> {
  return request<{ ok: boolean }>(
    `/api/assessments/${id}/draft`,
    { method: 'PUT' },
    { details },
  )
}

export async function submitAssessment(id: number): Promise<{ ok: boolean }> {
  return request<{ ok: boolean }>(
    `/api/assessments/${id}/submit`,
    { method: 'POST' },
    {},
  )
}

export async function getAssessmentHistory(
  id: number,
): Promise<AssessmentReview[]> {
  return request<AssessmentReview[]>(`/api/assessments/${id}/history`, {
    method: 'GET',
  })
}

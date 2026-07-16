export type PendingReview = {
  id: number
  assessment_id: number
  sequence: number
  buddy_id: number | null
  status: string
  member_id: number
  year: number
  version: number
  assessment_status: string
  submitted_at: string | null
}

export type SubmitReviewPayload = {
  conclusion: '认可' | '建议调整'
  feedback?: string
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

export async function listPendingReviews(): Promise<PendingReview[]> {
  return request<PendingReview[]>('/api/assessments/reviews/pending', {
    method: 'GET',
  })
}

export async function submitReview(
  assessmentId: number,
  reviewId: number,
  payload: SubmitReviewPayload,
): Promise<{ ok: boolean }> {
  return request<{ ok: boolean }>(
    `/api/assessments/${assessmentId}/reviews/${reviewId}`,
    { method: 'POST' },
    payload,
  )
}

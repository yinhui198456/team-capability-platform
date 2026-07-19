import { request } from './shared/api'

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

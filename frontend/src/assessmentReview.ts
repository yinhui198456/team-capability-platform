import { request } from './shared/api'
import type { AssessmentDetail } from './assessment'

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
  expected_revision: number
}

export type ReviewSubmitResult = {
  ok: boolean
  assessment_status: '已归档' | '建议调整'
  assessment_id: number
  revision: number
  review: {
    id: number
    sequence: number
    conclusion: '认可' | '建议调整'
    feedback: string | null
    reviewed_by_buddy_id: number
  }
  plan: {
    created: boolean
    plan_id: number | null
    items_created: number
    tasks_created: number
    target_is_legacy: boolean | null
  } | null
  proposal: {
    created: boolean
    proposal_id: number | null
    target_annual_growth_plan_id: number | null
    target_is_legacy: boolean | null
  } | null
  idempotent_replayed: boolean
}

export type BuddyReviewSummary = {
  total: number
  current_required: number
  target_progressive: number
  assessed: number
  gap_items: number
  high: number
  medium: number
  low: number
  hold: number
  in_plan: number
  by_quarter: { Q1: number; Q2: number; Q3: number; Q4: number }
  data_issues: number
  existing_formal_plan: boolean
  will_create_proposal: boolean
  target_is_legacy: boolean | null
}

export type BuddyReviewWorkspace = {
  assessment_id: number
  member_id: number
  year: number
  version: number
  assessment_status: string
  revision: number
  member_current_level_snapshot: string | null
  member_target_level_snapshot: string | null
  standard_version: { id: number | null; label: string | null }
  summary: BuddyReviewSummary
  details: AssessmentDetail[]
}

export async function listPendingReviews(): Promise<PendingReview[]> {
  return request<PendingReview[]>('/api/assessments/reviews/pending', {
    method: 'GET',
  })
}

export type ReviewSummary = {
  pending_count: number
  completed_count: number
}

export async function getAssessmentReviewSummary(
  year: number,
): Promise<ReviewSummary> {
  return request<ReviewSummary>(
    `/api/assessments/reviews/summary?year=${year}`,
    { method: 'GET' },
  )
}

export async function getBuddyReviewWorkspace(
  assessmentId: number,
): Promise<BuddyReviewWorkspace> {
  return request<BuddyReviewWorkspace>(
    `/api/assessments/${assessmentId}/buddy-review`,
    { method: 'GET' },
  )
}

export async function submitReview(
  assessmentId: number,
  reviewId: number,
  payload: SubmitReviewPayload,
  idempotencyKey: string,
): Promise<ReviewSubmitResult> {
  return request<ReviewSubmitResult>(
    `/api/assessments/${assessmentId}/reviews/${reviewId}`,
    { method: 'POST', headers: { 'Idempotency-Key': idempotencyKey } },
    payload,
  )
}

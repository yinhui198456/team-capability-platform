import { request } from './shared/api'

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
  revision?: number
  details?: AssessmentDetail[]
  gap_summary?: GapSummary
}

export type AssessmentDetail = {
  id?: number
  l3_code: string
  l3_name?: string
  current_level: number | null
  target_level: number | null
  standard_target_applicable?: boolean | null
  standard_target_level?: number | null
  target_adjusted?: boolean
  adjusted_target_level?: number | null
  target_adjustment_reason?: string | null
  target_snapshot_source?: string | null
  target_compatibility_error?: string | null
  gap_value?: number | null
  evidence_note?: string
  plan_candidate?: boolean
  recommended_start_level?: string
  l1_code?: string
  l1_name?: string
  l2_code?: string
  l2_name?: string
  inherited_from_assessment_id?: number | null
  inherited_current_level?: number | null
  inherited_evidence_note?: string | null
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

export async function createAssessment(
  year: number,
  assessmentType = '年度',
): Promise<{ id: number; revision?: number }> {
  return request<{ id: number; revision?: number }>(
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
  expectedRevision?: number,
): Promise<{
  ok: boolean
  revision?: number
  auto_cancelled_plan_candidates?: string[]
}> {
  return request<{
    ok: boolean
    revision?: number
    auto_cancelled_plan_candidates?: string[]
  }>(
    `/api/assessments/${id}/draft`,
    { method: 'PATCH' },
    {
      expected_revision: expectedRevision,
      details: details.map((detail) => ({
        l3_code: detail.l3_code,
        current_level: detail.current_level,
        target_adjusted: detail.target_adjusted ?? false,
        adjusted_target_level: detail.adjusted_target_level ?? null,
        target_adjustment_reason: detail.target_adjustment_reason ?? null,
        evidence_note: detail.evidence_note ?? null,
        plan_candidate: detail.plan_candidate ?? false,
      })),
    },
  )
}

export async function batchFillL2(
  id: number,
  l2Code: string,
  currentLevel: 1 | 2,
  expectedRevision: number,
): Promise<{
  revision: number
  updated_l3_codes: string[]
  skipped_l3_codes: string[]
}> {
  return request<{
    revision: number
    updated_l3_codes: string[]
    skipped_l3_codes: string[]
  }>(
    `/api/assessments/${id}/draft/batch-level`,
    { method: 'POST' },
    {
      l2_code: l2Code,
      current_level: currentLevel,
      expected_revision: expectedRevision,
    },
  )
}

export async function submitAssessment(
  id: number,
  expectedRevision?: number,
): Promise<{
  ok: boolean
  revision?: number
  auto_cancelled_plan_candidates?: string[]
}> {
  return request<{
    ok: boolean
    revision?: number
    auto_cancelled_plan_candidates?: string[]
  }>(
    `/api/assessments/${id}/submit`,
    { method: 'POST' },
    { expected_revision: expectedRevision },
  )
}

export async function getAssessmentHistory(
  id: number,
): Promise<AssessmentReview[]> {
  return request<AssessmentReview[]>(`/api/assessments/${id}/history`, {
    method: 'GET',
  })
}

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
  member_current_level?: string | null
  member_target_level?: string | null
  details?: AssessmentDetail[]
  l2_groups?: AssessmentL2Group[]
  gap_summary?: GapSummary
}

export type L2Requirements = Record<
  'P4' | 'P5' | 'P6' | 'P7' | 'P8',
  string | null
>

export type AssessmentL2Group = {
  l1_code: string | null
  l1_name: string | null
  l2_code: string | null
  l2_name: string | null
  l3_count: number
  is_empty: boolean
  details: AssessmentDetail[]
  requirements?: L2Requirements
}

const jobLevels = ['P4', 'P5', 'P6', 'P7', 'P8'] as const

export function selectL2Requirement(
  requirements: L2Requirements,
  currentLevel: string | null | undefined,
  targetLevel: string | null | undefined,
): {
  level: (typeof jobLevels)[number]
  label: '目标职级' | '当前职级'
  text: string
} | null {
  for (const [level, label] of [
    [targetLevel, '目标职级'],
    [currentLevel, '当前职级'],
  ] as const) {
    if (!jobLevels.includes(level as (typeof jobLevels)[number])) continue
    const text = requirements[level as (typeof jobLevels)[number]]
    if (text?.trim()) {
      return {
        level: level as (typeof jobLevels)[number],
        label,
        text: text.trim(),
      }
    }
  }
  return null
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
  current_level_explicitly_cleared?: boolean
}

export type GapSummary = {
  total_gaps: number
  avg_gap: number
  high_priority: number
  medium_priority: number
  low_priority: number
}

export type DraftTargetRepairDetail = {
  l3_code: string
  action: 'rebuild' | 'preserve' | 'not_applicable' | 'unrepairable'
  reason: string | null
}

export type DraftTargetRepairSummary = {
  rebuild_count: number
  preserve_count: number
  not_applicable_count: number
  unrepairable_count: number
  actionable_count: number
}

export type DraftTargetRepairPreview = {
  assessment_id: number
  status: string
  revision: number
  member_current_level: { value: string | null; source: string | null }
  member_target_level: { value: string | null; source: string | null }
  standard_version: {
    id: number
    version_no: number
    status: string
    source: string
  } | null
  summary: DraftTargetRepairSummary
  details: DraftTargetRepairDetail[]
  unrepairable_details: DraftTargetRepairDetail[]
}

export type DraftTargetRepairResult = {
  result: 'repaired' | 'noop'
  assessment_id: number
  old_revision: number
  revision: number
  audit_id: number | null
  summary: DraftTargetRepairSummary
  unrepairable_details: DraftTargetRepairDetail[]
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

export async function getDraftTargetRepairPreview(
  id: number,
): Promise<DraftTargetRepairPreview> {
  return request<DraftTargetRepairPreview>(
    `/api/assessments/${id}/draft-target-repair/preview`,
    { method: 'GET' },
  )
}

export async function repairDraftTargetSnapshots(
  id: number,
  expectedRevision: number,
): Promise<DraftTargetRepairResult> {
  return request<DraftTargetRepairResult>(
    `/api/assessments/${id}/draft-target-repair`,
    { method: 'POST' },
    { expected_revision: expectedRevision },
  )
}

export async function saveDraft(
  id: number,
  details: AssessmentDetail[],
  expectedRevision: number,
): Promise<{
  ok: boolean
  revision?: number
  auto_cancelled_plan_candidates?: string[]
  gap_summary?: GapSummary
}> {
  return request<{
    ok: boolean
    revision?: number
    auto_cancelled_plan_candidates?: string[]
    gap_summary?: GapSummary
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
  auto_cancelled_plan_candidates?: string[]
  gap_summary?: GapSummary
}> {
  return request<{
    revision: number
    updated_l3_codes: string[]
    skipped_l3_codes: string[]
    auto_cancelled_plan_candidates?: string[]
    gap_summary?: GapSummary
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
  expectedRevision: number,
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

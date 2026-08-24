import { request } from './shared/api'

const READ_ONLY_TARGET_ADJUSTMENT_FIELDS = new Set([
  'target_adjusted',
  'adjusted_target_level',
  'target_adjustment_reason',
])

export function newIdempotencyKey(): string {
  if (
    typeof crypto !== 'undefined' &&
    typeof crypto.randomUUID === 'function'
  ) {
    return crypto.randomUUID()
  }
  const buf = new Uint8Array(16)
  crypto.getRandomValues(buf)
  return (
    'abcdef' + // ponytail: prefix distinguishes from UUID v4 while staying hex-safe
    Array.from(buf, (b) => b.toString(16).padStart(2, '0')).join('')
  )
}

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
  member_current_level_snapshot?: string | null
  member_target_level_snapshot?: string | null
  capability_standard_version_id?: number | null
  assessment_scope_version?: string | null
  standard_version_label?: string | null
  scope_summary?: ScopeSummary | null
  details?: AssessmentDetail[]
  l2_groups?: AssessmentL2Group[]
  gap_summary?: GapSummary
}

export type ScopeL1Summary = {
  l1_code: string
  l1_name: string
  current_required: number
  target_progressive: number
  total: number
}

export type ScopeSummary = {
  total: number
  current_required: number
  target_progressive: number
  by_l1: ScopeL1Summary[]
}

export type ScopePreview = {
  member_id: number
  year: number
  assessment_type: string
  member_current_level: string
  member_target_level: string
  standard_version: { id: number; label: string }
  scope_version: string
  summary: ScopeSummary
  empty_scope: boolean
  scope_token: string
  open_draft_id: number | null
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

export type AssessmentDetail = {
  id?: number
  l3_code: string
  l3_name?: string
  l3_node_id?: number | null
  scope_type?: 'current_required' | 'target_progressive' | null
  standard_job_level_snapshot?: string | null
  current_level: number | null // 0–5, NULL = not assessed
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
  /** @deprecated use include_in_plan instead */
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
  member_priority?: '高' | '中' | '低' | '暂缓' | null
  include_in_plan?: boolean | null // tri-state: true/false/null
  /** Derived server-side from plan_month (Issue #194) — read-only display. */
  plan_quarter?: 'Q1' | 'Q2' | 'Q3' | 'Q4' | null
  plan_month?: string | null // 'YYYY-MM' (Issue #194)
  /** Buddy Review workspace: advisory consistency flag (never overwrites canonical). */
  data_issue?: boolean
}

export type GapSummary = {
  total_gaps: number
  avg_gap: number
  high_priority: number
  medium_priority: number
  low_priority: number
  on_hold?: number
  in_plan?: number
  by_quarter?: { Q1: number; Q2: number; Q3: number; Q4: number }
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

export async function fetchScopePreview(
  year: number,
  assessmentType = '年度',
): Promise<ScopePreview> {
  const params = new URLSearchParams({
    year: String(year),
    assessment_type: assessmentType,
  })
  return request<ScopePreview>(`/api/assessments/scope-preview?${params}`, {
    method: 'GET',
  })
}

export async function createAssessment(
  year: number,
  scopeToken: string,
  assessmentType = '年度',
  idempotencyKey?: string,
): Promise<{
  id: number
  revision?: number
  summary: ScopeSummary
  scope_token: string
}> {
  const headers: HeadersInit = {}
  if (idempotencyKey) headers['Idempotency-Key'] = idempotencyKey
  return request(
    '/api/assessments',
    { method: 'POST', headers },
    { year, assessment_type: assessmentType, scope_token: scopeToken },
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

/** 稀疏 PATCH 行：只包含调用方提供的字段，未提供的键不发送。
  Issue #194 P1：保存评级与计划草稿自动保存是两个独立动作，各自只提交
  自己的字段（plan_quarter 由服务端派生，永不作为输入发送）。 */
export type DraftDetailInput = {
  l3_node_id?: number | null
  l3_code: string
  [field: string]: unknown
}

export async function saveDraft(
  id: number,
  details: DraftDetailInput[],
  expectedRevision: number,
): Promise<{
  ok: boolean
  revision?: number
  auto_cleared?: Array<{ l3_node_id: number; fields: string[] }>
  gap_summary?: GapSummary
}> {
  return request<{
    ok: boolean
    revision?: number
    auto_cleared?: Array<{ l3_node_id: number; fields: string[] }>
    gap_summary?: GapSummary
  }>(
    `/api/assessments/${id}/draft`,
    { method: 'PATCH' },
    {
      expected_revision: expectedRevision,
      details: details.map((detail) => {
        const row: Record<string, unknown> = {
          l3_node_id: detail.l3_node_id,
          l3_code: detail.l3_code,
        }
        for (const [key, value] of Object.entries(detail)) {
          if (key === 'l3_node_id' || key === 'l3_code') continue
          if (key === 'plan_quarter') continue // derived server-side
          if (READ_ONLY_TARGET_ADJUSTMENT_FIELDS.has(key)) continue
          row[key] = value ?? null
        }
        return row
      }),
    },
  )
}

export async function batchFillL2(
  id: number,
  l2Code: string,
  currentLevel: 0 | 1 | 2,
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

/** Issue #194: M02 第三个独立动作 — 显式生成所选学习任务。

Retired contract: POST /submit (submit-and-auto-generate) → 422
legacy_assessment_submit_disabled; generation is now explicit and
idempotent per (plan, l3_code) — replays return the same created/existing
split. The Idempotency-Key header is accepted; the DB kernel provides
the guarantee.
*/
export async function generatePlanItems(
  id: number,
  l3Codes: string[],
  expectedRevision: number,
  idempotencyKey?: string,
): Promise<{
  ok: boolean
  annual_plan_id?: number
  created: string[]
  existing: string[]
}> {
  const headers: HeadersInit = {}
  if (idempotencyKey) headers['Idempotency-Key'] = idempotencyKey
  return request(
    `/api/assessments/${id}/generate-plan-items`,
    { method: 'POST', headers },
    { l3_codes: l3Codes, expected_revision: expectedRevision },
  )
}

export async function getAssessmentHistory(
  id: number,
): Promise<AssessmentReview[]> {
  return request<AssessmentReview[]>(`/api/assessments/${id}/history`, {
    method: 'GET',
  })
}

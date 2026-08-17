import { request, getOrNull, type ApiError } from './shared/api'
import type { EstimatedHours, EstimatedHoursSummary } from './estimatedHours'

export type AvailableYears = {
  available_years: number[]
  active_year: number
}

export async function getAvailableYears(): Promise<AvailableYears> {
  return request<AvailableYears>('/api/planning/available-years', {
    method: 'GET',
  })
}

export type AnnualPlanEligibility = {
  eligible: boolean
  reason: string | null
}

export type CapabilityContext = {
  l1_code?: string | null
  l1_name?: string | null
  l2_code?: string | null
  l2_name?: string | null
  l3_name?: string | null
  l3_recommended_start_level?: string | null
  l3_materials_text?: string | null
  l3_expected_output?: string | null
  l3_estimated_hours?: string | null
  l3_output_type?: string | null
  l3_notes?: string | null
}

export function formatCapabilityPath(
  item: Pick<CapabilityContext, 'l2_code' | 'l2_name' | 'l3_name'> & {
    l3_code: string
  },
): string {
  const l2 = item.l2_name
    ? `${item.l2_code ?? '未映射'} · ${item.l2_name}`
    : item.l2_code
  const l3 = item.l3_name ? `${item.l3_code} · ${item.l3_name}` : item.l3_code
  return l2 ? `${l2} → ${l3}` : l3
}

export type EligibleGap = CapabilityContext & {
  id: number
  assessment_id: number
  l3_code: string
  current_level: number
  target_level: number
  gap_value: number
  priority: '高' | '中' | '低'
  plan_candidate: boolean
  member_priority?: '高' | '中' | '低' | '暂缓' | null
  include_in_plan?: boolean | null
}

export type GrowthGoal = CapabilityContext & {
  id: number
  gap_id: number
  annual_growth_plan_id: number
  l3_code: string
  year: number
  target_level: number
  priority: '高' | '中' | '低'
}

export type PlanItemStatus =
  '未开始' | '进行中' | '已完成' | '延期' | '暂停' | '取消'

// v0010 six-state machine — '待 Evidence Review' is gone for tasks; a task
// stays 进行中 while evidence awaits review and completes via the gate.
export type LearningTaskStatus =
  '未开始' | '进行中' | '已完成' | '延期' | '暂停' | '取消'

export const TASK_TRANSITIONS: Record<
  LearningTaskStatus,
  LearningTaskStatus[]
> = {
  未开始: ['进行中', '取消'],
  进行中: ['暂停', '延期', '已完成', '取消'],
  暂停: ['进行中', '取消'],
  延期: ['进行中', '暂停', '已完成', '取消'],
  已完成: [],
  取消: [],
}

// Reasons are required when ENTERING these states (server-enforced).
export const STATUS_REASON_FIELDS: Partial<Record<LearningTaskStatus, string>> =
  {
    延期: 'delay_reason',
    暂停: 'pause_reason',
    取消: 'cancel_reason',
  }

export const COMPLETION_QUALITY_VALUES = [
  '达到预期',
  '部分达到',
  '超出预期',
] as const

export type PlanItem = CapabilityContext & {
  id: number
  annual_growth_plan_id: number
  growth_goal_id: number | null
  l3_code: string
  current_level: number
  target_level: number
  priority: '高' | '中' | '低'
  learning_material: string | null
  learning_task_content: string | null
  expected_output: string | null
  estimated_hours: string | null
  estimated_hours_parsed?: EstimatedHours
  plan_start_date: string | null
  plan_end_date: string | null
  target_month: number | null
  status: PlanItemStatus
  // CAS: every plan-item PUT must carry the item's current revision.
  revision: number
  // #62 frozen source snapshot (assessment-approval items)
  source_assessment_id?: number | null
  source_assessment_detail_id?: number | null
  capability_standard_version_id?: number | null
  planning_snapshot_id?: number | null
  l3_node_id?: number | null
  l1_code?: string | null
  l1_name?: string | null
  l2_code?: string | null
  l2_name?: string | null
  l3_name?: string | null
  scope_type?: 'current_required' | 'target_progressive' | null
  standard_target_level?: number | null
  adjusted_target_level?: number | null
  effective_target_level?: number | null
  standard_job_level_snapshot?: string | null
  member_current_level_snapshot?: string | null
  member_target_level_snapshot?: string | null
  plan_quarter?: 'Q1' | 'Q2' | 'Q3' | 'Q4' | null
  plan_month?: string | null // 'YYYY-MM' (Issue #194)
  planning_source_type?: 'assessment_approval' | null
  assessment_revision?: number | null
  gap_value?: number | null
  include_in_plan?: boolean | null
}

export type LearningTask = CapabilityContext & {
  id: number
  plan_item_id: number
  l3_code: string
  status: LearningTaskStatus
  actual_start_date: string | null
  actual_end_date: string | null
  actual_hours: number
  completion_quality: string | null
  review_conclusion: string | null
  next_action: string | null
  revision: number
  actual_started_at: string | null
  actual_completed_at: string | null
  delay_reason: string | null
  pause_reason: string | null
  cancel_reason: string | null
  revised_due_date: string | null
  plan_item_current_level: number
  plan_item_target_level: number
  plan_item_priority: '高' | '中' | '低'
  plan_item_learning_material: string | null
  plan_item_learning_task_content: string | null
  plan_item_expected_output: string | null
  plan_item_estimated_hours: string | null
  plan_item_estimated_hours_parsed?: EstimatedHours
  plan_item_target_month?: number | null
}

export type MemberDashboardAssessmentStatus =
  '草稿' | '待复核' | '已复核' | '建议调整' | '已归档'

export type MemberDashboardAnnualPlanStatus =
  '制定中' | '执行中' | '已归档' | null

export type MemberDashboardAssessment = {
  id: number
  status: MemberDashboardAssessmentStatus
  submitted_at: string | null
  archived_at: string | null
  review_status: '待复核' | '已闭环' | null
  review_conclusion: '认可' | '建议调整' | null
  member_current_level_snapshot?: string | null
  member_target_level_snapshot?: string | null
  applicable_completion?: {
    total: number
    completed: number
    ratio: number
  }
}

export type MemberDashboard = {
  year: number
  assessment: MemberDashboardAssessment | null
  annual_plan_status: MemberDashboardAnnualPlanStatus
  summary: {
    annual_actual_hours: number
    annual_planned_hours: number
    current_month_actual_hours: number
    current_month_planned_hours: number
    annual_planned_hours_min?: number | null
    annual_planned_hours_max?: number | null
    annual_planned_hours_has_values?: boolean
    annual_planned_hours_has_unparsed?: boolean
    current_month_planned_hours_min?: number | null
    current_month_planned_hours_max?: number | null
    current_month_planned_hours_has_values?: boolean
    current_month_planned_hours_has_unparsed?: boolean
    completed_task_count: number
    // Split evidence todos: what the member must submit vs what the buddy
    // must review — superseded evidence versions are never counted.
    pending_evidence_to_submit: number
    pending_evidence_to_review: number
  }
  plan_progress: {
    total: number
    未开始: number
    进行中: number
    已完成: number
    延期: number
    暂停: number
    取消: number
  }
  domain_radar: { domain_code: string; score: number }[]
  gaps: EligibleGap[]
  gap_summary: {
    current_required: number
    target_progressive: number
    derivation: 'scope_v1' | 'legacy_fallback'
  }
  current_month: {
    planned_count: number
    planned_ids: number[]
    in_progress_count: number
    delayed_count: number
    pending_evidence_count: number
    actual_hours: number
  }
  next_action: {
    action_key: string
    message: string
    count: number
  }
  meta: {
    year: number
    scope: string
    as_of: string | null
    source: string
    denominator_source?: string | null
  }
  current_tasks: LearningTask[]
}

export type AnnualPlan = {
  id: number
  member_id: number
  year: number
  plan_cycle: number
  status: string
  start_date: string | null
  end_date: string | null
  created_at: string
  items: PlanItem[]
  estimated_hours_summary?: EstimatedHoursSummary
  source_assessment_id?: number | null
  planning_source_type?: 'assessment_approval' | null
  source_standard_version_label?: string | null
}

export type ChangeProposalDetail = {
  id: number
  source_assessment_detail_id: number
  assessment_id: number
  l3_node_id: number
  l1_code: string
  l1_name: string
  l2_code: string
  l2_name: string
  l3_code: string
  l3_name: string
  scope_type: 'current_required' | 'target_progressive' | null
  current_level: number | null
  standard_target_level: number | null
  adjusted_target_level: number | null
  effective_target_level: number | null
  gap_value: number | null
  member_priority: '高' | '中' | '低' | '暂缓' | null
  include_in_plan: boolean | null
  plan_quarter: 'Q1' | 'Q2' | 'Q3' | 'Q4' | null
  plan_month: string | null // 'YYYY-MM' (Issue #194)
  standard_job_level_snapshot: string | null
  member_current_level_snapshot: string | null
  member_target_level_snapshot: string | null
  capability_standard_version_id: number
  planning_snapshot_id: number | null
  assessment_revision: number
  planning_source_type: 'assessment_approval'
}

export type ChangeProposal = {
  id: number
  member_id: number
  year: number
  source_assessment_id: number
  target_annual_growth_plan_id: number
  status: '待处理'
  created_by: number
  summary: {
    source_assessment_id: number
    source_assessment_version: number
    source_assessment_revision: number
    year: number
    member_id: number
    items_count: number
    target_annual_growth_plan_id: number
    target_is_legacy: boolean
  }
  created_at: string
  details: ChangeProposalDetail[]
}

export async function listChangeProposals(
  year: number,
  memberId?: number,
): Promise<ChangeProposal[]> {
  const query = new URLSearchParams({ year: String(year) })
  if (memberId !== undefined) query.set('member_id', String(memberId))
  return request<ChangeProposal[]>(`/api/planning/change-proposals?${query}`, {
    method: 'GET',
  })
}

export type EvidenceStatus =
  '草稿' | '待 Review' | '通过' | '需补充' | '驳回' | '已归档'

export type Evidence = CapabilityContext & {
  id: number
  learning_task_id: number
  l3_code: string
  version_number: number
  content: string | null
  evidence_link: string | null
  status: EvidenceStatus
  submitted_at: string | null
  created_at: string
  submitted_by: number | null
  description: string | null
  evidence_type: 'link' | 'file' | null
  url: string | null
  file_reference: string | null
  file_name: string | null
  mime_type: string | null
  file_size: number | null
  supersedes_evidence_id: number | null
  revision: number
}

export type EvidenceCreate = Partial<{
  content: string | null
  evidence_link: string | null
  description: string | null
  evidence_type: 'link' | 'file'
  url: string | null
  file_reference: string | null
  file_name: string | null
  mime_type: string | null
  file_size: number | null
  supersedes_evidence_id: number
}>

export type EvidenceUpdate = Partial<{
  content: string | null
  evidence_link: string | null
  description: string | null
}>

export async function getAnnualPlanEligibility(): Promise<AnnualPlanEligibility> {
  return request<AnnualPlanEligibility>(
    '/api/planning/annual-plan-eligibility',
    {
      method: 'GET',
    },
  )
}

export async function annualPlanDryRun(): Promise<{ ok: boolean }> {
  return request<{ ok: boolean }>(
    '/api/planning/annual-plan-dry-run',
    {
      method: 'POST',
    },
    {},
  )
}

export async function getEligibleGaps(): Promise<EligibleGap[]> {
  return request<EligibleGap[]>('/api/planning/eligible-gaps', {
    method: 'GET',
  })
}

export async function createGrowthGoal(gap_id: number): Promise<GrowthGoal> {
  return request<GrowthGoal>(
    '/api/planning/growth-goals',
    { method: 'POST' },
    { gap_id },
  )
}

export async function listGrowthGoals(): Promise<GrowthGoal[]> {
  return request<GrowthGoal[]>('/api/planning/growth-goals', { method: 'GET' })
}

export async function deleteGrowthGoal(goal_id: number): Promise<void> {
  await request<void>(`/api/planning/growth-goals/${goal_id}`, {
    method: 'DELETE',
  })
}

export async function getAnnualPlan(year: number): Promise<AnnualPlan | null> {
  return getOrNull<AnnualPlan>(`/api/planning/annual-plan?year=${year}`)
}

export async function generatePlanItems(): Promise<{
  created: number
  items: PlanItem[]
}> {
  return request<{ created: number; items: PlanItem[] }>(
    '/api/planning/annual-plan/generate',
    { method: 'POST' },
    {},
  )
}

export async function listPlanItems(): Promise<PlanItem[]> {
  return request<PlanItem[]>('/api/planning/plan-items', { method: 'GET' })
}

// Members may edit ONLY the two schedule dates of a plan item; everything
// else (target_month, status, the #62 source snapshot) is frozen server-side.
export type PlanItemUpdate = Partial<{
  plan_start_date: string | null
  plan_end_date: string | null
}>

export function formatL3Name(
  l3Name: string | null | undefined,
  l3Code: string,
): string {
  const name = l3Name?.trim()
  return name ? `${name}（${l3Code}）` : l3Code
}

// CAS contract: every plan-item PUT carries the item's current revision;
// a stale client gets a 409 plan_revision_conflict.
export async function updatePlanItem(
  plan_item_id: number,
  fields: PlanItemUpdate,
  expected_revision: number,
): Promise<PlanItem> {
  return request<PlanItem>(
    `/api/planning/plan-items/${plan_item_id}`,
    { method: 'PUT' },
    { ...fields, expected_revision },
  )
}

export async function listLearningTasks(): Promise<LearningTask[]> {
  return request<LearningTask[]>('/api/planning/learning-tasks', {
    method: 'GET',
  })
}

export async function getLearningTask(task_id: number): Promise<LearningTask> {
  return request<LearningTask>(`/api/planning/learning-tasks/${task_id}`, {
    method: 'GET',
  })
}

// Append-only progress log.  Rows are voided (invalidated_at) or corrected
// (correction_of_log_id) — never physically deleted.
export type ProgressLog = {
  id: number
  task_id: number
  record_date: string
  actual_hours: number
  note: string | null
  recorder_id: number
  created_at: string
  invalidated_at: string | null
  invalidated_by: number | null
  correction_of_log_id: number | null
  idempotency_key: string | null
}

export type ProgressLogCreate = {
  record_date: string
  actual_hours: number
  note?: string
  idempotency_key?: string
  correction_of_log_id?: number
}

export type MonthlyReviewDetail = {
  plan_item_id: number
  task_id: number | null
  l3_code: string
  status: string
  estimated_hours: string | null
  estimated_hours_parsed: EstimatedHours
  actual_hours: number
}

export type MonthlyReviewSummary = {
  planned_count: number
  completed_count: number
  in_progress_count: number
  delayed_count: number
  paused_count: number
  cancelled_count: number
  completion_rate: number
  actual_hours: number
  estimated_hours_summary: EstimatedHoursSummary
}

export type MonthlyReviewWritten = {
  id: number
  member_id: number
  year: number
  month: number
  revision: number
  main_output: string | null
  problems: string | null
  next_month_focus: string | null
  notes: string | null
  created_at: string | null
  updated_at: string | null
}

export type MonthlyReviewHistoryEntry = {
  revision: number
  main_output: string | null
  problems: string | null
  next_month_focus: string | null
  notes: string | null
  changed_by: number
  changed_at: string | null
}

export type MonthlyReview = {
  summary: MonthlyReviewSummary
  details: MonthlyReviewDetail[]
  written: MonthlyReviewWritten | null
  history: MonthlyReviewHistoryEntry[]
  meta: {
    year: number
    month: number
    scope: string
    as_of: string | null
    source: string
  }
}

export type MonthlyReviewWriteFields = Partial<{
  main_output: string | null
  problems: string | null
  next_month_focus: string | null
  notes: string | null
}>

export type LearningTaskUpdate = Partial<{
  completion_quality: string | null
  review_conclusion: string | null
  next_action: string | null
}>

// CAS contract: the revision is mandatory — a PUT without it is a 422.
export async function updateLearningTask(
  task_id: number,
  fields: LearningTaskUpdate,
  expected_revision: number,
): Promise<LearningTask> {
  return request<LearningTask>(
    `/api/planning/learning-tasks/${task_id}`,
    { method: 'PUT' },
    { ...fields, expected_revision },
  )
}

export type TaskTransitionPayload = {
  to_status: LearningTaskStatus
  reason?: string
  expected_revision: number
  idempotency_key?: string
  revised_due_date?: string
}

export async function transitionLearningTask(
  task_id: number,
  payload: TaskTransitionPayload,
): Promise<LearningTask> {
  return request<LearningTask>(
    `/api/planning/learning-tasks/${task_id}/transitions`,
    { method: 'POST' },
    payload,
  )
}

export type TransitionHistoryItem = {
  id: number
  learning_task_id: number
  from_status: string
  to_status: string
  reason: string | null
  actor_id: number
  occurred_at: string
  request_key: string | null
}

export async function listTaskTransitionHistory(
  task_id: number,
): Promise<TransitionHistoryItem[]> {
  return request<TransitionHistoryItem[]>(
    `/api/planning/learning-tasks/${task_id}/transition-history`,
    { method: 'GET' },
  )
}

export async function createProgressLog(
  task_id: number,
  fields: ProgressLogCreate,
): Promise<ProgressLog> {
  return request<ProgressLog>(
    `/api/planning/learning-tasks/${task_id}/progress-logs`,
    { method: 'POST' },
    fields,
  )
}

export async function listProgressLogs(
  task_id: number,
): Promise<ProgressLog[]> {
  return request<ProgressLog[]>(
    `/api/planning/learning-tasks/${task_id}/progress-logs`,
    { method: 'GET' },
  )
}

export async function invalidateProgressLog(
  log_id: number,
  idempotency_key?: string,
): Promise<ProgressLog> {
  return request<ProgressLog>(
    `/api/planning/progress-logs/${log_id}/invalidate`,
    { method: 'POST' },
    idempotency_key === undefined ? {} : { idempotency_key },
  )
}

export async function getMonthlyReview(
  year: number,
  month: number,
  memberId?: number,
): Promise<MonthlyReview> {
  const query = new URLSearchParams({
    year: String(year),
    month: String(month),
  })
  if (memberId !== undefined) query.set('member_id', String(memberId))
  return request<MonthlyReview>(
    `/api/planning/monthly-reviews?${query.toString()}`,
    { method: 'GET' },
  )
}

// CAS contract: the revision is mandatory — a PUT without it is a 422.
export async function upsertMonthlyReview(
  year: number,
  month: number,
  fields: MonthlyReviewWriteFields,
  expected_revision: number,
): Promise<{
  written: MonthlyReviewWritten
  history: MonthlyReviewHistoryEntry[]
}> {
  return request<{
    written: MonthlyReviewWritten
    history: MonthlyReviewHistoryEntry[]
  }>(
    `/api/planning/monthly-reviews?year=${year}&month=${month}`,
    { method: 'PUT' },
    { ...fields, expected_revision },
  )
}

export async function createEvidence(
  task_id: number,
  fields: EvidenceCreate,
): Promise<Evidence> {
  return request<Evidence>(
    `/api/planning/learning-tasks/${task_id}/evidences`,
    { method: 'POST' },
    fields,
  )
}

// CAS contract: every draft-updating PUT carries the evidence's current
// revision; a stale client gets a 409 evidence_revision_conflict.
export async function updateEvidence(
  evidence_id: number,
  fields: EvidenceUpdate,
  expected_revision: number,
): Promise<Evidence> {
  return request<Evidence>(
    `/api/planning/evidences/${evidence_id}`,
    { method: 'PUT' },
    { ...fields, expected_revision },
  )
}

export async function submitEvidence(evidence_id: number): Promise<Evidence> {
  return request<Evidence>(
    `/api/planning/evidences/${evidence_id}/submit`,
    { method: 'POST' },
    {},
  )
}

export async function listEvidences(task_id: number): Promise<Evidence[]> {
  return request<Evidence[]>(
    `/api/planning/learning-tasks/${task_id}/evidences`,
    { method: 'GET' },
  )
}

export async function getEvidence(evidence_id: number): Promise<Evidence> {
  return request<Evidence>(`/api/planning/evidences/${evidence_id}`, {
    method: 'GET',
  })
}

// The server accepts exactly 通过 / 需补充 for evidence review conclusions.
export type EvidenceReviewConclusion = '通过' | '需补充'

// A pending queue item is the evidence row itself, joined with the member
// owning the task (server already scoped it to the current primary Buddy).
export type PendingEvidenceReview = Evidence & {
  member_id: number
  username: string
}

// The immutable review history for a task: one closed row per evidence version.
export type EvidenceReviewRecord = {
  id: number
  evidence_id: number
  version_number: number
  status: string
  conclusion: EvidenceReviewConclusion | null
  feedback: string | null
  reviewed_at: string | null
  created_at: string
}

export type CapabilityProfileAssessmentReview = {
  id: number
  evidence_id?: number
  version_number?: number
  status: string
  conclusion: '认可' | '建议调整' | null
  feedback: string | null
  reviewed_at: string | null
  created_at?: string
}

export type CapabilityProfileAssessment = {
  id: number
  member_id: number
  year: number
  version: number
  assessment_type: string
  status: string
  created_at: string
  submitted_at: string | null
  archived_at: string | null
  reviews: CapabilityProfileAssessmentReview[]
}

export type CapabilityProfilePlanItem = PlanItem & {
  l3_name?: string | null
  learning_task:
    | (LearningTask & {
        l3_name?: string | null
        progress_logs: ProgressLog[]
        evidences: (Evidence & { review: EvidenceReviewRecord | null })[]
      })
    | null
}

export type CapabilityProfileAnnualPlan = Omit<AnnualPlan, 'items'> & {
  items: CapabilityProfilePlanItem[]
}

export type CapabilityProfileStatistics = {
  total_learning_hours: number
  total_planned_hours: number
  total_planned_hours_min?: number | null
  total_planned_hours_max?: number | null
  total_planned_hours_has_values?: boolean
  total_planned_hours_has_unparsed?: boolean
  evidence_count_by_status: Record<string, number>
}

export type SelectableMember = {
  id: number
  username: string
  full_name: string
  current_level: string | null
  target_level: string | null
}

export type SelectableMembersResponse = {
  members: SelectableMember[]
}

export type CapabilityProfile = {
  id: number
  member_id: number
  year: number
  status: string
  created_at: string
  updated_at: string
  member: {
    id: number
    username: string
    full_name: string
    current_level?: string | null
    target_level?: string | null
  }
  assessments: CapabilityProfileAssessment[]
  annual_plan: CapabilityProfileAnnualPlan | null
  monthly_reviews: (MonthlyReviewWritten & {
    history: MonthlyReviewHistoryEntry[]
  })[]
  meta: {
    year: number
    scope: string
    as_of: string | null
    source: string
  }
  statistics: CapabilityProfileStatistics
}

export async function getCapabilityProfile(
  year: number,
): Promise<CapabilityProfile> {
  return request<CapabilityProfile>(`/api/planning/profiles?year=${year}`, {
    method: 'GET',
  })
}

export async function getSelectableMembersForProfile(
  year: number,
): Promise<SelectableMembersResponse> {
  return request<SelectableMembersResponse>(
    `/api/planning/profiles/selectable-members?year=${year}`,
    { method: 'GET' },
  )
}

export async function getMemberDashboard(
  year: number,
): Promise<MemberDashboard> {
  return request<MemberDashboard>(
    `/api/planning/member-dashboard?year=${year}`,
    { method: 'GET' },
  )
}

export async function getCapabilityProfileForMember(
  member_id: number,
  year: number,
): Promise<CapabilityProfile> {
  return request<CapabilityProfile>(
    `/api/planning/profiles?member_id=${member_id}&year=${year}`,
    {
      method: 'GET',
    },
  )
}

export async function listPendingEvidenceReviews(): Promise<
  PendingEvidenceReview[]
> {
  return request<PendingEvidenceReview[]>(
    '/api/planning/evidence-reviews/pending',
    {
      method: 'GET',
    },
  )
}

export type ReviewSummary = {
  pending_count: number
  completed_count: number
}

export async function getEvidenceReviewSummary(
  year: number,
): Promise<ReviewSummary> {
  return request<ReviewSummary>(
    `/api/planning/evidence-reviews/summary?year=${year}`,
    { method: 'GET' },
  )
}

// Review is submitted against the evidence id (the queue item), not a review
// row id.  The idempotency key is bound to the exact payload so an unchanged
// retry replays server-side instead of double-writing.
export async function submitEvidenceReview(
  evidence_id: number,
  conclusion: EvidenceReviewConclusion,
  feedback: string,
  idempotency_key?: string,
): Promise<EvidenceReviewRecord> {
  return request<EvidenceReviewRecord>(
    `/api/planning/evidences/${evidence_id}/review`,
    { method: 'POST' },
    idempotency_key === undefined
      ? { conclusion, feedback }
      : { conclusion, feedback, idempotency_key },
  )
}

export async function listEvidenceReviewsForTask(
  task_id: number,
): Promise<EvidenceReviewRecord[]> {
  return request<EvidenceReviewRecord[]>(
    `/api/planning/learning-tasks/${task_id}/evidence-reviews`,
    { method: 'GET' },
  )
}

export type ApiErrorDetail = {
  status: number
  code: string | null
  field: string | null
  message: string
  isConflict: boolean
}

// Maps the structured server envelope {code, field, reason, message} (409) and
// {code, field, message} (422) plus plain 403s to a field-locatable state.
export function parseApiErrorDetail(error: unknown): ApiErrorDetail {
  const apiError = error as ApiError
  const detail = apiError?.detail
  const structured =
    detail !== null &&
    typeof detail === 'object' &&
    !Array.isArray(detail) &&
    detail !== undefined
      ? (detail as Record<string, unknown>)
      : null
  return {
    status: apiError?.status ?? 0,
    code: typeof structured?.code === 'string' ? structured.code : null,
    field: typeof structured?.field === 'string' ? structured.field : null,
    message:
      typeof structured?.message === 'string'
        ? structured.message
        : apiError instanceof Error
          ? apiError.message
          : '请求失败',
    isConflict: apiError?.status === 409,
  }
}

export type TeamAnnualCapabilityPlan = {
  id: number
  code: string
  year: number
  publisher_id: number
  resource_arrangement: string | null
  description: string | null
  published_at: string
  status: string
  created_at: string
  updated_at: string
  focus_domains: string[]
}

export type TeamAnnualPlanSave = {
  year: number
  focus_domain_codes: string[]
  resource_arrangement: string
  description: string
}

export async function getTeamAnnualPlan(
  year: number,
): Promise<TeamAnnualCapabilityPlan | null> {
  return getOrNull<TeamAnnualCapabilityPlan>(
    `/api/planning/team-annual-plan?year=${year}`,
  )
}

export async function publishTeamAnnualPlan(
  body: TeamAnnualPlanSave,
): Promise<TeamAnnualCapabilityPlan> {
  return request<TeamAnnualCapabilityPlan>(
    '/api/planning/team-annual-plan',
    { method: 'POST' },
    body,
  )
}

export async function updateTeamAnnualPlan(
  body: TeamAnnualPlanSave,
): Promise<TeamAnnualCapabilityPlan> {
  return request<TeamAnnualCapabilityPlan>(
    '/api/planning/team-annual-plan',
    { method: 'PUT' },
    body,
  )
}

export async function archiveTeamAnnualPlan(
  year: number,
): Promise<{ ok: boolean }> {
  return request<{ ok: boolean }>(
    '/api/planning/team-annual-plan/archive',
    { method: 'POST' },
    { year },
  )
}

export type TeamAnalyticsDistributions = {
  priority: { 高: number; 中: number; 低: number; total: number }
  formal_inclusion_ratio: {
    included_count: number
    total_count: number
    ratio: number
  }
  quarterly: { Q1: number; Q2: number; Q3: number; Q4: number; total: number }
  plan_status: {
    未开始: number
    进行中: number
    已完成: number
    延期: number
    暂停: number
    取消: number
    total: number
  }
  pending_acceptance: { count: number }
}

export type TeamAnalytics = {
  year: number
  meta: {
    year: number
    as_of: string | null
    scope: string
    source: string
    denominator_source?: string | null
  }
  gap_summary: {
    current_required: number
    target_progressive: number
    derivation: 'scope_v1' | 'legacy_fallback'
  }
  filters: { member_id: number | null; domain_code: string | null }
  kpis: {
    assessment_completion_rate: number
    assessment_completed_count: number
    assessment_total_count: number
    plan_completion_rate: number
    plan_completed_count: number
    plan_total_count: number
    evidence_pass_rate: number
    evidence_passed_count: number
    evidence_total_count: number
    overdue_plan_item_count: number
  }
  domain_averages: Array<{
    domain_code: string
    actual: number
    target: number
  }>
  member_attainment: Array<{
    member_id: number
    username: string
    full_name: string
    domain_code: string
    attainment: number | null
    actual: number | null
    target: number | null
  }>
  monthly_trends: Array<{
    month: number
    planned_count: number
    actual_count: number
    cumulative_planned_rate: number
    cumulative_actual_rate: number
    planned_hours: number
    planned_hours_min?: number | null
    planned_hours_max?: number | null
    planned_hours_has_unparsed?: boolean
    actual_hours: number
    cumulative_planned_hours: number
    cumulative_planned_hours_min?: number | null
    cumulative_planned_hours_max?: number | null
    cumulative_planned_hours_has_unparsed?: boolean
    cumulative_actual_hours: number
  }>
  overdue_items: Array<{
    member_id: number
    username: string
    full_name: string
    l3_code: string
    l1_code?: string | null
    l1_name?: string | null
    l2_code?: string | null
    l2_name?: string | null
    l3_name: string | null
    due_date: string
    plan_start_date: string
    plan_end_date: string
    overdue_days: number
    status: string
  }>
  distributions: TeamAnalyticsDistributions
}

export async function getTeamAnalytics(query: {
  year: number
  member_id?: number
  domain_code?: string
}): Promise<TeamAnalytics> {
  const parameters = new URLSearchParams({ year: String(query.year) })
  if (query.member_id !== undefined) {
    parameters.set('member_id', String(query.member_id))
  }
  if (query.domain_code) parameters.set('domain_code', query.domain_code)
  return request<TeamAnalytics>(`/api/planning/team-analytics?${parameters}`, {
    method: 'GET',
  })
}

export type TeamAnnualPlanItem = PlanItem & {
  member_id: number
  username: string
  full_name: string
  actual_hours?: number
}

export type TeamAnnualPlanItemStatusBreakdown = {
  未开始: number
  进行中: number
  已完成: number
  延期: number
  暂停: number
  取消: number
  total: number
}

export type TeamAnnualPlanItemSummary = {
  total_count: number
  planned_hours_min: number | null
  planned_hours_max: number | null
  has_values: boolean
  has_unparsed: boolean
  actual_hours: number
  status_breakdown: TeamAnnualPlanItemStatusBreakdown
}

export type TeamAnnualPlanMember = {
  member_id: number
  username: string
  full_name: string
}

export type TeamAnnualPlanItemList = {
  meta: {
    year: number
    as_of: string | null
    scope: string
    source: string
  }
  filters: {
    domain_code: string | null
    priority: string | null
    status: string | null
    quarter: string | null
    month: number | null
    member_id: number | null
    q: string | null
  }
  pagination: {
    page: number
    page_size: number
    total_pages: number
    total_count: number
  }
  summary: TeamAnnualPlanItemSummary
  members: TeamAnnualPlanMember[]
  items: TeamAnnualPlanItem[]
}

export async function getTeamAnnualPlanItems(query: {
  year: number
  page?: number
  page_size?: number
  sort_by?: string
  sort_order?: 'asc' | 'desc'
  member_id?: number
  domain_code?: string
  priority?: string
  status?: string
  quarter?: string
  month?: number
  q?: string
}): Promise<TeamAnnualPlanItemList> {
  const parameters = new URLSearchParams({ year: String(query.year) })
  if (query.page !== undefined) parameters.set('page', String(query.page))
  if (query.page_size !== undefined)
    parameters.set('page_size', String(query.page_size))
  if (query.sort_by) parameters.set('sort_by', query.sort_by)
  if (query.sort_order) parameters.set('sort_order', query.sort_order)
  if (query.member_id !== undefined)
    parameters.set('member_id', String(query.member_id))
  if (query.domain_code) parameters.set('domain_code', query.domain_code)
  if (query.priority) parameters.set('priority', query.priority)
  if (query.status) parameters.set('status', query.status)
  if (query.quarter) parameters.set('quarter', query.quarter)
  if (query.month !== undefined) parameters.set('month', String(query.month))
  if (query.q) parameters.set('q', query.q)
  return request<TeamAnnualPlanItemList>(
    `/api/planning/team-annual-plan/items?${parameters}`,
    { method: 'GET' },
  )
}

export async function createLearningTask(
  plan_item_id: number,
): Promise<LearningTask> {
  return request<LearningTask>(
    `/api/planning/plan-items/${plan_item_id}/learning-task`,
    { method: 'POST' },
    {},
  )
}

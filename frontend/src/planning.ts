import { request, getOrNull } from './shared/api'

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

export type EligibleGap = {
  id: number
  assessment_id: number
  l3_code: string
  l3_name?: string | null
  current_level: number
  target_level: number
  gap_value: number
  priority: '高' | '中' | '低'
  plan_candidate: boolean
}

export type GrowthGoal = {
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

export type LearningTaskStatus =
  | '未开始'
  | '进行中'
  | '待 Evidence Review'
  | '已完成'
  | '延期'
  | '暂停'
  | '取消'

export type PlanItem = {
  id: number
  annual_growth_plan_id: number
  growth_goal_id: number
  l3_code: string
  l3_name?: string | null
  current_level: number
  target_level: number
  priority: '高' | '中' | '低'
  learning_material: string | null
  learning_task_content: string | null
  expected_output: string | null
  estimated_hours: string | null
  plan_start_date: string | null
  plan_end_date: string | null
  target_month: number | null
  status: PlanItemStatus
}

export type LearningTask = {
  id: number
  plan_item_id: number
  l3_code: string
  l3_name?: string | null
  status: LearningTaskStatus
  actual_start_date: string | null
  actual_end_date: string | null
  actual_hours: number
  completion_quality: string | null
  review_conclusion: string | null
  next_action: string | null
  delay_reason?: string | null
  plan_item_current_level: number
  plan_item_target_level: number
  plan_item_priority: '高' | '中' | '低'
  plan_item_learning_material: string | null
  plan_item_learning_task_content: string | null
  plan_item_expected_output: string | null
  plan_item_estimated_hours: string | null
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
    completed_task_count: number
    pending_evidence_count: number
  }
  plan_progress: {
    total: number
    未开始: number
    进行中: number
    '待 Evidence Review': number
    已完成: number
    延期: number
  }
  domain_radar: { domain_code: string; score: number }[]
  gaps: EligibleGap[]
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
}

export type EvidenceStatus =
  '草稿' | '待 Review' | '通过' | '需补充' | '驳回' | '已归档'

export type Evidence = {
  id: number
  learning_task_id: number
  l3_code: string
  version_number: number
  content: string | null
  evidence_link: string | null
  status: EvidenceStatus
  submitted_at: string | null
  created_at: string
}

export type EvidenceUpdate = Partial<{
  content: string | null
  evidence_link: string | null
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

export type PlanItemUpdate = Partial<{
  plan_start_date: string | null
  plan_end_date: string | null
  target_month: number | null
  status: '进行中' | '暂停' | '取消'
}>

export function formatL3Name(
  l3Name: string | null | undefined,
  l3Code: string,
): string {
  const name = l3Name?.trim()
  return name ? `${name}（${l3Code}）` : l3Code
}

export async function updatePlanItem(
  plan_item_id: number,
  fields: PlanItemUpdate,
): Promise<PlanItem> {
  return request<PlanItem>(
    `/api/planning/plan-items/${plan_item_id}`,
    { method: 'PUT' },
    fields,
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

export type ProgressLog = {
  id: number
  task_id: number
  record_date: string
  actual_hours: number
  note: string | null
  recorder_id: number
}

export type ProgressLogUpdate = Partial<{
  record_date: string
  actual_hours: number
  note: string | null
}>

export type MonthlyHours = {
  month: number
  total_hours: number
}

export type LearningTaskUpdate = Partial<{
  status: '未开始' | '进行中' | '延期' | '暂停' | '取消'
  actual_start_date: string | null
  actual_end_date: string | null
  completion_quality: string | null
  review_conclusion: string | null
  next_action: string | null
}>

export async function updateLearningTask(
  task_id: number,
  fields: LearningTaskUpdate,
): Promise<LearningTask> {
  return request<LearningTask>(
    `/api/planning/learning-tasks/${task_id}`,
    { method: 'PUT' },
    fields,
  )
}

export async function createProgressLog(
  task_id: number,
  record_date: string,
  actual_hours: number,
  note: string,
): Promise<ProgressLog> {
  return request<ProgressLog>(
    `/api/planning/learning-tasks/${task_id}/progress-logs`,
    { method: 'POST' },
    { record_date, actual_hours, note },
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

export async function updateProgressLog(
  log_id: number,
  fields: ProgressLogUpdate,
): Promise<ProgressLog> {
  return request<ProgressLog>(
    `/api/planning/progress-logs/${log_id}`,
    { method: 'PUT' },
    fields,
  )
}

export async function deleteProgressLog(log_id: number): Promise<void> {
  await request<void>(`/api/planning/progress-logs/${log_id}`, {
    method: 'DELETE',
  })
}

export async function getMonthlyHours(year: number): Promise<MonthlyHours[]> {
  return request<MonthlyHours[]>(
    `/api/planning/progress-logs/monthly?year=${year}`,
    { method: 'GET' },
  )
}

export async function createEvidence(
  task_id: number,
  content: string,
  evidence_link: string,
): Promise<Evidence> {
  return request<Evidence>(
    `/api/planning/learning-tasks/${task_id}/evidences`,
    { method: 'POST' },
    { content, evidence_link },
  )
}

export async function updateEvidence(
  evidence_id: number,
  fields: EvidenceUpdate,
): Promise<Evidence> {
  return request<Evidence>(
    `/api/planning/evidences/${evidence_id}`,
    { method: 'PUT' },
    fields,
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

export type EvidenceReviewStatus =
  '待 Review' | '通过' | '需补充' | '驳回' | '已闭环'

export type EvidenceReviewConclusion = '通过' | '需补充' | '驳回'

export type EvidenceReview = {
  id: number
  evidence_id: number
  version_number: number
  status: EvidenceReviewStatus
  conclusion: EvidenceReviewConclusion | null
  feedback: string | null
  reviewed_at: string | null
  created_at?: string
  submitted_at?: string | null
  member_id?: number
  username?: string
  learning_task_id?: number
  l3_code?: string
  content?: string | null
  evidence_link?: string | null
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
        evidences: (Evidence & { review: EvidenceReview | null })[]
      })
    | null
}

export type CapabilityProfileAnnualPlan = Omit<AnnualPlan, 'items'> & {
  items: CapabilityProfilePlanItem[]
}

export type CapabilityProfileStatistics = {
  total_learning_hours: number
  total_planned_hours: number
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

export async function listPendingEvidenceReviews(): Promise<EvidenceReview[]> {
  return request<EvidenceReview[]>('/api/planning/evidence-reviews/pending', {
    method: 'GET',
  })
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

export async function submitEvidenceReview(
  review_id: number,
  conclusion: EvidenceReviewConclusion,
  feedback: string,
): Promise<{ ok: boolean }> {
  return request<{ ok: boolean }>(
    `/api/planning/evidence-reviews/${review_id}`,
    { method: 'POST' },
    { conclusion, feedback },
  )
}

export async function listEvidenceReviewsForTask(
  task_id: number,
): Promise<EvidenceReview[]> {
  return request<EvidenceReview[]>(
    `/api/planning/learning-tasks/${task_id}/evidence-reviews`,
    { method: 'GET' },
  )
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

export type TeamAnalytics = {
  year: number
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
    actual_hours: number
    cumulative_planned_hours: number
    cumulative_actual_hours: number
  }>
  overdue_items: Array<{
    member_id: number
    username: string
    full_name: string
    l3_code: string
    l3_name: string | null
    due_date: string
    plan_start_date: string
    plan_end_date: string
    overdue_days: number
    status: string
  }>
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

export async function createLearningTask(
  plan_item_id: number,
): Promise<LearningTask> {
  return request<LearningTask>(
    `/api/planning/plan-items/${plan_item_id}/learning-task`,
    { method: 'POST' },
    {},
  )
}

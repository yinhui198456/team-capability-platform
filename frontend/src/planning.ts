export type AnnualPlanEligibility = {
  eligible: boolean
  reason: string | null
}

export type EligibleGap = {
  id: number
  assessment_id: number
  l3_code: string
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
  status: LearningTaskStatus
  actual_start_date: string | null
  actual_end_date: string | null
  actual_hours: number
  completion_quality: string | null
  review_conclusion: string | null
  next_action: string | null
  plan_item_current_level: number
  plan_item_target_level: number
  plan_item_priority: '高' | '中' | '低'
  plan_item_learning_material: string | null
  plan_item_learning_task_content: string | null
  plan_item_expected_output: string | null
  plan_item_estimated_hours: string | null
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
  return request<AnnualPlan | null>(`/api/planning/annual-plan?year=${year}`, {
    method: 'GET',
  })
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

export async function createLearningTask(
  plan_item_id: number,
): Promise<LearningTask> {
  return request<LearningTask>(
    `/api/planning/plan-items/${plan_item_id}/learning-task`,
    { method: 'POST' },
    {},
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
  status: LearningTaskStatus
  actual_start_date: string | null
  actual_end_date: string | null
  actual_hours: number
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

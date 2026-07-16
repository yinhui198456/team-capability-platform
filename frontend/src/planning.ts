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

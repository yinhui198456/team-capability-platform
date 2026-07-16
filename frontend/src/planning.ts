export type AnnualPlanEligibility = {
  eligible: boolean
  reason: string | null
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

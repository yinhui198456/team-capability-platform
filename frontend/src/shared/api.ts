// Shared HTTP client — replaces 7 copies of request<T>() across the codebase.
// ponytail: one fetch wrapper, 204 guard, consistent error handling.

export type ApiError = Error & {
  status?: number
  detail?: unknown
}

export async function request<T>(
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
    const detail = payload.detail
    const message =
      typeof detail === 'object' && detail !== null && 'message' in detail
        ? String(detail.message)
        : String(detail ?? '请求失败')
    const error = new Error(message) as ApiError
    error.status = response.status
    error.detail = detail
    throw error
  }
  if (response.status === 204) return undefined as T
  return response.json() as Promise<T>
}

export async function getOrNull<T>(
  path: string,
  options?: RequestInit,
): Promise<T | null> {
  const response = await fetch(path, {
    ...options,
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...(options?.headers ?? {}),
    },
  })
  if (response.status === 404) return null
  if (!response.ok) {
    const payload = await response.json().catch(() => ({ detail: '请求失败' }))
    throw new Error(payload.detail ?? '请求失败')
  }
  return response.json() as Promise<T>
}

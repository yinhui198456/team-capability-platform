// Shared HTTP client — replaces 7 copies of request<T>() across the codebase.
// ponytail: one fetch wrapper, 204 guard, consistent error handling.

export type ApiError = Error & {
  status?: number
  detail?: unknown
}

const NETWORK_FAILURE = '网络连接失败，请检查网络后重试。'
const SERVICE_FAILURE = '服务暂时不可用，请稍后重试。'

function apiError(
  message: string,
  status?: number,
  detail?: unknown,
): ApiError {
  const error = new Error(message) as ApiError
  error.status = status
  error.detail = detail
  return error
}

async function responseError(response: Response): Promise<ApiError> {
  const payload = await response.json().catch(() => ({ detail: '请求失败' }))
  if (response.status >= 500) {
    return apiError(SERVICE_FAILURE, response.status)
  }
  const detail = payload.detail
  const message =
    typeof detail === 'object' && detail !== null && 'message' in detail
      ? String(detail.message)
      : String(detail ?? '请求失败')
  return apiError(message, response.status, detail)
}

export async function request<T>(
  path: string,
  options: RequestInit = {},
  body?: object,
): Promise<T> {
  let response: Response
  try {
    response = await fetch(path, {
      ...options,
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
        ...(options.headers ?? {}),
      },
      body: body ? JSON.stringify(body) : options.body,
    })
  } catch {
    throw apiError(NETWORK_FAILURE)
  }
  if (!response.ok) {
    throw await responseError(response)
  }
  if (response.status === 204) return undefined as T
  return response.json() as Promise<T>
}

export async function getOrNull<T>(
  path: string,
  options?: RequestInit,
): Promise<T | null> {
  let response: Response
  try {
    response = await fetch(path, {
      ...options,
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
        ...(options?.headers ?? {}),
      },
    })
  } catch {
    throw apiError(NETWORK_FAILURE)
  }
  if (response.status === 404) return null
  if (!response.ok) {
    throw await responseError(response)
  }
  return response.json() as Promise<T>
}

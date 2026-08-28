import { afterEach, describe, expect, it, vi } from 'vitest'

import { getOrNull, request } from './api'

function response(status: number, detail: unknown) {
  return new Response(JSON.stringify({ detail }), {
    headers: { 'Content-Type': 'application/json' },
    status,
  })
}

describe('shared api errors', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('uses actionable Chinese copy for network failures and 5xx responses', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockRejectedValue(new TypeError('Failed to fetch')),
    )
    await expect(request('/api/example')).rejects.toMatchObject({
      message: '网络连接失败，请检查网络后重试。',
    })

    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(response(500, 'Internal Server Error')),
    )
    await expect(getOrNull('/api/example')).rejects.toMatchObject({
      message: '服务暂时不可用，请稍后重试。',
      status: 500,
    })
  })

  it('keeps structured business errors available to their callers', async () => {
    const detail = {
      code: 'review_idempotency_conflict',
      field: 'idempotency_key',
      message: '请求冲突，请确认后重试。',
    }
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response(409, detail)))

    await expect(request('/api/example')).rejects.toMatchObject({
      detail,
      message: detail.message,
      status: 409,
    })
  })
})

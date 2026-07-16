import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import * as planningApi from './planning'

describe('evidence api helpers', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ id: 1 }),
        }),
      ),
    )
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('createEvidence posts content and link', async () => {
    await planningApi.createEvidence(
      100,
      '完成 P01 实践项目',
      'http://example.com/demo',
    )
    expect(fetch).toHaveBeenCalledWith(
      '/api/planning/learning-tasks/100/evidences',
      expect.objectContaining({
        method: 'POST',
        credentials: 'include',
        body: JSON.stringify({
          content: '完成 P01 实践项目',
          evidence_link: 'http://example.com/demo',
        }),
      }),
    )
  })

  it('updateEvidence puts fields', async () => {
    await planningApi.updateEvidence(10, {
      content: '更新内容',
      evidence_link: 'http://example.com/v2',
    })
    expect(fetch).toHaveBeenCalledWith(
      '/api/planning/evidences/10',
      expect.objectContaining({
        method: 'PUT',
        credentials: 'include',
        body: JSON.stringify({
          content: '更新内容',
          evidence_link: 'http://example.com/v2',
        }),
      }),
    )
  })

  it('submitEvidence posts submit endpoint', async () => {
    await planningApi.submitEvidence(10)
    expect(fetch).toHaveBeenCalledWith(
      '/api/planning/evidences/10/submit',
      expect.objectContaining({
        method: 'POST',
        credentials: 'include',
        body: JSON.stringify({}),
      }),
    )
  })

  it('listEvidences fetches by task id', async () => {
    await planningApi.listEvidences(100)
    expect(fetch).toHaveBeenCalledWith(
      '/api/planning/learning-tasks/100/evidences',
      expect.objectContaining({
        method: 'GET',
        credentials: 'include',
      }),
    )
  })

  it('getEvidence fetches by id', async () => {
    await planningApi.getEvidence(10)
    expect(fetch).toHaveBeenCalledWith(
      '/api/planning/evidences/10',
      expect.objectContaining({
        method: 'GET',
        credentials: 'include',
      }),
    )
  })
})

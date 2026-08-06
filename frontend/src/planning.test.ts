import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  formatCapabilityPath,
  formatL3Name,
  updateLearningTask,
  updatePlanItem,
} from './planning'

const ok = (body: unknown) =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })

describe('CAS update helpers', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('updatePlanItem sends only the editable fields plus the required expected_revision', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(ok({ id: 7, revision: 4 }))
    await updatePlanItem(
      7,
      { plan_start_date: '2026-04-01', plan_end_date: '2026-06-30' },
      3,
    )
    const [, init] = fetchSpy.mock.calls[0]
    expect(init?.method).toBe('PUT')
    expect(JSON.parse(String(init?.body))).toEqual({
      plan_start_date: '2026-04-01',
      plan_end_date: '2026-06-30',
      expected_revision: 3,
    })
  })

  it('updateLearningTask always sends the expected revision', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(ok({ id: 7, revision: 4 }))
    await updateLearningTask(7, { next_action: '继续' }, 2)
    const [, init] = fetchSpy.mock.calls[0]
    expect(init?.method).toBe('PUT')
    expect(JSON.parse(String(init?.body))).toEqual({
      next_action: '继续',
      expected_revision: 2,
    })
  })
})

describe('formatL3Name', () => {
  it('returns "名称（代码）" when l3_name is present', () => {
    expect(formatL3Name('常用办公工具基础', 'C01-L2A-L3A')).toBe(
      '常用办公工具基础（C01-L2A-L3A）',
    )
  })

  it('falls back to l3_code when l3_name is missing', () => {
    expect(formatL3Name(null, 'P01-L2A-L3A')).toBe('P01-L2A-L3A')
    expect(formatL3Name(undefined, 'P01-L2A-L3A')).toBe('P01-L2A-L3A')
    expect(formatL3Name('', 'P01-L2A-L3A')).toBe('P01-L2A-L3A')
  })

  it('trims whitespace and falls back to l3_code for blank names', () => {
    expect(formatL3Name('  ', 'P01-L2A-L3A')).toBe('P01-L2A-L3A')
    expect(formatL3Name('\t\n', 'P01-L2A-L3A')).toBe('P01-L2A-L3A')
    expect(formatL3Name('  常用办公工具基础  ', 'C01-L2A-L3A')).toBe(
      '常用办公工具基础（C01-L2A-L3A）',
    )
  })
})

describe('formatCapabilityPath', () => {
  it('shows the L2 standard before its L3 attainment path', () => {
    expect(
      formatCapabilityPath({
        l2_code: 'P01.01',
        l2_name: '数据基础',
        l3_code: 'P01.01.01',
        l3_name: '完成数据建模实践',
      }),
    ).toBe('P01.01 · 数据基础 → P01.01.01 · 完成数据建模实践')
  })

  it('keeps an unmapped historical L3 code visible', () => {
    expect(formatCapabilityPath({ l3_code: 'legacy-l3' })).toBe('legacy-l3')
  })
})

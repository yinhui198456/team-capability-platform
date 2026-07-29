import { describe, expect, it } from 'vitest'

import { formatCapabilityPath, formatL3Name } from './planning'

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

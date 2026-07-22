import { describe, expect, it } from 'vitest'

import { formatL3Name } from './planning'

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

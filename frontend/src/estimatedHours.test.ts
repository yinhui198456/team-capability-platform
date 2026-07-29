import { describe, expect, it } from 'vitest'

import {
  formatEstimatedHours,
  formatEstimatedHoursSummary,
} from './estimatedHours'

describe('estimated hour formatting', () => {
  it('keeps valid ranges as ranges instead of coercing them to zero or 46', () => {
    expect(
      formatEstimatedHours('4–6', {
        raw: '4–6',
        min_hours: 4,
        max_hours: 6,
        is_valid: true,
        is_range: true,
      }),
    ).toBe('4–6 h')
    expect(
      formatEstimatedHoursSummary({
        min_hours: 24,
        max_hours: 38,
        has_values: true,
        has_unparsed: false,
      }),
    ).toBe('24–38 h')
  })

  it('formats hour-suffix raw values with a normalized space', () => {
    expect(
      formatEstimatedHours('4h', {
        raw: '4h',
        min_hours: 4,
        max_hours: 4,
        is_valid: true,
        is_range: false,
      }),
    ).toBe('4 h')
    expect(
      formatEstimatedHours('4–6h', {
        raw: '4–6h',
        min_hours: 4,
        max_hours: 6,
        is_valid: true,
        is_range: true,
      }),
    ).toBe('4–6 h')
    expect(
      formatEstimatedHours('4.5h', {
        raw: '4.5h',
        min_hours: 4.5,
        max_hours: 4.5,
        is_valid: true,
        is_range: false,
      }),
    ).toBe('4.5 h')
  })

  it('keeps non-empty unparsed historic text visible', () => {
    expect(
      formatEstimatedHours('约半天', {
        raw: '约半天',
        min_hours: null,
        max_hours: null,
        is_valid: false,
        is_range: false,
      }),
    ).toBe('约半天')
  })
})

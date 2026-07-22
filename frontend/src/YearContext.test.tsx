/// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MemoryRouter, useSearchParams } from 'react-router-dom'

import { YearProvider, useYear, useYearState } from './YearContext'
import * as planningApi from './planning'

function YearReader() {
  const year = useYear()
  const { availableYears } = useYearState()
  return (
    <div>
      <span data-testid="year">{year}</span>
      <span data-testid="available-years">{availableYears.join(',')}</span>
    </div>
  )
}

function YearChanger() {
  const [searchParams, setSearchParams] = useSearchParams()
  return (
    <button
      data-testid="change-year"
      onClick={() => setSearchParams({ year: '2025' })}
      type="button"
    >
      Change to {searchParams.get('year') ?? 'default'}
    </button>
  )
}

describe('YearProvider', () => {
  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it('resolves year from URL query parameter', async () => {
    vi.spyOn(planningApi, 'getAvailableYears').mockResolvedValue({
      available_years: [2025, 2026],
      active_year: 2026,
    })
    render(
      <MemoryRouter initialEntries={['/dashboard/member?year=2025']}>
        <YearProvider>
          <YearReader />
        </YearProvider>
      </MemoryRouter>,
    )
    await waitFor(() => {
      expect(screen.getByTestId('year').textContent).toBe('2025')
    })
    expect(screen.getByTestId('available-years').textContent).toBe('2025,2026')
  })

  it('syncs context year when URL query parameter changes', async () => {
    vi.spyOn(planningApi, 'getAvailableYears').mockResolvedValue({
      available_years: [2025, 2026],
      active_year: 2026,
    })
    render(
      <MemoryRouter initialEntries={['/dashboard/member?year=2026']}>
        <YearProvider>
          <YearReader />
          <YearChanger />
        </YearProvider>
      </MemoryRouter>,
    )
    await waitFor(() => {
      expect(screen.getByTestId('year').textContent).toBe('2026')
    })
    screen.getByTestId('change-year').click()
    await waitFor(() => {
      expect(screen.getByTestId('year').textContent).toBe('2025')
    })
  })

  it('falls back to active year for invalid URL year', async () => {
    vi.spyOn(planningApi, 'getAvailableYears').mockResolvedValue({
      available_years: [2026],
      active_year: 2026,
    })
    render(
      <MemoryRouter initialEntries={['/dashboard/member?year=2024']}>
        <YearProvider>
          <YearReader />
        </YearProvider>
      </MemoryRouter>,
    )
    await waitFor(() => {
      expect(screen.getByTestId('year').textContent).toBe('2026')
    })
  })
})

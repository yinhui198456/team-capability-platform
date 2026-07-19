/// @vitest-environment jsdom

import { cleanup, render, screen, waitFor, fireEvent } from '@testing-library/react'
import { afterEach, describe, expect, it, vi, beforeEach } from 'vitest'

import { App } from './App'
import * as accessApi from './access'
import * as planningApi from './planning'
import { MemoryRouter } from 'react-router-dom'

function response(payload: unknown) {
  return Promise.resolve({ ok: true, json: () => Promise.resolve(payload) })
}

describe('workspace role navigation', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn((input: string) => {
        if (input === '/api/auth/me') return Promise.resolve({ ok: false, status: 401, json: () => Promise.resolve({}) })
        if (input.startsWith('/api/capability-model')) return response({ code: 'T', version: 'V1', domains: [] })
        if (input.startsWith('/api/learning-resources')) return response([])
        return response({})
      }),
    )
  })

  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it.each([
    ['Buddy', '负责成员', '能力地图', '/capability/model'],
    ['Leader', '团队', '能力地图', '/capability/model'],
    ['Admin', '全量', '能力地图', '/capability/model'],
  ])(
    'shows %s scope and capability-model navigation',
    async (role, scope, sidebarItem, href) => {
      vi.spyOn(accessApi, 'me').mockResolvedValue({
        id: 1,
        username: role.toLowerCase(),
        full_name: role,
        roles: [role],
      })
      render(
        <MemoryRouter initialEntries={['/capability/model']}>
          <App />
        </MemoryRouter>
      )
      await waitFor(() => {
        expect(screen.getByText(`数据范围：${scope}`)).toBeTruthy()
      })
      expect(screen.getByRole('link', { name: sidebarItem })).toHaveProperty(
        'href',
        expect.stringContaining(href),
      )
    },
  )
})

function stubApi() {
  vi.spyOn(accessApi, 'me').mockResolvedValue({
    id: 1, username: 'member', full_name: 'Member', roles: ['Member'],
  })
}

describe('year parameter persistence', () => {
  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it('[2025,2026] ?year=2025 preserved in links', async () => {
    vi.spyOn(planningApi, 'getAvailableYears').mockResolvedValue({ available_years: [2025, 2026], active_year: 2026 })
    stubApi()

    render(
      <MemoryRouter initialEntries={['/capability/model?year=2025']}>
        <App />
      </MemoryRouter>
    )

    await waitFor(() => {
      expect(screen.getByText('数据范围：本人')).toBeTruthy()
    })

    const links = screen.getAllByRole('link')
    const yearLinks = links.filter((l) => l.getAttribute('href')?.includes('year=2025'))
    expect(yearLinks.length).toBeGreaterThanOrEqual(2)
  })

  it('[2026 only] ?year=2025 falls back to 2026', async () => {
    vi.spyOn(planningApi, 'getAvailableYears').mockResolvedValue({ available_years: [2026], active_year: 2026 })
    stubApi()

    render(
      <MemoryRouter initialEntries={['/capability/model?year=2025']}>
        <App />
      </MemoryRouter>
    )

    await waitFor(() => {
      expect(screen.getByText('数据范围：本人')).toBeTruthy()
    })

    // Invalid year 2025 → redirect to 2026. Links should carry 2026.
    const links = screen.getAllByRole('link')
    const yearLinks = links.filter((l) => l.getAttribute('href')?.includes('year=2026'))
    expect(yearLinks.length).toBeGreaterThanOrEqual(2)
  })

  it('no ?year= uses activeYear', async () => {
    vi.spyOn(planningApi, 'getAvailableYears').mockResolvedValue({ available_years: [2025, 2026], active_year: 2025 })
    stubApi()

    render(
      <MemoryRouter initialEntries={['/capability/model']}>
        <App />
      </MemoryRouter>
    )

    await waitFor(() => {
      expect(screen.getByText('数据范围：本人')).toBeTruthy()
    })

    const links = screen.getAllByRole('link')
    const yearLinks = links.filter((l) => l.getAttribute('href')?.includes('year=2025'))
    expect(yearLinks.length).toBeGreaterThanOrEqual(2)
  })

  it('no activeYear uses latest available', async () => {
    vi.spyOn(planningApi, 'getAvailableYears').mockResolvedValue({ available_years: [2024, 2025], active_year: 0 })
    stubApi()

    render(
      <MemoryRouter initialEntries={['/capability/model']}>
        <App />
      </MemoryRouter>
    )

    await waitFor(() => {
      expect(screen.getByText('数据范围：本人')).toBeTruthy()
    })

    // Latest available is 2025
    const links = screen.getAllByRole('link')
    const yearLinks = links.filter((l) => l.getAttribute('href')?.includes('year=2025'))
    expect(yearLinks.length).toBeGreaterThanOrEqual(2)
  })

  it('single year → selector disabled', async () => {
    vi.spyOn(planningApi, 'getAvailableYears').mockResolvedValue({ available_years: [2026], active_year: 2026 })
    stubApi()

    render(
      <MemoryRouter initialEntries={['/capability/model']}>
        <App />
      </MemoryRouter>
    )

    await waitFor(() => {
      expect(screen.getByText('数据范围：本人')).toBeTruthy()
    })

    const select = screen.getByRole('combobox', { name: '选择年度' })
    expect((select as HTMLSelectElement).disabled).toBe(true)
  })
})

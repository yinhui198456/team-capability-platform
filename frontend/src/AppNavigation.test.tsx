/// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi, beforeEach } from 'vitest'

import { App } from './App'
import * as accessApi from './access'
import * as planningApi from './planning'
import { MemoryRouter, useLocation } from 'react-router-dom'

function LocationDisplay() {
  const location = useLocation()
  return (
    <span data-testid="location">{location.pathname + location.search}</span>
  )
}

function response(payload: unknown) {
  return Promise.resolve({ ok: true, json: () => Promise.resolve(payload) })
}

const emptyDashboard: planningApi.MemberDashboard = {
  year: 2026,
  assessment: {
    id: 1,
    status: '已归档',
    submitted_at: null,
    archived_at: null,
    review_status: '已闭环',
    review_conclusion: '认可',
  },
  annual_plan_status: '执行中',
  summary: {
    annual_actual_hours: 0,
    annual_planned_hours: 0,
    current_month_actual_hours: 0,
    current_month_planned_hours: 0,
    completed_task_count: 0,
    pending_evidence_count: 0,
  },
  plan_progress: {
    total: 0,
    未开始: 0,
    进行中: 0,
    '待 Evidence Review': 0,
    已完成: 0,
    延期: 0,
  },
  domain_radar: [
    { domain_code: 'P01', score: 0 },
    { domain_code: 'P02', score: 0 },
    { domain_code: 'P03', score: 0 },
    { domain_code: 'C01', score: 0 },
    { domain_code: 'C02', score: 0 },
    { domain_code: 'C03', score: 0 },
  ],
  gaps: [],
  current_tasks: [],
}

function stubDashboard() {
  return vi
    .spyOn(planningApi, 'getMemberDashboard')
    .mockResolvedValue(emptyDashboard)
}

describe('workspace role navigation', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn((input: string) => {
        if (input === '/api/auth/me')
          return Promise.resolve({
            ok: false,
            status: 401,
            json: () => Promise.resolve({}),
          })
        if (input.startsWith('/api/capability-model'))
          return response({ code: 'T', version: 'V1', domains: [] })
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

  it.each([['Buddy'], ['Leader'], ['Admin']])(
    'hides data-scope label on public capability model for %s',
    async (role) => {
      vi.spyOn(accessApi, 'me').mockResolvedValue({
        id: 1,
        username: role.toLowerCase(),
        full_name: role,
        roles: [role],
      })
      render(
        <MemoryRouter initialEntries={['/capability/model']}>
          <App />
        </MemoryRouter>,
      )
      await waitFor(() => {
        expect(screen.getByRole('link', { name: '能力地图' })).toBeTruthy()
      })
      expect(screen.queryByText(/数据范围：/)).toBeNull()
    },
  )
})

function stubApi() {
  vi.spyOn(accessApi, 'me').mockResolvedValue({
    id: 1,
    username: 'member',
    full_name: 'Member',
    roles: ['Member'],
  })
}

function stubYear() {
  vi.spyOn(planningApi, 'getAvailableYears').mockResolvedValue({
    available_years: [2026],
    active_year: 2026,
  })
}

describe('r1.1 topbar — sidebar is sole navigation', () => {
  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it('topbar has no module nav, only brand + year + scope', async () => {
    stubYear()
    stubApi()
    stubDashboard()
    render(
      <MemoryRouter initialEntries={['/dashboard/member']}>
        <App />
      </MemoryRouter>,
    )
    await waitFor(() => {
      expect(screen.getByText('Team Capability Platform')).toBeTruthy()
    })
    expect(document.querySelector('.app-topbar-nav')).toBeNull()
    expect(screen.getByRole('combobox', { name: '选择年度' })).toBeTruthy()
    expect(screen.getByText('数据范围：本人')).toBeTruthy()
  })
})

describe('role-based default routing', () => {
  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  function renderWithLocation(
    initialEntries: string[],
    user: accessApi.User | null,
  ) {
    vi.spyOn(accessApi, 'me').mockImplementation(() =>
      user ? Promise.resolve(user) : Promise.reject(new Error('Unauthorized')),
    )
    return render(
      <MemoryRouter initialEntries={initialEntries}>
        <App />
        <LocationDisplay />
      </MemoryRouter>,
    )
  }

  it.each([
    ['Admin', '/system/users'],
    ['Leader', '/operations/analytics'],
    ['Buddy', '/mentoring/dashboard'],
    ['Member', '/dashboard/member'],
  ])('redirects %s from / to %s', async (role, expectedPath) => {
    vi.spyOn(planningApi, 'getAvailableYears').mockResolvedValue({
      available_years: [2026],
      active_year: 2026,
    })
    if (role === 'Member') stubDashboard()
    renderWithLocation(['/'], {
      id: 1,
      username: role.toLowerCase(),
      full_name: role,
      roles: [role],
    })
    await waitFor(() => {
      expect(screen.getByTestId('location').textContent).toBe(expectedPath)
    })
  })

  it('redirects no-role user from / to /capability/model', async () => {
    vi.spyOn(planningApi, 'getAvailableYears').mockResolvedValue({
      available_years: [2026],
      active_year: 2026,
    })
    renderWithLocation(['/'], {
      id: 1,
      username: 'public',
      full_name: 'Public',
      roles: [],
    })
    await waitFor(() => {
      expect(screen.getByTestId('location').textContent).toBe(
        '/capability/model',
      )
    })
  })

  it.each([
    ['Admin', '/system/users'],
    ['Leader', '/operations/analytics'],
    ['Buddy', '/mentoring/dashboard'],
    ['Member', '/dashboard/member'],
  ])(
    'redirects %s from unknown URL to default route',
    async (role, expectedPath) => {
      vi.spyOn(planningApi, 'getAvailableYears').mockResolvedValue({
        available_years: [2026],
        active_year: 2026,
      })
      if (role === 'Member') stubDashboard()
      renderWithLocation(['/not-a-real-page'], {
        id: 1,
        username: role.toLowerCase(),
        full_name: role,
        roles: [role],
      })
      await waitFor(() => {
        expect(screen.getByTestId('location').textContent).toBe(expectedPath)
      })
    },
  )

  it('redirects no-role user from unknown URL to /capability/model', async () => {
    vi.spyOn(planningApi, 'getAvailableYears').mockResolvedValue({
      available_years: [2026],
      active_year: 2026,
    })
    renderWithLocation(['/not-a-real-page'], {
      id: 1,
      username: 'public',
      full_name: 'Public',
      roles: [],
    })
    await waitFor(() => {
      expect(screen.getByTestId('location').textContent).toBe(
        '/capability/model',
      )
    })
  })

  it('redirects unauthenticated users from / to /login', async () => {
    renderWithLocation(['/'], null)
    await waitFor(() => {
      expect(screen.getByTestId('location').textContent).toBe('/login')
    })
  })

  it('redirects unauthenticated users from unknown URL to /login', async () => {
    renderWithLocation(['/not-a-real-page'], null)
    await waitFor(() => {
      expect(screen.getByTestId('location').textContent).toBe('/login')
    })
  })

  it('gives Admin priority over Member when both roles present', async () => {
    vi.spyOn(planningApi, 'getAvailableYears').mockResolvedValue({
      available_years: [2026],
      active_year: 2026,
    })
    renderWithLocation(['/'], {
      id: 1,
      username: 'admin-member',
      full_name: 'Admin Member',
      roles: ['Admin', 'Member'],
    })
    await waitFor(() => {
      expect(screen.getByTestId('location').textContent).toBe('/system/users')
    })
  })
})

describe('authenticated route guard', () => {
  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  function renderUnauthenticated(initialEntries: string[]) {
    vi.spyOn(accessApi, 'me').mockRejectedValue(new Error('Unauthorized'))
    return render(
      <MemoryRouter initialEntries={initialEntries}>
        <App />
        <LocationDisplay />
      </MemoryRouter>,
    )
  }

  it.each([
    ['/dashboard/member'],
    ['/system/users'],
    ['/growth/annual-plan?year=2025'],
    ['/capability/model'],
  ])('redirects unauthenticated user from %s to /login', async (path) => {
    const getAvailableYears = vi
      .spyOn(planningApi, 'getAvailableYears')
      .mockResolvedValue({ available_years: [2026], active_year: 2026 })
    const getAnnualPlan = vi
      .spyOn(planningApi, 'getAnnualPlan')
      .mockResolvedValue(null)
    const getMemberDashboard = vi
      .spyOn(planningApi, 'getMemberDashboard')
      .mockResolvedValue(emptyDashboard)

    renderUnauthenticated([path])
    await waitFor(() => {
      expect(screen.getByTestId('location').textContent).toBe('/login')
    })
    expect(getAvailableYears).not.toHaveBeenCalled()
    expect(getAnnualPlan).not.toHaveBeenCalled()
    expect(getMemberDashboard).not.toHaveBeenCalled()
  })

  it('preserves path and year for authenticated Member accessing /growth/annual-plan', async () => {
    vi.spyOn(accessApi, 'me').mockResolvedValue({
      id: 1,
      username: 'member',
      full_name: 'Member',
      roles: ['Member'],
    })
    vi.spyOn(planningApi, 'getAvailableYears').mockResolvedValue({
      available_years: [2025, 2026],
      active_year: 2026,
    })
    vi.spyOn(planningApi, 'getAnnualPlan').mockResolvedValue(null)

    render(
      <MemoryRouter initialEntries={['/growth/annual-plan?year=2025']}>
        <App />
        <LocationDisplay />
      </MemoryRouter>,
    )
    await waitFor(() => {
      expect(screen.getByTestId('location').textContent).toBe(
        '/growth/annual-plan?year=2025',
      )
    })
  })

  it('allows logged-in no-role user to access /capability/model', async () => {
    vi.spyOn(accessApi, 'me').mockResolvedValue({
      id: 1,
      username: 'public',
      full_name: 'Public',
      roles: [],
    })
    vi.spyOn(planningApi, 'getAvailableYears').mockResolvedValue({
      available_years: [2026],
      active_year: 2026,
    })

    render(
      <MemoryRouter initialEntries={['/capability/model']}>
        <App />
        <LocationDisplay />
      </MemoryRouter>,
    )
    await waitFor(() => {
      expect(screen.getByTestId('location').textContent).toBe(
        '/capability/model',
      )
    })
  })
})

describe('year parameter persistence', () => {
  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it('[2025,2026] ?year=2025 preserved in links', async () => {
    vi.spyOn(planningApi, 'getAvailableYears').mockResolvedValue({
      available_years: [2025, 2026],
      active_year: 2026,
    })
    stubApi()
    stubDashboard()
    render(
      <MemoryRouter initialEntries={['/dashboard/member?year=2025']}>
        <App />
      </MemoryRouter>,
    )
    await waitFor(() => {
      expect(screen.getByText('数据范围：本人')).toBeTruthy()
    })
    await waitFor(() => {
      const yearLinks = screen
        .getAllByRole('link')
        .filter((l) => l.getAttribute('href')?.includes('year=2025'))
      expect(yearLinks.length).toBeGreaterThanOrEqual(2)
    })
  })

  it('[2026 only] ?year=2025 falls back to 2026', async () => {
    vi.spyOn(planningApi, 'getAvailableYears').mockResolvedValue({
      available_years: [2026],
      active_year: 2026,
    })
    stubApi()
    stubDashboard()
    const { container } = render(
      <MemoryRouter initialEntries={['/dashboard/member?year=2025']}>
        <App />
      </MemoryRouter>,
    )
    await waitFor(() => {
      expect(screen.getByText('数据范围：本人')).toBeTruthy()
    })
    const sel = container.querySelector('.year-selector') as HTMLSelectElement
    expect(sel).toBeTruthy()
    await waitFor(() => {
      expect(sel.value).toBe('2026')
    })
  })

  it('no ?year= uses activeYear', async () => {
    vi.spyOn(planningApi, 'getAvailableYears').mockResolvedValue({
      available_years: [2025, 2026],
      active_year: 2025,
    })
    stubApi()
    stubDashboard()
    render(
      <MemoryRouter initialEntries={['/dashboard/member']}>
        <App />
      </MemoryRouter>,
    )
    await waitFor(() => {
      expect(screen.getByText('数据范围：本人')).toBeTruthy()
    })
    await waitFor(() => {
      const yearLinks = screen
        .getAllByRole('link')
        .filter((l) => l.getAttribute('href')?.includes('year=2025'))
      expect(yearLinks.length).toBeGreaterThanOrEqual(2)
    })
  })

  it('no activeYear uses latest available', async () => {
    vi.spyOn(planningApi, 'getAvailableYears').mockResolvedValue({
      available_years: [2024, 2025],
      active_year: 0,
    })
    stubApi()
    stubDashboard()
    render(
      <MemoryRouter initialEntries={['/dashboard/member']}>
        <App />
      </MemoryRouter>,
    )
    await waitFor(() => {
      expect(screen.getByText('数据范围：本人')).toBeTruthy()
    })
    await waitFor(() => {
      const yearLinks = screen
        .getAllByRole('link')
        .filter((l) => l.getAttribute('href')?.includes('year=2025'))
      expect(yearLinks.length).toBeGreaterThanOrEqual(2)
    })
  })

  it('single year → selector disabled', async () => {
    vi.spyOn(planningApi, 'getAvailableYears').mockResolvedValue({
      available_years: [2026],
      active_year: 2026,
    })
    stubApi()
    stubDashboard()
    render(
      <MemoryRouter initialEntries={['/dashboard/member']}>
        <App />
      </MemoryRouter>,
    )
    await waitFor(() => {
      expect(screen.getByText('数据范围：本人')).toBeTruthy()
    })
    const select = screen.getByRole('combobox', {
      name: '选择年度',
    }) as HTMLSelectElement
    expect(select.disabled).toBe(true)
  })
})

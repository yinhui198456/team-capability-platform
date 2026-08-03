/// @vitest-environment jsdom

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react'
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
    ['/mentoring/evidence-review'],
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
  it('dashboard brand and primary-CTA have correct CSS classes', async () => {
    vi.spyOn(accessApi, 'me').mockResolvedValue({
      id: 1,
      username: 'member',
      full_name: 'Member',
      roles: ['Member'],
    })
    vi.spyOn(planningApi, 'getAvailableYears').mockResolvedValue({
      available_years: [2026],
      active_year: 2026,
    })
    vi.spyOn(planningApi, 'getMemberDashboard').mockResolvedValue(
      emptyDashboard,
    )
    render(
      <MemoryRouter initialEntries={['/dashboard/member']}>
        <App />
      </MemoryRouter>,
    )
    await waitFor(() => {
      expect(screen.getByText('我的成长总览')).toBeTruthy()
    })
    // Brand link must have correct class (white-on-dark, not overridden by :visited)
    const brandLink = screen.getByRole('link', {
      name: 'Team Capability Platform',
    })
    expect(brandLink.classList.contains('app-topbar-brand')).toBe(true)
    // Primary CTA renders asynchronously after dashboard data loads
    await waitFor(() => {
      const primaryLinks = document.querySelectorAll('a.primary-link')
      expect(primaryLinks.length).toBeGreaterThan(0)
      primaryLinks.forEach((link) => {
        expect(link.classList.contains('primary-link')).toBe(true)
      })
    })
  })
})

describe('evidence review route boundary', () => {
  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  function stubFetch() {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.reject(new Error('network down'))),
    )
  }

  it('renders inside the authenticated shell for Buddy with layout, identity and Buddy navigation', async () => {
    stubFetch()
    vi.spyOn(accessApi, 'me').mockResolvedValue({
      id: 2,
      username: 'buddy',
      full_name: 'Buddy',
      roles: ['Buddy'],
    })
    vi.spyOn(planningApi, 'getAvailableYears').mockResolvedValue({
      available_years: [2026],
      active_year: 2026,
    })
    vi.spyOn(planningApi, 'listPendingEvidenceReviews').mockResolvedValue([])
    render(
      <MemoryRouter initialEntries={['/mentoring/evidence-review']}>
        <App />
        <LocationDisplay />
      </MemoryRouter>,
    )
    await waitFor(() =>
      expect(screen.getByRole('heading', { name: '待验收成果' })).toBeTruthy(),
    )
    // Inside the auth shell: brand, identity, sign-out and Buddy nav all render.
    expect(
      screen.getByRole('link', { name: 'Team Capability Platform' }),
    ).toBeTruthy()
    expect(screen.getByText('Buddy')).toBeTruthy()
    expect(screen.getByRole('button', { name: '退出' })).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Buddy 复核中心' })).toBeTruthy()
    expect(screen.getByRole('link', { name: '待验收成果' })).toBeTruthy()
    expect(screen.getByTestId('location').textContent).toBe(
      '/mentoring/evidence-review',
    )
  })

  it.each([
    [['Member'], '/dashboard/member'],
    [['Leader'], '/operations/analytics'],
    [['Admin'], '/system/users'],
  ] as [string[], string][])(
    'redirects a logged-in %s away from the Buddy evidence page to %s',
    async (roles, expected) => {
      stubFetch()
      vi.spyOn(accessApi, 'me').mockResolvedValue({
        id: 1,
        username: roles[0].toLowerCase(),
        full_name: roles[0],
        roles,
      })
      vi.spyOn(planningApi, 'getAvailableYears').mockResolvedValue({
        available_years: [2026],
        active_year: 2026,
      })
      if (roles[0] === 'Member') {
        vi.spyOn(planningApi, 'getMemberDashboard').mockResolvedValue(
          emptyDashboard,
        )
      }
      render(
        <MemoryRouter initialEntries={['/mentoring/evidence-review']}>
          <App />
          <LocationDisplay />
        </MemoryRouter>,
      )
      await waitFor(() => {
        expect(screen.getByTestId('location').textContent).toBe(expected)
      })
      // No operable Evidence page for non-Buddy roles.
      expect(screen.queryByRole('heading', { name: '待验收成果' })).toBeNull()
    },
  )
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

describe('global logout action', () => {
  const users = [
    { role: 'Member', full_name: 'Member User', roles: ['Member'] },
    { role: 'Buddy', full_name: 'Buddy User', roles: ['Buddy'] },
    { role: 'Leader', full_name: 'Leader User', roles: ['Leader'] },
    { role: 'Admin', full_name: 'Admin User', roles: ['Admin'] },
    { role: 'no-role', full_name: '', roles: [] },
  ]

  function renderAuthenticated(user: {
    role: string
    full_name: string
    roles: string[]
  }) {
    vi.spyOn(accessApi, 'me').mockResolvedValue({
      id: 1,
      username: user.role.toLowerCase(),
      full_name: user.full_name,
      roles: user.roles,
    })
    vi.spyOn(planningApi, 'getAvailableYears').mockResolvedValue({
      available_years: [2026],
      active_year: 2026,
    })
    vi.stubGlobal(
      'fetch',
      vi.fn((input: string) => {
        if (input.startsWith('/api/capability-model'))
          return response({ code: 'T', version: 'V1', domains: [] })
        if (input.startsWith('/api/learning-resources')) return response([])
        return response({})
      }),
    )
    return render(
      <MemoryRouter initialEntries={['/capability/model']}>
        <App />
        <LocationDisplay />
      </MemoryRouter>,
    )
  }

  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it.each(users)(
    'shows the logout action for $role and falls back to username when full_name is empty',
    async (user) => {
      renderAuthenticated(user)
      const expectedName = user.full_name || user.role.toLowerCase()
      await waitFor(() => {
        expect(screen.getByText(expectedName)).toBeTruthy()
      })
      expect(screen.getByRole('button', { name: '退出' })).toBeTruthy()
      expect(screen.queryByText(/数据范围：/)).toBeNull()
    },
  )

  it('logs out once, disables the action while pending, and redirects to login', async () => {
    let resolveLogout: (() => void) | undefined
    const logout = vi.spyOn(accessApi, 'logout').mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          resolveLogout = resolve
        }),
    )
    renderAuthenticated(users[0])

    const button = (await screen.findByRole('button', {
      name: '退出',
    })) as HTMLButtonElement
    fireEvent.click(button)
    fireEvent.click(button)

    expect(logout).toHaveBeenCalledTimes(1)
    expect(button.disabled).toBe(true)
    expect(button.textContent).toBe('退出中…')

    resolveLogout?.()
    await waitFor(() => {
      expect(screen.getByTestId('location').textContent).toBe('/login')
    })
    expect(screen.queryByText('Member User')).toBeNull()
  })

  it('keeps the authenticated page visible when logout fails', async () => {
    vi.spyOn(accessApi, 'logout').mockRejectedValue(new Error('network'))
    renderAuthenticated(users[0])

    fireEvent.click(await screen.findByRole('button', { name: '退出' }))

    await waitFor(() => {
      expect(screen.getByRole('alert').textContent).toBe('退出失败，请重试')
    })
    expect(screen.getByTestId('location').textContent).toBe('/capability/model')
    expect(screen.getByText('Member User')).toBeTruthy()
    expect(
      (screen.getByRole('button', { name: '退出' }) as HTMLButtonElement)
        .disabled,
    ).toBe(false)
  })
})

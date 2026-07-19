/// @vitest-environment jsdom

import { cleanup, render, screen, waitFor, fireEvent } from '@testing-library/react'
import { afterEach, describe, expect, it, vi, beforeEach } from 'vitest'

import { App } from './App'
import * as accessApi from './access'
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

describe('year parameter persistence', () => {
  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it('preserves ?year=2025 in sidebar navigation links', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ ok: false, status: 401, json: () => Promise.resolve({}) })))
    vi.spyOn(accessApi, 'me').mockResolvedValue({
      id: 1, username: 'member', full_name: 'Member', roles: ['Member'],
    })

    render(
      <MemoryRouter initialEntries={['/capability/model?year=2025']}>
        <App />
      </MemoryRouter>
    )

    await waitFor(() => {
      expect(screen.getByText('数据范围：本人')).toBeTruthy()
    })

    // All sidebar links should carry ?year=2025
    const links = screen.getAllByRole('link')
    const yearLinks = links.filter((l) => l.getAttribute('href')?.includes('year=2025'))
    expect(yearLinks.length).toBeGreaterThanOrEqual(2)
  })

  it('defaults to current year via context when no ?year parameter', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ ok: false, status: 401, json: () => Promise.resolve({}) })))
    vi.spyOn(accessApi, 'me').mockResolvedValue({
      id: 1, username: 'member', full_name: 'Member', roles: ['Member'],
    })

    render(
      <MemoryRouter initialEntries={['/capability/model']}>
        <App />
      </MemoryRouter>
    )

    await waitFor(() => {
      expect(screen.getByText('数据范围：本人')).toBeTruthy()
    })

    // Without explicit ?year=, links don't append it. YearProvider uses current year as default.
    const brandLink = screen.getByText('Team Capability Platform')
    expect(brandLink.getAttribute('href')).not.toContain('?year=')
  })
})

/// @vitest-environment jsdom

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'

import { App } from './App'
import * as accessApi from './access'
import { MemoryRouter } from 'react-router-dom'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

const todayStr = new Date().toISOString().split('T')[0]

interface FetchOpts {
  method?: string
  body?: string
}

function makeFetch(
  users: object[],
  overrides?: Record<string, object | object[]>,
) {
  return vi.fn(
    async (path: string, init?: FetchOpts): Promise<unknown> => {
      const u = (typeof path === 'string' ? path : '') as string

      // POST buddy-relationship
      if (
        init?.method === 'POST' &&
        u === '/api/system/buddy-relationships' &&
        !u.endsWith('/end')
      ) {
        const body = init.body ? JSON.parse(init.body) : {}
        return {
          ok: true,
          json: () =>
            Promise.resolve({
              id: 1,
              member_id: body.member_id ?? 2,
              buddy_id: body.buddy_id ?? 3,
              buddy_name: 'New Buddy',
              effective_date: todayStr,
              expiry_date: body.expiry_date ?? null,
              is_primary: true,
              created_at: '2026-01-01T00:00:00Z',
              updated_at: '2026-01-01T00:00:00Z',
            }),
        }
      }

      // POST buddy-relationship end
      if (init?.method === 'POST' && u.endsWith('/end')) {
        return {
          ok: true,
          json: () =>
            Promise.resolve({
              id: 1,
              member_id: 2,
              buddy_id: 3,
              buddy_name: 'Ended Buddy',
              effective_date: todayStr,
              expiry_date: todayStr,
              is_primary: true,
              created_at: '2026-01-01T00:00:00Z',
              updated_at: '2026-01-01T00:00:00Z',
            }),
        }
      }

      // PUT buddy-relationship
      if (init?.method === 'PUT' && u.startsWith('/api/system/buddy-relationships/')) {
        const body = init.body ? JSON.parse(init.body) : {}
        return {
          ok: true,
          json: () =>
            Promise.resolve({
              id: 1,
              member_id: 2,
              buddy_id: body.buddy_id ?? 3,
              buddy_name: 'Updated Buddy',
              effective_date: todayStr,
              expiry_date: body.expiry_date ?? null,
              is_primary: true,
              created_at: '2026-01-01T00:00:00Z',
              updated_at: '2026-01-01T00:00:00Z',
            }),
        }
      }

      // Override routes
      if (overrides) {
        for (const [key, value] of Object.entries(overrides)) {
          if (u === key || (key.includes('*') && u.startsWith(key.replace('*', '')))) {
            return { ok: true, json: () => Promise.resolve(value) }
          }
        }
      }

      // Standard routes
      if (u === '/api/system/users') return { ok: true, json: () => Promise.resolve(users) }
      if (u === '/api/system/roles')
        return { ok: true, json: () => Promise.resolve(['Member', 'Buddy', 'Leader', 'Admin']) }
      if (u === '/api/system/available-buddies')
        return {
          ok: true,
          json: () =>
            Promise.resolve([
              { id: 3, username: 'buddy001', full_name: 'Buddy User' },
            ]),
        }
      if (/^\/api\/system\/buddy-relationships\/\d+$/.test(u))
        return { ok: true, json: () => Promise.resolve([]) }

      // Fallback: system config
      return {
        ok: true,
        json: () =>
          Promise.resolve([
            {
              code: 'default_plan_cycle',
              name: '默认计划周期',
              value: '12',
              value_type: 'integer',
              description: '年度成长计划默认月数',
              enabled: true,
            },
          ]),
      }
    },
  )
}

it('renders the Admin system management workspace', async () => {
  vi.spyOn(accessApi, 'me').mockResolvedValue({
    id: 1,
    username: 'admin',
    full_name: 'Admin',
    roles: ['Admin'],
  })
  vi.stubGlobal(
    'fetch',
    makeFetch([
      {
        id: 1,
        username: 'admin',
        full_name: 'Admin',
        is_active: true,
        roles: ['Admin'],
      },
    ]),
  )
  render(
    <MemoryRouter initialEntries={['/system/users']}>
      <App />
    </MemoryRouter>,
  )
  await waitFor(() => {
    expect(screen.getByRole('heading', { name: '系统管理' })).toBeTruthy()
  })
  expect(screen.getByText('用户管理')).toBeTruthy()
  expect(screen.getByText('系统配置')).toBeTruthy()
  await waitFor(() => {
    expect(screen.getByText(/Admin · admin · 启用/)).toBeTruthy()
  })
  expect(screen.getByDisplayValue('12')).toBeTruthy()
})

it('shows buddy relationship section when selecting a Member user', async () => {
  vi.spyOn(accessApi, 'me').mockResolvedValue({
    id: 1,
    username: 'admin',
    full_name: 'Admin',
    roles: ['Admin'],
  })
  vi.stubGlobal(
    'fetch',
    makeFetch([
      {
        id: 1,
        username: 'admin',
        full_name: 'Admin',
        is_active: true,
        roles: ['Admin'],
      },
      {
        id: 2,
        username: 'member001',
        full_name: 'Test Member',
        is_active: true,
        roles: ['Member'],
      },
      {
        id: 3,
        username: 'buddy001',
        full_name: 'Buddy User',
        is_active: true,
        roles: ['Buddy'],
      },
    ]),
  )
  render(
    <MemoryRouter initialEntries={['/system/users']}>
      <App />
    </MemoryRouter>,
  )
  await waitFor(() => {
    expect(screen.getByRole('heading', { name: '系统管理' })).toBeTruthy()
  })
  const memberBtn = await screen.findByRole('button', {
    name: /Test Member · member001 · 启用/,
  })
  fireEvent.click(memberBtn)

  await waitFor(() => {
    expect(screen.getByRole('heading', { name: '主 Buddy 关系' })).toBeTruthy()
  })
  expect(screen.getByText('该成员暂无 Buddy 关系。')).toBeTruthy()
})

it('displays buddy relationship list with status badges', async () => {
  vi.spyOn(accessApi, 'me').mockResolvedValue({
    id: 1,
    username: 'admin',
    full_name: 'Admin',
    roles: ['Admin'],
  })
  vi.stubGlobal(
    'fetch',
    makeFetch(
      [
        {
          id: 1,
          username: 'admin',
          full_name: 'Admin',
          is_active: true,
          roles: ['Admin'],
        },
        {
          id: 2,
          username: 'member002',
          full_name: 'Member Two',
          is_active: true,
          roles: ['Member'],
        },
        {
          id: 3,
          username: 'buddy002',
          full_name: 'Buddy Two',
          is_active: true,
          roles: ['Buddy'],
        },
      ],
      {
        '/api/system/buddy-relationships/2': [
          {
            id: 1,
            member_id: 2,
            buddy_id: 3,
            buddy_name: 'Buddy Two',
            effective_date: todayStr,
            expiry_date: null,
            is_primary: true,
            created_at: '2026-01-01T00:00:00Z',
            updated_at: '2026-01-01T00:00:00Z',
          },
        ],
      },
    ),
  )

  render(
    <MemoryRouter initialEntries={['/system/users']}>
      <App />
    </MemoryRouter>,
  )
  await waitFor(() => {
    expect(screen.getByRole('heading', { name: '系统管理' })).toBeTruthy()
  })

  const memberBtn = await screen.findByRole('button', {
    name: /Member Two · member002 · 启用/,
  })
  fireEvent.click(memberBtn)

  await waitFor(() => {
    expect(screen.getByRole('heading', { name: '主 Buddy 关系' })).toBeTruthy()
  })
  await waitFor(() => {
    expect(screen.getByText('Buddy Two')).toBeTruthy()
  })
  expect(screen.getByText('当前有效')).toBeTruthy()
  expect(screen.getByRole('button', { name: '修改' })).toBeTruthy()
  expect(screen.getByRole('button', { name: '结束' })).toBeTruthy()
})

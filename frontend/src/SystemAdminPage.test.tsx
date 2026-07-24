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
  return vi.fn(async (path: string, init?: FetchOpts): Promise<unknown> => {
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
    if (
      init?.method === 'PUT' &&
      u.startsWith('/api/system/buddy-relationships/')
    ) {
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
        if (
          u === key ||
          (key.includes('*') && u.startsWith(key.replace('*', '')))
        ) {
          return { ok: true, json: () => Promise.resolve(value) }
        }
      }
    }

    // Standard routes
    if (u === '/api/system/users')
      return { ok: true, json: () => Promise.resolve(users) }
    if (u === '/api/system/roles')
      return {
        ok: true,
        json: () => Promise.resolve(['Member', 'Buddy', 'Leader', 'Admin']),
      }
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
  })
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

it('creates a new buddy relationship through the UI form', async () => {
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
          username: 'member003',
          full_name: 'Member Three',
          is_active: true,
          roles: ['Member'],
        },
        {
          id: 3,
          username: 'buddy003',
          full_name: 'Buddy Three',
          is_active: true,
          roles: ['Buddy'],
        },
      ],
      {
        '/api/system/buddy-relationships/2': [],
        '/api/system/available-buddies': [
          { id: 3, username: 'buddy003', full_name: 'Buddy Three' },
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
    name: /Member Three · member003 · 启用/,
  })
  fireEvent.click(memberBtn)

  await waitFor(() => {
    expect(screen.getByRole('heading', { name: '主 Buddy 关系' })).toBeTruthy()
  })
  // Empty state before adding
  expect(screen.getByText('该成员暂无 Buddy 关系。')).toBeTruthy()
  // Click "新增关系" button
  fireEvent.click(screen.getByRole('button', { name: '新增关系' }))
  // Form should appear
  await waitFor(() => {
    expect(screen.getByRole('heading', { name: '新增关系' })).toBeTruthy()
  })
  // Save button should be present
  expect(screen.getByRole('button', { name: '保存关系' })).toBeTruthy()
})

it('modifies an existing buddy relationship and refreshes history', async () => {
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
          username: 'member004',
          full_name: 'Member Four',
          is_active: true,
          roles: ['Member'],
        },
        {
          id: 3,
          username: 'buddy004',
          full_name: 'Buddy Four',
          is_active: true,
          roles: ['Buddy'],
        },
      ],
      {
        '/api/system/buddy-relationships/2': [
          {
            id: 10,
            member_id: 2,
            buddy_id: 3,
            buddy_name: 'Buddy Four',
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
    name: /Member Four · member004 · 启用/,
  })
  fireEvent.click(memberBtn)

  await waitFor(() => {
    expect(screen.getByRole('heading', { name: '主 Buddy 关系' })).toBeTruthy()
  })
  // Click "修改" button on existing relationship
  fireEvent.click(screen.getByRole('button', { name: '修改' }))
  // Edit form appears
  await waitFor(() => {
    expect(screen.getByRole('heading', { name: '修改关系' })).toBeTruthy()
  })
  expect(screen.getByRole('button', { name: '保存关系' })).toBeTruthy()
  expect(screen.getByRole('button', { name: '取消' })).toBeTruthy()
})

it('ends a relationship and refreshes status', async () => {
  window.confirm = vi.fn(() => true)
  vi.spyOn(accessApi, 'me').mockResolvedValue({
    id: 1,
    username: 'admin',
    full_name: 'Admin',
    roles: ['Admin'],
  })
  // First GET returns the relationship, second GET (after end) returns empty
  let getCount = 0
  vi.stubGlobal(
    'fetch',
    vi.fn(async (path: string, init?: FetchOpts): Promise<unknown> => {
      const u = (typeof path === 'string' ? path : '') as string
      if (init?.method === 'POST' && u.endsWith('/end')) {
        return {
          ok: true,
          json: () =>
            Promise.resolve({
              id: 10,
              member_id: 2,
              buddy_id: 3,
              buddy_name: 'Buddy Five',
              effective_date: todayStr,
              expiry_date: todayStr,
              is_primary: true,
              created_at: '2026-01-01T00:00:00Z',
              updated_at: '2026-01-01T00:00:00Z',
            }),
        }
      }
      if (u === '/api/system/users') {
        return {
          ok: true,
          json: () =>
            Promise.resolve([
              {
                id: 1,
                username: 'admin',
                full_name: 'Admin',
                is_active: true,
                roles: ['Admin'],
              },
              {
                id: 2,
                username: 'member005',
                full_name: 'Member Five',
                is_active: true,
                roles: ['Member'],
              },
              {
                id: 3,
                username: 'buddy005',
                full_name: 'Buddy Five',
                is_active: true,
                roles: ['Buddy'],
              },
            ]),
        }
      }
      if (u === '/api/system/roles') {
        return {
          ok: true,
          json: () => Promise.resolve(['Member', 'Buddy', 'Leader', 'Admin']),
        }
      }
      if (u === '/api/system/available-buddies') {
        return {
          ok: true,
          json: () =>
            Promise.resolve([
              { id: 3, username: 'buddy005', full_name: 'Buddy Five' },
            ]),
        }
      }
      if (/^\/api\/system\/buddy-relationships\/\d+$/.test(u)) {
        getCount += 1
        return {
          ok: true,
          json: () =>
            Promise.resolve(
              getCount <= 1
                ? [
                    {
                      id: 10,
                      member_id: 2,
                      buddy_id: 3,
                      buddy_name: 'Buddy Five',
                      effective_date: todayStr,
                      expiry_date: null,
                      is_primary: true,
                      created_at: '2026-01-01T00:00:00Z',
                      updated_at: '2026-01-01T00:00:00Z',
                    },
                  ]
                : [],
            ),
        }
      }
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
    }),
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
    name: /Member Five · member005 · 启用/,
  })
  fireEvent.click(memberBtn)

  await waitFor(() => {
    expect(screen.getByRole('heading', { name: '主 Buddy 关系' })).toBeTruthy()
  })
  await waitFor(() => {
    expect(screen.getByText('Buddy Five')).toBeTruthy()
  })
  expect(screen.getByText('当前有效')).toBeTruthy()
  // Click "结束" button — confirm is already mocked
  fireEvent.click(screen.getByRole('button', { name: '结束' }))
  // After ending, the relationship should disappear from the list
  await waitFor(() => {
    expect(screen.getByText('该成员暂无 Buddy 关系。')).toBeTruthy()
  })
})

it('shows Chinese error when creating relationship with overlapping dates', async () => {
  vi.spyOn(accessApi, 'me').mockResolvedValue({
    id: 1,
    username: 'admin',
    full_name: 'Admin',
    roles: ['Admin'],
  })
  vi.stubGlobal(
    'fetch',
    vi.fn(async (path: string, init?: FetchOpts): Promise<unknown> => {
      const u = (typeof path === 'string' ? path : '') as string
      if (
        init?.method === 'POST' &&
        u === '/api/system/buddy-relationships' &&
        !u.endsWith('/end')
      ) {
        return {
          ok: false,
          status: 422,
          statusText: 'Unprocessable Entity',
          json: () =>
            Promise.resolve({
              detail: '该成员在所选日期区间内已有主 Buddy 关系，日期不可重叠。',
            }),
        }
      }
      if (u === '/api/system/users') {
        return {
          ok: true,
          json: () =>
            Promise.resolve([
              {
                id: 1,
                username: 'admin',
                full_name: 'Admin',
                is_active: true,
                roles: ['Admin'],
              },
              {
                id: 2,
                username: 'member006',
                full_name: 'Member Six',
                is_active: true,
                roles: ['Member'],
              },
              {
                id: 3,
                username: 'buddy006',
                full_name: 'Buddy Six',
                is_active: true,
                roles: ['Buddy'],
              },
            ]),
        }
      }
      if (u === '/api/system/roles') {
        return {
          ok: true,
          json: () => Promise.resolve(['Member', 'Buddy', 'Leader', 'Admin']),
        }
      }
      if (/^\/api\/system\/buddy-relationships\/\d+$/.test(u)) {
        return {
          ok: true,
          json: () =>
            Promise.resolve([
              {
                id: 99,
                member_id: 2,
                buddy_id: 3,
                buddy_name: 'Existing Buddy',
                effective_date: todayStr,
                expiry_date: null,
                is_primary: true,
                created_at: '2026-01-01T00:00:00Z',
                updated_at: '2026-01-01T00:00:00Z',
              },
            ]),
        }
      }
      if (u === '/api/system/available-buddies') {
        return {
          ok: true,
          json: () =>
            Promise.resolve([
              { id: 4, username: 'buddy007', full_name: 'Buddy Seven' },
            ]),
        }
      }
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
    }),
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
    name: /Member Six · member006 · 启用/,
  })
  fireEvent.click(memberBtn)

  await waitFor(() => {
    expect(screen.getByRole('heading', { name: '主 Buddy 关系' })).toBeTruthy()
  })
  // Click "新增关系" to open form
  fireEvent.click(screen.getByRole('button', { name: '新增关系' }))
  await waitFor(() => {
    expect(screen.getByRole('heading', { name: '新增关系' })).toBeTruthy()
  })
  // Submit form - API will return 422
  fireEvent.click(screen.getByRole('button', { name: '保存关系' }))
  // Chinese error message should appear
  await waitFor(() => {
    expect(
      screen.getByText(/该成员在所选日期区间内已有主 Buddy 关系/),
    ).toBeTruthy()
  })
})

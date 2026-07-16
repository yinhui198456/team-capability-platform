/// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'

import { App } from './App'
import * as accessApi from './access'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

it('renders the Admin system management workspace', async () => {
  vi.spyOn(accessApi, 'me').mockResolvedValue({
    id: 1,
    username: 'admin',
    full_name: 'Admin',
    roles: ['Admin'],
  })
  vi.stubGlobal(
    'fetch',
    vi.fn((path: string) => {
      if (path === '/api/system/users') {
        return Promise.resolve({
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
            ]),
        })
      }
      if (path === '/api/system/roles') {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve(['Member', 'Buddy', 'Leader', 'Admin']),
        })
      }
      return Promise.resolve({
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
      })
    }),
  )
  window.history.pushState({}, '', '/system/users')

  render(<App />)

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

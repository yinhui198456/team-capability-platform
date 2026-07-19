/// @vitest-environment jsdom

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { App } from './App'
import { login, logout, me } from './access'
import { MemoryRouter } from 'react-router-dom'

describe('access helpers', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              id: 1,
              username: 'leader',
              full_name: 'Leader User',
              roles: ['Leader', 'Member'],
            }),
        }),
      ),
    )
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('login posts to /api/auth/login with credentials include and json body', async () => {
    const user = await login('leader', '123456')

    expect(fetch).toHaveBeenCalledWith('/api/auth/login', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'leader', password: '123456' }),
    })
    expect(user.username).toBe('leader')
  })

  it('login does not write to localStorage', async () => {
    const setItem = vi.spyOn(Storage.prototype, 'setItem')
    await login('leader', '123456')
    expect(setItem).not.toHaveBeenCalled()
    setItem.mockRestore()
  })

  it('logout posts to /api/auth/logout with credentials include', async () => {
    await logout()
    expect(fetch).toHaveBeenCalledWith(
      '/api/auth/logout',
      expect.objectContaining({
        method: 'POST',
        credentials: 'include',
      }),
    )
  })

  it('me fetches /api/auth/me with credentials include', async () => {
    const user = await me()
    expect(fetch).toHaveBeenCalledWith(
      '/api/auth/me',
      expect.objectContaining({
        method: 'GET',
        credentials: 'include',
      }),
    )
    expect(user.username).toBe('leader')
  })
})

describe('LoginPage', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn((input: string, init?: RequestInit) => {
        if (input === '/api/auth/login' && init?.method === 'POST') {
          return Promise.resolve({
            ok: true,
            json: () =>
              Promise.resolve({
                id: 1,
                username: 'leader',
                full_name: 'Leader User',
                roles: ['Leader', 'Member'],
              }),
          })
        }
        return Promise.resolve({ ok: true, json: () => Promise.resolve({}) })
      }),
    )
  })

  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
  })

  it('renders labelled username and password inputs', () => {
    render(
      <MemoryRouter initialEntries={['/login']}>
        <App />
      </MemoryRouter>
    )
    expect(screen.getByLabelText('用户名')).toBeTruthy()
    expect(screen.getByLabelText('密码')).toBeTruthy()
  })

  it('reports API errors on failed login', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve({
          ok: false,
          status: 401,
          json: () => Promise.resolve({ detail: 'invalid credentials' }),
        }),
      ),
    )

    render(
      <MemoryRouter initialEntries={['/login']}>
        <App />
      </MemoryRouter>
    )
    fireEvent.change(screen.getByLabelText('用户名'), {
      target: { value: 'leader' },
    })
    fireEvent.change(screen.getByLabelText('密码'), {
      target: { value: 'wrong' },
    })
    fireEvent.click(screen.getByRole('button', { name: '登录' }))

    await waitFor(() => {
      expect(screen.getByText('invalid credentials')).toBeTruthy()
    })
  })
})

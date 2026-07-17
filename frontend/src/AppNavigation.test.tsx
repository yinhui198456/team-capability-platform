/// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { App } from './App'
import * as accessApi from './access'

describe('workspace role navigation', () => {
  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it.each([
    ['Buddy', '负责成员', '导师指导', '/mentoring/dashboard'],
    ['Leader', '团队', '团队运营', '/operations/resources'],
    ['Admin', '全量', '系统管理', '/system/users'],
  ])(
    'shows %s modules and scope',
    async (role, scope, module, href) => {
      vi.spyOn(accessApi, 'me').mockResolvedValue({
        id: 1,
        username: role.toLowerCase(),
        full_name: role,
        roles: [role],
      })
      window.history.pushState({}, '', '/capability/model')
      render(<App />)

      await waitFor(() => {
        expect(screen.getByText(`数据范围：${scope}`)).toBeTruthy()
      })
      expect(screen.getByRole('link', { name: module })).toHaveProperty(
        'href',
        expect.stringContaining(href),
      )
    },
  )
})

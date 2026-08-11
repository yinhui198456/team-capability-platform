/// @vitest-environment jsdom

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { App } from './App'
import * as accessApi from './access'
import * as planningApi from './planning'
import { MemoryRouter } from 'react-router-dom'

function stubMatchMedia(matches: boolean) {
  vi.stubGlobal(
    'matchMedia',
    vi.fn().mockImplementation((media: string) => ({
      matches,
      media,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  )
}

async function renderShell(matches: boolean) {
  stubMatchMedia(matches)
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
  vi.stubGlobal(
    'fetch',
    vi.fn((input: string) => {
      if (input.startsWith('/api/capability-model'))
        return Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({ code: 'T', version: 'V1', domains: [] }),
        })
      if (input.startsWith('/api/learning-resources'))
        return Promise.resolve({ ok: true, json: () => Promise.resolve([]) })
      return Promise.resolve({ ok: true, json: () => Promise.resolve({}) })
    }),
  )
  render(
    <MemoryRouter initialEntries={['/capability/model']}>
      <App />
    </MemoryRouter>,
  )
  await waitFor(() => {
    expect(screen.getByText('Team Capability Platform')).toBeTruthy()
  })
}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('Issue #93 — narrow shell (≤991px)', () => {
  it('renders a nav toggle, keeps header identity visible, drops the sidebar column', async () => {
    await renderShell(true)
    // Toggle is the narrow-mode entry: accessible, reflects drawer state.
    const toggle = screen.getByRole('button', { name: '打开导航菜单' })
    expect(toggle.getAttribute('aria-expanded')).toBe('false')
    expect(toggle.getAttribute('aria-controls')).toBe('app-sidebar')
    // Header identity / year / logout stay visible and operable at 768.
    expect(
      screen.getByRole('link', { name: 'Team Capability Platform' }),
    ).toBeTruthy()
    expect(screen.getByRole('combobox', { name: '选择年度' })).toBeTruthy()
    expect(screen.getByText('Member')).toBeTruthy()
    expect(screen.getByRole('button', { name: '退出' })).toBeTruthy()
    // The fixed 224px sidebar column is gone — content is not compressed.
    const shell = document.querySelector('.app-shell') as HTMLElement
    expect(shell.getAttribute('data-narrow')).toBe('true')
    expect(window.getComputedStyle(shell).gridTemplateColumns).toBe('1fr')
    // Closed drawer leaves no off-canvas nav in the tab order.
    expect(document.querySelector('.app-sidebar')).toBeNull()
  })

  it('opens and closes the drawer with keyboard-accessible controls', async () => {
    await renderShell(true)
    const toggle = screen.getByRole('button', { name: '打开导航菜单' })
    fireEvent.click(toggle)
    expect(toggle.getAttribute('aria-expanded')).toBe('true')
    expect(screen.getByTestId('nav-backdrop')).toBeTruthy()
    expect(document.querySelector('.app-sidebar')).toBeTruthy()
    // Focus moves into the drawer so the nav is keyboard-operable.
    await waitFor(() => {
      expect(document.activeElement?.textContent).toContain('我的工作台')
    })
    // Backdrop closes the drawer and returns focus to the toggle.
    fireEvent.click(screen.getByTestId('nav-backdrop'))
    expect(document.querySelector('.app-sidebar')).toBeNull()
    expect(toggle.getAttribute('aria-expanded')).toBe('false')
    expect(document.activeElement).toBe(toggle)
  })

  it('closes the drawer on Escape', async () => {
    await renderShell(true)
    fireEvent.click(screen.getByRole('button', { name: '打开导航菜单' }))
    expect(document.querySelector('.app-sidebar')).toBeTruthy()
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(document.querySelector('.app-sidebar')).toBeNull()
    expect(
      screen
        .getByRole('button', { name: '打开导航菜单' })
        .getAttribute('aria-expanded'),
    ).toBe('false')
  })
})

describe('Issue #93 — desktop shell (≥992px)', () => {
  it('keeps the fixed sidebar navigation and no toggle', async () => {
    await renderShell(false)
    expect(screen.queryByRole('button', { name: /导航菜单/ })).toBeNull()
    expect(screen.getByRole('link', { name: '能力地图' })).toBeTruthy()
    const shell = document.querySelector('.app-shell') as HTMLElement
    expect(shell.hasAttribute('data-narrow')).toBe(false)
    // jsdom drops var()-based declarations, so the guard is: the desktop
    // shell never collapses to the narrow single-column grid.
    expect(window.getComputedStyle(shell).gridTemplateColumns).not.toBe('1fr')
  })
})

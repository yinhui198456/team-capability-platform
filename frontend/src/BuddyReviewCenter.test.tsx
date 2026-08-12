/// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { App } from './App'
import * as accessApi from './access'
import * as assessmentReviewApi from './assessmentReview'
import { MemoryRouter } from 'react-router-dom'

describe('BuddyReviewCenter', () => {
  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  function mockBuddyData() {
    vi.spyOn(accessApi, 'me').mockResolvedValue({
      id: 3,
      username: 'buddy',
      full_name: '辅导员',
      roles: ['Buddy'],
      assigned_members: [
        { id: 4, username: 'member', full_name: '成员甲', is_active: true },
      ],
    })
    vi.spyOn(assessmentReviewApi, 'listPendingReviews').mockResolvedValue([])
  }

  it('shows the member list and the Evidence Review entry on the dashboard', async () => {
    mockBuddyData()
    render(
      <MemoryRouter initialEntries={['/mentoring/dashboard']}>
        <App />
      </MemoryRouter>,
    )
    await waitFor(() =>
      expect(
        screen.getByRole('heading', { level: 1, name: '辅导成员看板' }),
      ).toBeTruthy(),
    )
    expect(screen.getByRole('heading', { name: '辅导成员' })).toBeTruthy()
    expect(screen.getByText('成员甲')).toBeTruthy()
    // No assessment self-review queue surface anywhere.
    expect(screen.queryByText('自评复核')).toBeNull()
    expect(screen.queryByText('复核工作区')).toBeNull()
    expect(screen.queryByRole('tab')).toBeNull()
    // The Evidence Review entry links to its own queue.
    const link = screen.getByRole('link', { name: '前往成果验收' })
    expect(link.getAttribute('href')).toContain('/mentoring/evidence-review')
  })

  it('redirects /mentoring/assessment-review to the dashboard', async () => {
    mockBuddyData()
    render(
      <MemoryRouter initialEntries={['/mentoring/assessment-review']}>
        <App />
      </MemoryRouter>,
    )

    await waitFor(() =>
      expect(
        screen.getByRole('heading', { level: 1, name: '辅导成员看板' }),
      ).toBeTruthy(),
    )
  })

  it('removes the assessment self-review entry and queue, keeping Evidence Review (#178)', async () => {
    mockBuddyData()
    render(
      <MemoryRouter initialEntries={['/mentoring/dashboard']}>
        <App />
      </MemoryRouter>,
    )
    await waitFor(() =>
      expect(
        screen.getByRole('heading', { level: 1, name: '辅导成员看板' }),
      ).toBeTruthy(),
    )
    // No self-assessment review queue or entry surfaces anywhere.
    expect(screen.queryByText('自评复核')).toBeNull()
    expect(screen.queryByText('待复核自评')).toBeNull()
    expect(screen.queryByRole('tab')).toBeNull()
    // Member list and the Evidence Review entry remain (nav + dashboard card).
    expect(screen.getByRole('heading', { name: '辅导成员' })).toBeTruthy()
    expect(screen.getAllByText('待验收成果').length).toBeGreaterThan(0)
  })
})

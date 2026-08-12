import { expect, test } from '@playwright/test'

import { loginAs, logout } from '../fixtures/auth'

test.describe('Member main flow', () => {
  test('persists year param across 我的工作台 → 能力自评与 Gap → 年度成长计划', async ({
    page,
  }) => {
    const year = '2026'
    await loginAs(page, 'member')

    // 1. 我的工作台
    await page.goto(`/dashboard/member?year=${year}`)
    await expect(
      page.getByRole('heading', { name: '我的成长总览' }),
    ).toBeVisible()
    await expect(page).toHaveURL(new RegExp(`/dashboard/member\\?year=${year}`))

    // 2. 能力自评与 Gap
    await page.getByRole('link', { name: '能力自评与 Gap' }).click()
    await expect(
      page.getByRole('heading', { name: '能力自评与 Gap 分析' }),
    ).toBeVisible()
    await expect(page).toHaveURL(
      new RegExp(`/capability/assessment\\?year=${year}`),
    )

    // 3. 年度成长计划
    await page.getByRole('link', { name: '年度成长计划' }).click()
    await expect(
      page.getByRole('heading', { name: '年度成长计划' }),
    ).toBeVisible()
    await expect(page).toHaveURL(
      new RegExp(`/growth/annual-plan\\?year=${year}`),
    )
  })
})

test.describe('Issue #52 L2/L3 cross-page read-only path', () => {
  test('keeps capability-standard and attainment-path wording through the member, Buddy, and Leader views', async ({
    page,
  }) => {
    await loginAs(page, 'member')

    await page.goto('/capability/model')
    await expect(page.getByRole('heading', { name: '能力地图' })).toBeVisible()
    await page.getByTestId('l2-toggle-P01.01').click()
    await expect(page.getByText('职级要求 P4–P8').first()).toBeVisible()

    await page.goto('/capability/assessment')
    await expect(
      page.getByRole('heading', { name: '能力自评与 Gap 分析' }),
    ).toBeVisible()

    // #62: the legacy growth-goals route redirects to the annual plan page
    await page.goto('/growth/goals')
    await expect(
      page.getByRole('heading', { name: '年度成长计划' }),
    ).toBeVisible()

    await page.goto('/growth/annual-plan')
    await expect(
      page.getByRole('heading', { name: '年度成长计划' }),
    ).toBeVisible()

    await page.goto('/growth/profile')
    await expect(page.getByRole('heading', { name: '成长档案' })).toBeVisible()

    await logout(page)
    await loginAs(page, 'buddy')
    await page.goto('/mentoring/dashboard')
    await expect(
      page.getByRole('heading', { name: '辅导成员看板' }),
    ).toBeVisible()

    await logout(page)
    await loginAs(page, 'leader')
    await page.goto('/operations/analytics')
    await expect(
      page.getByRole('heading', { name: '团队能力分析' }),
    ).toBeVisible()
  })
})

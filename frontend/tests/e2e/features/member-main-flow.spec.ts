import { expect, test } from '@playwright/test'

import { loginAs } from '../fixtures/auth'

test.describe('Member main flow', () => {
  test('persists year param across 我的工作台 → 能力自评与 Gap → 年度成长计划', async ({
    page,
  }) => {
    const year = '2026'
    await loginAs(page, 'member')

    // 1. 我的工作台
    await page.goto(`/dashboard/member?year=${year}`)
    await expect(page.getByRole('heading', { name: '我的成长总览' })).toBeVisible()
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

import { expect, test } from '@playwright/test'

import { loginAs } from '../fixtures/auth'

/*
 * The default Playwright target is the shared demo database. Keep this suite
 * read-only until browser tests have an isolated database lifecycle.
 */
test.describe('four-role core read paths', () => {
  test('Member: can view the self-assessment workspace', async ({ page }) => {
    await loginAs(page, 'member')
    await page.goto('/capability/assessment')

    await expect(
      page.getByRole('heading', { name: '能力自评与 Gap 分析' }),
    ).toBeVisible()
    await expect(page.getByText('数据范围：本人')).toBeVisible()
  })

  test('Buddy: uses the unified review center and legacy links redirect', async ({
    page,
  }) => {
    await loginAs(page, 'buddy')
    await page.goto('/mentoring/dashboard')

    await expect(
      page.getByRole('heading', { name: 'Buddy 复核中心' }),
    ).toBeVisible()
    await expect(page.getByText('数据范围：负责成员')).toBeVisible()
    await expect(page.getByRole('heading', { name: '辅导成员' })).toBeVisible()

    await page.goto('/mentoring/evidence-review')
    await expect(page).toHaveURL(/\/mentoring\/dashboard$/)
    await expect(
      page.getByRole('heading', { name: 'Buddy 复核中心' }),
    ).toBeVisible()
  })

  test('Leader: can view team analytics', async ({ page }) => {
    await loginAs(page, 'leader')
    await page.goto('/operations/analytics')

    await expect(
      page.getByRole('heading', { name: '团队能力分析' }),
    ).toBeVisible()
    await expect(page.getByText('数据范围：团队')).toBeVisible()
    await expect(page.getByText('成员 L3 掌握度达成率')).toBeVisible()
  })

  test('Admin: can view user and configuration management', async ({
    page,
  }) => {
    await loginAs(page, 'admin')
    await page.goto('/system/users')

    await expect(page.getByRole('heading', { name: '系统管理' })).toBeVisible()
    await expect(page.getByText('数据范围：全量')).toBeVisible()
    await expect(page.getByRole('heading', { name: '创建用户' })).toBeVisible()
  })
})

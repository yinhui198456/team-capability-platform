import { expect, test } from '@playwright/test'

import { loginAs } from '../fixtures/auth'

/*
 * The default Playwright target is the shared demo database. Keep this suite
 * read-only until browser tests have an isolated database lifecycle.
 */
test.describe('four-role core read paths', () => {
  test('Member: signs out from the capability map and cannot revisit the dashboard', async ({
    page,
  }) => {
    await loginAs(page, 'member')
    await page.goto('/capability/model')

    await expect(page.getByRole('combobox', { name: '选择年度' })).toBeVisible()
    await expect(page.locator('.app-topbar-user')).not.toHaveText('')
    await expect(page.getByRole('button', { name: '退出' })).toBeVisible()
    await expect(page.getByText(/数据范围：/)).toHaveCount(0)
    for (const viewport of [
      { width: 1440, height: 900 },
      { width: 1920, height: 1080 },
    ]) {
      await page.setViewportSize(viewport)
      expect(
        await page
          .locator('html')
          .evaluate((element) => element.scrollWidth <= window.innerWidth),
      ).toBe(true)
    }

    await page.getByRole('button', { name: '退出' }).click()
    await expect(page).toHaveURL(/\/login$/)

    await page.goto('/dashboard/member')
    await expect(page).toHaveURL(/\/login$/)
  })

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

  test('Admin: signs out and cannot revisit user management', async ({
    page,
  }) => {
    await loginAs(page, 'admin')
    await page.goto('/system/users')

    await expect(page.locator('.app-topbar-user')).not.toHaveText('')
    await page.getByRole('button', { name: '退出' }).click()
    await expect(page).toHaveURL(/\/login$/)

    await page.goto('/system/users')
    await expect(page).toHaveURL(/\/login$/)
  })
})

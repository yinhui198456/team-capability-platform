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

  test('Buddy: member overview board; evidence review is a standalone page', async ({
    page,
  }) => {
    await loginAs(page, 'buddy')
    await page.goto('/mentoring/dashboard')

    await expect(
      page.getByRole('heading', { name: '辅导成员看板' }),
    ).toBeVisible()
    await expect(
      page.getByRole('heading', { name: '辅导成员', exact: true }),
    ).toBeVisible()
    await expect(
      page.getByRole('heading', { name: '待验收成果' }),
    ).toBeVisible()
    await expect(page.getByRole('link', { name: '前往成果验收' })).toBeVisible()

    // Legacy assessment-review alias still resolves to the Buddy board.
    await page.goto('/mentoring/assessment-review')
    await expect(page).toHaveURL(/\/mentoring\/dashboard$/)
    await expect(
      page.getByRole('heading', { name: '辅导成员看板' }),
    ).toBeVisible()

    // Evidence review is its own route now — it must NOT redirect to the
    // assessment review center, and it must render the evidence page.
    await page.goto('/mentoring/evidence-review')
    await expect(page).toHaveURL(/\/mentoring\/evidence-review$/)
    await expect(
      page.getByRole('heading', { name: '待验收成果' }),
    ).toBeVisible()
    await expect(
      page.getByRole('heading', { name: '辅导成员看板' }),
    ).toHaveCount(0)
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
    await expect(
      page.getByText('管理账号、固定角色及年度计划的全局参数。'),
    ).toBeVisible()
    // The create flow lives in an accessible dialog opened from the toolbar
    // button; required account fields are asserted read-only (no user is
    // created by this read-path suite).
    await page.getByRole('button', { name: '创建用户' }).click()
    const drawer = page.getByRole('dialog', { name: /创建用户/ })
    await expect(drawer).toBeVisible()
    await expect(drawer.getByLabel('用户名')).toBeVisible()
    await expect(drawer.getByLabel('姓名')).toBeVisible()
    await expect(drawer.getByLabel('初始密码')).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(drawer).toHaveCount(0)
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

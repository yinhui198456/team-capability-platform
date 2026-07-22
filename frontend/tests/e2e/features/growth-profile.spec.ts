import { expect, test } from '@playwright/test'

import { loginAs } from '../fixtures/auth'
import {
  mockGrowthProfileData,
  mockGrowthProfileEmptyData,
  growthProfileMockMember,
  growthProfileMockMember2,
} from '../fixtures/growth-profile-mock'

test.describe('成长档案', () => {
  test('Member 查看本人成长档案', async ({ page }) => {
    await mockGrowthProfileData(page)
    await loginAs(page, 'member')
    await page.goto('/growth/profile?year=2026')

    await expect(
      page.getByRole('heading', { name: '成长档案', level: 1 }),
    ).toBeVisible()
    await expect(
      page.getByText(/成员：.*· 年度：2026 · 数据范围：本人/),
    ).toBeVisible()
    const kpiRegion = page.getByRole('region', { name: '年度成长闭环摘要' })
    await expect(page.getByLabel('查看成员')).not.toBeVisible()
    await expect(page.getByText('计划学习时长')).toBeVisible()
    await expect(kpiRegion.getByText('实际学习时长')).toBeVisible()
    await expect(page.getByText('计划项完成率')).toBeVisible()
  })

  test('Buddy 查看负责成员档案并切换成员', async ({ page }) => {
    await mockGrowthProfileData(page)
    await loginAs(page, 'buddy')
    await page.goto('/growth/profile?year=2026')

    await expect(
      page.getByRole('heading', { name: '成长档案', level: 1 }),
    ).toBeVisible()
    await expect(
      page.getByText(/成员：.*· 年度：2026 · 数据范围：负责成员/),
    ).toBeVisible()

    const selector = page.getByLabel('查看成员')
    await expect(selector).toBeVisible()
    await expect(selector).toHaveValue(String(growthProfileMockMember.id))

    await selector.selectOption({
      label: `${growthProfileMockMember2.full_name}（${growthProfileMockMember2.username}）`,
    })
    await expect(
      page.getByText(new RegExp(`成员：${growthProfileMockMember2.full_name}`)),
    ).toBeVisible()
  })

  test('Leader 查看团队成员档案', async ({ page }) => {
    await mockGrowthProfileData(page)
    await loginAs(page, 'leader')
    await page.goto('/growth/profile?year=2026')

    await expect(
      page.getByRole('heading', { name: '成长档案', level: 1 }),
    ).toBeVisible()
    await expect(
      page.getByText(/成员：.*· 年度：2026 · 数据范围：团队/),
    ).toBeVisible()

    const selector = page.getByLabel('查看成员')
    await expect(selector).toBeVisible()
    await expect(selector.locator('option')).toHaveCount(2)
  })

  test('成长档案页面只读，不出现写入按钮', async ({ page }) => {
    await mockGrowthProfileData(page)
    await loginAs(page, 'buddy')
    await page.goto('/growth/profile?year=2026')

    await expect(
      page.getByRole('heading', { name: '成长档案', level: 1 }),
    ).toBeVisible()
    await expect(page.getByRole('button', { name: /编辑/ })).not.toBeVisible()
    await expect(page.getByRole('button', { name: /提交/ })).not.toBeVisible()
    await expect(page.getByRole('button', { name: /审核/ })).not.toBeVisible()
  })

  test('Member 越权访问其他成员固定行为', async ({ page }) => {
    await mockGrowthProfileData(page)
    await loginAs(page, 'member')
    await page.goto(
      `/growth/profile?member_id=${growthProfileMockMember2.id}&year=2026`,
    )

    await expect(
      page.getByRole('heading', { name: '成长档案', level: 1 }),
    ).toBeVisible()
    await expect(
      page.getByText(new RegExp(`成员：${growthProfileMockMember.full_name}`)),
    ).toBeVisible()
  })

  test('导航包含成长管理分组及成长档案', async ({ page }) => {
    await mockGrowthProfileData(page)
    await loginAs(page, 'member')
    await page.goto('/growth/profile?year=2026')

    const nav = page.locator('.app-sidebar')
    await expect(nav.getByText('成长管理')).toBeVisible()
    await expect(nav.getByRole('link', { name: '成长档案' })).toBeVisible()
    await expect(nav.getByRole('link', { name: '月度复盘' })).toBeVisible()
  })

  test('空态展示', async ({ page }) => {
    await mockGrowthProfileEmptyData(page)
    await loginAs(page, 'member')
    await page.goto('/growth/profile?year=2026')

    await expect(
      page.getByRole('heading', { name: '成长档案', level: 1 }),
    ).toBeVisible()
    const kpiRegion = page.getByRole('region', { name: '年度成长闭环摘要' })
    await expect(page.getByText(/暂无年度成长计划/)).toBeVisible()
    await expect(page.getByText('计划学习时长')).toBeVisible()
    await expect(kpiRegion.getByText('实际学习时长')).toBeVisible()
  })
})

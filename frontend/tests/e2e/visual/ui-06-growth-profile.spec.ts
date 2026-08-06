import { expect, test } from '@playwright/test'

import { loginAs } from '../fixtures/auth'
import {
  mockGrowthProfileData,
  mockGrowthProfileEmptyData,
} from '../fixtures/growth-profile-mock'

test.use({
  locale: 'zh-CN',
  timezoneId: 'Asia/Shanghai',
})

const VIEWPORTS = [
  { name: '1440x900', width: 1440, height: 900 },
  { name: '1280x800', width: 1280, height: 800 },
] as const

for (const viewport of VIEWPORTS) {
  test.describe(`UI-06 growth profile visual regression @ ${viewport.name}`, () => {
    test.beforeEach(async ({ page }) => {
      await page.setViewportSize(viewport)
      await mockGrowthProfileData(page)
      await loginAs(page, 'member')
      await page.goto('/growth/profile?year=2026')
      await expect(
        page.getByRole('heading', { name: '成长档案', level: 1 }),
      ).toBeVisible()
      await page.evaluate(() => window.scrollTo(0, 0))
    })

    test('semantic alignment', async ({ page }) => {
      const kpiRegion = page.getByRole('region', { name: '年度成长闭环摘要' })
      await expect(kpiRegion.getByText('已完成计划项')).toBeVisible()
      await expect(kpiRegion.getByText('实际学习时长')).toBeVisible()
      await expect(kpiRegion.getByText('已归档任务成果证明')).toBeVisible()
      await expect(kpiRegion.getByText('能力评估')).toBeVisible()
      await expect(page.getByText('计划学习时长')).toBeVisible()
      await expect(page.getByText('计划项完成率')).toBeVisible()
      await expect(
        page.getByRole('region', { name: '年度成长闭环摘要' }),
      ).toBeVisible()
      await expect(
        page.getByRole('article', { name: '计划项：P01-L2A-L3A' }),
      ).toBeVisible()
      await expect(
        page.getByRole('article', { name: '计划项：C01-L2A-L3A' }),
      ).toBeVisible()
      await expect(
        page.getByRole('article', { name: '学习任务：P01-L2A-L3A' }),
      ).toBeVisible()
      await expect(
        page.getByRole('article', { name: '学习任务：C01-L2A-L3A' }),
      ).toBeVisible()
      await expect(
        page.getByRole('article', {
          name: '任务成果证明 版本 1：P01-L2A-L3A',
        }),
      ).toBeVisible()
      await expect(
        page.getByRole('article', {
          name: '任务成果证明 版本 1：C01-L2A-L3A',
        }),
      ).toBeVisible()
      await expect(page.getByText('2026-03-15')).toBeVisible()
      await expect(page.getByText('2026-05-10')).toBeVisible()
      await expect(
        page
          .getByRole('article', { name: '学习任务：P01-L2A-L3A' })
          .getByText('实际 8 小时'),
      ).toBeVisible()
      await expect(
        page
          .getByRole('article', { name: '学习任务：C01-L2A-L3A' })
          .getByText('实际 5 小时'),
      ).toBeVisible()

      // Fixture exposes the complete L2/L3 context alongside test codes.
      await expect(
        page
          .getByText(
            'P01-L2A · Data Infra 产品体系认知 → P01-L2A-L3A · TDC / TDH / ArgoDB / TDS 产品定位',
          )
          .first(),
      ).toBeVisible()
      await expect(
        page
          .getByText('C01-L2A · 办公效率标准 → C01-L2A-L3A · 常用办公工具基础')
          .first(),
      ).toBeVisible()

      // Below-fold DOM verification: scroll to the learning-task region and
      // confirm progress logs / evidence remain in the document at 1280x800.
      const timeline = page.getByRole('region', { name: '学习任务与学习日志' })
      await timeline.scrollIntoViewIfNeeded()
      await expect(
        timeline.getByRole('article', { name: '学习任务：P01-L2A-L3A' }),
      ).toBeVisible()
      await expect(
        timeline.getByRole('article', { name: '学习任务：C01-L2A-L3A' }),
      ).toBeVisible()
      await expect(page.getByText('完成 POC 与文档')).toBeVisible()
      await expect(page.getByText('TDD 练习')).toBeVisible()
    })

    test('default full viewport screenshot', async ({ page }) => {
      await expect(page).toHaveScreenshot(
        `ui-06-growth-profile-${viewport.name}.png`,
        { fullPage: false, maxDiffPixels: 1500 },
      )
    })

    test('empty state screenshot', async ({ page }) => {
      await mockGrowthProfileEmptyData(page)
      await page.goto('/growth/profile?year=2026')
      await expect(
        page.getByRole('heading', { name: '成长档案', level: 1 }),
      ).toBeVisible()
      await expect(page.getByText(/暂无年度成长计划/)).toBeVisible()
      await page.evaluate(() => window.scrollTo(0, 0))
      await expect(page).toHaveScreenshot(
        `ui-06-growth-profile-empty-${viewport.name}.png`,
        { fullPage: false, maxDiffPixels: 1500 },
      )
    })
  })
}

for (const viewport of VIEWPORTS) {
  test.describe(`UI-06 growth profile selector visual regression @ ${viewport.name}`, () => {
    test.beforeEach(async ({ page }) => {
      await page.setViewportSize(viewport)
      await mockGrowthProfileData(page)
    })

    test('Buddy selector expanded screenshot', async ({ page }) => {
      await loginAs(page, 'buddy')
      await page.goto('/growth/profile?year=2026')
      await expect(
        page.getByRole('heading', { name: '成长档案', level: 1 }),
      ).toBeVisible()
      await page.getByLabel('查看成员').click()
      await page.evaluate(() => window.scrollTo(0, 0))
      await expect(page).toHaveScreenshot(
        `ui-06-growth-profile-buddy-selector-${viewport.name}.png`,
        { fullPage: false, maxDiffPixels: 1500 },
      )
    })

    test('Leader selector expanded screenshot', async ({ page }) => {
      await loginAs(page, 'leader')
      await page.goto('/growth/profile?year=2026')
      await expect(
        page.getByRole('heading', { name: '成长档案', level: 1 }),
      ).toBeVisible()
      await page.getByLabel('查看成员').click()
      await page.evaluate(() => window.scrollTo(0, 0))
      await expect(page).toHaveScreenshot(
        `ui-06-growth-profile-leader-selector-${viewport.name}.png`,
        { fullPage: false, maxDiffPixels: 1500 },
      )
    })
  })
}

import { expect, test } from '@playwright/test'

import { loginAs } from '../fixtures/auth'

const VIEWPORTS = [
  { name: '1440x900', width: 1440, height: 900 },
  { name: '1920x1080', width: 1920, height: 1080 },
  { name: '1280x800', width: 1280, height: 800 },
] as const

for (const viewport of VIEWPORTS) {
  test.describe(`UI-03 annual plan visual regression @ ${viewport.name}`, () => {
    test.beforeEach(async ({ page }) => {
      await page.setViewportSize(viewport)
      await loginAs(page, 'member')
      // Pin to 2026: the seed's annual plan lives there; the active-year
      // resolver otherwise follows future-year smoke drafts.
      await page.goto('/growth/annual-plan?year=2026')
      // 真实计划/任务数据下首屏更慢：加载态中页面只渲染「加载中…」，
      // heading 与计划项均在加载结束后才出现。先用 20 秒有界等待加载态
      // 消失（或错误态出现），再断言无 alert、heading 与计划项已渲染。
      // 注意：heading 断言不得放在 poll 之前——5 秒默认门禁正是
      // run 32119821566 的失败点。
      await expect
        .poll(
          async () =>
            (await page.getByText('加载中…').count()) === 0 ||
            (await page.getByRole('alert').count()) > 0,
          { timeout: 20000 },
        )
        .toBeTruthy()
      await expect(page.getByRole('alert')).toHaveCount(0)
      // Issue #194 R5：定版原型 M03 V1 标题/说明。
      await expect(
        page.getByRole('heading', { name: '月度计划时间轴' }),
      ).toBeVisible()
      await expect(page.getByTestId('plan-item')).not.toHaveCount(0)
    })

    test('annual plan and learning-task semantics', async ({ page }) => {
      // Issue #194 R5：定版原型 M03 V1 摘要为任务总数/已完成/进行中/逾期；
      // 原型没有的三筛选区（状态/优先级/能力域）不得出现。
      const summary = page.getByTestId('plan-summary')
      await expect(summary).toContainText('任务总数')
      await expect(summary).toContainText('已完成')
      await expect(summary).toContainText('进行中')
      await expect(summary).toContainText('逾期')
      await expect(summary).not.toContainText('总体进度')
      await expect(summary).not.toContainText('预计时长')
      await expect(page.getByLabel('状态筛选')).toHaveCount(0)
      await expect(page.getByLabel('优先级筛选')).toHaveCount(0)
      await expect(page.getByLabel('能力域筛选')).toHaveCount(0)

      const timeline = page.getByTestId('month-timeline')
      // Issue #194 P1: 12 月横向筛选条由权威原型 M03 V1 纵向月度时间轴
      // 合法替代——仅有计划项的月份渲染月份 marker（不虚构空月业务项），
      // marker 为带 aria-pressed 的按钮（点击切换该月过滤）。
      const markers = timeline.locator('button[aria-pressed]')
      await expect(markers.first()).toBeVisible()
      await expect(timeline).toContainText('月')
      await expect(timeline).toContainText('项')

      const planItems = page.getByTestId('plan-item')
      await expect.poll(async () => planItems.count()).toBeGreaterThan(0)
      // Issue #194 P1 复审修正：全局表头由权威原型 M03 V1 月卡头
      // （标题+项数/状态摘要/aria-expanded）与时间轴节点 i（aria-hidden）
      // 替代。仅结构断言；截图基线不在本轮重新生成。
      const monthHeads = timeline.getByRole('button', { name: /月任务/ })
      await expect(monthHeads.first()).toBeVisible()
      await expect(monthHeads.first()).toHaveAttribute('aria-expanded', 'true')
      await expect(
        timeline.locator('button i[aria-hidden="true"]').first(),
      ).toBeAttached()

      // Issue #194 R5：展开月卡内每个任务行有且仅有一个可访问「进入任务」
      // 链接，指向独立 M05 任务详情；行身份只显示 L3 编码/名称。
      const enterLinks = timeline.getByRole('link', { name: '进入任务' })
      await expect(enterLinks.first()).toBeVisible()
      await expect(enterLinks).toHaveCount(await planItems.count())
      await expect(enterLinks.first()).toHaveAttribute(
        'href',
        /\/growth\/tasks\/\d+\?year=2026$/,
      )
      await expect(
        timeline.getByTestId('plan-header').first(),
      ).not.toHaveAttribute('role', 'button')
    })

    test('annual plan screenshot', async ({ page }) => {
      await expect(page).toHaveScreenshot(
        `ui-03-annual-plan-${viewport.name}.png`,
        { maxDiffPixelRatio: 0.05 },
      )
    })

    test('tasks route exposes independent M04 task-list semantics', async ({
      page,
    }) => {
      await page.goto('/growth/tasks?year=2026')
      await expect(page).toHaveURL(/\/growth\/tasks\?year=2026$/)
      await expect(
        page.getByRole('heading', { name: '学习任务' }),
      ).toBeVisible()
      const filters = page.getByLabel('任务筛选')
      await expect(filters.getByRole('button', { name: '全部' })).toBeVisible()
      await expect(filters.getByLabel('搜索任务')).toBeVisible()
      await expect(filters.getByLabel('筛选月份')).toBeVisible()
      await expect(filters.getByLabel('筛选能力域')).toBeVisible()
      const taskLinks = page.getByRole('link', { name: '进入任务' })
      await expect(taskLinks.first()).toBeVisible()
      await expect(taskLinks.first()).toHaveAttribute(
        'href',
        /\/growth\/tasks\/\d+\?year=2026$/,
      )
    })
  })
}

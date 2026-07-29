import { expect, test } from '@playwright/test'

import { loginAs } from '../fixtures/auth'
import {
  mockBuddyReviewData,
  mockBuddyReviewEmptyData,
} from '../fixtures/buddy-review-mock'

const VIEWPORTS = [
  { name: '1440x900', width: 1440, height: 900 },
  { name: '1920x1080', width: 1920, height: 1080 },
  { name: '1280x800', width: 1280, height: 800 },
] as const

for (const viewport of VIEWPORTS) {
  test.describe(`UI-04 Buddy review center visual regression @ ${viewport.name}`, () => {
    test.beforeEach(async ({ page }) => {
      await page.setViewportSize(viewport)
      await mockBuddyReviewData(page)
      await loginAs(page, 'buddy')
      await page.goto('/mentoring/dashboard')
      await expect(
        page.getByRole('heading', { name: 'Buddy 复核中心' }),
      ).toBeVisible()
      await page.evaluate(() => window.scrollTo(0, 0))
    })

    test('semantic alignment', async ({ page }) => {
      const summary = page.getByLabel('Buddy 待办摘要')
      await expect(summary).toContainText('待复核自评')
      await expect(summary).toContainText('待 Review Evidence')
      await expect(summary).toContainText('本年度已完成 Review')
      await expect(summary).not.toContainText('需跟进')
      await expect(summary).not.toContainText('辅导成员')

      const members = page.locator('.buddy-member-list')
      await expect(
        members.getByRole('heading', { name: '辅导成员' }),
      ).toBeVisible()
      await expect(
        members.getByRole('button', { name: '全部成员' }),
      ).toBeVisible()
      await expect(
        members.getByRole('button', { name: /Member User/ }),
      ).toBeVisible()
      await expect(
        members.getByRole('button', { name: /Member Two/ }),
      ).toBeVisible()
      // The stray comma from a JSX expression must not render as a text node.
      await expect(members.getByText(',')).toHaveCount(0)
      await expect(page.getByText('’')).toHaveCount(0)

      const queue = page.locator('.buddy-queue')
      await expect(
        queue.getByRole('heading', { name: '复核队列' }),
      ).toBeVisible()
      await expect(
        queue.getByRole('tablist', { name: '复核队列类型' }),
      ).toContainText('全部待处理')
      await expect(queue.getByRole('tab', { name: '自评复核' })).toBeVisible()
      await expect(
        queue.getByRole('tab', { name: 'Evidence Review' }),
      ).toBeVisible()

      const workspace = page.locator('.buddy-workspace')
      await expect(
        workspace.getByRole('heading', { name: '复核工作区' }),
      ).toBeVisible()
      await expect(workspace).toContainText(
        '标准 3；个人调整 4（岗位项目要求）',
      )
      await expect(workspace).toContainText(
        '目标职级 P6 要求：能够负责复杂场景',
      )
      await expect(workspace).toContainText('三级达成路径：P01.01.01')
    })

    test('default all members screenshot', async ({ page }) => {
      const filename =
        viewport.name === '1280x800'
          ? 'ui-04-buddy-review-center-top-1280x800.png'
          : `ui-04-buddy-review-center-default-${viewport.name}.png`
      await expect(page).toHaveScreenshot(filename, {
        fullPage: false,
        maxDiffPixelRatio: 0.05,
      })
    })

    test('single member selected screenshot', async ({ page }) => {
      await page
        .locator('.buddy-member-list')
        .getByRole('button', { name: /Member Two/ })
        .click()
      await expect(
        page
          .locator('.buddy-member-list .active')
          .filter({ hasText: 'Member Two' }),
      ).toBeVisible()
      await page.evaluate(() => window.scrollTo(0, 0))
      await expect(page).toHaveScreenshot(
        `ui-04-buddy-review-center-member-selected-${viewport.name}.png`,
        { fullPage: false, maxDiffPixelRatio: 0.05 },
      )
    })

    test('assessment conclusion selected screenshot', async ({ page }) => {
      await page.getByLabel('建议调整').check()
      await page.getByLabel('反馈').fill('请补充更多自评依据并细化 Gap 说明。')
      await page.evaluate(() => window.scrollTo(0, 0))
      await expect(page).toHaveScreenshot(
        `ui-04-buddy-review-center-assessment-${viewport.name}.png`,
        { fullPage: false, maxDiffPixelRatio: 0.05 },
      )
    })

    test('evidence 需补充 with feedback screenshot', async ({ page }) => {
      await page.getByRole('tab', { name: 'Evidence Review' }).click()
      await expect(page.locator('.buddy-workspace')).toContainText(
        'Evidence 版本 1',
      )
      await page.getByLabel('需补充').check()
      await page.getByLabel('反馈').fill('请补充数据质量监控截图与运行日志。')
      await page.evaluate(() => window.scrollTo(0, 0))
      await expect(page).toHaveScreenshot(
        `ui-04-buddy-review-center-evidence-${viewport.name}.png`,
        { fullPage: false, maxDiffPixelRatio: 0.05 },
      )
    })

    test('history screenshot', async ({ page }) => {
      // Evidence tab shows a closed history list that proves read-only state.
      await page.getByRole('tab', { name: 'Evidence Review' }).click()
      await expect(page.locator('.buddy-workspace')).toContainText(
        '反馈历史（只读）',
      )
      // Scope to the history list under "反馈历史（只读）" heading, not the workspace-wide compact-list
      const historyList = page
        .locator('.buddy-workspace h3', { hasText: '反馈历史（只读）' })
        .locator('+ ul.compact-list')
      await expect(historyList).toBeVisible()
      // Auto-waiting: mock returns exactly 3 history records
      await expect(historyList.locator('li')).toHaveCount(3)
      await expect(historyList.locator('li').first()).toContainText(
        'Evidence 充分，通过。',
      )
      if (viewport.name === '1280x800') {
        await historyList.locator('li').first().scrollIntoViewIfNeeded()
      }
      const filename =
        viewport.name === '1280x800'
          ? 'ui-04-buddy-review-center-history-scrolled-1280x800.png'
          : `ui-04-buddy-review-center-history-${viewport.name}.png`
      await expect(page).toHaveScreenshot(filename, {
        fullPage: false,
        maxDiffPixelRatio: 0.05,
      })
    })
  })
}

test.describe('UI-04 Buddy review center empty state', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    await mockBuddyReviewEmptyData(page)
    await loginAs(page, 'buddy')
    await page.goto('/mentoring/dashboard')
    await expect(
      page.getByRole('heading', { name: 'Buddy 复核中心' }),
    ).toBeVisible()
    await page.evaluate(() => window.scrollTo(0, 0))
  })

  test('empty queue semantic alignment', async ({ page }) => {
    const queue = page.locator('.buddy-queue')
    await expect(queue).toContainText('当前范围暂无待处理项。')

    const workspace = page.locator('.buddy-workspace')
    await expect(workspace).toContainText(
      '选择一项待复核内容后查看依据和历史反馈。',
    )
  })

  test('empty queue screenshot', async ({ page }) => {
    await expect(page).toHaveScreenshot('ui-04-buddy-review-center-empty.png', {
      fullPage: false,
      maxDiffPixels: 1000,
    })
  })
})

test.describe('UI-04 Buddy review center permission boundary', () => {
  test('hides queue items outside the Buddy assignment', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    await mockBuddyReviewEmptyData(page)
    await page.route(
      '/api/planning/evidence-reviews/pending',
      async (route) => {
        await route.fulfill({
          status: 200,
          body: JSON.stringify([
            {
              id: 999,
              evidence_id: 999,
              version_number: 1,
              status: '待 Review',
              conclusion: null,
              feedback: null,
              reviewed_at: null,
              member_id: 99,
              username: 'unassigned',
              learning_task_id: 999,
              l3_code: 'P01.01.01',
              content: '不属于当前 Buddy 的 evidence',
            },
          ]),
        })
      },
    )
    await loginAs(page, 'buddy')
    await page.goto('/mentoring/dashboard')
    await expect(
      page.getByRole('heading', { name: 'Buddy 复核中心' }),
    ).toBeVisible()
    await expect(page.getByText('当前范围暂无待处理项。')).toBeVisible()
    await expect(page.locator('.buddy-workspace')).toContainText(
      '选择一项待复核内容后查看依据和历史反馈。',
    )
    await expect(
      page
        .locator('.buddy-summary button')
        .filter({ hasText: '待 Review Evidence' }),
    ).toContainText('0')
    await expect(page.locator('text=不属于当前 Buddy 的 evidence')).toHaveCount(
      0,
    )
  })
})

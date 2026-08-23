import { expect, test } from '@playwright/test'

import { loginAs } from '../fixtures/auth'
import {
  mockBuddyReviewData,
  mockBuddyReviewEmptyData,
} from '../fixtures/buddy-review-mock'

const VIEWPORTS = [
  { name: '1440x900', width: 1440, height: 900 },
  { name: '1024x800', width: 1024, height: 800 },
  { name: '768x900', width: 768, height: 900 },
] as const

for (const viewport of VIEWPORTS) {
  test.describe(`UI-04 legacy buddy route redirect compat @ ${viewport.name}`, () => {
    test.beforeEach(async ({ page }) => {
      await page.setViewportSize(viewport)
      await mockBuddyReviewData(page)
      await loginAs(page, 'buddy')
      // Issue #194: the Buddy Review Center is retired. The legacy route
      // must land on the standalone evidence review surface.
      await page.goto('/mentoring/dashboard')
      await page.waitForURL(
        (url) => url.pathname === '/mentoring/evidence-review',
      )
      await expect(
        page.getByRole('heading', { name: '成果验收' }),
      ).toBeVisible()
      await page.evaluate(() => window.scrollTo(0, 0))
    })

    test('legacy route: retired review-center surfaces never render', async ({
      page,
    }) => {
      // None of the retired assessment-review workspace surfaces survive
      // behind the redirect: no old summary, member list, queue tabs,
      // workspace copy, or the dead first-approval auto-generation notice.
      await expect(
        page.getByRole('heading', { name: 'Buddy 复核中心' }),
      ).toHaveCount(0)
      await expect(page.getByText('待复核自评')).toHaveCount(0)
      await expect(page.getByRole('tab', { name: '自评复核' })).toHaveCount(0)
      await expect(
        page.getByRole('button', { name: '提交复核反馈' }),
      ).toHaveCount(0)
      await expect(
        page.getByText('首次认可将原子生成正式年度计划'),
      ).toHaveCount(0)
      await expect(page.getByText('适用 3')).toHaveCount(0)

      // The evidence review surface is exactly what the legacy entry point
      // yields: queue + workspace on the standalone page.
      const queue = page.locator('.buddy-member-list')
      await expect(
        queue.getByRole('heading', { name: '待办队列' }),
      ).toBeVisible()
      await expect(
        queue.getByRole('button', { name: /^待验收 member / }),
      ).toBeVisible()
      await expect(queue.getByRole('button')).toHaveCount(3)
      const workspace = page.locator('.buddy-workspace')
      await expect(
        workspace.getByRole('button', { name: '提交验收结果' }),
      ).toBeVisible()
      // No stray comma / curly-quote text nodes in the queue list.
      await expect(queue.getByText(',')).toHaveCount(0)
      await expect(queue.getByText('’')).toHaveCount(0)
      // No page-level horizontal overflow at any viewport.
      const dims = await page.evaluate(() => ({
        docScrollWidth: document.documentElement.scrollWidth,
        bodyScrollWidth: document.body.scrollWidth,
        innerWidth: window.innerWidth,
      }))
      expect(dims.docScrollWidth).toBeLessThanOrEqual(dims.innerWidth)
      expect(dims.bodyScrollWidth).toBeLessThanOrEqual(dims.innerWidth)
    })

    test('layout integrity after redirect: submit unobstructed and clickable', async ({
      page,
    }) => {
      // Same layout guarantee as the retired review center: the submit action
      // is reachable, in viewport, and not covered by any sticky/overlay
      // element — now on the redirect target's workspace.
      const submit = page.getByRole('button', { name: '提交验收结果' })
      await expect(submit).toBeVisible()
      await submit.scrollIntoViewIfNeeded()
      await expect(submit).toBeInViewport()
      const box = await submit.boundingBox()
      expect(box).not.toBeNull()
      expect(box!.width).toBeGreaterThan(0)
      expect(box!.height).toBeGreaterThan(0)
      const coveredBy = await page.evaluate(
        ([x, y]) => {
          const el = document.elementFromPoint(x, y)
          if (!el) return 'none'
          let node: HTMLElement | null = el as HTMLElement
          while (node) {
            if (node.tagName === 'BUTTON') return node.textContent ?? ''
            node = node.parentElement
          }
          return `${el.tagName}.${(el.className ?? '').toString().slice(0, 40)}`
        },
        [box!.x + box!.width / 2, box!.y + box!.height / 2],
      )
      expect(coveredBy).toContain('提交验收结果')
      // The feedback field is part of the submit area and is not clipped.
      await expect(page.getByLabel('反馈建议').first()).toBeVisible()
      // The page itself never overflows horizontally.
      const pageDims = await page.evaluate(() => ({
        docScrollWidth: document.documentElement.scrollWidth,
        bodyScrollWidth: document.body.scrollWidth,
        innerWidth: window.innerWidth,
      }))
      expect(pageDims.docScrollWidth).toBeLessThanOrEqual(pageDims.innerWidth)
      expect(pageDims.bodyScrollWidth).toBeLessThanOrEqual(pageDims.innerWidth)
    })

    test('redirected default screenshot', async ({ page }) => {
      await expect(page).toHaveScreenshot(
        `ui-04-legacy-dashboard-redirect-${viewport.name}.png`,
        { fullPage: false, maxDiffPixelRatio: 0.05 },
      )
    })

    test('redirected queue item selected screenshot', async ({ page }) => {
      await page
        .locator('.buddy-member-list')
        .getByRole('button', { name: /^待验收 member / })
        .click()
      await expect(
        page
          .locator('.buddy-member-list .active')
          .filter({ hasText: 'member' }),
      ).toBeVisible()
      await page.evaluate(() => window.scrollTo(0, 0))
      await expect(page).toHaveScreenshot(
        `ui-04-legacy-dashboard-redirect-member-selected-${viewport.name}.png`,
        { fullPage: false, maxDiffPixelRatio: 0.05 },
      )
    })

    test('redirected conclusion selected screenshot', async ({ page }) => {
      await page.getByRole('radio', { name: '通过' }).check()
      await page.evaluate(() => window.scrollTo(0, 0))
      await expect(page).toHaveScreenshot(
        `ui-04-legacy-dashboard-redirect-conclusion-${viewport.name}.png`,
        { fullPage: false, maxDiffPixelRatio: 0.05 },
      )
    })
  })
}

for (const viewport of VIEWPORTS) {
  test.describe(`UI-04 Buddy evidence review (standalone page) @ ${viewport.name}`, () => {
    test.beforeEach(async ({ page }) => {
      await page.setViewportSize(viewport)
      await mockBuddyReviewData(page)
      await loginAs(page, 'buddy')
      await page.goto('/mentoring/evidence-review')
      await expect(
        page.getByRole('heading', { name: '成果验收' }),
      ).toBeVisible()
      await page.evaluate(() => window.scrollTo(0, 0))
    })

    test('semantic alignment and queue isolation', async ({ page }) => {
      const summary = page.getByLabel('验收概览')
      await expect(summary).toContainText('待验收')
      await expect(summary).toContainText('3')
      await expect(summary).toContainText('需补充')
      await expect(summary).toContainText('1')
      await expect(summary).toContainText('本月通过')
      await expect(summary).toContainText('8')
      await expect(summary).toContainText('平均响应')
      await expect(summary).toContainText('1.2 天')
      const queue = page.locator('.buddy-member-list')
      await expect(
        queue.getByRole('heading', { name: '待办队列' }),
      ).toBeVisible()
      // The pending evidence from the assigned member is the queue item:
      // member + version + capability code, stable accessible button name.
      const item = queue.getByRole('button', { name: /^待验收 member / })
      await expect(item).toBeVisible()
      await expect(item).toContainText('待验收')
      await expect(item).toContainText('数据管道基础')
      await expect(queue.getByRole('button')).toHaveCount(3)
      await expect(queue.locator('.review-queue-status.red')).toHaveText(
        '补充后重提',
      )

      const workspace = page.locator('.buddy-workspace')
      await expect(workspace).toContainText('成果 v1')
      await expect(workspace).toContainText('完成数据管道基础文档与示例代码。')
      await expect(
        workspace.getByRole('link', { name: '查看任务成果证明链接' }),
      ).toBeVisible()
      await expect(workspace.getByRole('radio', { name: '通过' })).toBeVisible()
      await expect(
        workspace.getByRole('radio', { name: '需补充' }),
      ).toBeVisible()
      await expect(workspace.getByLabel('反馈建议')).toBeVisible()
      await expect(
        workspace.getByRole('button', { name: '提交验收结果' }),
      ).toBeVisible()
      // Immutable review history for the selected evidence version.
      await expect(
        workspace.getByRole('heading', { name: '历史反馈（只读）' }),
      ).toBeVisible()

      // Isolation: assessment-review surfaces never leak onto the
      // evidence page.
      await expect(
        page.getByRole('heading', { name: 'Buddy 复核中心' }),
      ).toHaveCount(0)
      await expect(page.getByText('待复核自评')).toHaveCount(0)
      await expect(page.getByRole('tab', { name: '自评复核' })).toHaveCount(0)
      await expect(
        page.getByRole('button', { name: '提交复核反馈' }),
      ).toHaveCount(0)
      await expect(
        page.getByText('首次认可将原子生成正式年度计划'),
      ).toHaveCount(0)

      // No page-level horizontal overflow at any viewport.
      const dims = await page.evaluate(() => ({
        docScrollWidth: document.documentElement.scrollWidth,
        bodyScrollWidth: document.body.scrollWidth,
        innerWidth: window.innerWidth,
        docHeight: document.documentElement.scrollHeight,
        clientHeight: document.documentElement.clientHeight,
      }))
      expect(dims.docScrollWidth).toBeLessThanOrEqual(dims.innerWidth)
      expect(dims.bodyScrollWidth).toBeLessThanOrEqual(dims.innerWidth)
      // If the content overflows the viewport vertically it must actually
      // scroll (nothing is clipped by a fixed-height container).
      if (dims.docHeight > dims.clientHeight) {
        await page.evaluate(() =>
          window.scrollTo(0, document.body.scrollHeight),
        )
        const scrolled = await page.evaluate(() => window.scrollY > 0)
        expect(scrolled).toBe(true)
        await page.evaluate(() => window.scrollTo(0, 0))
      }
    })

    test('layout integrity: submit area unobstructed and clickable', async ({
      page,
    }) => {
      const submit = page.getByRole('button', { name: '提交验收结果' })
      await expect(submit).toBeVisible()
      await submit.scrollIntoViewIfNeeded()
      await expect(submit).toBeInViewport()
      const box = await submit.boundingBox()
      expect(box).not.toBeNull()
      expect(box!.width).toBeGreaterThan(0)
      expect(box!.height).toBeGreaterThan(0)
      const coveredBy = await page.evaluate(
        ([x, y]) => {
          const el = document.elementFromPoint(x, y)
          if (!el) return 'none'
          let node: HTMLElement | null = el as HTMLElement
          while (node) {
            if (node.tagName === 'BUTTON') return node.textContent ?? ''
            node = node.parentElement
          }
          return `${el.tagName}.${(el.className ?? '').toString().slice(0, 40)}`
        },
        [box!.x + box!.width / 2, box!.y + box!.height / 2],
      )
      expect(coveredBy).toContain('提交验收结果')
      // The feedback field is part of the submit area and is not clipped.
      await expect(page.getByLabel('反馈建议')).toBeVisible()
    })

    test('需补充 requires feedback, then screenshot', async ({ page }) => {
      await page.getByRole('radio', { name: '需补充' }).check()
      // Client gate: 需补充 without feedback is refused before any write.
      await page.getByRole('button', { name: '提交验收结果' }).click()
      await expect(page.getByRole('alert')).toContainText(
        '需补充必须填写反馈。',
      )
      await page
        .getByLabel('反馈建议')
        .fill('请补充数据质量监控截图与运行日志。')
      await page.evaluate(() => window.scrollTo(0, 0))
      await expect(page).toHaveScreenshot(
        `ui-04-evidence-review-needs-supplement-${viewport.name}.png`,
        { fullPage: false, maxDiffPixelRatio: 0.05 },
      )
    })

    test('immutable history screenshot', async ({ page }) => {
      // The closed history list is read-only: version + conclusion records
      // only, no write controls.
      const historyList = page.locator(
        '.buddy-workspace .review-history .compact-list',
      )
      await expect(historyList).toBeVisible()
      // Auto-waiting: the default visual state keeps one legal history row.
      await expect(historyList.locator('li')).toHaveCount(1)
      await expect(historyList.locator('li').first()).toContainText(
        'Evidence 充分，通过。',
      )
      await expect(
        historyList.locator('button, input, textarea, select'),
      ).toHaveCount(0)
      if (viewport.name === '768x900') {
        await historyList.locator('li').first().scrollIntoViewIfNeeded()
      }
      const filename =
        viewport.name === '768x900'
          ? 'ui-04-evidence-review-history-scrolled-768x900.png'
          : `ui-04-evidence-review-history-${viewport.name}.png`
      await expect(page).toHaveScreenshot(filename, {
        fullPage: false,
        maxDiffPixelRatio: 0.05,
      })
    })
  })
}

test.describe('UI-04 legacy buddy route empty state', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    await mockBuddyReviewEmptyData(page)
    await loginAs(page, 'buddy')
    await page.goto('/mentoring/dashboard')
    await page.waitForURL(
      (url) => url.pathname === '/mentoring/evidence-review',
    )
    await expect(page.getByRole('heading', { name: '成果验收' })).toBeVisible()
    await page.evaluate(() => window.scrollTo(0, 0))
  })

  test('legacy route redirects to the empty evidence page', async ({
    page,
  }) => {
    // The retired review center has no empty state of its own anymore: the
    // legacy entry point lands on the standalone evidence page, which owns
    // the empty state.
    await expect(page.getByText('暂无待验收成果。')).toBeVisible()
    await expect(
      page.getByRole('heading', { name: 'Buddy 复核中心' }),
    ).toHaveCount(0)
    await expect(page.locator('.buddy-member-list')).toHaveCount(1)
    await expect(page.locator('.buddy-workspace')).toHaveCount(1)
  })

  test('empty queue screenshot', async ({ page }) => {
    await expect(page).toHaveScreenshot(
      'ui-04-legacy-dashboard-redirect-empty-1440x900.png',
      {
        fullPage: false,
        maxDiffPixels: 1000,
      },
    )
  })

  test('evidence page shows its own empty state', async ({ page }) => {
    await page.goto('/mentoring/evidence-review')
    await expect(page.getByRole('heading', { name: '成果验收' })).toBeVisible()
    // Queue and workspace stay mounted so the empty state does not collapse
    // the B01 page hierarchy.
    await expect(page.getByText('暂无待验收成果。')).toBeVisible()
    await expect(page.locator('.buddy-member-list')).toHaveCount(1)
    await expect(page.locator('.buddy-workspace')).toHaveCount(1)
  })
})

test.describe('UI-04 Buddy evidence review loading and error states', () => {
  test('loading state renders before the queue arrives', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    await mockBuddyReviewData(page)
    // Override the pending route: delay the response so the loading state is
    // observable, then deliver the same queue.
    await page.route(
      '/api/planning/evidence-reviews/pending',
      async (route) => {
        await new Promise((resolve) => setTimeout(resolve, 700))
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify([
            {
              id: 301,
              evidence_id: 401,
              version_number: 1,
              status: '待 Review',
              conclusion: null,
              feedback: null,
              reviewed_at: null,
              created_at: '2026-07-19T10:00:00+08:00',
              submitted_at: '2026-07-19T10:00:00+08:00',
              member_id: 3,
              username: 'member',
              learning_task_id: 501,
              l3_code: 'P01.01.01',
              l2_code: 'P01.01',
              l2_name: '数据基础',
              l3_name: '数据管道基础',
              content: '完成数据管道基础文档与示例代码。',
              evidence_link: 'https://example.invalid/tcp-demo-evidence',
              queue_status: '待验收',
            },
          ]),
        })
      },
    )
    await loginAs(page, 'buddy')
    await page.goto('/mentoring/evidence-review')
    await expect(page.getByText('加载中…')).toBeVisible()
    await expect(page.getByRole('heading', { name: '成果验收' })).toBeVisible()
    await expect(
      page.locator('.buddy-member-list').getByRole('button', {
        name: /^待验收 member /,
      }),
    ).toBeVisible()
    await expect(page.getByText('加载中…')).toHaveCount(0)
  })

  test('server error surfaces on the evidence queue', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    await mockBuddyReviewData(page)
    await page.route(
      '/api/planning/evidence-reviews/pending',
      async (route) => {
        await route.fulfill({
          status: 500,
          contentType: 'application/json',
          body: JSON.stringify({ detail: '服务器暂时不可用' }),
        })
      },
    )
    await loginAs(page, 'buddy')
    await page.goto('/mentoring/evidence-review')
    await expect(page.getByRole('alert')).toContainText('服务器暂时不可用')
  })
})

test.describe('UI-04 Buddy review permission boundary (legacy route + evidence)', () => {
  test('legacy dashboard redirect: evidence feed is the single queue surface', async ({
    page,
  }) => {
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
              queue_status: '待验收',
            },
          ]),
        })
      },
    )
    await loginAs(page, 'buddy')
    await page.goto('/mentoring/dashboard')
    await page.waitForURL(
      (url) => url.pathname === '/mentoring/evidence-review',
    )
    await expect(page.getByRole('heading', { name: '成果验收' })).toBeVisible()
    // The evidence feed has exactly one consumer — the standalone queue —
    // rendered verbatim; member scoping is enforced by the Buddy-only
    // backend endpoint, never duplicated or leaked by another surface.
    await expect(
      page.locator('.buddy-member-list').getByRole('button', {
        name: /^待验收 unassigned /,
      }),
    ).toBeVisible()
    // The retired assessment-review surfaces are gone entirely.
    await expect(
      page.getByRole('heading', { name: 'Buddy 复核中心' }),
    ).toHaveCount(0)
    await expect(page.getByText('待复核自评')).toHaveCount(0)
  })

  test('expired review permission: 403 keeps the item, no fake success', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    await mockBuddyReviewData(page)
    await page.route('/api/planning/evidences/301/review', async (route) => {
      await route.fulfill({
        status: 403,
        contentType: 'application/json',
        body: JSON.stringify({ detail: 'current buddy relationship invalid' }),
      })
    })
    await loginAs(page, 'buddy')
    await page.goto('/mentoring/evidence-review')
    await expect(
      page.locator('.buddy-member-list').getByRole('button', {
        name: /^待验收 member /,
      }),
    ).toBeVisible()
    await page.getByRole('radio', { name: '通过' }).check()
    await page.getByRole('button', { name: '提交验收结果' }).click()
    await expect(page.getByRole('alert')).toContainText(
      '当前有效辅导关系不存在或已失效，无法评审该成果。',
    )
    // The item stays in the queue for review once access is restored.
    await expect(
      page.locator('.buddy-member-list').getByRole('button', {
        name: /^待验收 member /,
      }),
    ).toBeVisible()
    await expect(page.locator('.buddy-member-list button')).toHaveCount(3)
  })
})

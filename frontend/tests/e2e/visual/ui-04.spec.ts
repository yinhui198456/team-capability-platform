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
  test.describe(`UI-04 Buddy board (member overview) @ ${viewport.name}`, () => {
    test.beforeEach(async ({ page }) => {
      await page.setViewportSize(viewport)
      await mockBuddyReviewData(page)
      await loginAs(page, 'buddy')
      await page.goto('/mentoring/dashboard')
      await expect(
        page.getByRole('heading', { name: '辅导成员看板' }),
      ).toBeVisible()
      await page.evaluate(() => window.scrollTo(0, 0))
    })

    test('semantic alignment: member overview + evidence entry, no review queue', async ({
      page,
    }) => {
      await expect(page.getByText('Buddy 工作台')).toBeVisible()
      await expect(
        page.getByText(
          '按负责成员查看学习进展，对成员提交的成果与证据进行验收复核。',
        ),
      ).toBeVisible()

      const members = page.locator('.buddy-member-list')
      await expect(
        members.getByRole('heading', { name: '辅导成员' }),
      ).toBeVisible()
      const rows = members.locator('.member-row')
      await expect(rows).toHaveCount(2)
      await expect(rows.first()).toContainText('Member User')
      await expect(rows.first()).toContainText('member')
      await expect(rows.nth(1)).toContainText('Member Two')
      await expect(rows.nth(1)).toContainText('member2')
      // no stray comma or apostrophe text nodes from JSX expressions
      await expect(members.getByText(',')).toHaveCount(0)
      await expect(page.getByText('’')).toHaveCount(0)

      const entry = page.locator('.buddy-evidence-entry')
      await expect(
        entry.getByRole('heading', { name: '待验收成果' }),
      ).toBeVisible()
      const link = entry.getByRole('link', { name: '前往成果验收' })
      await expect(link).toBeVisible()
      await expect(link).toHaveAttribute('href', '/mentoring/evidence-review')
      // Isolation: the assessment-review workspace and queue are gone.
      await expect(page.getByText('复核队列')).toHaveCount(0)
      await expect(page.getByText('待复核自评')).toHaveCount(0)
      await expect(
        page.getByRole('button', { name: '提交复核反馈' }),
      ).toHaveCount(0)
      await expect(
        page.getByText('首次认可将原子生成正式年度计划'),
      ).toHaveCount(0)
    })

    test('layout integrity: no overflow, evidence entry unobstructed', async ({
      page,
    }) => {
      const dims = await page.evaluate(() => ({
        docScrollWidth: document.documentElement.scrollWidth,
        bodyScrollWidth: document.body.scrollWidth,
        innerWidth: window.innerWidth,
      }))
      expect(dims.docScrollWidth).toBeLessThanOrEqual(dims.innerWidth)
      expect(dims.bodyScrollWidth).toBeLessThanOrEqual(dims.innerWidth)
      await expect(page.locator('.buddy-member-list')).toBeVisible()
      await expect(page.locator('.buddy-evidence-entry')).toBeVisible()
      // the entry link stays reachable and is not covered by any overlay
      const link = page.getByRole('link', { name: '前往成果验收' })
      await link.scrollIntoViewIfNeeded()
      await expect(link).toBeInViewport()
      const box = await link.boundingBox()
      expect(box).not.toBeNull()
      expect(box!.width).toBeGreaterThan(0)
      expect(box!.height).toBeGreaterThan(0)
      const coveredBy = await page.evaluate(
        ([x, y]) => {
          const el = document.elementFromPoint(x, y)
          if (!el) return 'none'
          let node: HTMLElement | null = el as HTMLElement
          while (node) {
            if (node.tagName === 'A') return node.textContent ?? ''
            node = node.parentElement
          }
          return `${el.tagName}.${(el.className ?? '').toString().slice(0, 40)}`
        },
        [box!.x + box!.width / 2, box!.y + box!.height / 2],
      )
      expect(coveredBy).toContain('前往成果验收')
    })

    test('default board screenshot', async ({ page }) => {
      await expect(page).toHaveScreenshot(
        `ui-04-buddy-board-default-${viewport.name}.png`,
        { fullPage: false, maxDiffPixelRatio: 0.05 },
      )
    })

    test('evidence review entry stays reachable from the board', async ({
      page,
    }) => {
      await page.getByRole('link', { name: '前往成果验收' }).click()
      await expect(page).toHaveURL(/\/mentoring\/evidence-review$/)
      await expect(
        page.getByRole('heading', { name: '待验收成果' }),
      ).toBeVisible()
      await expect(
        page
          .locator('.buddy-member-list')
          .getByRole('button', { name: /^member / }),
      ).toBeVisible()
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
        page.getByRole('heading', { name: '待验收成果' }),
      ).toBeVisible()
      await page.evaluate(() => window.scrollTo(0, 0))
    })

    test('semantic alignment and queue isolation', async ({ page }) => {
      const queue = page.locator('.buddy-member-list')
      await expect(
        queue.getByRole('heading', { name: '待验收队列' }),
      ).toBeVisible()
      // The pending evidence from the assigned member is the queue item:
      // member + version + capability code, stable accessible button name.
      const item = queue.getByRole('button', { name: /^member / })
      await expect(item).toBeVisible()
      await expect(item).toContainText('版本 1')
      await expect(item).toContainText('P01.01.01')

      const workspace = page.locator('.buddy-workspace')
      await expect(
        workspace.getByRole('heading', { name: '验收工作区' }),
      ).toBeVisible()
      await expect(workspace).toContainText('任务成果证明 版本 1')
      await expect(workspace).toContainText('完成数据管道基础文档与示例代码。')
      await expect(
        workspace.getByRole('link', { name: '查看任务成果证明链接' }),
      ).toBeVisible()
      await expect(workspace.getByRole('radio', { name: '通过' })).toBeVisible()
      await expect(
        workspace.getByRole('radio', { name: '需补充' }),
      ).toBeVisible()
      await expect(workspace.getByLabel('反馈')).toBeVisible()
      await expect(
        workspace.getByRole('button', { name: '提交评审结论' }),
      ).toBeVisible()
      // Immutable review history for the selected evidence version.
      await expect(
        workspace.getByRole('heading', { name: '历史版本与评审（只读）' }),
      ).toBeVisible()

      // Isolation: assessment-review surfaces never leak onto the
      // evidence page.
      await expect(
        page.getByRole('heading', { name: '辅导成员看板' }),
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
      const submit = page.getByRole('button', { name: '提交评审结论' })
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
      expect(coveredBy).toContain('提交评审结论')
      // The feedback field is part of the submit area and is not clipped.
      await expect(page.getByLabel('反馈')).toBeVisible()
    })

    test('需补充 requires feedback, then screenshot', async ({ page }) => {
      await page.getByRole('radio', { name: '需补充' }).check()
      // Client gate: 需补充 without feedback is refused before any write.
      await page.getByRole('button', { name: '提交评审结论' }).click()
      await expect(page.getByRole('alert')).toContainText(
        '需补充必须填写反馈。',
      )
      await page.getByLabel('反馈').fill('请补充数据质量监控截图与运行日志。')
      await page.evaluate(() => window.scrollTo(0, 0))
      await expect(page).toHaveScreenshot(
        `ui-04-evidence-review-needs-supplement-${viewport.name}.png`,
        { fullPage: false, maxDiffPixelRatio: 0.05 },
      )
    })

    test('immutable history screenshot', async ({ page }) => {
      // The closed history list is read-only: version + conclusion records
      // only, no write controls.
      const historyList = page
        .locator('.buddy-workspace h3', { hasText: '历史版本与评审（只读）' })
        .locator('+ ul.compact-list')
      await expect(historyList).toBeVisible()
      // Auto-waiting: mock returns exactly 3 closed review records.
      await expect(historyList.locator('li')).toHaveCount(3)
      await expect(historyList.locator('li').first()).toContainText(
        'Evidence 充分，通过。',
      )
      await expect(
        historyList.locator('button, input, textarea, select'),
      ).toHaveCount(0)
      if (viewport.name === '1280x800') {
        await historyList.locator('li').first().scrollIntoViewIfNeeded()
      }
      const filename =
        viewport.name === '1280x800'
          ? 'ui-04-evidence-review-history-scrolled-1280x800.png'
          : `ui-04-evidence-review-history-${viewport.name}.png`
      await expect(page).toHaveScreenshot(filename, {
        fullPage: false,
        maxDiffPixelRatio: 0.05,
      })
    })
  })
}

test.describe('UI-04 Buddy board empty state', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    await mockBuddyReviewEmptyData(page)
    await loginAs(page, 'buddy')
    await page.goto('/mentoring/dashboard')
    await expect(
      page.getByRole('heading', { name: '辅导成员看板' }),
    ).toBeVisible()
    await page.evaluate(() => window.scrollTo(0, 0))
  })

  test('board keeps the member overview and the evidence entry', async ({
    page,
  }) => {
    await expect(page.locator('.buddy-member-list .member-row')).toHaveCount(1)
    await expect(
      page.locator('.buddy-member-list .member-row').first(),
    ).toContainText('Member User')
    await expect(
      page.getByRole('heading', { name: '待验收成果' }),
    ).toBeVisible()
    // no evidence queue or assessment-review surface on the board
    await expect(page.getByText('暂无待验收成果。')).toHaveCount(0)
    await expect(page.getByText('当前范围暂无待处理项。')).toHaveCount(0)
    await expect(
      page.getByText('选择一项待复核内容后查看依据和历史反馈。'),
    ).toHaveCount(0)
  })

  test('empty board screenshot', async ({ page }) => {
    await expect(page).toHaveScreenshot('ui-04-buddy-board-empty.png', {
      fullPage: false,
      maxDiffPixels: 1000,
    })
  })

  test('evidence page shows its own empty state', async ({ page }) => {
    await page.goto('/mentoring/evidence-review')
    await expect(
      page.getByRole('heading', { name: '待验收成果' }),
    ).toBeVisible()
    // The empty queue replaces the whole workspace layout with a single
    // message — no queue sidebar, no workspace hint.
    await expect(page.getByText('暂无待验收成果。')).toBeVisible()
    await expect(page.locator('.buddy-member-list')).toHaveCount(0)
    await expect(page.locator('.buddy-workspace')).toHaveCount(0)
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
            },
          ]),
        })
      },
    )
    await loginAs(page, 'buddy')
    await page.goto('/mentoring/evidence-review')
    await expect(page.getByText('加载中…')).toBeVisible()
    await expect(
      page.getByRole('heading', { name: '待验收成果' }),
    ).toBeVisible()
    await expect(
      page.locator('.buddy-member-list').getByRole('button', {
        name: /^member /,
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

test.describe('UI-04 Buddy board permission boundary', () => {
  test('evidence queue data never leaks onto the board', async ({ page }) => {
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
      page.getByRole('heading', { name: '辅导成员看板' }),
    ).toBeVisible()
    // The evidence pending feed is consumed only by the standalone page:
    // nothing from it renders on the board.
    await expect(page.getByText('不属于当前 Buddy 的 evidence')).toHaveCount(0)
    await expect(page.getByText('待复核自评')).toHaveCount(0)
    await expect(
      page.getByRole('button', { name: '提交复核反馈' }),
    ).toHaveCount(0)
    // The standalone page does render the routed feed.
    await page.goto('/mentoring/evidence-review')
    await expect(
      page
        .locator('.buddy-member-list')
        .getByRole('button', { name: /^unassigned/ }),
    ).toBeVisible()
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
        name: /^member /,
      }),
    ).toBeVisible()
    await page.getByRole('radio', { name: '通过' }).check()
    await page.getByRole('button', { name: '提交评审结论' }).click()
    await expect(page.getByRole('alert')).toContainText(
      '当前有效辅导关系不存在或已失效，无法评审该成果。',
    )
    // The item stays in the queue for review once access is restored.
    await expect(
      page.locator('.buddy-member-list').getByRole('button', {
        name: /^member /,
      }),
    ).toBeVisible()
    await expect(page.locator('.buddy-member-list button')).toHaveCount(1)
  })
})

import { expect, test, type Page } from '@playwright/test'

import { loginAs } from '../fixtures/auth'
import {
  mockBuddyReviewData,
  mockEvidenceReviewWorkspace,
} from '../fixtures/buddy-review-mock'

const VIEWPORTS = [
  { name: '1440x900', width: 1440, height: 900 },
  { name: '1024x768', width: 1024, height: 768 },
  { name: '768x900', width: 768, height: 900 },
] as const

async function openEvidenceReview(page: Page) {
  await mockBuddyReviewData(page)
  await mockEvidenceReviewWorkspace(page)
  await loginAs(page, 'buddy')
  await page.goto('/mentoring/evidence-review')
  await expect(page.getByRole('heading', { name: '成果验收' })).toBeVisible()
}

for (const viewport of VIEWPORTS) {
  test.describe(`B01 V2成果验收 @ ${viewport.name}`, () => {
    test.beforeEach(async ({ page }) => {
      await page.setViewportSize(viewport)
      await openEvidenceReview(page)
    })

    test('shows metrics, distinct pending and resubmitted queue items, and an operable workspace', async ({
      page,
    }) => {
      const metrics = page.getByLabel('验收指标')
      for (const label of ['待验收', '需补充', '本月通过', '平均响应']) {
        await expect(metrics).toContainText(label)
      }

      const queue = page.locator('.evidence-review-queue')
      await expect(
        queue.getByRole('heading', { name: '待办队列' }),
      ).toBeVisible()
      await expect(queue.getByText('待验收')).toBeVisible()
      await expect(queue.getByText('补充后重提')).toBeVisible()
      await expect(
        queue.getByRole('button', { name: /数据管道基础/ }),
      ).toBeVisible()
      await expect(
        queue.getByRole('button', { name: /数据质量校验/ }),
      ).toBeVisible()

      const workspace = page.getByLabel('验收工作区')
      await expect(
        workspace.getByRole('heading', { name: '数据管道基础' }),
      ).toBeVisible()
      await expect(
        workspace.getByRole('link', { name: '查看成果文件' }),
      ).toBeVisible()
      await expect(
        workspace.getByRole('button', { name: '通过' }),
      ).toHaveAttribute('aria-pressed', 'false')
      await expect(
        workspace.getByRole('button', { name: '需补充' }),
      ).toHaveAttribute('aria-pressed', 'false')
      await expect(workspace.getByLabel('反馈建议')).toBeVisible()
      await expect(
        workspace.getByRole('button', { name: '提交验收结果' }),
      ).toBeVisible()

      await page.getByRole('button', { name: '查看历史反馈' }).click()
      await expect(
        workspace.getByRole('heading', { name: '历史反馈' }),
      ).toBeFocused()
      await expect(workspace).toContainText('请补充运行记录。')

      const clipped = await page.evaluate(() =>
        [document.documentElement, document.body].some(
          (node) => node.scrollWidth > node.clientWidth + 1,
        ),
      )
      expect(clipped).toBe(false)
    })
  })
}

test.describe('B01 V2成果验收状态与错误合同', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
  })

  test('keeps both panels and disables history when the workspace is empty', async ({
    page,
  }) => {
    await mockBuddyReviewData(page)
    await mockEvidenceReviewWorkspace(page, { empty: true })
    await loginAs(page, 'buddy')
    await page.goto('/mentoring/evidence-review')
    await expect(page.getByRole('heading', { name: '成果验收' })).toBeVisible()
    await expect(page.locator('.evidence-review-queue button')).toHaveCount(0)
    await expect(
      page
        .getByLabel('验收工作区')
        .getByRole('heading', { name: '验收工作区' }),
    ).toBeVisible()
    await expect(
      page.getByRole('button', { name: '查看历史反馈' }),
    ).toBeDisabled()
  })

  test('shows loading and workspace errors without replacing the page contract', async ({
    page,
  }) => {
    await mockBuddyReviewData(page)
    await mockEvidenceReviewWorkspace(page)
    await page.route(
      '/api/planning/evidence-reviews/workspace*',
      async (route) => {
        await new Promise((resolve) => setTimeout(resolve, 50))
        await route.fulfill({
          status: 500,
          body: JSON.stringify({ detail: '读取失败' }),
        })
      },
    )
    await loginAs(page, 'buddy')
    await page.goto('/mentoring/evidence-review')
    await expect(page.getByText('加载中…')).toBeVisible()
    await expect(page.getByRole('heading', { name: '成果验收' })).toBeVisible()
    await expect(page.getByRole('alert')).toContainText('读取失败')
  })

  test('requires a conclusion and feedback for supplement before writing', async ({
    page,
  }) => {
    let writes = 0
    await mockBuddyReviewData(page)
    await mockEvidenceReviewWorkspace(page)
    await page.route('/api/planning/evidences/401/review', async (route) => {
      writes += 1
      await route.fulfill({ status: 200, body: '{}' })
    })
    await loginAs(page, 'buddy')
    await page.goto('/mentoring/evidence-review')
    await page.getByRole('button', { name: '提交验收结果' }).click()
    await expect(page.getByRole('alert')).toContainText('请先选择')
    await page.getByRole('button', { name: '需补充' }).click()
    await page.getByRole('button', { name: '提交验收结果' }).click()
    await expect(page.getByRole('alert')).toContainText('需补充必须填写反馈')
    expect(writes).toBe(0)
  })

  test('keeps the selected item and input on 403 or 409, reusing the retry key and reading back after conflict', async ({
    page,
  }) => {
    const requests: Array<{ key: string; body: unknown }> = []
    let attempt = 0
    await mockBuddyReviewData(page)
    await mockEvidenceReviewWorkspace(page)
    await page.route('/api/planning/evidences/401/review', async (route) => {
      attempt += 1
      requests.push({
        key: route.request().postDataJSON().idempotency_key,
        body: route.request().postDataJSON(),
      })
      const status = attempt === 1 ? 403 : attempt === 2 ? 409 : 200
      await route.fulfill({
        status,
        body: JSON.stringify(
          status === 200
            ? {
                id: 801,
                conclusion: '通过',
                feedback: '可通过',
                status: '通过',
              }
            : {
                detail:
                  status === 403
                    ? 'forbidden'
                    : { code: 'review_idempotency_conflict' },
              },
        ),
      })
    })
    await loginAs(page, 'buddy')
    await page.goto('/mentoring/evidence-review')
    await page.getByRole('button', { name: '通过' }).click()
    await page.getByLabel('反馈建议').fill('可通过')
    const submit = page.getByRole('button', { name: '提交验收结果' })
    await submit.click()
    await expect(page.getByRole('alert')).toContainText(
      '当前有效辅导关系不存在',
    )
    await expect(page.getByLabel('反馈建议')).toHaveValue('可通过')
    await submit.click()
    await expect(page.getByRole('alert')).toContainText('提交冲突')
    await expect(page.getByLabel('反馈建议')).toHaveValue('可通过')
    await submit.click()
    await expect(page.getByRole('status')).toContainText('已通过')
    expect(requests).toHaveLength(3)
    expect(requests[0].key).toBe(requests[1].key)
    expect(requests[1].key).not.toBe(requests[2].key)
  })
})

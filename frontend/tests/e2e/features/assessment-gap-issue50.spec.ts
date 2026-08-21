import { expect, test } from '@playwright/test'

import { loginAs } from '../fixtures/auth'

type AssessmentDetail = {
  id?: number
  l3_code: string
  l3_node_id?: number | null
  l1_code?: string
  l2_code?: string
  current_level: number | null
  target_level: number | null
  standard_target_applicable?: boolean | null
  standard_target_level?: number | null
  gap_value?: number | null
  evidence_note?: string | null
  member_priority?: '高' | '中' | '低' | '暂缓' | null
  include_in_plan?: boolean | null
  plan_quarter?: 'Q1' | 'Q2' | 'Q3' | 'Q4' | null
  plan_month?: string | null // Issue #194: YYYY-MM
  inherited_current_level?: number | null
  inherited_evidence_note?: string | null
  inherited_from_assessment_id?: number | null
}

type Assessment = {
  id: number
  revision: number
  details: AssessmentDetail[]
}

let activeDraftId: number | null = null

async function currentDraft(
  page: Parameters<typeof loginAs>[0],
  assessmentId = activeDraftId,
): Promise<Assessment> {
  const response = await page.request.get('/api/assessments')
  expect(response.ok()).toBeTruthy()
  const assessments = (await response.json()) as Array<{
    id: number
    status: string
  }>
  const draft = assessmentId
    ? assessments.find((assessment) => assessment.id === assessmentId)
    : assessments
        .filter(
          (assessment) =>
            assessment.status === '草稿' || assessment.status === '建议调整',
        )
        .sort((left, right) => right.id - left.id)[0]
  expect(draft).toBeDefined()
  const detailResponse = await page.request.get(`/api/assessments/${draft!.id}`)
  expect(detailResponse.ok()).toBeTruthy()
  return (await detailResponse.json()) as Assessment
}

async function fillAllApplicable(page: Parameters<typeof loginAs>[0]) {
  const draft = await currentDraft(page)
  const response = await page.request.put(
    `/api/assessments/${draft.id}/draft`,
    {
      data: {
        expected_revision: draft.revision,
        details: draft.details.map((detail) => ({
          l3_node_id: detail.l3_node_id,
          l3_code: detail.l3_code,
          current_level: detail.standard_target_applicable === false ? null : 1,
        })),
      },
    },
  )
  expect(response.ok()).toBeTruthy()
  await page.reload()
  await expect(page.getByLabel('评估摘要')).toBeVisible()
  return currentDraft(page)
}

test.describe('Issue #50 assessment gap workflow', () => {
  test.beforeEach(async ({ page }) => {
    // 隔离由 CI 既有 per-run 隔离栈提供（e2e.yml），不再用测试级条件跳过。
    await loginAs(page, 'member2')
    const preview = await page.request.get(
      '/api/assessments/scope-preview?year=2026',
    )
    expect(preview.ok()).toBeTruthy()
    const previewBody = (await preview.json()) as {
      scope_token: string
      open_draft_id: number | null
    }
    if (previewBody.open_draft_id) {
      activeDraftId = previewBody.open_draft_id
    } else {
      const created = await page.request.post('/api/assessments', {
        data: {
          year: 2026,
          assessment_type: '年度',
          scope_token: previewBody.scope_token,
        },
      })
      expect(created.ok()).toBeTruthy()
      activeDraftId = ((await created.json()) as { id: number }).id
    }
    await page.route('**/api/assessments', async (route) => {
      if (route.request().method() !== 'GET') return route.continue()
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([{ id: activeDraftId, status: '草稿' }]),
      })
    })
    await page.goto('/capability/assessment')
    const summary = page.getByLabel('评估摘要')
    await expect(summary).toBeVisible({ timeout: 15000 })
    await expect(page.getByTestId('assessment-table').first()).toBeVisible()
  })

  test('search switches domain, expands L2, and focuses the selected L3', async ({
    page,
  }) => {
    const search = page.getByLabel('搜索全部能力项')
    await search.fill('P')
    await search.press('ArrowDown')
    await expect(
      page.locator('[role="option"][aria-selected="true"]'),
    ).toHaveCount(1)
    await search.press('Enter')
    await expect(search).toHaveValue('')
    await expect(page.locator('[id^="row-"]:focus')).toHaveCount(1)
  })

  test('Escape closes search results and restores input focus', async ({
    page,
  }) => {
    const search = page.getByLabel('搜索全部能力项')
    await search.fill('P01')
    const result = page
      .getByRole('listbox', { name: '搜索结果' })
      .getByRole('option')
      .first()
    await expect(result).toBeVisible()
    await search.press('Escape')
    await expect(search).toHaveValue('')
    await expect(page.getByRole('listbox', { name: '搜索结果' })).toHaveCount(0)
    await expect(search).toBeFocused()
  })

  test('retired Gap Drawer stays absent and L2 batch fill requires confirmation', async ({
    page,
  }) => {
    await expect(
      page.getByRole('button', { name: '查看 Gap 摘要' }),
    ).toHaveCount(0)

    const batch = page.getByRole('button', { name: '批量填 2' }).first()
    if (await batch.isVisible()) {
      await batch.click()
      await expect(page.getByRole('button', { name: '确认填 2' })).toBeVisible()
    }
  })

  test('unassessed level 3 is visibly incomplete and cannot enter the plan', async ({
    page,
  }) => {
    // Issue #194 P1: 当前评级为逐档按钮（M02 V1 原型），选中态以
    // aria-pressed 表达；点击已选中按钮清空评级。
    const rating = page.locator('[aria-label^="当前等级"]').first()
    // the draft is shared across tests — clear the row first so the
    // unfilled state is deterministic
    if ((await rating.locator('button[aria-pressed="true"]').count()) > 0) {
      await rating.locator('button[aria-pressed="true"]').first().click()
    }
    const row = rating.locator('xpath=ancestor::div[starts-with(@id,"row-")]')
    await expect(row.getByText('需评估等级')).toBeVisible()
    // Issue #194: 提交自评已退役；未评估项无法纳入计划草稿（前置校验）。
    // M02 V1：行内加入/移出按钮在未评估时禁用（gap 未知，无加入资格）。
    const planButton = row.getByRole('button', { name: /加入提升计划/ })
    await expect(planButton).toBeDisabled()
    await rating.getByRole('button', { name: /^3 ·/ }).click()
    await expect(row.getByText('需评估等级')).toHaveCount(0)
    await rating.locator('button[aria-pressed="true"]').first().click()
    await expect(row.getByText('需评估等级')).toBeVisible()
    await expect(planButton).toBeDisabled()
  })

  test('excludes N/A items from progress without a retired locator control', async ({
    page,
  }) => {
    const draft = await fillAllApplicable(page)
    const applicable = draft.details.filter(
      (detail) => detail.standard_target_applicable !== false,
    )
    const summary = page.getByLabel('评估摘要')
    await expect(summary).toContainText(
      `进度 ${applicable.length}/${applicable.length}`,
    )
    await expect(summary).toContainText('未评估 0')
    await expect(page.getByRole('button', { name: '定位未完成' })).toHaveCount(
      0,
    )
  })

  test('personal adjustment requires a valid target and reason; cancel clears errors', async ({
    page,
  }) => {
    await fillAllApplicable(page)
    const code = 'P01.01.01'
    const search = page.getByLabel('搜索全部能力项')
    await search.fill(code)
    await search.press('Enter')
    const rating = page.getByLabel(`当前等级 ${code}`)
    if ((await rating.locator('button[aria-pressed="true"]').count()) === 0) {
      await rating.getByRole('button', { name: /^1 ·/ }).click()
    }
    const row = rating.locator('xpath=ancestor::div[starts-with(@id,"row-")]')
    await row.getByRole('button', { name: '调整▸' }).click()
    const enable = page.getByLabel(`启用个人调整 ${code}`)
    await enable.check()
    await page.getByLabel(`调整目标 ${code}`).selectOption('')
    await expect(page.getByText('需填写调整目标')).toBeVisible()
    await page.getByLabel(`调整目标 ${code}`).selectOption('4')
    await expect(page.getByText('需填写调整原因')).toBeVisible()
    await page.getByLabel(`调整原因 ${code}`).fill('合法调整原因')
    await expect(page.getByText('需填写调整原因')).toHaveCount(0)
    await expect(page.getByText('需填写调整目标')).toHaveCount(0)
    // cancel clears the adjustment errors again (调整必填校验恢复)
    await enable.uncheck()
    await expect(page.getByText('需填写调整目标')).toHaveCount(0)
    await expect(page.getByText('需填写调整原因')).toHaveCount(0)
  })

  test('structured generation validation switches domain and focuses the failing L3', async ({
    page,
  }) => {
    const draft = await fillAllApplicable(page)
    const target = draft.details.find(
      (detail) =>
        detail.standard_target_applicable !== false &&
        (detail.l1_code ?? detail.l3_code.split('.')[0]) !== 'P01',
    )!
    // Issue #194: 生成前置满足（纳入计划 + 优先级 + YYYY-MM），
    // 服务端逐项校验失败时定位失败 L3 并切换域。
    const patched = await page.request.patch(
      `/api/assessments/${draft.id}/draft`,
      {
        data: {
          expected_revision: draft.revision,
          details: [
            {
              l3_node_id: target.l3_node_id,
              l3_code: target.l3_code,
              member_priority: '高',
              include_in_plan: true,
              plan_month: '2026-06',
            },
          ],
        },
      },
    )
    expect(patched.ok()).toBeTruthy()
    await page.reload()
    await expect(page.getByLabel('评估摘要')).toBeVisible()
    await page
      .getByRole('navigation', { name: '一级能力域导航' })
      .getByRole('button', { name: /^P01 · / })
      .click()
    await page.route(
      '**/api/assessments/*/generate-plan-items',
      async (route) => {
        await route.fulfill({
          status: 422,
          contentType: 'application/json',
          body: JSON.stringify({
            detail: {
              code: target.l3_code,
              l3_code: target.l3_code,
              l3_node_id: target.l3_node_id,
              field: 'member_priority',
              reason: 'priority_required',
              message: `${target.l3_code} requires member_priority`,
            },
          }),
        })
      },
    )
    await page.getByRole('button', { name: '生成所选学习任务' }).click()
    await expect(
      page.getByText(`${target.l3_code} requires member_priority`),
    ).toBeVisible()
    await expect(page.locator(`#row-${target.id}`)).toBeFocused()
    await expect(
      page
        .getByRole('navigation', { name: '一级能力域导航' })
        .getByRole('button', {
          name: new RegExp(`^${target.l1_code ?? 'P02'} · `),
        }),
    ).toHaveAttribute('aria-pressed', 'true')
  })

  test('first evaluation fills all domains and submits dirty input', async ({
    page,
  }) => {
    test.setTimeout(120_000)
    // Issue #194 P1: 逐档评级按钮；未选中任何档位视为未评估。
    const firstRating = page.locator('[aria-label^="当前等级"]').first()
    if (
      (await firstRating.locator('button[aria-pressed="true"]').count()) === 0
    ) {
      await firstRating.getByRole('button', { name: /^1 ·/ }).click()
    }
    for (const domain of await page
      .getByRole('navigation', { name: '一级能力域导航' })
      .getByRole('button')
      .all()) {
      await domain.click()
      while (await page.getByRole('button', { name: '批量填 1' }).count()) {
        await page.getByRole('button', { name: '批量填 1' }).first().click()
        const responsePromise = page.waitForResponse(
          (response) =>
            response.url().includes('/batch-level') &&
            response.request().method() === 'POST',
        )
        await page.getByRole('button', { name: '确认填 1' }).click()
        expect((await responsePromise).status()).toBe(200)
      }
    }
    // positive-Gap items need an explicit plan decision before submit
    const draft = await currentDraft(page)
    const gapDetails = draft.details.filter(
      (detail) =>
        detail.standard_target_applicable !== false &&
        (detail.gap_value ?? 0) > 0,
    )
    if (gapDetails.length) {
      const patched = await page.request.patch(
        `/api/assessments/${draft.id}/draft`,
        {
          data: {
            expected_revision: draft.revision,
            details: gapDetails.map((detail) => ({
              l3_node_id: detail.l3_node_id,
              l3_code: detail.l3_code,
              member_priority: '低',
              include_in_plan: false,
            })),
          },
        },
      )
      expect(patched.ok()).toBeTruthy()
      await page.reload()
      await expect(page.getByLabel('评估摘要')).toBeVisible()
    }
    // Issue #194: 提交自评退役；三动作之一「保存能力评级」保留脏输入。
    // 批量填写与 gap 修正均已保存（无 dirty 行）：先通过可见控件制造
    // 一个合法脏变更（applicable 行的当前等级 +1），再保存验证 UI 提示
    // 与持久化。
    const ratings = page.locator('[aria-label^="当前等级"]')
    const ratingCount = await ratings.count()
    let ratingIndex = -1
    for (let i = 0; i < ratingCount; i += 1) {
      if (await ratings.nth(i).locator('button').first().isEnabled()) {
        ratingIndex = i
        break
      }
    }
    expect(ratingIndex).toBeGreaterThanOrEqual(0)
    const rating = ratings.nth(ratingIndex)
    const row = rating.locator('xpath=ancestor::div[starts-with(@id,"row-")]')
    const rowId = await row.getAttribute('id')
    expect(rowId).toMatch(/^row-\d+$/)
    const previous = Number(
      (await rating
        .locator('button[aria-pressed="true"]')
        .first()
        .textContent())!.split(' ')[0],
    )
    expect(previous).toBeGreaterThanOrEqual(0)
    await rating
      .getByRole('button', { name: new RegExp(`^${previous + 1} ·`) })
      .click()
    await expect(
      page.getByRole('button', { name: '保存能力评级' }),
    ).toBeVisible()
    await page.getByRole('button', { name: '保存能力评级' }).click()
    await expect(page.getByText('草稿已保存')).toBeVisible({ timeout: 15000 })
    // 持久化：该行评级已落库。
    const persisted = await currentDraft(page)
    const changedRow = persisted.details.find(
      (detail) => detail.id === Number(rowId.slice(4)),
    )
    expect(changedRow?.current_level).toBe(previous + 1)
  })

  test('partial save keeps the page dense and avoids viewport overflow', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    const viewport = page.viewportSize()
    expect(viewport).not.toBeNull()
    // Issue #194 M02: 三动作之一「保存能力评级」。
    await expect(
      page.getByRole('button', { name: '保存能力评级' }),
    ).toBeVisible()
    const metrics = await page
      .getByTestId('assessment-content-area')
      .evaluate((content) => {
        const visible = (rect: DOMRect) => {
          const left = Math.max(0, rect.left)
          const top = Math.max(0, rect.top)
          const right = Math.min(window.innerWidth, rect.right)
          const bottom = Math.min(window.innerHeight, rect.bottom)
          return {
            width: Math.max(0, right - left),
            height: Math.max(0, bottom - top),
          }
        }
        const contentRect = visible(content.getBoundingClientRect())
        const main = content.querySelector(
          '[data-testid="assessment-main-area"]',
        )
        const mainRect = main
          ? visible(main.getBoundingClientRect())
          : { width: 0, height: 0 }
        // Issue #194 P1: 能力项行容器为 div[id^="row-"]（原七列表格已退役）。
        const rows = [...content.querySelectorAll('[id^="row-"]')].filter(
          (row) => {
            const rect = row.getBoundingClientRect()
            return rect.top >= 0 && rect.bottom <= window.innerHeight
          },
        ).length
        return {
          contentArea: contentRect.width * contentRect.height,
          tableArea: mainRect.width * mainRect.height,
          rows,
        }
      })
    expect(metrics.tableArea / metrics.contentArea).toBeGreaterThanOrEqual(0.7)
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBeLessThanOrEqual(viewport!.width)
  })

  test('768 viewport: M02 same-item controls measured together at scrollLeft=0 without horizontal scroll', async ({
    page,
  }) => {
    // 权威原型 M02 V1 在窄宽做响应式重排；横向滚动桌面表格不是合法替代。
    await page.setViewportSize({ width: 768, height: 900 })
    const draft = await currentDraft(page)
    const target = draft.details.find(
      (detail) =>
        detail.standard_target_applicable !== false && detail.id != null,
    )!
    const patched = await page.request.patch(
      `/api/assessments/${draft.id}/draft`,
      {
        data: {
          expected_revision: draft.revision,
          details: [
            {
              l3_node_id: target.l3_node_id,
              l3_code: target.l3_code,
              current_level: 1,
              member_priority: '高',
              include_in_plan: true,
              plan_month: '2026-06',
            },
          ],
        },
      },
    )
    expect(patched.ok()).toBeTruthy()
    await page.reload()
    await expect(page.getByLabel('评估摘要')).toBeVisible({ timeout: 15000 })
    // 先定位稳定的能力项容器（id^=row-；未来 article/card 保留该 id），
    // 不要求 table 结构存在。
    const row = page.locator(`#row-${target.id}`)
    await expect(row).toBeVisible()
    // 垂直方向单独处理：只做纵向滚动让目标行可见，禁止触发横向滚动。
    await row.evaluate((element) => {
      const scroller = element.closest('[data-testid="assessment-main-area"]')
      if (scroller) {
        scroller.scrollBy({
          top:
            element.getBoundingClientRect().top -
            scroller.getBoundingClientRect().top -
            8,
          behavior: 'auto',
        })
      } else {
        window.scrollBy({
          top: element.getBoundingClientRect().top - 80,
          behavior: 'auto',
        })
      }
    })
    // 测量前提：scrollLeft 保持 0，不得靠横向滚动逐一暴露右侧控件。
    const scrollLeft = await page.evaluate(() => {
      const element = document.querySelector(
        '[data-testid="assessment-main-area"]',
      )
      return element ? element.scrollLeft : 0
    })
    expect(scrollLeft).toBe(0)
    const code = target.l3_code.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const controls = [
      // 当前评级：item 内按稳定 aria-label 前缀定位，兼容旧 select 与
      // 未来分段容器/按钮。
      row.locator('[aria-label^="当前等级"]').first(),
      page.getByLabel(`优先级 ${target.l3_code}`),
      page.getByRole('button', { name: new RegExp(`提升计划 ${code}`) }),
      page.getByLabel(`计划月份 ${target.l3_code}`),
      page.getByRole('button', { name: '生成所选学习任务' }),
    ]
    const viewportWidth = await page.evaluate(() => window.innerWidth)
    // 同一能力项的五个控件同时测量水平边界与裁切祖先（整数像素判定）。
    for (const control of controls) {
      const box = await control.boundingBox()
      expect(box).not.toBeNull()
      expect(Math.floor(box!.x)).toBeGreaterThanOrEqual(0)
      expect(Math.ceil(box!.x + box!.width)).toBeLessThanOrEqual(viewportWidth)
      const clipping = await control.evaluate((element) => {
        const rect = element.getBoundingClientRect()
        let left = Math.max(0, rect.left)
        let right = Math.min(window.innerWidth, rect.right)
        let node = element.parentElement
        while (node) {
          const overflowX = window.getComputedStyle(node).overflowX
          if (/(hidden|auto|scroll)/.test(overflowX)) {
            const clip = node.getBoundingClientRect()
            left = Math.max(left, clip.left)
            right = Math.min(right, clip.right)
          }
          node = node.parentElement
        }
        return {
          visibleWidth: Math.max(0, right - left),
          fullWidth: rect.width,
        }
      })
      expect(Math.round(clipping.visibleWidth)).toBe(
        Math.round(clipping.fullWidth),
      )
    }
    // 主区域自身不得以横向滚动承载表格（真实横向溢出判定）。
    const overflow = await page
      .getByTestId('assessment-main-area')
      .evaluate((element) => ({
        scrollWidth: element.scrollWidth,
        clientWidth: element.clientWidth,
      }))
    expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.clientWidth)
  })

  test('sparse PATCH preserves a hidden L1 detail', async ({ page }) => {
    const before = await currentDraft(page)
    const first = before.details.find(
      (detail) => detail.standard_target_applicable !== false,
    )!
    const untouched = before.details.find(
      (detail) => detail.l3_code !== first.l3_code,
    )!
    const response = await page.request.patch(
      `/api/assessments/${before.id}/draft`,
      {
        data: {
          expected_revision: before.revision,
          details: [
            {
              l3_node_id: first.l3_node_id,
              l3_code: first.l3_code,
              current_level: 1,
            },
          ],
        },
      },
    )
    expect(response.ok()).toBeTruthy()
    const after = await currentDraft(page)
    expect(
      after.details.find((detail) => detail.l3_code === untouched.l3_code)
        ?.current_level,
    ).toBe(untouched.current_level)
  })

  test('two PATCH requests use revision conflict instead of last-write-wins', async ({
    page,
  }) => {
    const before = await currentDraft(page)
    const detail = before.details.find(
      (item) => item.standard_target_applicable !== false,
    )!
    const requests = [1, 2].map((level) =>
      page.request.patch(`/api/assessments/${before.id}/draft`, {
        data: {
          expected_revision: before.revision,
          details: [
            {
              l3_node_id: detail.l3_node_id,
              l3_code: detail.l3_code,
              current_level: level,
            },
          ],
        },
      }),
    )
    const responses = await Promise.all(requests)
    expect(responses.map((response) => response.status()).sort()).toEqual([
      200, 409,
    ])
    const after = await currentDraft(page)
    expect(after.revision).toBe(before.revision + 1)
    expect(
      after.details.find((item) => item.l3_code === detail.l3_code)
        ?.current_level,
    ).toBeGreaterThanOrEqual(1)
  })

  test('a legal level increase to the target auto-clears plan fields (auto_cleared)', async ({
    page,
  }) => {
    const before = await currentDraft(page)
    const candidate = before.details.find(
      (item) =>
        item.standard_target_applicable !== false &&
        item.target_level != null &&
        item.target_level > 1,
    )!
    const first = await page.request.patch(
      `/api/assessments/${before.id}/draft`,
      {
        data: {
          expected_revision: before.revision,
          details: [
            {
              l3_node_id: candidate.l3_node_id,
              l3_code: candidate.l3_code,
              current_level: 1,
              member_priority: '高',
              include_in_plan: true,
              // Issue #194: plan_quarter 派生列不接受输入；月份为 YYYY-MM。
              plan_month: '2026-02',
            },
          ],
        },
      },
    )
    expect(first.ok()).toBeTruthy()
    const firstBody = (await first.json()) as { revision: number }
    const second = await page.request.patch(
      `/api/assessments/${before.id}/draft`,
      {
        data: {
          expected_revision: firstBody.revision,
          details: [
            {
              l3_node_id: candidate.l3_node_id,
              l3_code: candidate.l3_code,
              current_level: candidate.target_level,
            },
          ],
        },
      },
    )
    expect(second.ok()).toBeTruthy()
    const secondBody = (await second.json()) as {
      auto_cleared: Array<{
        l3_node_id: number
        l3_code: string
        fields: string[]
      }>
      gap_summary: { total_gaps: number }
    }
    const cleared = secondBody.auto_cleared.find(
      (entry) => entry.l3_code === candidate.l3_code,
    )
    expect(cleared).toBeDefined()
    expect(cleared!.fields).toEqual(
      expect.arrayContaining([
        'member_priority',
        'include_in_plan',
        'plan_month',
      ]),
    )
    expect(secondBody.gap_summary.total_gaps).toBeGreaterThanOrEqual(0)
    const after = await currentDraft(page)
    const updated = after.details.find(
      (item) => item.l3_code === candidate.l3_code,
    )!
    expect(updated.member_priority).toBeNull()
    expect(updated.include_in_plan).toBeNull()
    expect(updated.plan_quarter).toBeNull()
    expect(updated.plan_month).toBeNull()
    const gaps = await page.request.get(`/api/gaps?assessment_id=${before.id}`)
    expect(gaps.ok()).toBeTruthy()
    expect(
      ((await gaps.json()) as Array<{ l3_code: string }>).some(
        (gap) => gap.l3_code === candidate.l3_code,
      ),
    ).toBe(false)
  })
})

test.describe('Issue #50 兼容改造：历史数据只读与旧写端点退役', () => {
  test('legacy assessment writes are retired; drafts stay readable and editable', async ({
    page,
    browser,
  }) => {
    test.setTimeout(120_000)
    // 隔离由 CI 既有 per-run 隔离栈提供（同前），测试级无条件执行。
    await loginAs(page, 'member2')
    // 新合同动作：创建 2025 草稿并保存评级。
    const previousPreview = await page.request.get(
      '/api/assessments/scope-preview?year=2025',
    )
    expect(previousPreview.ok()).toBeTruthy()
    const previousPreviewBody = (await previousPreview.json()) as {
      scope_token: string
      open_draft_id: number | null
    }
    let previousId: number
    if (previousPreviewBody.open_draft_id) {
      previousId = previousPreviewBody.open_draft_id
    } else {
      const previousCreated = await page.request.post('/api/assessments', {
        data: {
          year: 2025,
          assessment_type: '年度',
          scope_token: previousPreviewBody.scope_token,
        },
      })
      expect(previousCreated.ok()).toBeTruthy()
      previousId = ((await previousCreated.json()) as { id: number }).id
    }
    const previousResponse = await page.request.get(
      `/api/assessments/${previousId}`,
    )
    const previous = (await previousResponse.json()) as Assessment
    const applicable = previous.details.filter(
      (detail) =>
        detail.standard_target_applicable !== false &&
        detail.target_level != null,
    )
    const low = applicable.find((detail) => (detail.target_level ?? 0) >= 2)!
    const details = previous.details.map((detail) => {
      if (detail.standard_target_applicable === false) {
        return {
          l3_node_id: detail.l3_node_id,
          l3_code: detail.l3_code,
          current_level: null,
        }
      }
      const current =
        detail.l3_code === low.l3_code ? 1 : (detail.target_level ?? 1)
      return {
        l3_node_id: detail.l3_node_id,
        l3_code: detail.l3_code,
        current_level: current,
        evidence_note:
          detail.l3_code === low.l3_code ? null : `历史依据-${detail.l3_code}`,
      }
    })
    const saved = await page.request.put(
      `/api/assessments/${previousId}/draft`,
      {
        data: { expected_revision: previous.revision, details },
      },
    )
    expect(saved.ok()).toBeTruthy()
    const savedBody = (await saved.json()) as { revision: number }

    // Issue #194: 旧提交端点退役 → 422 零写入，评估保持草稿。
    const submitted = await page.request.post(
      `/api/assessments/${previousId}/submit`,
      { data: { expected_revision: savedBody.revision } },
    )
    expect(submitted.status()).toBe(422)
    expect(await submitted.text()).toContain(
      'legacy_assessment_submit_disabled',
    )
    const afterRejected = await page.request.get(
      `/api/assessments/${previousId}`,
    )
    expect((await afterRejected.json()).status).toBe('草稿')

    // 旧 review 写路径退役：Buddy 关系有效 → 410 assessment_review_write_disabled
    // 零写入；GET 历史保持只读。
    const buddy = await browser.newContext()
    await loginAs(buddy.pages()[0] ?? (await buddy.newPage()), 'buddy')
    const rejectedReview = await buddy.request.post(
      `/api/assessments/${previousId}/reviews/1`,
      {
        data: {
          conclusion: '认可',
          feedback: 'E2E 认可',
          expected_revision: savedBody.revision,
        },
      },
    )
    expect(rejectedReview.status()).toBe(410)
    expect(await rejectedReview.text()).toContain(
      'assessment_review_write_disabled',
    )
    const history = await buddy.request.get(
      `/api/assessments/${previousId}/history`,
    )
    expect(history.status()).toBe(200)
    await buddy.close()

    // UI：2025 草稿可继续编辑保存（保存能力评级）。
    await page.goto('/capability/assessment?year=2025')
    await expect(page.getByLabel('评估摘要')).toBeVisible()
    // 与 first-evaluation 同根因：无 dirty 行时保存不产生提示。先通过
    // 可见控件制造一个合法脏变更（applicable 行当前等级 +1）再保存。
    const ratings = page.locator('[aria-label^="当前等级"]')
    const ratingCount = await ratings.count()
    let ratingIndex = -1
    for (let i = 0; i < ratingCount; i += 1) {
      if (await ratings.nth(i).locator('button').first().isEnabled()) {
        ratingIndex = i
        break
      }
    }
    expect(ratingIndex).toBeGreaterThanOrEqual(0)
    const rating = ratings.nth(ratingIndex)
    const row = rating.locator('xpath=ancestor::div[starts-with(@id,"row-")]')
    const rowId = await row.getAttribute('id')
    expect(rowId).toMatch(/^row-\d+$/)
    const priorLevel = Number(
      (await rating
        .locator('button[aria-pressed="true"]')
        .first()
        .textContent())!.split(' ')[0],
    )
    expect(priorLevel).toBeGreaterThanOrEqual(0)
    await rating
      .getByRole('button', { name: new RegExp(`^${priorLevel + 1} ·`) })
      .click()
    await page.getByRole('button', { name: '保存能力评级' }).click()
    await expect(page.getByText('草稿已保存')).toBeVisible({ timeout: 15000 })

    // 显式生成前置校验：未纳入计划的项 → 422 且零写入。
    const afterUi = await currentDraft(page, previousId)
    // 持久化：该行评级已落库（afterUi 读取于保存之后）。
    const changedRow = afterUi.details.find(
      (detail) => detail.id === Number(rowId.slice(4)),
    )
    expect(changedRow?.current_level).toBe(priorLevel + 1)
    const beforeGenerate = await page.request.get(
      `/api/planning/annual-plan?year=2025`,
    )
    const beforeBody = await beforeGenerate.json()
    const generate = await page.request.post(
      `/api/assessments/${previousId}/generate-plan-items`,
      {
        data: {
          l3_codes: [low.l3_code],
          expected_revision: afterUi.revision,
        },
      },
    )
    expect(generate.status()).toBe(422)
    expect(await generate.text()).toContain('未加入提升计划')
    const afterGenerate = await page.request.get(
      `/api/planning/annual-plan?year=2025`,
    )
    expect(await afterGenerate.json()).toEqual(beforeBody)
  })
})

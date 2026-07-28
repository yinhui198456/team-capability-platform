import { expect, test } from '@playwright/test'

import { loginAs } from '../fixtures/auth'

type AssessmentDetail = {
  id?: number
  l3_code: string
  l1_code?: string
  l2_code?: string
  current_level: number | null
  target_level: number | null
  standard_target_applicable?: boolean | null
  standard_target_level?: number | null
  evidence_note?: string | null
  plan_candidate?: boolean
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
    test.skip(
      !process.env.TCP_E2E_ISOLATED,
      'Issue #50 writes assessment data and requires an isolated database',
    )
    await loginAs(page, 'member2')
    const created = await page.request.post('/api/assessments', {
      data: { year: 2026, assessment_type: '年度' },
    })
    expect(created.ok()).toBeTruthy()
    activeDraftId = ((await created.json()) as { id: number }).id
    await page.route('**/api/assessments', async (route) => {
      if (route.request().method() !== 'GET') return route.continue()
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([{ id: activeDraftId, status: '草稿' }]),
      })
    })
    await page.goto('/capability/assessment')
    const createDraft = page.getByRole('button', { name: '创建年度自评草稿' })
    const summary = page.getByLabel('评估摘要')
    await expect(createDraft.or(summary)).toBeVisible()
    if (await createDraft.isVisible()) await createDraft.click()
    await expect(summary).toBeVisible({ timeout: 10000 })
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

  test('Gap Drawer is on demand and L2 batch fill requires confirmation', async ({
    page,
  }) => {
    await expect(page.getByTestId('gap-drawer')).toHaveCount(0)
    await page.getByRole('button', { name: '查看 Gap 摘要' }).click()
    await expect(page.getByTestId('gap-drawer')).toBeVisible()
    await page.getByRole('button', { name: '关闭' }).click()

    const batch = page.getByRole('button', { name: '批量填 2' }).first()
    if (await batch.isVisible()) {
      await batch.click()
      await expect(page.getByRole('button', { name: '确认填 2' })).toBeVisible()
    }
  })

  test('level 3 without evidence is visibly incomplete before submit', async ({
    page,
  }) => {
    const current = page.getByRole('combobox', { name: /当前等级/ }).first()
    await current.selectOption('3')
    const row = current.locator('xpath=ancestor::tr')
    await row.getByRole('button', { name: /^(编辑|填写)$/ }).click()
    await page.locator('textarea').fill('')
    await page.getByRole('button', { name: '确认依据' }).click()
    await expect(page.getByText('需自评依据').first()).toBeVisible()
    await expect(page.getByRole('button', { name: '提交自评' })).toBeDisabled()
  })

  test('excludes N/A items from progress and unfinished-item location', async ({
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
    await expect(summary).toContainText('未完成 0')
    await page.getByRole('button', { name: '定位未完成' }).click()
    await expect(page.locator('[id^="row-"]:focus')).toHaveCount(0)
  })

  test('personal adjustment requires a valid target and reason, and cancel unblocks submit', async ({
    page,
  }) => {
    await fillAllApplicable(page)
    const code = 'P01.01.01'
    const search = page.getByLabel('搜索全部能力项')
    await search.fill(code)
    await search.press('Enter')
    const current = page.getByLabel(`当前等级 ${code}`)
    if ((await current.inputValue()) === '') await current.selectOption('1')
    const adjustment = page.getByLabel(`申请调整 ${code}`)
    await adjustment.click()
    await page.getByLabel(`调整目标 ${code}`).selectOption('')
    await expect(page.getByText('需填写调整目标')).toBeVisible()
    await expect(page.getByRole('button', { name: '提交自评' })).toBeDisabled()
    await page.getByLabel(`调整目标 ${code}`).selectOption('4')
    await expect(page.getByText('需填写调整原因')).toBeVisible()
    await page.getByLabel(`调整原因 ${code}`).fill('合法调整原因')
    await expect(page.getByRole('button', { name: '提交自评' })).toBeEnabled()
    await adjustment.click()
    await expect(page.getByRole('button', { name: '提交自评' })).toBeEnabled()
  })

  test('structured submit validation switches domain and focuses the failing L3', async ({
    page,
  }) => {
    const draft = await fillAllApplicable(page)
    const target = draft.details.find(
      (detail) =>
        detail.standard_target_applicable !== false &&
        (detail.l1_code ?? detail.l3_code.split('.')[0]) !== 'P01',
    )!
    await page.getByRole('button', { name: /P01/ }).click()
    await page.route('**/api/assessments/*/submit', async (route) => {
      await route.fulfill({
        status: 400,
        contentType: 'application/json',
        body: JSON.stringify({
          detail: {
            code: 'assessment_validation_failed',
            l3_code: target.l3_code,
            reason: 'requires_evidence',
            message: `${target.l3_code} requires evidence`,
          },
        }),
      })
    })
    await page.getByRole('button', { name: '提交自评' }).click()
    await expect(
      page.getByText(`${target.l3_code} requires evidence`),
    ).toBeVisible()
    await expect(page.locator(`#row-${target.id}`)).toBeFocused()
    await expect(
      page.getByRole('button', { name: new RegExp(target.l1_code ?? 'P02') }),
    ).toHaveAttribute('aria-pressed', 'true')
  })

  test('first evaluation fills all domains and submits dirty input', async ({
    page,
  }) => {
    test.setTimeout(120_000)
    const firstCurrent = page
      .getByRole('combobox', { name: /当前等级/ })
      .first()
    if ((await firstCurrent.inputValue()) === '') {
      await firstCurrent.selectOption('1')
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
    await expect(page.getByRole('button', { name: '提交自评' })).toBeEnabled()
    await page.getByRole('button', { name: '提交自评' }).click()
    await expect(page.getByText(/已提交/)).toBeVisible({ timeout: 15000 })
  })

  test('partial save keeps the page dense and avoids viewport overflow', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    const viewport = page.viewportSize()
    expect(viewport).not.toBeNull()
    await expect(page.getByRole('button', { name: '保存草稿' })).toBeVisible()
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
        const rows = [...content.querySelectorAll('tbody tr')].filter((row) => {
          const rect = row.getBoundingClientRect()
          return rect.top >= 0 && rect.bottom <= window.innerHeight
        }).length
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
          details: [{ l3_code: first.l3_code, current_level: 1 }],
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
          details: [{ l3_code: detail.l3_code, current_level: level }],
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

  test('a legal level increase to the target cancels an existing plan candidate', async ({
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
              l3_code: candidate.l3_code,
              current_level: 1,
              plan_candidate: true,
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
              l3_code: candidate.l3_code,
              current_level: candidate.target_level,
            },
          ],
        },
      },
    )
    expect(second.ok()).toBeTruthy()
    const secondBody = (await second.json()) as {
      auto_cancelled_plan_candidates: string[]
      gap_summary: { total_gaps: number }
    }
    expect(secondBody.auto_cancelled_plan_candidates).toContain(
      candidate.l3_code,
    )
    expect(secondBody.gap_summary.total_gaps).toBeGreaterThanOrEqual(0)
    const after = await currentDraft(page)
    expect(
      after.details.find((item) => item.l3_code === candidate.l3_code)
        ?.plan_candidate,
    ).toBe(false)
    const gaps = await page.request.get(`/api/gaps?assessment_id=${before.id}`)
    expect(gaps.ok()).toBeTruthy()
    expect(
      ((await gaps.json()) as Array<{ l3_code: string }>).some(
        (gap) => gap.l3_code === candidate.l3_code,
      ),
    ).toBe(false)
  })
})

test.describe('Issue #50 historical inheritance and evidence gates', () => {
  test('creates a cross-year snapshot and rejects unchanged evidence for 1→2 and 3→4', async ({
    page,
    browser,
  }) => {
    test.setTimeout(120_000)
    test.skip(
      !process.env.TCP_E2E_ISOLATED,
      'Issue #50 writes assessment data and requires an isolated database',
    )
    await loginAs(page, 'member2')
    const previousCreated = await page.request.post('/api/assessments', {
      data: { year: 2025, assessment_type: '年度' },
    })
    expect(previousCreated.ok()).toBeTruthy()
    const previousId = ((await previousCreated.json()) as { id: number }).id
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
    const high =
      applicable.find(
        (detail) =>
          detail.l3_code !== low.l3_code && (detail.target_level ?? 0) >= 4,
      ) ?? applicable.find((detail) => detail.l3_code !== low.l3_code)!
    const details = previous.details.map((detail) => {
      if (detail.standard_target_applicable === false) {
        return { l3_code: detail.l3_code, current_level: null }
      }
      const current =
        detail.l3_code === low.l3_code
          ? 1
          : detail.l3_code === high.l3_code
            ? 3
            : (detail.target_level ?? 1)
      return {
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
    const submitted = await page.request.post(
      `/api/assessments/${previousId}/submit`,
      { data: { expected_revision: 2 } },
    )
    expect(submitted.ok()).toBeTruthy()

    const buddy = await browser.newContext()
    await loginAs(buddy.pages()[0] ?? (await buddy.newPage()), 'buddy')
    const pending = await buddy.request.get('/api/assessments/reviews/pending')
    expect(pending.ok()).toBeTruthy()
    const review = (
      (await pending.json()) as Array<{
        assessment_id: number
        id: number
      }>
    ).find((item) => item.assessment_id === previousId)!
    const reviewed = await buddy.request.post(
      `/api/assessments/${previousId}/reviews/${review.id}`,
      { data: { conclusion: '认可', feedback: 'E2E 认可' } },
    )
    expect(reviewed.ok()).toBeTruthy()
    await buddy.close()

    const currentCreated = await page.request.post('/api/assessments', {
      data: { year: 2026, assessment_type: '晋升复核' },
    })
    expect(currentCreated.ok()).toBeTruthy()
    const currentId = ((await currentCreated.json()) as { id: number }).id
    const currentResponse = await page.request.get(
      `/api/assessments/${currentId}`,
    )
    const current = (await currentResponse.json()) as Assessment
    const inheritedLow = current.details.find(
      (detail) => detail.l3_code === low.l3_code,
    )!
    const inheritedHigh = current.details.find(
      (detail) => detail.l3_code === high.l3_code,
    )!
    expect(inheritedLow.inherited_from_assessment_id).toBe(previousId)
    expect(inheritedLow.current_level).toBe(1)
    expect(inheritedLow.target_level).toBe(low.target_level)
    expect(inheritedLow.inherited_evidence_note).toBe(
      inheritedLow.evidence_note,
    )
    expect(inheritedHigh.current_level).toBe(3)

    await page.goto('/capability/assessment')
    await expect(page.getByText('沿用上次评估').first()).toBeVisible()
    const lowSelect = page.getByLabel(`当前等级 ${low.l3_code}`)
    if (await lowSelect.isVisible()) {
      await lowSelect.selectOption('2')
      const lowRow = page.locator(`#row-${inheritedLow.id}`)
      await expect(lowRow.getByText('需更新依据')).toBeVisible()
      await expect(
        page.getByRole('button', { name: '提交自评' }),
      ).toBeDisabled()
      await lowRow.getByRole('button', { name: '填写' }).click()
      await lowRow.locator('textarea').fill('   ')
      await lowRow.getByRole('button', { name: '确认依据' }).click()
      await expect(lowRow.getByText('需更新依据')).toBeVisible()
      await lowRow.getByRole('button', { name: '填写' }).click()
      await lowRow.locator('textarea').fill('本次新依据')
      await lowRow.getByRole('button', { name: '确认依据' }).click()
      await expect(lowRow.getByText('需更新依据')).toHaveCount(0)
      await expect(page.getByRole('button', { name: '提交自评' })).toBeEnabled()
    }

    const lowUpdate = await page.request.patch(
      `/api/assessments/${currentId}/draft`,
      {
        data: {
          expected_revision: current.revision,
          details: [
            {
              l3_code: low.l3_code,
              current_level: 2,
              evidence_note: inheritedLow.evidence_note,
            },
          ],
        },
      },
    )
    expect(lowUpdate.ok()).toBeTruthy()
    const lowBody = (await lowUpdate.json()) as { revision: number }
    const highUpdate = await page.request.patch(
      `/api/assessments/${currentId}/draft`,
      {
        data: {
          expected_revision: lowBody.revision,
          details: [
            {
              l3_code: high.l3_code,
              current_level: 4,
              evidence_note: inheritedHigh.evidence_note,
            },
          ],
        },
      },
    )
    expect(highUpdate.ok()).toBeTruthy()
    const highBody = (await highUpdate.json()) as { revision: number }
    const rejected = await page.request.post(
      `/api/assessments/${currentId}/submit`,
      {
        data: { expected_revision: highBody.revision },
      },
    )
    expect(rejected.status()).toBe(400)
    expect(await rejected.text()).toContain('requires updated evidence')
  })
})

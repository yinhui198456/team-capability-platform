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
  plan_month?: number | null
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
    test.skip(
      !process.env.TCP_E2E_ISOLATED,
      'Issue #50 writes assessment data and requires an isolated database',
    )
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

  test('unassessed rows never block generation; current_level=0 is a valid selection', async ({
    page,
  }) => {
    const current = page.getByRole('combobox', { name: /当前等级/ }).first()
    // the draft is shared across tests — clear the row first so the
    // unfilled state is deterministic
    if ((await current.inputValue()) !== '') await current.selectOption('')
    const row = current.locator('xpath=ancestor::tr')
    await expect(row.getByText('需评估等级')).toBeVisible()
    // Issue #178: unselected (unassessed) rows never block task generation
    await expect(
      page.getByText(/项未完成评估（未选择的能力项不阻塞生成）/),
    ).toBeVisible()
    // current_level=0 is a legal filled outcome and can be selected
    await current.selectOption('0')
    await expect(row.getByText('需评估等级')).toHaveCount(0)
    const code = (await current.getAttribute('aria-label'))!.replace(
      '当前等级 ',
      '',
    )
    await page.getByLabel(`选择 ${code}`).check()
    await expect(page.getByText('已选择 1 项')).toBeVisible()
    await page.getByRole('button', { name: '生成所选学习任务' }).click()
    await expect(page.getByText(/已生成 \d+ 个学习任务/)).toBeVisible()
    // the annual plan now carries the selected L3
    const plan = await (
      await page.request.get('/api/planning/annual-plan?year=2026')
    ).json()
    expect(
      plan.items.some((item: { l3_code: string }) => item.l3_code === code),
    ).toBe(true)
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
    await expect(summary).toContainText('未评估 0')
    await page.getByRole('button', { name: '定位未完成' }).click()
    await expect(page.locator('[id^="row-"]:focus')).toHaveCount(0)
  })

  test('multiple selected L3s generate atomically; an invalid batch fails whole', async ({
    page,
  }) => {
    await fillAllApplicable(page)
    const draft = await currentDraft(page)
    const applicable = draft.details.filter(
      (detail) => detail.standard_target_applicable !== false,
    )
    // pick applicable rows that are not already in the annual plan, so the
    // created counts stay deterministic across runs
    const planResp = await page.request.get(
      '/api/planning/annual-plan?year=2026',
    )
    // No plan yet: the endpoint returns JSON null (not an error) — treat it
    // as an empty item list so the pre-generation pick stays deterministic.
    const planBody = (await planResp.json()) as {
      items: Array<{ l3_code: string }>
    } | null
    const existing = planBody ? planBody.items.map((item) => item.l3_code) : []
    const picks = applicable
      .filter((detail) => !existing.includes(detail.l3_code))
      .slice(0, 2)
    expect(picks).toHaveLength(2)
    for (const pick of picks) {
      await page.getByLabel(`选择 ${pick.l3_code}`).check()
    }
    await expect(page.getByText('已选择 2 项')).toBeVisible()
    await page.getByRole('button', { name: '生成所选学习任务' }).click()
    await expect(page.getByText(/已生成 \d+ 个学习任务/)).toBeVisible()
    const after = await (
      await page.request.get('/api/planning/annual-plan?year=2026')
    ).json()
    for (const pick of picks) {
      expect(
        after.items.some(
          (item: { l3_code: string }) => item.l3_code === pick.l3_code,
        ),
      ).toBe(true)
    }
    // an invalid batch (a still-unplanned row + an unknown code) fails as a
    // whole: nothing is created for the valid row in the same request
    const third = applicable.find(
      (detail) =>
        !existing.includes(detail.l3_code) &&
        detail.l3_code !== picks[0].l3_code &&
        detail.l3_code !== picks[1].l3_code,
    )!
    const invalid = await page.request.post(
      `/api/assessments/${draft.id}/generate-plan-items`,
      {
        data: { l3_codes: [third.l3_code, 'NOPE.NOPE.NOPE'] },
      },
    )
    expect(invalid.status()).toBe(422)
    const planAfter = await (
      await page.request.get('/api/planning/annual-plan?year=2026')
    ).json()
    expect(
      planAfter.items.some(
        (item: { l3_code: string }) => item.l3_code === third.l3_code,
      ),
    ).toBe(false)
  })

  test('repeated generation idempotently reuses tasks and creates no review', async ({
    page,
  }) => {
    const draft = await currentDraft(page)
    const planBefore = await (
      await page.request.get('/api/planning/annual-plan?year=2026')
    ).json()
    const codes = (
      planBefore.items as Array<{ l3_code: string }>
    ).map((item) => item.l3_code)
    expect(codes.length).toBeGreaterThanOrEqual(2)
    for (const code of codes.slice(0, 2)) {
      await page.getByLabel(`选择 ${code}`).check()
    }
    await page.getByRole('button', { name: '生成所选学习任务' }).click()
    // Issue #178: the same selection reuses the existing plan items/tasks
    await expect(
      page.getByText(/已生成 0 个学习任务（\d+ 个已存在）/),
    ).toBeVisible()
    const planAfter = await (
      await page.request.get('/api/planning/annual-plan?year=2026')
    ).json()
    expect(planAfter.items.length).toBe(planBefore.items.length)
    const tasks = await (
      await page.request.get('/api/planning/learning-tasks')
    ).json()
    const itemIds = new Set(
      (
        planAfter.items as Array<{ id: number; l3_code: string }>
      )
        .filter((item) => codes.slice(0, 2).includes(item.l3_code))
        .map((item) => item.id),
    )
    expect(
      tasks.filter((task: { plan_item_id: number }) =>
        itemIds.has(task.plan_item_id),
      ),
    ).toHaveLength(2)
    // generation creates no Assessment Review and never transitions status:
    // the Buddy-only review queue is a #178-removed surface (403 for members)
    const pendingResp = await page.request.get(
      '/api/assessments/reviews/pending',
    )
    expect(pendingResp.status()).toBe(403)
    const history = await (
      await page.request.get(`/api/assessments/${draft.id}/history`)
    ).json()
    expect(history).toHaveLength(0)
    const fresh = await (
      await page.request.get(`/api/assessments/${draft.id}`)
    ).json()
    expect(fresh.status).toBe('草稿')
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
              plan_quarter: 'Q1',
              plan_month: 2,
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
        'plan_quarter',
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

test.describe('Issue #50 historical inheritance and evidence gates', () => {
  test('creates a cross-year snapshot and keeps inherited evidence readable and writable', async ({
    page,
    browser,
  }) => {
    test.setTimeout(120_000)
    test.skip(
      !process.env.TCP_E2E_ISOLATED,
      'Issue #50 writes assessment data and requires an isolated database',
    )
    await loginAs(page, 'member2')
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
    const high =
      applicable.find(
        (detail) =>
          detail.l3_code !== low.l3_code && (detail.target_level ?? 0) >= 4,
      ) ?? applicable.find((detail) => detail.l3_code !== low.l3_code)!
    const details = previous.details.map((detail) => {
      if (detail.standard_target_applicable === false) {
        return {
          l3_node_id: detail.l3_node_id,
          l3_code: detail.l3_code,
          current_level: null,
        }
      }
      const current =
        detail.l3_code === low.l3_code
          ? 1
          : detail.l3_code === high.l3_code
            ? 3
            : (detail.target_level ?? 1)
      const hasGap =
        detail.target_level != null && current < detail.target_level
      return {
        l3_node_id: detail.l3_node_id,
        l3_code: detail.l3_code,
        current_level: current,
        evidence_note:
          detail.l3_code === low.l3_code ? null : `历史依据-${detail.l3_code}`,
        // positive-Gap items need an explicit plan decision before submit
        ...(hasGap
          ? { member_priority: '中' as const, include_in_plan: false }
          : {}),
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
    const submitted = await page.request.post(
      `/api/assessments/${previousId}/submit`,
      { data: { expected_revision: savedBody.revision } },
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
      {
        data: {
          conclusion: '认可',
          feedback: 'E2E 认可',
          expected_revision: (await submitted.json()).revision,
        },
      },
    )
    expect(reviewed.ok()).toBeTruthy()
    await buddy.close()

    const currentPreview = await page.request.get(
      `/api/assessments/scope-preview?year=2026&assessment_type=${encodeURIComponent('晋升复核')}`,
    )
    expect(currentPreview.ok()).toBeTruthy()
    const currentPreviewBody = (await currentPreview.json()) as {
      scope_token: string
      open_draft_id: number | null
    }
    let currentId: number
    if (currentPreviewBody.open_draft_id) {
      currentId = currentPreviewBody.open_draft_id
    } else {
      const currentCreated = await page.request.post('/api/assessments', {
        data: {
          year: 2026,
          assessment_type: '晋升复核',
          scope_token: currentPreviewBody.scope_token,
        },
      })
      expect(currentCreated.ok()).toBeTruthy()
      currentId = ((await currentCreated.json()) as { id: number }).id
    }
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
    await expect(lowSelect).toBeVisible()
    await lowSelect.selectOption('2')
    // evidence is no longer a submit gate — saving the updated level works
    // without touching the inherited evidence
    await page.getByRole('button', { name: '保存草稿' }).click()
    await expect(page.getByText('草稿已保存')).toBeVisible()

    const afterUi = await currentDraft(page, currentId)
    const lowUpdate = await page.request.patch(
      `/api/assessments/${currentId}/draft`,
      {
        data: {
          expected_revision: afterUi.revision,
          details: [
            {
              l3_node_id: inheritedLow.l3_node_id,
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
              l3_node_id: inheritedHigh.l3_node_id,
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
    const submittedCurrent = await page.request.post(
      `/api/assessments/${currentId}/submit`,
      {
        data: { expected_revision: highBody.revision },
      },
    )
    expect(submittedCurrent.ok()).toBeTruthy()
    const submittedBody = (await submittedCurrent.json()) as {
      plan_generation?: { created_items: number; created_tasks: number }
    }
    // Weak management: unchanged inherited evidence and undecided positive
    // Gaps are accepted. They stay in the backlog instead of becoming tasks.
    expect(submittedBody.plan_generation?.created_items).toBe(0)
    expect(submittedBody.plan_generation?.created_tasks).toBe(0)
  })
})

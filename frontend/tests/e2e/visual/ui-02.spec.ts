import { expect, test, type Page } from '@playwright/test'

import { loginAs } from '../fixtures/auth'

const VIEWPORTS = [
  { name: '1440x900', width: 1440, height: 900 },
  { name: '1024x768', width: 1024, height: 768 },
  { name: '768x900', width: 768, height: 900 },
] as const

async function ensure2026Draft(page: Page): Promise<number> {
  const preview = await page.request.get(
    '/api/assessments/scope-preview?year=2026',
  )
  expect(preview.ok()).toBeTruthy()
  const previewBody = (await preview.json()) as {
    scope_token: string
    open_draft_id: number | null
  }
  if (previewBody.open_draft_id) return previewBody.open_draft_id

  const created = await page.request.post('/api/assessments', {
    data: {
      year: 2026,
      assessment_type: '年度',
      scope_token: previewBody.scope_token,
    },
  })
  expect(created.ok()).toBeTruthy()
  const createdBody = (await created.json()) as { id: number }
  return createdBody.id
}

async function openM02(page: Page) {
  await page.goto('/capability/assessment')
  await expect(
    page.getByRole('heading', { name: '能力评级与提升计划' }),
  ).toBeVisible()
}

for (const viewport of VIEWPORTS) {
  test.describe(`M02 V1 @ ${viewport.name}`, () => {
    test.beforeEach(async ({ page }) => {
      test.skip(
        !process.env.TCP_E2E_ISOLATED,
        'M02 prepares a controlled draft only in the isolated E2E environment',
      )
      await page.setViewportSize(viewport)
      await loginAs(page, 'member2')
      await ensure2026Draft(page)
      await openM02(page)
    })

    test('keeps the approved M02 actions, navigation, and no-clipping contract', async ({
      page,
    }) => {
      const summary = page.getByLabel('评估摘要')
      await expect(summary).toBeVisible()
      for (const metric of ['三级能力项', '已评级', '存在差距', '已加入计划']) {
        await expect(summary).toContainText(metric)
      }

      const domainNav = page.getByRole('navigation', {
        name: '一级能力域导航',
      })
      await expect(
        domainNav.getByRole('button', { name: '全部能力域' }),
      ).toBeVisible()
      await expect(
        page.getByRole('combobox', { name: '搜索全部能力项' }),
      ).toBeVisible()
      const draftActions = page.getByLabel('能力评级与计划操作')
      await expect(draftActions).toBeVisible()
      await expect(draftActions.getByRole('button')).toHaveCount(2)
      const ratingSave = draftActions.getByRole('button', {
        name: '保存能力评级',
      })
      const generate = draftActions.getByRole('button', {
        name: '生成所选学习任务',
      })
      await expect(ratingSave).toBeVisible()
      await expect(ratingSave).not.toHaveClass(/primary/)
      await expect(generate).toHaveClass(/primary/)
      await expect(
        page.getByRole('button', { name: '生成所选学习任务' }),
      ).toHaveCount(1)
      await expect(page.getByText(/Assessment Review/)).toHaveCount(0)

      await domainNav.getByRole('button', { name: '全部能力域' }).focus()
      await expect(
        domainNav.getByRole('button', { name: '全部能力域' }),
      ).toBeFocused()

      const clipped = await page.evaluate(() => {
        const nodes = [
          document.documentElement,
          document.querySelector('[aria-label="一级能力域导航"]'),
          ...document.querySelectorAll('[aria-label^="当前等级"] button'),
        ].filter((node): node is HTMLElement => node instanceof HTMLElement)
        return nodes.some((node) => node.scrollWidth > node.clientWidth + 1)
      })
      expect(clipped).toBe(false)

      const table = page.getByTestId('assessment-table')
      await expect(table).toBeVisible()
      const ratingGroup = table.locator('[aria-label^="当前等级 "]').first()
      const levelNames = ratingGroup.locator('button small')
      await expect(levelNames).toHaveCount(6)
      await expect(
        ratingGroup.getByRole('button', {
          name: '0 · 未接触/无可验证输出',
        }),
      ).toBeVisible()
      await expect(levelNames.first()).toHaveText('未接触')
      for (let index = 0; index < 6; index += 1) {
        await expect(levelNames.nth(index)).toBeVisible()
      }
      if (viewport.width === 768) {
        const columns = await ratingGroup.evaluate((element) =>
          getComputedStyle(element).gridTemplateColumns.trim().split(/\s+/),
        )
        expect(columns).toHaveLength(6)
      }
      if (viewport.name === '1440x900') {
        const visibleRowCount = await page.evaluate(() => {
          const main = document.querySelector<HTMLElement>(
            '[data-testid="assessment-main-area"]',
          )
          if (!main) return null
          const mainRect = main.getBoundingClientRect()
          const footer = document.querySelector<HTMLElement>(
            '[aria-label="能力评级与计划操作"]',
          )
          const visibleTop = Math.max(0, mainRect.top)
          const visibleBottom = Math.min(
            window.innerHeight,
            mainRect.bottom,
            footer?.getBoundingClientRect().top ?? window.innerHeight,
          )
          return [...main.querySelectorAll<HTMLElement>('[id^="row-"]')].filter(
            (row) => {
              const rect = row.getBoundingClientRect()
              return rect.top >= visibleTop && rect.bottom <= visibleBottom
            },
          ).length
        })
        expect(visibleRowCount).not.toBeNull()
        expect(visibleRowCount).toBeGreaterThanOrEqual(6)
      }
      const initialRow = table
        .locator('[id^="row-"]')
        .filter({ has: page.locator('button[aria-label^="加入提升计划 "]') })
        .first()
      const rowId = await initialRow.getAttribute('id')
      expect(rowId).toBeTruthy()
      const row = page.locator(`#${rowId}`)
      const rating = row.locator('[aria-label^="当前等级"] button').first()
      if ((await rating.getAttribute('aria-pressed')) === 'true') {
        await rating.click()
      }
      await rating.click()
      await expect(rating).toHaveAttribute('aria-pressed', 'true')

      const join = row.locator('button[aria-label^="加入提升计划 "]')
      await expect(join).toBeEnabled()
      let planSave = page.waitForResponse(
        (response) =>
          response.request().method() === 'PATCH' &&
          /\/api\/assessments\/\d+\/draft$/.test(response.url()) &&
          response.ok(),
      )
      await join.click()
      await planSave
      const planEditor = row.locator('[data-testid^="plan-editor-"]')
      await expect(planEditor).toBeVisible()
      expect(
        await planEditor.evaluate((element) =>
          getComputedStyle(element).gridTemplateColumns.trim().split(/\s+/),
        ),
      ).toHaveLength(viewport.width === 768 ? 2 : 5)
      expect(
        await planEditor.evaluate(
          (element) => element.scrollWidth <= element.clientWidth + 1,
        ),
      ).toBe(true)

      planSave = page.waitForResponse(
        (response) =>
          response.request().method() === 'PATCH' &&
          /\/api\/assessments\/\d+\/draft$/.test(response.url()) &&
          response.ok(),
      )
      await row.locator('button[aria-label^="移出提升计划 "]').click()
      await planSave
      await expect(join).toBeVisible()
      await rating.click()
      await expect(rating).toHaveAttribute('aria-pressed', 'false')
    })
  })
}

test('persists one isolated M02 rating and plan draft at 1440', async ({
  page,
}) => {
  test.skip(
    !process.env.TCP_E2E_ISOLATED,
    'M02 prepares a controlled draft only in the isolated E2E environment',
  )
  await page.setViewportSize({ width: 1440, height: 900 })
  await loginAs(page, 'member2')
  const draftId = await ensure2026Draft(page)
  await openM02(page)

  const table = page.getByTestId('assessment-table')
  const initialRow = table
    .locator('[id^="row-"]')
    .filter({ has: page.locator('button[aria-label^="加入提升计划 "]') })
    .first()
  const rowId = await initialRow.getAttribute('id')
  expect(rowId).toBeTruthy()
  const row = page.locator(`#${rowId}`)
  const ratingLabel = await row
    .locator('[aria-label^="当前等级"]')
    .getAttribute('aria-label')
  if (!ratingLabel) throw new Error('expected the stable row rating label')
  const code = ratingLabel.replace('当前等级 ', '')
  if (!code) throw new Error('expected the stable row capability code')
  const rating = row.locator('[aria-label^="当前等级"] button').first()
  if ((await rating.getAttribute('aria-pressed')) === 'true') {
    await rating.click()
  }
  await rating.click()
  await expect(rating).toHaveAttribute('aria-pressed', 'true')

  const ratingSave = page.waitForResponse(
    (response) =>
      response.request().method() === 'PATCH' &&
      response.url().endsWith(`/api/assessments/${draftId}/draft`) &&
      response.ok(),
  )
  await page.getByRole('button', { name: '保存能力评级' }).click()
  await ratingSave
  await expect(
    page.getByRole('status', { name: '评级保存状态' }),
  ).toContainText('评级已保存')

  let planSave = page.waitForResponse(
    (response) =>
      response.request().method() === 'PATCH' &&
      response.url().endsWith(`/api/assessments/${draftId}/draft`) &&
      response.ok(),
  )
  await row.locator('button[aria-label^="加入提升计划 "]').click()
  await planSave

  planSave = page.waitForResponse(
    (response) =>
      response.request().method() === 'PATCH' &&
      response.url().endsWith(`/api/assessments/${draftId}/draft`) &&
      response.ok(),
  )
  await row.getByLabel(`优先级 ${code}`).selectOption('高')
  await planSave

  planSave = page.waitForResponse(
    (response) =>
      response.request().method() === 'PATCH' &&
      response.url().endsWith(`/api/assessments/${draftId}/draft`) &&
      response.ok(),
  )
  await row.getByLabel(`计划月份 ${code}`).fill('2026-05')
  await planSave

  await page.reload()
  await expect(
    page.getByRole('heading', { name: '能力评级与提升计划' }),
  ).toBeVisible()
  let persistedRow = page
    .getByLabel(`当前等级 ${code}`)
    .locator('xpath=ancestor::div[starts-with(@id, "row-")]')
  await expect(
    persistedRow.locator('[aria-label^="当前等级"] button').first(),
  ).toHaveAttribute('aria-pressed', 'true')
  await expect(
    persistedRow.getByRole('button', { name: `移出提升计划 ${code}` }),
  ).toBeVisible()
  await expect(persistedRow.getByLabel(`优先级 ${code}`)).toHaveValue('高')
  await expect(persistedRow.getByLabel(`计划月份 ${code}`)).toHaveValue(
    '2026-05',
  )

  await page.goto('/growth/annual-plan?year=2026')
  await expect(
    page.getByRole('heading', { name: '2026 年度成长旅程', level: 1 }),
  ).toBeVisible()
  await page.goBack()
  await expect(
    page.getByRole('heading', { name: '能力评级与提升计划' }),
  ).toBeVisible()
  persistedRow = page
    .getByLabel(`当前等级 ${code}`)
    .locator('xpath=ancestor::div[starts-with(@id, "row-")]')
  await expect(
    persistedRow.locator('[aria-label^="当前等级"] button').first(),
  ).toHaveAttribute('aria-pressed', 'true')
  await expect(
    persistedRow.getByRole('button', { name: `移出提升计划 ${code}` }),
  ).toBeVisible()
  await expect(persistedRow.getByLabel(`优先级 ${code}`)).toHaveValue('高')
  await expect(persistedRow.getByLabel(`计划月份 ${code}`)).toHaveValue(
    '2026-05',
  )
  await expect(page.getByText(/Assessment Review/)).toHaveCount(0)
})

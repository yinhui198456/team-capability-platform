import { expect, test, type Page } from '@playwright/test'

import { loginAs } from '../fixtures/auth'
import {
  capabilityMapModel,
  capabilityMapResourceDetail,
  capabilityMapResources,
} from '../fixtures/capability-map-mock'

async function mockCapabilityMap(page: Page) {
  let modelRequests = 0
  let currentUser: {
    id: number
    username: string
    full_name: string
    roles: string[]
  } | null = null
  await page.route('**/api/auth/login', async (route) => {
    const { username } = route.request().postDataJSON() as { username: string }
    const isLeader = username === 'leader'
    currentUser = {
      id: isLeader ? 1 : 2,
      username,
      full_name: isLeader ? 'Issue #52 Leader' : 'Issue #52 Member',
      roles: [isLeader ? 'Leader' : 'Member'],
    }
    await route.fulfill({ status: 200, json: currentUser })
  })
  await page.route('**/api/auth/me', async (route) => {
    if (currentUser) {
      await route.fulfill({ status: 200, json: currentUser })
      return
    }
    await route.fulfill({ status: 401, json: { detail: 'Unauthorized' } })
  })
  await page.route('**/api/capability-model**', async (route) => {
    if (route.request().method() === 'GET') {
      modelRequests += 1
      await route.fulfill({ status: 200, json: capabilityMapModel })
      return
    }
    await route.fulfill({ status: 200, json: route.request().postDataJSON() })
  })
  await page.route(
    '**/api/capability-standard-versions/published?model_id=1',
    async (route) => {
      await route.fulfill({
        status: 200,
        json: {
          version: {
            id: 1,
            model_id: 1,
            version_no: 1,
            label: 'Legacy Baseline v1',
            status: '已发布',
            published_at: '2026-07-29T00:00:00Z',
          },
          items: ['P4', 'P5', 'P6', 'P7', 'P8'].map((job_level, index) => ({
            l3_node_id: 1,
            l3_code: 'P01.01.01',
            job_level,
            applicable: true,
            target_level: index + 1,
            source: 'legacy_derived',
          })),
        },
      })
    },
  )
  await page.route('**/api/learning-resources**', async (route) => {
    const url = new URL(route.request().url())
    if (url.pathname.endsWith('/ISSUE52-M001')) {
      await route.fulfill({ status: 200, json: capabilityMapResourceDetail })
      return
    }
    await route.fulfill({ status: 200, json: capabilityMapResources })
  })
  return () => modelRequests
}

test.describe('Issue #52 capability map', () => {
  test('mounts one L1, unloads collapsed L3 DOM, and preserves per-domain state', async ({
    page,
  }) => {
    expect(
      capabilityMapModel.domains.reduce(
        (count, domain) => count + domain.children.length,
        0,
      ),
    ).toBe(51)
    expect(
      capabilityMapModel.domains.reduce(
        (count, domain) =>
          count +
          domain.children.reduce((total, l2) => total + l2.children.length, 0),
        0,
      ),
    ).toBe(310)
    await mockCapabilityMap(page)
    await loginAs(page, 'member')
    await page.goto('/capability/model')

    await expect(
      page.getByTestId('capability-domain-content-P01'),
    ).toBeVisible()
    await expect(
      page.locator('[data-testid^="capability-domain-content-"]'),
    ).toHaveCount(1)
    await expect(page.locator('[data-testid^="l3-row-"]')).toHaveCount(0)
    await expect(page.locator('[data-testid^="l2-group-"]')).toHaveCount(10)

    await page.getByTestId('l2-toggle-P01.01').click()
    await expect(page.locator('[data-testid^="l3-row-"]')).toHaveCount(9)
    await page.getByTestId('l2-toggle-P01.01').click()
    await expect(page.locator('[data-testid^="l3-row-"]')).toHaveCount(0)

    await page.getByTestId('l2-toggle-P01.02').click()
    await page.getByRole('tab', { name: /P02/ }).click()
    await expect(page.getByTestId('capability-domain-content-P01')).toHaveCount(
      0,
    )
    await page.getByRole('tab', { name: /P01/ }).click()
    await expect(page.getByTestId('l2-toggle-P01.02')).toHaveAttribute(
      'aria-expanded',
      'true',
    )
  })

  test('shows an explicit empty state for L2 standards without L3 paths', async ({
    page,
  }) => {
    await mockCapabilityMap(page)
    await loginAs(page, 'member')
    await page.goto('/capability/model')
    await page.getByTestId('capability-domain-tab-P02').click()
    await page.getByTestId('l2-toggle-P02.07').click()
    await expect(page.getByRole('status')).toContainText('三级达成路径待补充')
    await expect(page.locator('[data-testid^="l3-row-"]')).toHaveCount(0)
  })

  test('searches all levels, waits for selection, and locates across domains', async ({
    page,
  }) => {
    const modelRequests = await mockCapabilityMap(page)
    await loginAs(page, 'member')
    await page.goto('/capability/model')
    const search = page.getByRole('combobox', { name: '搜索能力地图' })
    await expect(page.getByTestId('capability-domain-tab-P01')).toBeVisible()
    const initialModelRequests = modelRequests()

    await search.fill('P01')
    await expect(
      page.getByRole('option').filter({ hasText: /^能力域/ }),
    ).toHaveCount(1)
    await expect(
      page
        .getByRole('option')
        .filter({ hasText: /^能力标准/ })
        .first(),
    ).toBeVisible()
    await expect(
      page
        .getByRole('option')
        .filter({ hasText: /^达成路径/ })
        .first(),
    ).toBeVisible()
    await expect(page.getByTestId('capability-domain-tab-P01')).toHaveAttribute(
      'aria-selected',
      'true',
    )

    await search.fill('跨域搜索目标达成路径')
    await expect(page.getByRole('option')).toHaveCount(1)
    await expect(page.getByRole('option')).toContainText('达成路径')
    await expect(page.getByRole('option')).toContainText('P02.03.07')
    await expect(page.getByRole('option')).toContainText('P02 能力域')
    await expect(page.getByRole('option')).toContainText('P02.03')
    await page.getByRole('option').click()
    await expect(page.getByTestId('capability-domain-tab-P02')).toHaveAttribute(
      'aria-selected',
      'true',
    )
    await expect(page.getByTestId('l2-toggle-P02.03')).toHaveAttribute(
      'aria-expanded',
      'true',
    )
    await expect(page.getByTestId('l3-row-P02.03.07')).toBeFocused()
    await expect(page.getByRole('dialog')).toHaveCount(0)

    await search.fill('没有这个能力')
    await expect(page.getByRole('status')).toContainText('未找到')
    await page.getByRole('button', { name: '清除搜索' }).click()
    await expect(search).toHaveValue('')
    expect(modelRequests()).toBe(initialModelRequests)
  })

  test('opens an L3 Drawer, handles Escape, and restores focus', async ({
    page,
  }) => {
    await mockCapabilityMap(page)
    await loginAs(page, 'member')
    await page.goto('/capability/model')
    await page.getByTestId('l2-toggle-P01.01').click()
    const row = page.getByTestId('l3-row-P01.01.01')
    await row.click()
    const dialog = page.getByRole('dialog', { name: 'P01.01.01' })
    await expect(dialog).toBeVisible()
    await expect(dialog).toContainText('所属能力域P01 · P01 能力域')
    await expect(dialog).toContainText('所属能力组P01.01 · P01 能力标准 1')
    await expect(dialog).toContainText('P01.01.01')
    await expect(dialog).toContainText('达成路径')
    await expect(dialog).toContainText('当前已发布职级标准')
    await expect(dialog).toContainText('Legacy Baseline v1')
    await expect(dialog).toContainText('目标掌握度 1 / 5')
    await expect(dialog).not.toContainText('P4 完整描述')
    await page.keyboard.press('Escape')
    await expect(dialog).toHaveCount(0)
    await expect(row).toBeFocused()
  })

  test('keeps focus stable after search location and closes Drawer on domain collapse', async ({
    page,
  }) => {
    await mockCapabilityMap(page)
    await loginAs(page, 'member')
    await page.goto('/capability/model')
    const search = page.getByRole('combobox', { name: '搜索能力地图' })
    await search.fill('跨域搜索目标达成路径')
    await page.getByRole('option').click()
    const focusedL3 = page.getByTestId('l3-row-P02.03.07')
    await expect(focusedL3).toBeFocused()

    await page.getByTestId('l2-toggle-P02.04').click()
    await expect(page.getByTestId('l2-toggle-P02.04')).toBeFocused()
    await focusedL3.click()
    await expect(page.getByRole('dialog')).toBeVisible()

    await page.getByRole('button', { name: '收起当前域' }).click()
    await expect(page.getByRole('dialog')).toHaveCount(0)
    await expect(page.locator('[data-testid^="l3-row-"]')).toHaveCount(0)
    await expect(
      page.getByTestId('capability-domain-content-P02'),
    ).toBeFocused()
  })

  test('closes and reopens search results without changing the query', async ({
    page,
  }) => {
    await mockCapabilityMap(page)
    await loginAs(page, 'member')
    await page.goto('/capability/model')
    const search = page.getByRole('combobox', { name: '搜索能力地图' })
    await search.fill('P02.03')
    await expect(page.getByRole('listbox')).toBeVisible()
    await page.getByRole('option').first().click()
    await expect(search).toHaveValue('P02.03')
    await expect(search).toHaveAttribute('aria-expanded', 'false')
    await expect(page.getByRole('listbox')).toHaveCount(0)
    await search.focus()
    await expect(page.getByRole('listbox')).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(page.getByRole('listbox')).toHaveCount(0)
  })

  test('resolves the initial hash and keeps the resource reverse link compatible', async ({
    page,
  }) => {
    await mockCapabilityMap(page)
    await loginAs(page, 'member')
    await page.goto('/capability/model#P02.03.07')
    await expect(page.getByTestId('capability-domain-tab-P02')).toHaveAttribute(
      'aria-selected',
      'true',
    )
    await expect(page.getByTestId('l3-row-P02.03.07')).toBeFocused()
    await expect(page.getByRole('dialog')).toHaveCount(0)

    await page.goto('/operations/resources')
    await page.getByLabel('资源详情').selectOption('ISSUE52-M001')
    const reverseLink = page.getByRole('link', { name: /P02\.03\.07/ })
    await expect(reverseLink).toHaveAttribute(
      'href',
      '/capability/model#P02.03.07',
    )
    await reverseLink.click()
    await expect(page.getByTestId('capability-domain-tab-P02')).toHaveAttribute(
      'aria-selected',
      'true',
    )
    await expect(page.getByTestId('l3-row-P02.03.07')).toBeFocused()
  })

  test('Leader can edit L1, L2, and L3 while viewing Drawer remains separate', async ({
    page,
  }) => {
    await mockCapabilityMap(page)
    await loginAs(page, 'leader')
    await page.goto('/capability/model')

    const editDrawer = page.getByTestId('node-edit-drawer')

    await page
      .getByTestId('capability-domain-content-P01')
      .getByRole('button', { name: '编辑' })
      .first()
      .click()
    await expect(editDrawer).toBeVisible()
    await expect(editDrawer).toContainText('编辑能力域')
    await expect(editDrawer).toContainText('P01')
    await page.getByRole('button', { name: '取消' }).click()
    await expect(editDrawer).toHaveCount(0)

    await page.getByTestId('l2-toggle-P01.01').click()
    await page.getByTestId('l2-edit-P01.01').click()
    await expect(editDrawer).toBeVisible()
    await expect(editDrawer).toContainText('编辑能力标准')
    await expect(editDrawer).toContainText('P01.01')
    await page.getByRole('button', { name: '取消' }).click()

    const l3Row = page.getByTestId('l3-row-P01.01.01')
    const l3Edit = page.getByTestId('l3-edit-P01.01.01')
    await expect(l3Edit).toBeVisible()
    const rowBox = await l3Row.locator('..').boundingBox()
    const editBox = await l3Edit.boundingBox()
    expect(rowBox).not.toBeNull()
    expect(editBox).not.toBeNull()
    expect(editBox!.x).toBeGreaterThanOrEqual(
      rowBox!.x + rowBox!.width - editBox!.width - 16,
    )
    expect(editBox!.x + editBox!.width).toBeLessThanOrEqual(
      rowBox!.x + rowBox!.width + 1,
    )

    // The read-only L3 drawer stays separate from the edit drawer: it has no
    // 编辑节点 button (that trigger lives on the row) and shows the detail
    // kicker instead of an edit form.
    await l3Row.click()
    const readOnlyDrawer = page.getByTestId('l3-drawer')
    await expect(readOnlyDrawer).toBeVisible()
    await expect(readOnlyDrawer).toContainText('达成路径详情')
    await expect(
      readOnlyDrawer.getByRole('button', { name: '编辑节点' }),
    ).toHaveCount(0)
    await expect(editDrawer).toHaveCount(0)
    await page.keyboard.press('Escape')
    await expect(readOnlyDrawer).toHaveCount(0)

    await page.getByTestId('l3-edit-P01.01.01').click()
    await expect(editDrawer).toBeVisible()
    await expect(editDrawer).toContainText('编辑达成路径')
    await expect(editDrawer).toContainText('P01.01.01')
  })
})

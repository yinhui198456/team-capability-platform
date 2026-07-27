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
    await expect(page.locator('[data-testid^="l2-group-"]')).toHaveCount(4)

    await page.getByTestId('l2-toggle-P01.01').click()
    await expect(page.locator('[data-testid^="l3-row-"]')).toHaveCount(14)
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
      page.getByRole('option').filter({ hasText: /^L1/ }),
    ).toHaveCount(1)
    await expect(
      page.getByRole('option').filter({ hasText: /^L2/ }).first(),
    ).toBeVisible()
    await expect(
      page.getByRole('option').filter({ hasText: /^L3/ }).first(),
    ).toBeVisible()
    await expect(page.getByTestId('capability-domain-tab-P01')).toHaveAttribute(
      'aria-selected',
      'true',
    )

    await search.fill('跨域搜索目标能力')
    await expect(page.getByRole('option')).toHaveCount(1)
    await expect(page.getByRole('option')).toContainText('L3')
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
    await expect(dialog).toContainText('P01.01.01 P4 完整描述')
    await expect(dialog).toContainText('该能力项的 P4–P8 完整描述')
    await page.keyboard.press('Escape')
    await expect(dialog).toHaveCount(0)
    await expect(row).toBeFocused()
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

    await page
      .getByTestId('capability-domain-content-P01')
      .getByRole('button', { name: '编辑' })
      .first()
      .click()
    await expect(page.locator('.edit-form')).toContainText('编辑 P01 (L1)')
    await page.getByRole('button', { name: '取消' }).click()

    await page.getByTestId('l2-toggle-P01.01').click()
    await page.getByTestId('l2-edit-P01.01').click()
    await expect(page.locator('.edit-form')).toContainText('编辑 P01.01 (L2)')
    await page.getByRole('button', { name: '取消' }).click()

    await page.getByTestId('l3-row-P01.01.01').click()
    await expect(page.getByRole('dialog')).toBeVisible()
    await expect(
      page.getByRole('dialog').getByRole('button', { name: '编辑节点' }),
    ).toHaveCount(0)
    await page.keyboard.press('Escape')
    await page.getByTestId('l3-edit-P01.01.01').click()
    await expect(page.locator('.edit-form')).toContainText(
      '编辑 P01.01.01 (L3)',
    )
  })
})

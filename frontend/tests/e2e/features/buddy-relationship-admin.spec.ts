import { expect, test, type Page } from '@playwright/test'

import { loginAs } from '../fixtures/auth'

const today = new Date().toISOString().split('T')[0]
const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000)
  .toISOString()
  .split('T')[0]

async function loginWithCredentials(
  page: Page,
  username: string,
  password: string,
): Promise<void> {
  const resp = await page.request.post('/api/auth/login', {
    data: { username, password },
  })
  expect(resp.ok()).toBeTruthy()
  const setCookie = resp.headers()['set-cookie'] as string
  const match = /tcp_session=([^;]+)/.exec(setCookie)
  if (!match) throw new Error('session cookie not set')
  await page.context().addCookies([
    {
      name: 'tcp_session',
      value: match[1],
      domain: 'localhost',
      path: '/',
      httpOnly: true,
    },
  ])
}

async function adminCookies(page: Page): Promise<string> {
  await loginAs(page, 'admin')
  const cookies = await page.context().cookies()
  const session = cookies.find(
    (c: { name: string; value: string }) => c.name === 'tcp_session',
  )
  if (!session) throw new Error('admin session not found')
  return `tcp_session=${session.value}`
}

async function createTestUsers(page: Page, tag: string) {
  const cookie = await adminCookies(page)
  const suffix = `${Date.now().toString(36)}_${tag}`
  const memberUsername = `e2e_member_${suffix}`
  const buddyOneUsername = `e2e_buddy1_${suffix}`
  const buddyTwoUsername = `e2e_buddy2_${suffix}`
  const memberFullName = `E2E Member ${suffix}`
  const buddyOneFullName = `E2E Buddy One ${suffix}`
  const buddyTwoFullName = `E2E Buddy Two ${suffix}`

  const memberResp = await page.request.post('/api/system/users', {
    headers: { cookie },
    data: {
      username: memberUsername,
      full_name: memberFullName,
      password: '123456',
      is_active: true,
      roles: ['Member'],
    },
  })
  expect(memberResp.ok()).toBeTruthy()
  const memberId = (await memberResp.json()).id

  const buddyOneResp = await page.request.post('/api/system/users', {
    headers: { cookie },
    data: {
      username: buddyOneUsername,
      full_name: buddyOneFullName,
      password: '123456',
      is_active: true,
      roles: ['Buddy'],
    },
  })
  expect(buddyOneResp.ok()).toBeTruthy()
  const buddyOneId = (await buddyOneResp.json()).id

  const buddyTwoResp = await page.request.post('/api/system/users', {
    headers: { cookie },
    data: {
      username: buddyTwoUsername,
      full_name: buddyTwoFullName,
      password: '123456',
      is_active: true,
      roles: ['Buddy'],
    },
  })
  expect(buddyTwoResp.ok()).toBeTruthy()
  const buddyTwoId = (await buddyTwoResp.json()).id

  return {
    cookie,
    memberId,
    buddyOneId,
    buddyTwoId,
    memberUsername,
    buddyOneUsername,
    buddyTwoUsername,
    memberFullName,
    buddyOneFullName,
    buddyTwoFullName,
  }
}

test.describe('buddy relationship admin management', () => {
  test('admin creates member and buddies then assigns primary buddy', async ({
    page,
  }) => {
    const {
      cookie,
      memberId,
      buddyOneId,
      memberUsername,
      memberFullName,
      buddyOneFullName,
    } = await createTestUsers(page, 'assign')

    const relResp = await page.request.post('/api/system/buddy-relationships', {
      headers: { cookie },
      data: {
        member_id: memberId,
        buddy_id: buddyOneId,
        effective_date: today,
        expiry_date: null,
      },
    })
    expect(relResp.ok()).toBeTruthy()
    const rel = await relResp.json()
    expect(rel.buddy_name).toBe(buddyOneFullName)
    expect(rel.effective_date).toBe(today)
    expect(rel.expiry_date).toBeNull()

    await page.goto('/system/users')
    await page
      .getByRole('button', {
        name: new RegExp(`${memberFullName} · ${memberUsername}`),
      })
      .click()
    await expect(
      page.getByRole('heading', { name: '主 Buddy 关系' }),
    ).toBeVisible()
    const card = page.locator('.buddy-relationship-card')
    await expect(card.getByText(buddyOneFullName)).toBeVisible()
    await expect(card.getByText('当前有效')).toBeVisible()
  })

  test('assigned buddy sees and can access member', async ({ page }) => {
    const { memberId, buddyOneId, buddyOneUsername, memberFullName } =
      await createTestUsers(page, 'access')

    await loginWithCredentials(page, 'admin', '123456')
    const adminCookie = (await page.context().cookies()).find(
      (c: { name: string; value: string }) => c.name === 'tcp_session',
    )
    if (!adminCookie) throw new Error('admin cookie not found')
    const cookie = `tcp_session=${adminCookie.value}`

    const relResp = await page.request.post('/api/system/buddy-relationships', {
      headers: { cookie },
      data: {
        member_id: memberId,
        buddy_id: buddyOneId,
        effective_date: today,
        expiry_date: null,
      },
    })
    expect(relResp.ok()).toBeTruthy()

    await loginWithCredentials(page, buddyOneUsername, '123456')
    await page.goto('/mentoring/dashboard')
    await expect(page.getByText(memberFullName)).toBeVisible()

    const meResp = await page.request.get('/api/auth/me')
    expect(meResp.ok()).toBeTruthy()
    const me = await meResp.json()
    expect(
      me.assigned_members.some((m: { id: number }) => m.id === memberId),
    ).toBe(true)

    const profileResp = await page.request.get(
      `/api/planning/profiles?year=${new Date().getFullYear()}&member_id=${memberId}`,
    )
    expect(profileResp.status()).toBe(200)
  })

  test('non-responsible buddy cannot access member via UI or API', async ({
    page,
  }) => {
    const { memberId, buddyOneId, buddyTwoUsername, memberFullName } =
      await createTestUsers(page, 'block')

    await loginWithCredentials(page, 'admin', '123456')
    const adminCookie = (await page.context().cookies()).find(
      (c: { name: string; value: string }) => c.name === 'tcp_session',
    )
    if (!adminCookie) throw new Error('admin cookie not found')
    const cookie = `tcp_session=${adminCookie.value}`

    const relResp = await page.request.post('/api/system/buddy-relationships', {
      headers: { cookie },
      data: {
        member_id: memberId,
        buddy_id: buddyOneId,
        effective_date: today,
        expiry_date: null,
      },
    })
    expect(relResp.ok()).toBeTruthy()

    await loginWithCredentials(page, buddyTwoUsername, '123456')
    await page.goto('/mentoring/dashboard')
    await expect(page.getByText(memberFullName)).not.toBeVisible()

    const meResp = await page.request.get('/api/auth/me')
    expect(meResp.ok()).toBeTruthy()
    const me = await meResp.json()
    expect(
      me.assigned_members.some((m: { id: number }) => m.id === memberId),
    ).toBe(false)

    const profileResp = await page.request.get(
      `/api/planning/profiles?year=${new Date().getFullYear()}&member_id=${memberId}`,
    )
    expect(profileResp.status()).toBe(403)
  })

  test('ending relationship revokes old buddy and new buddy gains access', async ({
    page,
  }) => {
    const {
      cookie,
      memberId,
      buddyOneId,
      buddyTwoId,
      buddyOneUsername,
      buddyTwoUsername,
      memberFullName,
    } = await createTestUsers(page, 'swap')

    // 1. Create relationship that started yesterday (so we can end on yesterday)
    const activeResp = await page.request.post(
      '/api/system/buddy-relationships',
      {
        headers: { cookie },
        data: {
          member_id: memberId,
          buddy_id: buddyOneId,
          effective_date: yesterday,
          expiry_date: null,
        },
      },
    )
    expect(activeResp.ok()).toBeTruthy()
    const activeRel = await activeResp.json()

    // 2. End it via /end with end_date=yesterday (valid: end >= effective)
    const endResp = await page.request.post(
      `/api/system/buddy-relationships/${activeRel.id}/end`,
      {
        headers: { cookie },
        data: { end_date: yesterday },
      },
    )
    expect(endResp.ok()).toBeTruthy()

    // 3. Old buddy immediately loses access (expired as of today)
    await loginWithCredentials(page, buddyOneUsername, '123456')
    const oldMeResp = await page.request.get('/api/auth/me')
    const oldMe = await oldMeResp.json()
    expect(
      oldMe.assigned_members.some((m: { id: number }) => m.id === memberId),
    ).toBe(false)

    await page.goto('/mentoring/dashboard')
    await expect(page.getByText(memberFullName)).not.toBeVisible()

    // Old buddy cannot access member profile
    const blockedResp = await page.request.get(
      `/api/planning/profiles?year=${new Date().getFullYear()}&member_id=${memberId}`,
    )
    expect(blockedResp.status()).toBe(403)

    // 4. Create new relationship for buddyTwo (effective_date=today)
    const newResp = await page.request.post('/api/system/buddy-relationships', {
      headers: { cookie },
      data: {
        member_id: memberId,
        buddy_id: buddyTwoId,
        effective_date: today,
        expiry_date: null,
      },
    })
    expect(newResp.ok()).toBeTruthy()

    // 5. New buddy gains access
    await loginWithCredentials(page, buddyTwoUsername, '123456')
    const newMeResp = await page.request.get('/api/auth/me')
    const newMe = await newMeResp.json()
    expect(
      newMe.assigned_members.some((m: { id: number }) => m.id === memberId),
    ).toBe(true)

    await page.goto('/mentoring/dashboard')
    await expect(page.getByText(memberFullName)).toBeVisible()

    const profileResp = await page.request.get(
      `/api/planning/profiles?year=${new Date().getFullYear()}&member_id=${memberId}`,
    )
    expect(profileResp.status()).toBe(200)
  })

  test('admin assigns buddy through browser UI form', async ({ page }) => {
    const {
      memberUsername,
      memberFullName,
      buddyOneFullName,
    } = await createTestUsers(page, 'ui')

    await loginAs(page, 'admin')
    await page.goto('/system/users')

    // Select member in user list
    await page
      .getByRole('button', {
        name: new RegExp(`${memberFullName} · ${memberUsername}`),
      })
      .click()

    await expect(
      page.getByRole('heading', { name: '主 Buddy 关系' }),
    ).toBeVisible()
    // Empty state
    await expect(page.getByText('该成员暂无 Buddy 关系。')).toBeVisible()

    // Click "新增关系"
    await page.getByRole('button', { name: '新增关系' }).click()
    await expect(page.getByRole('heading', { name: '新增关系' })).toBeVisible()

    // Select buddy from dropdown by value (the option's value is buddy's id)
    const buddySelect = page.getByRole('combobox', { name: 'Buddy' })
    const options = await buddySelect.locator('option').all()
    let targetValue = ''
    for (const opt of options) {
      const text = (await opt.textContent()) ?? ''
      if (text.includes(buddyOneFullName)) {
        targetValue = (await opt.getAttribute('value')) ?? ''
        break
      }
    }
    expect(targetValue).toBeTruthy()
    await buddySelect.selectOption(targetValue)

    // Fill effective_date
    const dateInput = page.getByLabel('生效日期')
    await dateInput.fill(today)

    // Submit
    await page.getByRole('button', { name: '保存关系' }).click()

    // UI should show the new relationship
    await expect(page.getByText(buddyOneFullName)).toBeVisible()
    await expect(page.getByText('当前有效')).toBeVisible()
    await expect(page.getByText('该成员暂无 Buddy 关系。')).not.toBeVisible()
  })

  test('admin page shows relationship history and status', async ({ page }) => {
    const {
      cookie,
      memberId,
      buddyOneId,
      buddyTwoId,
      memberUsername,
      memberFullName,
      buddyOneFullName,
      buddyTwoFullName,
    } = await createTestUsers(page, 'history')

    const oldResp = await page.request.post('/api/system/buddy-relationships', {
      headers: { cookie },
      data: {
        member_id: memberId,
        buddy_id: buddyOneId,
        effective_date: yesterday,
        expiry_date: yesterday,
      },
    })
    expect(oldResp.ok()).toBeTruthy()

    const newResp = await page.request.post('/api/system/buddy-relationships', {
      headers: { cookie },
      data: {
        member_id: memberId,
        buddy_id: buddyTwoId,
        effective_date: today,
        expiry_date: null,
      },
    })
    expect(newResp.ok()).toBeTruthy()

    await page.goto('/system/users')
    await page
      .getByRole('button', {
        name: new RegExp(`${memberFullName} · ${memberUsername}`),
      })
      .click()
    await expect(
      page.getByRole('heading', { name: '主 Buddy 关系' }),
    ).toBeVisible()

    const list = page.locator('.buddy-relationship-list')
    await expect(list.getByText(buddyOneFullName)).toBeVisible()
    await expect(list.getByText('已失效')).toBeVisible()
    await expect(list.getByText(buddyTwoFullName)).toBeVisible()
    await expect(list.getByText('当前有效')).toBeVisible()

    const historyResp = await page.request.get(
      `/api/system/buddy-relationships/${memberId}`,
      { headers: { cookie } },
    )
    expect(historyResp.ok()).toBeTruthy()
    const history = await historyResp.json()
    expect(history.length).toBeGreaterThanOrEqual(2)
    expect(history[0].buddy_name).toBe(buddyTwoFullName)
    expect(history[1].buddy_name).toBe(buddyOneFullName)
  })
})

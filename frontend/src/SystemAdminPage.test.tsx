/// @vitest-environment jsdom

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

import { App } from './App'
import { MemoryRouter } from 'react-router-dom'

const USERS = [
  {
    id: 1,
    username: 'admin',
    full_name: 'Admin',
    is_active: true,
    roles: ['Admin'],
    current_level: null,
    target_level: null,
  },
  {
    id: 2,
    username: 'zhangsan',
    full_name: '张三',
    is_active: true,
    roles: ['Member', 'Buddy'],
    current_level: 'P5',
    target_level: 'P6',
  },
  {
    id: 3,
    username: 'lisi',
    full_name: '李四',
    is_active: false,
    roles: ['Member'],
    current_level: 'P4',
    target_level: 'P5',
  },
  {
    id: 4,
    username: 'wangwu',
    full_name: '王五',
    is_active: true,
    roles: ['Leader'],
    current_level: null,
    target_level: null,
  },
]

const CONFIGS = [
  {
    code: 'default_plan_cycle',
    name: '默认计划周期',
    value: '12',
    value_type: 'integer',
    description: '年度成长计划默认月数',
    enabled: true,
  },
]

function response(payload: unknown) {
  return Promise.resolve({ ok: true, json: () => Promise.resolve(payload) })
}

function errorResponse(status: number, detail: string): Promise<Response> {
  return Promise.resolve({
    ok: false,
    status,
    json: () => Promise.resolve({ detail }),
  }) as unknown as Promise<Response>
}

let posted: Array<Record<string, unknown>> = []
let put: Array<{ id: number; body: Record<string, unknown> }> = []
let users: typeof USERS

/** adminFetch: /api/auth/me as Admin, system endpoints, records POST/PUT bodies. */
function adminFetch(overrides?: { users?: typeof USERS }) {
  users = overrides?.users ?? USERS
  return vi.fn((input: string, init?: RequestInit) => {
    const url = String(input)
    const method = init?.method ?? 'GET'
    if (url === '/api/auth/me') {
      return response({
        id: 1,
        username: 'admin',
        full_name: 'Admin',
        roles: ['Admin'],
      })
    }
    if (url === '/api/system/users' && method === 'GET') return response(users)
    if (url === '/api/system/users' && method === 'POST') {
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>
      posted.push(body)
      return response({
        id: 99,
        username: body.username,
        full_name: body.full_name,
        is_active: body.is_active,
        roles: body.roles,
        current_level: body.current_level ?? null,
        target_level: body.target_level ?? null,
      })
    }
    if (url.startsWith('/api/system/users/') && method === 'PUT') {
      const id = Number(url.split('/').pop())
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>
      put.push({ id, body })
      return response({
        id,
        username: 'zhangsan',
        full_name: body.full_name,
        is_active: body.is_active,
        roles: body.roles,
        current_level: body.current_level ?? null,
        target_level: body.target_level ?? null,
      })
    }
    if (url === '/api/planning/available-years') {
      return response({ available_years: [2026], active_year: 2026 })
    }
    if (url === '/api/system/roles') {
      return response(['Member', 'Buddy', 'Leader', 'Admin'])
    }
    if (url === '/api/system/settings' && method === 'GET') {
      return response(CONFIGS)
    }
    if (url.startsWith('/api/system/settings/') && method === 'PUT') {
      const code = url.split('/').pop() ?? ''
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>
      put.push({ id: -1, body: { code, ...body } })
      return response({
        code,
        ...body,
        name: '',
        value_type: '',
        description: '',
      })
    }
    return response({})
  })
}

function renderAdmin() {
  vi.stubGlobal('fetch', adminFetch())
  render(
    <MemoryRouter initialEntries={['/system/users']}>
      <App />
    </MemoryRouter>,
  )
}

async function openCreateDrawer() {
  fireEvent.click(await screen.findByTestId('create-user-btn'))
  await screen.findByRole('dialog', { name: /创建用户/ })
}

async function openEditDrawer(userId: number) {
  fireEvent.click(await screen.findByTestId(`user-edit-${userId}`))
  await screen.findByRole('dialog', { name: /编辑用户/ })
}

beforeEach(() => {
  posted = []
  put = []
  vi.stubGlobal(
    'matchMedia',
    vi.fn().mockImplementation(() => ({
      addEventListener: vi.fn(),
      addListener: vi.fn(),
      dispatchEvent: vi.fn(),
      matches: false,
      media: '',
      onchange: null,
      removeEventListener: vi.fn(),
      removeListener: vi.fn(),
    })),
  )
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

it('renders title, search/filters, create button, table and user rows', async () => {
  renderAdmin()
  expect(await screen.findByRole('heading', { name: '系统管理' })).toBeTruthy()
  expect(screen.getByLabelText('搜索')).toBeTruthy()
  expect(screen.getByLabelText('角色筛选')).toBeTruthy()
  expect(screen.getByLabelText('状态筛选')).toBeTruthy()
  expect(screen.getByTestId('create-user-btn')).toBeTruthy()
  const header = await screen.findByRole('table')
  ;['姓名', '用户名', '角色', '状态', '当前等级', '目标等级', '操作'].forEach(
    (column) => {
      expect(
        within(header).getByRole('columnheader', { name: column }),
      ).toBeTruthy()
    },
  )
  await waitFor(() => {
    const zhangRow = screen.getByRole('row', { name: /张三/ })
    expect(within(zhangRow).getByText('zhangsan')).toBeTruthy()
    expect(within(zhangRow).getByText('Member、Buddy')).toBeTruthy()
    expect(within(zhangRow).getByText('P5')).toBeTruthy()
    expect(within(zhangRow).getByText('P6')).toBeTruthy()
    expect(within(zhangRow).getByRole('button', { name: '编辑' })).toBeTruthy()
    expect(screen.getAllByText('停用').length).toBeGreaterThan(0)
    expect(screen.getAllByText('启用').length).toBeGreaterThan(1)
    expect(screen.getByTestId('user-edit-2')).toBeTruthy()
  })
})

it('searches by full name and by username', async () => {
  renderAdmin()
  await screen.findByText('张三')
  const search = screen.getByLabelText('搜索')
  fireEvent.change(search, { target: { value: '张三' } })
  await waitFor(() => {
    expect(screen.getByText('张三')).toBeTruthy()
    expect(screen.queryByText('李四')).toBeNull()
  })
  fireEvent.change(search, { target: { value: 'zhangsan' } })
  await waitFor(() => {
    expect(screen.getByText('zhangsan')).toBeTruthy()
    expect(screen.queryByText('wangwu')).toBeNull()
  })
  fireEvent.change(search, { target: { value: '' } })
  await waitFor(() => {
    expect(screen.getByText('wangwu')).toBeTruthy()
  })
})

it('filters by role and by active status', async () => {
  renderAdmin()
  await screen.findByText('张三')
  fireEvent.change(screen.getByLabelText('角色筛选'), {
    target: { value: 'Member' },
  })
  await waitFor(() => {
    expect(screen.getByText('张三')).toBeTruthy()
    expect(screen.getByText('李四')).toBeTruthy()
    expect(screen.queryByText('王五')).toBeNull()
  })
  fireEvent.change(screen.getByLabelText('状态筛选'), {
    target: { value: 'inactive' },
  })
  await waitFor(() => {
    expect(screen.queryByText('张三')).toBeNull()
    expect(screen.getByText('李四')).toBeTruthy()
  })
})

it('shows an empty state when nothing matches and when no users exist', async () => {
  renderAdmin()
  await screen.findByText('张三')
  fireEvent.change(screen.getByLabelText('搜索'), {
    target: { value: '不存在的用户' },
  })
  expect(await screen.findByText(/没有符合条件的用户/)).toBeTruthy()
  expect(screen.getByRole('table')).toBeTruthy()
})

it('shows a dedicated empty state when there are no users at all', async () => {
  vi.stubGlobal('fetch', adminFetch({ users: [] }))
  render(
    <MemoryRouter initialEntries={['/system/users']}>
      <App />
    </MemoryRouter>,
  )
  expect(await screen.findByText(/暂无用户/)).toBeTruthy()
  expect(screen.queryByRole('table')).toBeNull()
})

it('create drawer opens with accessible name and focuses the first field', async () => {
  renderAdmin()
  await openCreateDrawer()
  const dialog = screen.getByRole('dialog', { name: /创建用户/ })
  expect(dialog.getAttribute('aria-modal')).toBe('true')
  expect(screen.getByLabelText('用户名')).toBeTruthy()
  expect(screen.getByLabelText('姓名')).toBeTruthy()
  expect(screen.getByLabelText('初始密码')).toBeTruthy()
  expect(screen.getByLabelText('启用账号')).toBeTruthy()
  expect(document.activeElement).toBe(screen.getByLabelText('用户名'))
})

it('creating a Member user sends P4–P8 current/target levels in the payload', async () => {
  renderAdmin()
  await openCreateDrawer()
  fireEvent.change(screen.getByLabelText('用户名'), {
    target: { value: 'zhaoliu' },
  })
  fireEvent.change(screen.getByLabelText('姓名'), {
    target: { value: '赵六' },
  })
  fireEvent.change(screen.getByLabelText('初始密码'), {
    target: { value: 'M0ck-Placeholder-9' },
  })
  fireEvent.click(screen.getByRole('checkbox', { name: 'Member' }))
  const current = screen.getByLabelText('当前等级') as HTMLSelectElement
  const target = screen.getByLabelText('目标等级') as HTMLSelectElement
  expect([...current.options].map((option) => option.value)).toEqual([
    '',
    'P4',
    'P5',
    'P6',
    'P7',
    'P8',
  ])
  expect([...target.options].map((option) => option.value)).toEqual([
    '',
    'P4',
    'P5',
    'P6',
    'P7',
    'P8',
  ])
  fireEvent.change(current, { target: { value: 'P5' } })
  fireEvent.change(target, { target: { value: 'P6' } })
  expect(screen.getByText(/等级按用户配置/)).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: '保存' }))
  await waitFor(() => {
    expect(posted).toHaveLength(1)
    expect(posted[0]).toMatchObject({
      username: 'zhaoliu',
      password: 'M0ck-Placeholder-9',
      full_name: '赵六',
      is_active: true,
      roles: ['Member'],
      current_level: 'P5',
      target_level: 'P6',
    })
  })
  await waitFor(() => {
    expect(screen.queryByRole('dialog')).toBeNull()
  })
})

it('without the Member role the level fields are hidden and payload keeps the contract', async () => {
  renderAdmin()
  await openCreateDrawer()
  fireEvent.change(screen.getByLabelText('用户名'), {
    target: { value: 'zhaoliu' },
  })
  fireEvent.change(screen.getByLabelText('姓名'), {
    target: { value: '赵六' },
  })
  fireEvent.change(screen.getByLabelText('初始密码'), {
    target: { value: 'M0ck-Placeholder-9' },
  })
  fireEvent.click(screen.getByRole('checkbox', { name: 'Leader' }))
  expect(screen.queryByLabelText('当前等级')).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: '保存' }))
  await waitFor(() => {
    expect(posted).toHaveLength(1)
    expect(posted[0]).toMatchObject({
      username: 'zhaoliu',
      roles: ['Leader'],
    })
    expect(posted[0].current_level).toBeNull()
    expect(posted[0].target_level).toBeNull()
  })
})

it('blocks saving a Member without levels and shows an actionable error', async () => {
  renderAdmin()
  await openCreateDrawer()
  fireEvent.change(screen.getByLabelText('用户名'), {
    target: { value: 'zhaoliu' },
  })
  fireEvent.change(screen.getByLabelText('姓名'), {
    target: { value: '赵六' },
  })
  fireEvent.change(screen.getByLabelText('初始密码'), {
    target: { value: 'M0ck-Placeholder-9' },
  })
  fireEvent.click(screen.getByRole('checkbox', { name: 'Member' }))
  fireEvent.click(screen.getByRole('button', { name: '保存' }))
  expect((await screen.findByRole('alert')).textContent).toMatch(
    /请为 Member 用户配置当前等级与目标等级/,
  )
  expect(screen.getByRole('dialog')).toBeTruthy()
  expect(posted).toHaveLength(0)
})

it('edit drawer pre-fills user values and PUTs the edit payload', async () => {
  renderAdmin()
  await openEditDrawer(2)
  const dialog = screen.getByRole('dialog', { name: /编辑用户/ })
  expect(dialog.textContent).toContain('张三')
  expect((screen.getByLabelText('姓名') as HTMLInputElement).value).toBe('张三')
  expect(
    (screen.getByRole('checkbox', { name: 'Member' }) as HTMLInputElement)
      .checked,
  ).toBe(true)
  expect((screen.getByLabelText('当前等级') as HTMLSelectElement).value).toBe(
    'P5',
  )
  expect((screen.getByLabelText('目标等级') as HTMLSelectElement).value).toBe(
    'P6',
  )
  fireEvent.change(screen.getByLabelText('姓名'), {
    target: { value: '张三丰' },
  })
  fireEvent.click(screen.getByRole('button', { name: '保存' }))
  await waitFor(() => {
    expect(put).toHaveLength(1)
    expect(put[0].id).toBe(2)
    expect(put[0].body).toMatchObject({
      full_name: '张三丰',
      is_active: true,
      roles: ['Member', 'Buddy'],
      current_level: 'P5',
      target_level: 'P6',
    })
  })
  await waitFor(() => {
    expect(screen.queryByRole('dialog')).toBeNull()
  })
  await waitFor(() => {
    expect(document.activeElement).toBe(screen.getByTestId('user-edit-2'))
  })
})

it('removing Member hides levels but keeps existing values in the payload', async () => {
  renderAdmin()
  await openEditDrawer(2)
  fireEvent.click(screen.getByRole('checkbox', { name: 'Member' }))
  expect(screen.queryByLabelText('当前等级')).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: '保存' }))
  await waitFor(() => {
    expect(put).toHaveLength(1)
    expect(put[0].body).toMatchObject({
      roles: ['Buddy'],
      current_level: 'P5',
      target_level: 'P6',
    })
  })
})

it('save failure keeps the drawer open, preserves input and shows a Chinese error', async () => {
  renderAdmin()
  await openEditDrawer(2)
  const fetchMock = vi.mocked(fetch)
  fetchMock.mockImplementationOnce((input, init) => {
    if (String(input).startsWith('/api/system/users/')) {
      return errorResponse(422, '该账号信息无法保存：角色或职级无效')
    }
    return fetchMock(input, init)
  })
  fireEvent.change(screen.getByLabelText('姓名'), {
    target: { value: '张三丰' },
  })
  fireEvent.click(screen.getByRole('button', { name: '保存' }))
  expect((await screen.findByRole('alert')).textContent).toMatch(
    /该账号信息无法保存：角色或职级无效/,
  )
  expect(screen.getByRole('dialog')).toBeTruthy()
  expect((screen.getByLabelText('姓名') as HTMLInputElement).value).toBe(
    '张三丰',
  )
})

it('Esc, cancel and mask close the drawer and restore focus to the trigger', async () => {
  renderAdmin()
  await openCreateDrawer()
  fireEvent.keyDown(document, { key: 'Escape' })
  await waitFor(() => {
    expect(screen.queryByRole('dialog')).toBeNull()
  })
  expect(document.activeElement).toBe(screen.getByTestId('create-user-btn'))

  await openCreateDrawer()
  fireEvent.click(screen.getByRole('button', { name: '取消' }))
  await waitFor(() => {
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  await openCreateDrawer()
  fireEvent.click(screen.getByTestId('user-drawer-mask'))
  await waitFor(() => {
    expect(screen.queryByRole('dialog')).toBeNull()
  })
  expect(document.activeElement).toBe(screen.getByTestId('create-user-btn'))
})

it('switching users does not leak the previous user form state', async () => {
  renderAdmin()
  await openEditDrawer(2)
  fireEvent.change(screen.getByLabelText('姓名'), {
    target: { value: '张三丰' },
  })
  fireEvent.click(screen.getByRole('button', { name: '取消' }))
  await openEditDrawer(3)
  expect((screen.getByLabelText('姓名') as HTMLInputElement).value).toBe('李四')
  expect((screen.getByLabelText('当前等级') as HTMLSelectElement).value).toBe(
    'P4',
  )
})

it('non-admin users only see the permission message', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn((input: string) => {
      if (input === '/api/auth/me') {
        return response({
          id: 2,
          username: 'member',
          full_name: 'Member',
          roles: ['Member'],
        })
      }
      if (input === '/api/planning/available-years') {
        return response({ available_years: [2026], active_year: 2026 })
      }
      return response({})
    }),
  )
  render(
    <MemoryRouter initialEntries={['/system/users']}>
      <App />
    </MemoryRouter>,
  )
  expect(await screen.findByText(/无权限/)).toBeTruthy()
})

it('keeps the config section as a separate card with a scope note', async () => {
  renderAdmin()
  await screen.findByRole('heading', { name: '系统管理' })
  expect(screen.getByRole('heading', { name: '系统配置' })).toBeTruthy()
  expect(screen.getByText(/作用于全体用户/)).toBeTruthy()
  fireEvent.change(await screen.findByLabelText(/默认计划周期/), {
    target: { value: '6' },
  })
  fireEvent.click(screen.getByRole('button', { name: '保存配置' }))
  await waitFor(() => {
    expect(put).toContainEqual(
      expect.objectContaining({
        id: -1,
        body: expect.objectContaining({
          code: 'default_plan_cycle',
          value: '6',
        }),
      }),
    )
  })
})

it('regression: drawer uses module classes only — no global form classes, module checkbox rows', async () => {
  renderAdmin()
  await openCreateDrawer()
  const drawer = document.querySelector('[data-testid="user-drawer"]')
  const form = drawer?.querySelector('form')
  expect(form).toBeTruthy()
  expect(form?.className).not.toContain('edit-form')
  expect(form?.className).not.toContain('system-form')
  expect(form?.className).toContain('userDrawerForm')
  expect(drawer?.querySelector('[class*="userDrawerBody"]')).toBeTruthy()
  expect(drawer?.querySelector('[class*="userDrawerFooter"]')).toBeTruthy()
  const checkboxes = drawer?.querySelectorAll('[class*="userDrawerCheckbox"]')
  expect(checkboxes?.length).toBeGreaterThanOrEqual(2)
  checkboxes?.forEach((label) => {
    expect(label.classList.contains('checkbox')).toBe(false)
  })
})

it('Issue #93 — narrow shell offers a drawer nav and the user table keeps its scroll contract', async () => {
  vi.stubGlobal(
    'matchMedia',
    vi.fn().mockImplementation((media: string) => ({
      matches: true,
      media,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  )
  renderAdmin()
  await screen.findByRole('heading', { name: '系统管理' })
  // The narrow shell replaces the fixed sidebar with an operable toggle.
  expect(screen.getByRole('button', { name: '打开导航菜单' })).toBeTruthy()
  // Filters wrap and the user table scrolls horizontally — readable at 768.
  const toolbar = document.querySelector('[class*="toolbar"]') as HTMLElement
  expect(window.getComputedStyle(toolbar).flexWrap).toBe('wrap')
  const tableWrap = document.querySelector(
    '[class*="tableWrap"]',
  ) as HTMLElement
  expect(window.getComputedStyle(tableWrap).overflowX).toBe('auto')
})

/// @vitest-environment jsdom

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { App } from './App'
import type { CapabilityModel } from './catalog'
import { MemoryRouter, useLocation } from 'react-router-dom'

function LocationDisplay() {
  const location = useLocation()
  return (
    <span data-testid="location">{location.pathname + location.search}</span>
  )
}

function emptyDomain(code: string) {
  return {
    code,
    name: `${code} 允许域`,
    overview: `${code} 一级概述`,
    children: [],
  }
}

const model: CapabilityModel = {
  code: '技术架构与开发专业线能力模型',
  version: 'V1.0',
  domains: [
    {
      code: 'P01',
      name: 'Data Infra 能力',
      overview: 'P01 一级概述',
      children: [
        {
          code: 'P01.01',
          name: 'Data Infra 产品体系认知',
          p4_description: null,
          p5_description: null,
          p6_description: null,
          p7_description: null,
          p8_description: null,
          children: [
            {
              code: 'P01.01.01',
              name: 'TDC / TDH / ArgoDB / TDS 产品定位',
              recommended_start_level: 'P6',
              standard_target_overrides: { P7: 3 },
              materials_text: 'P01-M001、A8',
              expected_output: '能力说明',
              estimated_hours: '8',
              output_type: '认知+环境验证',
              notes: null,
              resources: [
                {
                  material_code: 'P01-M001',
                  name: '产品体系材料',
                  material_type: '文档',
                  status: '已提供附件',
                },
              ],
              unmatched_materials: ['P01-M001、A8'],
            },
          ],
        },
        {
          code: 'P01.02',
          name: '其他能力项',
          p4_description: 'L2 P4 完整描述',
          p5_description: 'L2 P5 完整描述',
          p6_description: 'L2 P6 完整描述',
          p7_description: 'L2 P7 完整描述',
          p8_description: 'L2 P8 完整描述',
          children: [
            {
              code: 'P01.02.01',
              name: '默认折叠能力',
              recommended_start_level: null,
              materials_text: '',
              expected_output: null,
              estimated_hours: null,
              output_type: null,
              notes: null,
              resources: [],
              unmatched_materials: [],
            },
          ],
        },
      ],
    },
    {
      code: 'P02',
      name: 'AI Infra 能力',
      overview: 'P02 一级概述',
      children: [
        {
          code: 'P02.01',
          name: 'Agent 基础能力组',
          p4_description: 'P02 L2 P4',
          p5_description: 'P02 L2 P5',
          p6_description: 'P02 L2 P6',
          p7_description: 'P02 L2 P7',
          p8_description: 'P02 L2 P8',
          children: [
            {
              code: 'P02.01.01',
              name: 'Agent 编排能力',
              recommended_start_level: 'P4',
              materials_text: '',
              expected_output: 'Agent 方案',
              estimated_hours: '10',
              output_type: null,
              notes: null,
              resources: [],
              unmatched_materials: [],
            },
          ],
        },
        {
          code: 'P02.02',
          name: 'Agent 扩展能力组',
          p4_description: null,
          p5_description: null,
          p6_description: null,
          p7_description: null,
          p8_description: null,
          children: [],
        },
      ],
    },
    emptyDomain('P03'),
    emptyDomain('C01'),
    emptyDomain('C02'),
    emptyDomain('C03'),
    {
      ...emptyDomain('P04'),
      name: 'P04 扩展能力域',
    },
  ],
}

const resources = [
  {
    material_code: 'P01-M001',
    name: '产品体系材料',
    material_type: '文档',
    source_text: '内部知识库',
    purpose: '了解产品定位',
    status: '已提供附件',
    l3_count: 1,
  },
  {
    material_code: 'P01-M099',
    name: '有效未关联资源',
    material_type: '文档',
    source_text: '材料索引',
    purpose: '待关联',
    status: '待补充',
    l3_count: 0,
  },
]

const detail = {
  material_code: 'P01-M001',
  name: '产品体系材料',
  material_type: '文档',
  source_text: '内部知识库',
  purpose: '了解产品定位',
  status: '已提供附件',
  l3_nodes: [
    {
      code: 'P01.01.01',
      name: 'TDC / TDH / ArgoDB / TDS 产品定位',
      l1_code: 'P01',
      l1_name: 'Data Infra 能力',
      l2_code: 'P01.01',
      l2_name: 'Data Infra 产品体系认知',
    },
  ],
}

function response(payload: unknown) {
  return Promise.resolve({ ok: true, json: () => Promise.resolve(payload) })
}

function anonymousResponse() {
  return Promise.resolve({
    ok: false,
    status: 401,
    json: () => Promise.resolve({ detail: 'Unauthorized' }),
  })
}

function mockFetchWithAuth(
  userResponse: Promise<{
    ok: boolean
    status?: number
    json: () => Promise<unknown>
  }>,
) {
  return vi.fn((input: string) => {
    if (input === '/api/auth/me') return userResponse
    if (input === '/api/planning/available-years')
      return response({ available_years: [2026], active_year: 2026 })
    if (input.startsWith('/api/capability-model')) return response(model)
    if (input === '/api/learning-resources/P01-M001') return response(detail)
    if (input.includes('name=%E4%BA%A7%E5%93%81%E4%BD%93%E7%B3%BB')) {
      return response([resources[0]])
    }
    if (
      input.includes('status=%E5%B7%B2%E6%8F%90%E4%BE%9B%E9%99%84%E4%BB%B6')
    ) {
      return response([resources[0]])
    }
    if (input.includes('l3_code=P01.01.01')) return response([resources[0]])
    return response(resources)
  })
}

function stubMember() {
  vi.stubGlobal(
    'fetch',
    mockFetchWithAuth(
      response({
        id: 2,
        username: 'member',
        full_name: 'Member User',
        roles: ['Member'],
      }),
    ),
  )
}

function stubLeader() {
  vi.stubGlobal(
    'fetch',
    mockFetchWithAuth(
      response({
        id: 1,
        username: 'leader',
        full_name: 'Leader User',
        roles: ['Leader'],
      }),
    ),
  )
}

beforeEach(() => {
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
  vi.stubGlobal('fetch', mockFetchWithAuth(anonymousResponse()))
})

afterEach(() => {
  cleanup()
  window.history.replaceState({}, '', '/capability/model')
  vi.unstubAllGlobals()
})

describe('catalog routes', () => {
  it('renders the read-only capability tree with unmatched material warning', async () => {
    stubMember()
    render(
      <MemoryRouter initialEntries={['/capability/model']}>
        <App />
      </MemoryRouter>,
    )
    await screen.findByRole('tab', { name: /P01/ })
    fireEvent.click(screen.getByTestId('l2-toggle-P01.01'))

    expect(
      await screen.findByText(/TDC \/ TDH \/ ArgoDB \/ TDS 产品定位/),
    ).toBeTruthy()
    expect(screen.getByText(/来源待补充 \/ 未关联/)).toBeTruthy()
    expect(screen.getByText('职级要求 P4–P8')).toBeTruthy()
    expect(screen.getByText('预计耗时：8')).toBeTruthy()
    expect(screen.getByText(/产品体系材料/)).toBeTruthy()
    for (const code of ['P01', 'P02', 'P03', 'C01', 'C02', 'C03']) {
      expect(screen.getByRole('tab', { name: new RegExp(code) })).toBeTruthy()
    }
    expect(screen.queryByText(/P04 扩展能力域/)).toBeNull()
  })

  it('mounts one domain and unloads collapsed L3 rows while preserving domain state', async () => {
    stubMember()
    render(
      <MemoryRouter initialEntries={['/capability/model']}>
        <App />
      </MemoryRouter>,
    )

    await screen.findByRole('tab', { name: /P01/ })
    expect(screen.getByTestId('capability-domain-content-P01')).toBeTruthy()
    expect(screen.queryByTestId('capability-domain-content-P02')).toBeNull()
    expect(screen.queryByTestId('l3-row-P01.01.01')).toBeNull()

    fireEvent.click(screen.getByTestId('l2-toggle-P01.01'))
    expect(await screen.findByTestId('l3-row-P01.01.01')).toBeTruthy()

    fireEvent.click(screen.getByRole('tab', { name: /P02/ }))
    expect(screen.queryByTestId('capability-domain-content-P01')).toBeNull()
    expect(screen.getByTestId('capability-domain-content-P02')).toBeTruthy()
    expect(screen.queryByTestId('l3-row-P02.01.01')).toBeNull()

    fireEvent.click(screen.getByRole('tab', { name: /P01/ }))
    expect(await screen.findByTestId('l3-row-P01.01.01')).toBeTruthy()
  })

  it('searches L1, L2, and L3 without changing domain until a result is selected', async () => {
    stubMember()
    render(
      <MemoryRouter initialEntries={['/capability/model']}>
        <App />
      </MemoryRouter>,
    )

    await screen.findByRole('tab', { name: /P01/ })
    const search = screen.getByRole('combobox', { name: '搜索能力地图' })
    fireEvent.change(search, { target: { value: 'Agent 编排能力' } })

    expect(
      screen.getByRole('tab', { name: /P01/ }).getAttribute('aria-selected'),
    ).toBe('true')
    const l3Result = screen.getByRole('option', {
      name: /达成路径.*P02\.01\.01.*Agent 编排能力/,
    })
    expect(l3Result).toBeTruthy()
    fireEvent.click(l3Result)

    expect(
      screen.getByRole('tab', { name: /P02/ }).getAttribute('aria-selected'),
    ).toBe('true')
    const selectedL3 = await screen.findByTestId('l3-row-P02.01.01')
    expect(document.activeElement).toBe(selectedL3)
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('selects L1 and L2 results only after an explicit choice', async () => {
    stubMember()
    render(
      <MemoryRouter initialEntries={['/capability/model']}>
        <App />
      </MemoryRouter>,
    )

    await screen.findByRole('tab', { name: /P01/ })
    const search = screen.getByRole('combobox', { name: '搜索能力地图' })

    fireEvent.change(search, { target: { value: 'AI Infra 能力' } })
    expect(
      screen.getByRole('tab', { name: /P01/ }).getAttribute('aria-selected'),
    ).toBe('true')
    fireEvent.click(screen.getByRole('option', { name: /能力域.*P02/ }))
    expect(
      screen.getByRole('tab', { name: /P02/ }).getAttribute('aria-selected'),
    ).toBe('true')
    expect(document.activeElement).toBe(
      screen.getByTestId('capability-domain-content-P02'),
    )

    fireEvent.change(search, { target: { value: 'P02.02' } })
    fireEvent.click(screen.getByRole('option', { name: /能力标准.*P02\.02/ }))
    expect(
      screen.getByTestId('l2-toggle-P02.02').getAttribute('aria-expanded'),
    ).toBe('true')
    expect(document.activeElement).toBe(screen.getByTestId('l2-toggle-P02.02'))
  })

  it('opens the L3 Drawer with its path context and restores focus on close', async () => {
    stubMember()
    render(
      <MemoryRouter initialEntries={['/capability/model']}>
        <App />
      </MemoryRouter>,
    )

    await screen.findByRole('tab', { name: /P01/ })
    fireEvent.click(screen.getByTestId('l2-toggle-P01.01'))
    const row = await screen.findByTestId('l3-row-P01.01.01')
    fireEvent.click(row)

    const dialog = await screen.findByRole('dialog', { name: /P01\.01\.01/ })
    expect(within(dialog).getByText(/P01 · Data Infra 能力/)).toBeTruthy()
    expect(
      within(dialog).getByText(/P01\.01 · Data Infra 产品体系认知/),
    ).toBeTruthy()
    expect(within(dialog).getByText(/P01\.01\.01 · TDC/)).toBeTruthy()
    expect(within(dialog).getByText('认知+环境验证')).toBeTruthy()
    expect(within(dialog).queryByText('L3 P4 完整描述')).toBeNull()
    fireEvent.keyDown(dialog, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(document.activeElement).toBe(row)
  })

  it('expands an L2 level description inline and handles an initial L3 hash', async () => {
    window.history.replaceState({}, '', '/capability/model#P02.01.01')
    stubMember()
    render(
      <MemoryRouter initialEntries={['/capability/model']}>
        <App />
      </MemoryRouter>,
    )

    const row = await screen.findByTestId('l3-row-P02.01.01')
    expect(
      screen.getByRole('tab', { name: /P02/ }).getAttribute('aria-selected'),
    ).toBe('true')
    expect(
      screen.getByTestId('l2-toggle-P02.01').getAttribute('aria-expanded'),
    ).toBe('true')
    expect(document.activeElement).toBe(row)

    fireEvent.click(screen.getByTestId('l2-level-summary-P02.01-P4'))
    expect(
      screen.getByTestId('l2-level-inline-description-P02.01-P4').textContent,
    ).toContain('P02 L2 P4')
    window.history.replaceState({}, '', '/capability/model')
  })

  it('does not refetch the capability model during local navigation', async () => {
    stubMember()
    render(
      <MemoryRouter initialEntries={['/capability/model']}>
        <App />
      </MemoryRouter>,
    )
    await screen.findByRole('tab', { name: /P01/ })
    fireEvent.click(screen.getByTestId('l2-toggle-P01.01'))
    fireEvent.click(await screen.findByTestId('l3-row-P01.01.01'))
    fireEvent.click(screen.getByRole('button', { name: '关闭达成路径详情' }))
    fireEvent.change(screen.getByRole('combobox', { name: '搜索能力地图' }), {
      target: { value: 'P02' },
    })
    fireEvent.click(screen.getAllByRole('option')[0])
    fireEvent.click(screen.getByRole('tab', { name: /P01/ }))

    const modelCalls = vi
      .mocked(fetch)
      .mock.calls.filter(([url]) => url === '/api/capability-model')
    expect(modelCalls).toHaveLength(1)
  })

  it('consumes a search focus target before later L2 state changes', async () => {
    stubMember()
    render(
      <MemoryRouter initialEntries={['/capability/model']}>
        <App />
      </MemoryRouter>,
    )

    await screen.findByRole('tab', { name: /P01/ })
    fireEvent.change(screen.getByRole('combobox', { name: '搜索能力地图' }), {
      target: { value: 'Agent 编排能力' },
    })
    fireEvent.click(
      screen.getByRole('option', {
        name: /达成路径.*P02\.01\.01.*Agent 编排能力/,
      }),
    )
    const focusedL3 = screen.getByTestId('l3-row-P02.01.01')
    expect(document.activeElement).toBe(focusedL3)

    const otherL2 = screen.getByTestId('l2-toggle-P02.02')
    otherL2.focus()
    fireEvent.click(otherL2)
    expect(document.activeElement).toBe(otherL2)
  })

  it('closes the Drawer before collapsing the current domain or its parent L2', async () => {
    stubMember()
    render(
      <MemoryRouter initialEntries={['/capability/model']}>
        <App />
      </MemoryRouter>,
    )

    await screen.findByRole('tab', { name: /P01/ })
    fireEvent.click(screen.getByTestId('l2-toggle-P01.01'))
    fireEvent.click(await screen.findByTestId('l3-row-P01.01.01'))
    fireEvent.click(screen.getByRole('button', { name: '收起当前域' }))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(screen.queryByTestId('l3-row-P01.01.01')).toBeNull()
    expect(document.activeElement).toBe(
      screen.getByTestId('capability-domain-content-P01'),
    )

    fireEvent.click(screen.getByRole('button', { name: '展开当前域' }))
    fireEvent.click(await screen.findByTestId('l3-row-P01.01.01'))
    fireEvent.click(screen.getByTestId('l2-toggle-P01.01'))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(screen.queryByTestId('l3-row-P01.01.01')).toBeNull()
  })

  it('closes and reopens the search result panel without clearing the query', async () => {
    stubMember()
    render(
      <MemoryRouter initialEntries={['/capability/model']}>
        <App />
      </MemoryRouter>,
    )

    await screen.findByRole('tab', { name: /P01/ })
    const search = screen.getByRole('combobox', { name: '搜索能力地图' })
    fireEvent.change(search, { target: { value: 'P02.02' } })
    expect(search.getAttribute('aria-expanded')).toBe('true')
    fireEvent.click(screen.getByRole('option', { name: /能力标准.*P02\.02/ }))
    expect((search as HTMLInputElement).value).toBe('P02.02')
    expect(search.getAttribute('aria-expanded')).toBe('false')
    expect(screen.queryByRole('listbox')).toBeNull()

    fireEvent.focus(search)
    expect(screen.getByRole('listbox')).toBeTruthy()
    fireEvent.keyDown(search, { key: 'Escape' })
    expect(screen.queryByRole('listbox')).toBeNull()
    expect(search.getAttribute('aria-expanded')).toBe('false')
  })

  it('uses a page-local class for the Leader L3 edit action', async () => {
    stubLeader()
    render(
      <MemoryRouter initialEntries={['/capability/model']}>
        <App />
      </MemoryRouter>,
    )
    await screen.findByRole('tab', { name: /P01/ })
    fireEvent.click(screen.getByTestId('l2-toggle-P01.01'))
    const editButton = await screen.findByTestId('l3-edit-P01.01.01')
    expect(editButton.className).not.toBe('inline-edit')
  })

  it('filters resources by name, status, and L3 then links reverse L3 details', async () => {
    stubMember()
    render(
      <MemoryRouter initialEntries={['/operations/resources']}>
        <App />
      </MemoryRouter>,
    )
    await screen.findByText('有效未关联资源')
    fireEvent.change(screen.getByLabelText('名称'), {
      target: { value: '产品体系' },
    })
    await waitFor(() => expect(screen.queryByText('有效未关联资源')).toBeNull())
    fireEvent.change(screen.getByLabelText('名称'), { target: { value: '' } })
    fireEvent.change(screen.getByLabelText('状态'), {
      target: { value: '已提供附件' },
    })
    await waitFor(() =>
      expect(fetch).toHaveBeenCalledWith(
        '/api/learning-resources?status=%E5%B7%B2%E6%8F%90%E4%BE%9B%E9%99%84%E4%BB%B6',
        expect.anything(),
      ),
    )
    fireEvent.change(screen.getByLabelText('状态'), { target: { value: '' } })
    fireEvent.change(screen.getByLabelText('三级达成路径'), {
      target: { value: 'P01.01.01' },
    })
    await waitFor(() =>
      expect(fetch).toHaveBeenCalledWith(
        '/api/learning-resources?l3_code=P01.01.01',
        expect.anything(),
      ),
    )
    fireEvent.change(screen.getByLabelText('资源详情'), {
      target: { value: 'P01-M001' },
    })

    const reverseLink = await screen.findByRole('link', {
      name: 'P01.01 · Data Infra 产品体系认知 → P01.01.01 · TDC / TDH / ArgoDB / TDS 产品定位',
    })
    expect(reverseLink.getAttribute('href')).toBe('/capability/model#P01.01.01')
  })

  it.each(['/capability/model', '/operations/resources'])(
    'does not render mutation or other-domain controls on %s',
    async (path) => {
      stubMember()
      render(
        <MemoryRouter initialEntries={[path]}>
          <App />
        </MemoryRouter>,
      )

      if (path === '/capability/model') {
        await screen.findByRole('tab', { name: /P01/ })
      } else {
        await screen.findByText('有效未关联资源')
      }
      expect(
        [
          ...document.querySelectorAll(
            'main > section button, main > section a, main > section label',
          ),
        ].some((element) =>
          /导入|添加|编辑|删除|保存|提交|上传|导出|登录|账号|Gap|成长目标|评估|计划|任务|Evidence/i.test(
            element.textContent ?? '',
          ),
        ),
      ).toBe(false)
    },
  )

  it('does not load catalog data for unknown routes (redirect)', () => {
    render(
      <MemoryRouter initialEntries={['/']}>
        <App />
      </MemoryRouter>,
    )
    // Verify catalog model was never fetched — the redirect should NOT trigger catalog loading
    const modelCalls = vi
      .mocked(fetch)
      .mock.calls.filter(
        (call: unknown[]) =>
          typeof call[0] === 'string' &&
          (call[0] as string).startsWith('/api/capability-model'),
      )
    expect(modelCalls).toHaveLength(0)
  })

  it('renders the capability model with L3 details on the model page', async () => {
    stubMember()
    render(
      <MemoryRouter initialEntries={['/capability/model']}>
        <App />
      </MemoryRouter>,
    )
    await screen.findByRole('tab', { name: /P01/ })
    expect(screen.queryByTestId('l3-row-P01.01.01')).toBeNull()
    fireEvent.click(screen.getByTestId('l2-toggle-P01.01'))
    expect(await screen.findByTestId('l3-row-P01.01.01')).toBeTruthy()
  })
})

describe('Member and anonymous catalog access', () => {
  it('redirects an unauthenticated user from /capability/model to /login', async () => {
    render(
      <MemoryRouter initialEntries={['/capability/model']}>
        <App />
        <LocationDisplay />
      </MemoryRouter>,
    )
    await waitFor(() => {
      expect(screen.getByTestId('location').textContent).toBe('/login')
    })
    expect(screen.queryByText('编辑')).toBeNull()
    expect(screen.queryByText('编辑节点')).toBeNull()
  })

  it('does not show Leader controls for a Member', async () => {
    vi.stubGlobal(
      'fetch',
      mockFetchWithAuth(
        response({
          id: 2,
          username: 'member',
          full_name: 'Member User',
          roles: ['Member'],
        }),
      ),
    )
    render(
      <MemoryRouter initialEntries={['/operations/resources']}>
        <App />
      </MemoryRouter>,
    )
    await screen.findByText('有效未关联资源')
    expect(screen.queryByText('新建资源')).toBeNull()
    expect(screen.queryByText('编辑')).toBeNull()
  })
})

describe('Leader catalog controls', () => {
  function getFormByHeading(heading: string) {
    const headingElement = screen.getByRole('heading', { name: heading })
    return within(headingElement.closest('form')!)
  }

  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn((input: string) => {
        if (input === '/api/auth/me') {
          return response({
            id: 1,
            username: 'leader',
            full_name: 'Leader User',
            roles: ['Leader'],
          })
        }
        if (input.startsWith('/api/capability-model')) return response(model)
        if (input === '/api/learning-resources/P01-M001')
          return response(detail)
        if (input.includes('name=%E4%BA%A7%E5%93%81%E4%BD%93%E7%B3%BB')) {
          return response([resources[0]])
        }
        if (
          input.includes('status=%E5%B7%B2%E6%8F%90%E4%BE%9B%E9%99%84%E4%BB%B6')
        ) {
          return response([resources[0]])
        }
        if (input.includes('l3_code=P01.01.01')) return response([resources[0]])
        return response(resources)
      }),
    )
  })

  it('shows edit buttons on capability model nodes for Leader', async () => {
    render(
      <MemoryRouter initialEntries={['/capability/model']}>
        <App />
      </MemoryRouter>,
    )
    await screen.findByRole('tab', { name: /P01/ })
    fireEvent.click(screen.getByTestId('l2-toggle-P01.01'))
    expect(screen.getAllByText('编辑').length).toBeGreaterThanOrEqual(2)
    expect(screen.getAllByText('编辑节点').length).toBeGreaterThanOrEqual(1)
  })

  it('submits PUT to update a domain overview', async () => {
    render(
      <MemoryRouter initialEntries={['/capability/model']}>
        <App />
      </MemoryRouter>,
    )
    await screen.findByRole('tab', { name: /P01/ })
    fireEvent.click(screen.getAllByText('编辑')[0])

    fireEvent.change(screen.getByLabelText('一级概述'), {
      target: { value: '更新后的概述' },
    })
    fireEvent.click(screen.getByText('保存'))

    await waitFor(() =>
      expect(fetch).toHaveBeenCalledWith(
        '/api/capability-model/nodes/P01',
        expect.objectContaining({
          method: 'PUT',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: expect.any(String),
        }),
      ),
    )
    const calls = vi.mocked(fetch).mock.calls
    const putCall = calls.find(
      ([url, init]) =>
        url === '/api/capability-model/nodes/P01' &&
        (init as RequestInit | undefined)?.method === 'PUT',
    )
    expect(putCall).toBeTruthy()
    const body = JSON.parse((putCall![1] as RequestInit).body as string)
    expect(body).toMatchObject({
      name: 'Data Infra 能力',
      enabled: true,
      overview: '更新后的概述',
    })
  })

  it('submits PUT with L3-only fields and resource codes for an L3 node', async () => {
    render(
      <MemoryRouter initialEntries={['/capability/model']}>
        <App />
      </MemoryRouter>,
    )
    await screen.findByRole('tab', { name: /P01/ })
    fireEvent.click(screen.getByTestId('l2-toggle-P01.01'))
    fireEvent.click(screen.getAllByText('编辑节点')[0])

    fireEvent.change(screen.getByLabelText('原始学习材料'), {
      target: { value: 'P01-M001' },
    })
    fireEvent.click(screen.getByText('保存'))

    await waitFor(() =>
      expect(fetch).toHaveBeenCalledWith(
        '/api/capability-model/nodes/P01.01.01',
        expect.objectContaining({ method: 'PUT' }),
      ),
    )
    const calls = vi.mocked(fetch).mock.calls
    const putCall = calls.find(
      ([url, init]) =>
        url === '/api/capability-model/nodes/P01.01.01' &&
        (init as RequestInit | undefined)?.method === 'PUT',
    )
    expect(putCall).toBeTruthy()
    const body = JSON.parse((putCall![1] as RequestInit).body as string)
    expect(body).toMatchObject({
      name: 'TDC / TDH / ArgoDB / TDS 产品定位',
      enabled: true,
      recommended_start_level: 'P6',
      materials_text: 'P01-M001',
      expected_output: '能力说明',
      estimated_hours: '8',
      resource_codes: ['P01-M001'],
    })
  })

  it('maintains three-state standard targets and disables levels below applicability', async () => {
    render(
      <MemoryRouter initialEntries={['/capability/model']}>
        <App />
      </MemoryRouter>,
    )
    await screen.findByRole('tab', { name: /P01/ })
    fireEvent.click(screen.getByTestId('l2-toggle-P01.01'))
    fireEvent.click(screen.getAllByText('编辑节点')[0])

    expect(
      (screen.getByLabelText('P4 标准目标') as HTMLSelectElement).disabled,
    ).toBe(true)
    expect(
      (screen.getByLabelText('P5 标准目标') as HTMLSelectElement).disabled,
    ).toBe(true)
    expect(
      (screen.getByLabelText('P7 标准目标') as HTMLSelectElement).value,
    ).toBe('3')

    fireEvent.change(screen.getByLabelText('P6 标准目标'), {
      target: { value: '__na__' },
    })
    fireEvent.change(screen.getByLabelText('P7 标准目标'), {
      target: { value: '4' },
    })
    fireEvent.click(screen.getByText('保存'))

    await waitFor(() =>
      expect(fetch).toHaveBeenCalledWith(
        '/api/capability-model/nodes/P01.01.01',
        expect.objectContaining({ method: 'PUT' }),
      ),
    )
    const putCall = vi
      .mocked(fetch)
      .mock.calls.find(
        ([url, init]) =>
          url === '/api/capability-model/nodes/P01.01.01' &&
          (init as RequestInit | undefined)?.method === 'PUT',
      )
    const body = JSON.parse((putCall![1] as RequestInit).body as string)
    expect(body.standard_target_overrides).toEqual({ P6: null, P7: 4 })
  })

  it('removes low-level overrides when the recommended start level is raised', async () => {
    const modelWithLowLevelOverrides = structuredClone(model)
    const node = modelWithLowLevelOverrides.domains[0].children[0].children[0]
    node.recommended_start_level = 'P4'
    node.standard_target_overrides = { P4: 3, P5: null, P7: 4 }
    vi.stubGlobal(
      'fetch',
      vi.fn((input: string) => {
        if (input === '/api/auth/me') {
          return response({
            id: 1,
            username: 'leader',
            full_name: 'Leader User',
            roles: ['Leader'],
          })
        }
        if (input.startsWith('/api/capability-model')) {
          return response(modelWithLowLevelOverrides)
        }
        return response(resources)
      }),
    )
    render(
      <MemoryRouter initialEntries={['/capability/model']}>
        <App />
      </MemoryRouter>,
    )
    await screen.findByRole('tab', { name: /P01/ })
    fireEvent.click(screen.getByTestId('l2-toggle-P01.01'))
    fireEvent.click(screen.getAllByText('编辑节点')[0])

    fireEvent.change(screen.getByLabelText('建议起始等级'), {
      target: { value: 'P6' },
    })
    expect(screen.getByText(/已移除不适用的覆盖项：P4、P5/)).toBeTruthy()
    fireEvent.click(screen.getByText('保存'))

    await waitFor(() =>
      expect(fetch).toHaveBeenCalledWith(
        '/api/capability-model/nodes/P01.01.01',
        expect.objectContaining({ method: 'PUT' }),
      ),
    )
    const putCall = vi
      .mocked(fetch)
      .mock.calls.find(
        ([url, init]) =>
          url === '/api/capability-model/nodes/P01.01.01' &&
          (init as RequestInit | undefined)?.method === 'PUT',
      )
    const body = JSON.parse((putCall![1] as RequestInit).body as string)
    expect(body.standard_target_overrides).toEqual({ P7: 4 })
  })

  it('shows create and edit controls on resources page for Leader', async () => {
    render(
      <MemoryRouter initialEntries={['/operations/resources']}>
        <App />
      </MemoryRouter>,
    )
    await screen.findByText('有效未关联资源')
    expect(screen.getByText('新建资源')).toBeTruthy()
    expect(screen.getAllByText('编辑').length).toBe(2)
  })

  it('submits POST to create a resource with L3 links', async () => {
    render(
      <MemoryRouter initialEntries={['/operations/resources']}>
        <App />
      </MemoryRouter>,
    )
    await screen.findByText('有效未关联资源')
    fireEvent.click(screen.getByText('新建资源'))

    const form = getFormByHeading('新建资源')
    fireEvent.change(form.getByLabelText('资源编码'), {
      target: { value: 'P01-M002' },
    })
    fireEvent.change(form.getByLabelText('名称'), {
      target: { value: '新建材料' },
    })
    fireEvent.change(form.getByLabelText('类型'), {
      target: { value: '视频' },
    })
    fireEvent.change(form.getByLabelText('来源'), {
      target: { value: '内部' },
    })
    fireEvent.change(form.getByLabelText('用途'), {
      target: { value: '学习' },
    })
    fireEvent.change(form.getByLabelText('状态'), {
      target: { value: '待补充' },
    })
    fireEvent.click(form.getByLabelText(/P01\.01\.01/))
    fireEvent.click(form.getByText('保存'))

    await waitFor(() =>
      expect(fetch).toHaveBeenCalledWith(
        '/api/learning-resources',
        expect.objectContaining({
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: expect.any(String),
        }),
      ),
    )
    const calls = vi.mocked(fetch).mock.calls
    const postCall = calls.find(
      ([url, init]) =>
        url === '/api/learning-resources' &&
        (init as RequestInit | undefined)?.method === 'POST',
    )
    expect(postCall).toBeTruthy()
    const body = JSON.parse((postCall![1] as RequestInit).body as string)
    expect(body).toMatchObject({
      material_code: 'P01-M002',
      name: '新建材料',
      material_type: '视频',
      source_text: '内部',
      purpose: '学习',
      status: '待补充',
      l3_codes: ['P01.01.01'],
    })
  })

  it('submits PUT to update a resource and atomically replaces L3 links', async () => {
    render(
      <MemoryRouter initialEntries={['/operations/resources']}>
        <App />
      </MemoryRouter>,
    )
    await screen.findByText('有效未关联资源')
    fireEvent.click(screen.getAllByText('编辑')[0])

    const form = getFormByHeading('编辑资源 P01-M001')
    const l3Checkbox = form.getByLabelText(/P01\.01\.01/) as HTMLInputElement
    await waitFor(() => expect(l3Checkbox.checked).toBe(true))
    fireEvent.click(l3Checkbox)
    fireEvent.change(form.getByLabelText('名称'), {
      target: { value: '更新后的材料' },
    })
    fireEvent.click(form.getByText('保存'))

    await waitFor(() =>
      expect(fetch).toHaveBeenCalledWith(
        '/api/learning-resources/P01-M001',
        expect.objectContaining({
          method: 'PUT',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: expect.any(String),
        }),
      ),
    )
    const calls = vi.mocked(fetch).mock.calls
    const putCall = calls.find(
      ([url, init]) =>
        url === '/api/learning-resources/P01-M001' &&
        (init as RequestInit | undefined)?.method === 'PUT',
    )
    expect(putCall).toBeTruthy()
    const body = JSON.parse((putCall![1] as RequestInit).body as string)
    expect(body).toMatchObject({
      name: '更新后的材料',
      material_type: '文档',
      source_text: '内部知识库',
      purpose: '了解产品定位',
      status: '已提供附件',
      l3_codes: [],
    })
  })

  it('keeps material_code read-only when editing a resource', async () => {
    render(
      <MemoryRouter initialEntries={['/operations/resources']}>
        <App />
      </MemoryRouter>,
    )
    await screen.findByText('有效未关联资源')
    fireEvent.click(screen.getAllByText('编辑')[0])

    const form = getFormByHeading('编辑资源 P01-M001')
    const codeInput = form.getByLabelText('资源编码') as HTMLInputElement
    expect(codeInput.readOnly).toBe(true)
  })

  it('archives a resource after local confirmation', async () => {
    render(
      <MemoryRouter initialEntries={['/operations/resources']}>
        <App />
      </MemoryRouter>,
    )
    await screen.findByText('有效未关联资源')
    fireEvent.click(screen.getAllByText('编辑')[0])

    const form = getFormByHeading('编辑资源 P01-M001')
    fireEvent.click(form.getByText('归档'))
    expect(form.getByText('确认归档')).toBeTruthy()
    fireEvent.click(form.getByText('确认归档'))

    await waitFor(() =>
      expect(fetch).toHaveBeenCalledWith(
        '/api/learning-resources/P01-M001/archive',
        expect.objectContaining({
          method: 'POST',
          credentials: 'include',
        }),
      ),
    )
  })

  it('refreshes the capability model after a successful node update', async () => {
    render(
      <MemoryRouter initialEntries={['/capability/model']}>
        <App />
      </MemoryRouter>,
    )
    await screen.findByRole('tab', { name: /P01/ })
    fireEvent.click(screen.getAllByText('编辑')[0])
    fireEvent.click(screen.getByText('保存'))

    await waitFor(() =>
      expect(
        vi
          .mocked(fetch)
          .mock.calls.filter(([url]) =>
            (url as string).startsWith('/api/capability-model'),
          ).length,
      ).toBeGreaterThanOrEqual(2),
    )
  })

  it('refreshes the resource list after a successful resource write', async () => {
    render(
      <MemoryRouter initialEntries={['/operations/resources']}>
        <App />
      </MemoryRouter>,
    )
    await screen.findByText('有效未关联资源')
    fireEvent.click(screen.getByText('新建资源'))
    const form = getFormByHeading('新建资源')
    fireEvent.change(form.getByLabelText('资源编码'), {
      target: { value: 'P01-M002' },
    })
    fireEvent.change(form.getByLabelText('名称'), {
      target: { value: '新建材料' },
    })
    fireEvent.change(form.getByLabelText('类型'), {
      target: { value: '视频' },
    })
    fireEvent.change(form.getByLabelText('状态'), {
      target: { value: '待补充' },
    })
    fireEvent.click(form.getByText('保存'))

    await waitFor(() =>
      expect(
        vi
          .mocked(fetch)
          .mock.calls.filter(([url]) =>
            /^\/api\/learning-resources(\?.*)?$/.test(url as string),
          ).length,
      ).toBeGreaterThanOrEqual(2),
    )
  })
})

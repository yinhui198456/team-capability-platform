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
import { MemoryRouter } from 'react-router-dom'

function emptyDomain(code: string) {
  return {
    code,
    name: `${code} 允许域`,
    p4_description: null,
    p5_description: null,
    p6_description: null,
    p7_description: null,
    p8_description: null,
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
      p4_description: 'P4 描述',
      p5_description: 'P5 描述',
      p6_description: 'P6 描述',
      p7_description: 'P7 描述',
      p8_description: 'P8 描述',
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
              p4_description: null,
              p5_description: null,
              p6_description: null,
              p7_description: null,
              p8_description: null,
              recommended_start_level: 'L1',
              materials_text: 'P01-M001、A8',
              expected_output: '能力说明',
              estimated_hours: '8',
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
          p4_description: null,
          p5_description: null,
          p6_description: null,
          p7_description: null,
          p8_description: null,
          children: [
            {
              code: 'P01.02.01',
              name: '默认折叠能力',
              p4_description: null,
              p5_description: null,
              p6_description: null,
              p7_description: null,
              p8_description: null,
              recommended_start_level: null,
              materials_text: '',
              expected_output: null,
              estimated_hours: null,
              resources: [],
              unmatched_materials: [],
            },
          ],
        },
      ],
    },
    emptyDomain('P02'),
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
  vi.unstubAllGlobals()
})

describe('catalog routes', () => {
  it('renders the read-only capability tree with unmatched material warning', async () => {
    render(
      <MemoryRouter initialEntries={['/capability/model']}>
        <App />
      </MemoryRouter>,
    )
    await screen.findByText(/Data Infra 能力/)
    fireEvent.click(screen.getByText(/Data Infra 产品体系认知/))

    expect(
      await screen.findByText(/TDC \/ TDH \/ ArgoDB \/ TDS 产品定位/),
    ).toBeTruthy()
    expect(screen.getByText(/来源待补充 \/ 未关联/)).toBeTruthy()
    expect(screen.getByText('P4 描述')).toBeTruthy()
    expect(screen.getByText('8 小时')).toBeTruthy()
    expect(screen.getByText(/产品体系材料/)).toBeTruthy()
    for (const code of ['P01', 'P02', 'P03', 'C01', 'C02', 'C03']) {
      expect(screen.getByText(new RegExp(`${code} ·`))).toBeTruthy()
    }
    expect(screen.queryByText(/P04 扩展能力域/)).toBeNull()
  })

  it('filters resources by name, status, and L3 then links reverse L3 details', async () => {
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
    fireEvent.change(screen.getByLabelText('L3'), {
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
      name: 'P01.01.01 · TDC / TDH / ArgoDB / TDS 产品定位',
    })
    expect(reverseLink.getAttribute('href')).toBe('/capability/model#P01.01.01')
  })

  it.each(['/capability/model', '/operations/resources'])(
    'does not render mutation or other-domain controls on %s',
    async (path) => {
      render(
        <MemoryRouter initialEntries={[path]}>
          <App />
        </MemoryRouter>,
      )

      await screen.findByText(
        path === '/capability/model' ? /Data Infra 能力/ : '有效未关联资源',
      )
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
    render(
      <MemoryRouter initialEntries={['/capability/model']}>
        <App />
      </MemoryRouter>,
    )
    await screen.findByText(/TDC \/ TDH \/ ArgoDB \/ TDS 产品定位/)
    const target = document.getElementById('P01.01.01')
    expect(target).toBeTruthy()
    // ponytail: MemoryRouter doesn't set window.location.hash, so hash-driven
    // auto-open is not testable here. Verify the element exists and can be interacted with.
    expect(target?.closest('details')).toBeTruthy()
  })
})

describe('Member and anonymous catalog access', () => {
  it('does not show Leader controls for an unauthenticated user', async () => {
    render(
      <MemoryRouter initialEntries={['/capability/model']}>
        <App />
      </MemoryRouter>,
    )
    await screen.findByText(/Data Infra 能力/)
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
    await screen.findByText(/Data Infra 能力/)
    expect(screen.getAllByText('编辑').length).toBeGreaterThanOrEqual(2)
    expect(screen.getAllByText('编辑节点').length).toBeGreaterThanOrEqual(1)
  })

  it('submits PUT to update a domain description', async () => {
    render(
      <MemoryRouter initialEntries={['/capability/model']}>
        <App />
      </MemoryRouter>,
    )
    await screen.findByText(/Data Infra 能力/)
    fireEvent.click(screen.getAllByText('编辑')[0])

    fireEvent.change(screen.getByLabelText('P4 描述'), {
      target: { value: '更新后的 P4' },
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
      p4_description: '更新后的 P4',
      p5_description: 'P5 描述',
      p6_description: 'P6 描述',
      p7_description: 'P7 描述',
      p8_description: 'P8 描述',
    })
  })

  it('submits PUT with L3-only fields and resource codes for an L3 node', async () => {
    render(
      <MemoryRouter initialEntries={['/capability/model']}>
        <App />
      </MemoryRouter>,
    )
    await screen.findByText(/Data Infra 能力/)
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
      recommended_start_level: 'L1',
      materials_text: 'P01-M001',
      expected_output: '能力说明',
      estimated_hours: '8',
      resource_codes: ['P01-M001'],
    })
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
    await screen.findByText(/Data Infra 能力/)
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

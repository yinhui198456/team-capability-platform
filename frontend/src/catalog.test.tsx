/// @vitest-environment jsdom

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { App } from './App'
import type { CapabilityModel } from './catalog'

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
          children: [
            {
              code: 'P01.01.01',
              name: 'TDC / TDH / ArgoDB / TDS 产品定位',
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
          children: [
            {
              code: 'P01.02.01',
              name: '默认折叠能力',
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
  vi.stubGlobal(
    'fetch',
    vi.fn((input: string) => {
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
    }),
  )
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('catalog routes', () => {
  it('renders the read-only capability tree with unmatched material warning', async () => {
    window.history.pushState({}, '', '/capability/model')
    render(<App />)

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
    window.history.pushState({}, '', '/operations/resources')
    render(<App />)

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
      ),
    )
    fireEvent.change(screen.getByLabelText('状态'), { target: { value: '' } })
    fireEvent.change(screen.getByLabelText('L3'), {
      target: { value: 'P01.01.01' },
    })
    await waitFor(() =>
      expect(fetch).toHaveBeenCalledWith(
        '/api/learning-resources?l3_code=P01.01.01',
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
      window.history.pushState({}, '', path)
      render(<App />)

      await screen.findByText(
        path === '/capability/model' ? /Data Infra 能力/ : '有效未关联资源',
      )
      expect(
        [...document.querySelectorAll('button, a, label')].some((element) =>
          /导入|添加|编辑|删除|保存|提交|上传|导出|登录|账号|Gap|成长目标|评估|计划|任务|Evidence/i.test(
            element.textContent ?? '',
          ),
        ),
      ).toBe(false)
    },
  )

  it('renders an unknown-route state without loading catalog data', () => {
    window.history.pushState({}, '', '/')
    render(<App />)

    expect(screen.getByText('页面不存在')).toBeTruthy()
    expect(screen.queryByText('能力模型')).toBeNull()
    expect(fetch).not.toHaveBeenCalled()
  })

  it('locates a linked L3 through the capability-model hash', async () => {
    window.history.pushState({}, '', '/capability/model#P01.01.01')
    render(<App />)

    await screen.findByText(/TDC \/ TDH \/ ArgoDB \/ TDS 产品定位/)
    const target = document.getElementById('P01.01.01')
    expect(target).toBeTruthy()
    expect(target?.closest('details')?.open).toBe(true)
    expect(screen.getByText(/其他能力项/).closest('details')?.open).toBe(false)
  })
})

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

const model = {
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
              estimated_hours: 8,
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
      ],
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
  ...resources[0],
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
    expect(screen.getByText(/产品体系材料/)).toBeTruthy()
  })

  it('renders resources, filters by name, and shows reverse L3 links', async () => {
    window.history.pushState({}, '', '/operations/resources')
    render(<App />)

    await screen.findByText('有效未关联资源')
    fireEvent.change(screen.getByLabelText('名称'), {
      target: { value: '产品体系' },
    })
    await waitFor(() => expect(screen.queryByText('有效未关联资源')).toBeNull())
    fireEvent.change(screen.getByLabelText('资源详情'), {
      target: { value: 'P01-M001' },
    })

    expect(
      await screen.findByText('P01.01.01 · TDC / TDH / ArgoDB / TDS 产品定位'),
    ).toBeTruthy()
  })

  it('does not render mutation or other-domain controls', async () => {
    window.history.pushState({}, '', '/capability/model')
    render(<App />)

    await screen.findByText(/Data Infra 能力/)
    expect(
      screen.queryByText(
        /导入|添加|编辑|删除|保存|提交|登录|用户|评估|计划|任务|Evidence|Review/i,
      ),
    ).toBeNull()
  })
})

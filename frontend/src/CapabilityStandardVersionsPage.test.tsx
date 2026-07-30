/// @vitest-environment jsdom

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

const catalogMocks = vi.hoisted(() => ({
  abandon: vi.fn(),
  copyPrevious: vi.fn(),
  createDraft: vi.fn(),
  publish: vi.fn(),
  publishPreview: vi.fn(),
  reconcile: vi.fn(),
  update: vi.fn(),
  validate: vi.fn(),
  useCatalog: vi.fn(),
  useMe: vi.fn(),
}))

vi.mock('./catalog', () => ({
  abandonStandardDraft: catalogMocks.abandon,
  copyStandardPreviousLevel: catalogMocks.copyPrevious,
  createStandardDraft: catalogMocks.createDraft,
  enabledDomains: (model: { domains: unknown[] } | null) =>
    model?.domains ?? [],
  publishStandardVersion: catalogMocks.publish,
  previewStandardPublish: catalogMocks.publishPreview,
  reconcileStandardCatalog: catalogMocks.reconcile,
  updateStandardMatrix: catalogMocks.update,
  useCatalog: catalogMocks.useCatalog,
  useMe: catalogMocks.useMe,
  validateStandardVersion: catalogMocks.validate,
}))

import { CapabilityStandardVersionsPage } from './CapabilityStandardVersionsPage'

function makeModel(overrides?: {
  l3Id?: number
  l3Code?: string
  l3Name?: string
}) {
  return {
    id: 9,
    code: 'model',
    version: '1',
    domains: [
      {
        code: 'P01',
        name: '平台能力',
        overview: null,
        children: [
          {
            code: 'P01.01',
            name: '能力标准',
            children: [
              {
                id: overrides?.l3Id ?? 101,
                code: overrides?.l3Code ?? 'P01.01.01',
                name: overrides?.l3Name ?? '达成路径',
              },
            ],
          },
        ],
      },
    ],
  }
}

function makeMatrixItems(nodeId: number, l3Code: string, l3Name: string) {
  return ['P4', 'P5', 'P6', 'P7', 'P8'].map((job_level, index) => ({
    l3_node_id: nodeId,
    l1_code: 'P01',
    l1_name: '平台能力',
    l2_code: 'P01.01',
    l2_name: '能力标准',
    l3_code: l3Code,
    l3_name: l3Name,
    job_level,
    applicable: true,
    target_level: index + 1,
    source: 'copied' as const,
  }))
}

const draft = {
  id: 11,
  model_id: 9,
  version_no: 2,
  label: '标准版本 v2',
  status: '草稿' as const,
  revision: 3,
  published_at: null,
}

function mockedCatalog(path: string | null) {
  if (path === '/api/capability-model')
    return { data: makeModel(), refresh: vi.fn() }
  if (path === '/api/capability-standard-versions?model_id=9')
    return { data: [draft], refresh: vi.fn() }
  if (path === '/api/capability-standard-versions/11')
    return {
      data: {
        version: draft,
        items: makeMatrixItems(101, 'P01.01.01', '达成路径'),
      },
      refresh: vi.fn(),
    }
  if (path === '/api/capability-standard-versions/11/catalog-drift')
    return {
      data: {
        has_drift: false,
        added_enabled_l3: [],
        disabled_l3: [],
        renamed_or_moved_l3: [],
      },
      refresh: vi.fn(),
    }
  return { data: null, refresh: vi.fn() }
}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.clearAllMocks()
})

describe('CapabilityStandardVersionsPage', () => {
  it('matches matrix by l3_node_id only', () => {
    catalogMocks.useMe.mockReturnValue({ isLeader: true, loading: false })
    catalogMocks.useCatalog.mockImplementation(mockedCatalog)

    render(<CapabilityStandardVersionsPage />)
    fireEvent.click(screen.getByRole('button', { name: /P01\.01.*能力标准/ }))
    expect(screen.getByTestId('standard-l2-P01.01')).toBeTruthy()
    // 5 matrix cells + 1 copyFrom = 6 comboboxes
    expect(screen.getAllByRole('combobox')).toHaveLength(6)
  })

  it('shows matrix correctly when L3 renamed (stable l3_node_id)', () => {
    const renamedModel = makeModel({
      l3Id: 101,
      l3Code: 'P01.01.01-new',
      l3Name: '改名后',
    })
    catalogMocks.useMe.mockReturnValue({ isLeader: true, loading: false })
    catalogMocks.useCatalog.mockImplementation((path: string | null) => {
      if (path === '/api/capability-model')
        return { data: renamedModel, refresh: vi.fn() }
      if (path === '/api/capability-standard-versions?model_id=9')
        return { data: [draft], refresh: vi.fn() }
      if (path === '/api/capability-standard-versions/11')
        return {
          data: {
            version: draft,
            items: makeMatrixItems(101, 'P01.01.01', '达成路径'),
          },
          refresh: vi.fn(),
        }
      if (path === '/api/capability-standard-versions/11/catalog-drift')
        return {
          data: {
            has_drift: false,
            added_enabled_l3: [],
            disabled_l3: [],
            renamed_or_moved_l3: [],
          },
          refresh: vi.fn(),
        }
      return { data: null, refresh: vi.fn() }
    })

    render(<CapabilityStandardVersionsPage />)
    fireEvent.click(screen.getByRole('button', { name: /P01\.01.*能力标准/ }))
    // Still shows cells via l3_node_id even though l3_code differs
    expect(screen.getAllByRole('combobox')).toHaveLength(6)
    expect(screen.getByText(/改名后/)).toBeTruthy()
  })

  it('shows missing node identity when L3 has no id', () => {
    const noIdModel = {
      id: 9,
      code: 'model',
      version: '1',
      domains: [
        {
          code: 'P01',
          name: '平台能力',
          overview: null,
          children: [
            {
              code: 'P01.01',
              name: '能力标准',
              children: [
                {
                  // No id — must trigger "缺少稳定节点身份"
                  code: 'P01.01.01',
                  name: '达成路径',
                },
              ],
            },
          ],
        },
      ],
    }
    catalogMocks.useMe.mockReturnValue({ isLeader: true, loading: false })
    catalogMocks.useCatalog.mockImplementation((path: string | null) => {
      if (path === '/api/capability-model')
        return { data: noIdModel, refresh: vi.fn() }
      if (path === '/api/capability-standard-versions?model_id=9')
        return { data: [draft], refresh: vi.fn() }
      if (path === '/api/capability-standard-versions/11')
        return {
          data: {
            version: draft,
            items: makeMatrixItems(101, 'P01.01.01', '达成路径'),
          },
          refresh: vi.fn(),
        }
      if (path === '/api/capability-standard-versions/11/catalog-drift')
        return {
          data: {
            has_drift: false,
            added_enabled_l3: [],
            disabled_l3: [],
            renamed_or_moved_l3: [],
          },
          refresh: vi.fn(),
        }
      return { data: null, refresh: vi.fn() }
    })

    render(<CapabilityStandardVersionsPage />)
    fireEvent.click(screen.getByRole('button', { name: /P01\.01.*能力标准/ }))
    expect(screen.getByText(/缺少稳定节点身份/)).toBeTruthy()
  })

  it('writes with l3_node_id and reports revision conflict', async () => {
    catalogMocks.useMe.mockReturnValue({ isLeader: true, loading: false })
    catalogMocks.useCatalog.mockImplementation(mockedCatalog)
    catalogMocks.update.mockRejectedValueOnce(
      new Error('standard revision conflict'),
    )

    render(<CapabilityStandardVersionsPage />)
    fireEvent.click(screen.getByRole('button', { name: /P01\.01.*能力标准/ }))
    fireEvent.change(screen.getAllByRole('combobox')[1], {
      target: { value: '4' },
    })

    await waitFor(() =>
      expect(catalogMocks.update).toHaveBeenCalledWith(11, 3, {
        l3_node_id: 101,
        l3_code: 'P01.01.01',
        job_level: 'P4',
        applicable: true,
        target_level: 4,
      }),
    )
    expect((await screen.findByRole('alert')).textContent).toContain(
      'standard revision conflict',
    )
  })

  it('does not expose draft metadata to non-Leader', () => {
    catalogMocks.useMe.mockReturnValue({ isLeader: false, loading: false })
    catalogMocks.useCatalog.mockImplementation(mockedCatalog)
    render(<CapabilityStandardVersionsPage />)
    expect(screen.getByText('仅 Leader 可维护能力标准版本。')).toBeTruthy()
  })

  it('has validation, preview, copy, abandon, reconcile buttons', () => {
    catalogMocks.useMe.mockReturnValue({ isLeader: true, loading: false })
    catalogMocks.useCatalog.mockImplementation(mockedCatalog)
    render(<CapabilityStandardVersionsPage />)
    expect(screen.getByRole('button', { name: '检查草稿' })).toBeTruthy()
    expect(screen.getByRole('button', { name: '预览发布' })).toBeTruthy()
    expect(screen.getByRole('button', { name: /复制 P7 → P8/ })).toBeTruthy()
    expect(screen.getByRole('button', { name: '放弃草稿' })).toBeTruthy()
    expect(screen.getByRole('button', { name: '协调目录' })).toBeTruthy()
    expect(screen.getByRole('button', { name: '检查并发布' })).toBeTruthy()
  })

  it('copyTo derives from copyFrom', () => {
    catalogMocks.useMe.mockReturnValue({ isLeader: true, loading: false })
    catalogMocks.useCatalog.mockImplementation(mockedCatalog)
    render(<CapabilityStandardVersionsPage />)
    expect(screen.getByText(/目标职级：/).textContent).toContain('P8')
    fireEvent.change(screen.getByDisplayValue('P7'), {
      target: { value: 'P4' },
    })
    expect(screen.getByText(/目标职级：/).textContent).toContain('P5')
  })

  it('copy disabled when zero selected', () => {
    catalogMocks.useMe.mockReturnValue({ isLeader: true, loading: false })
    catalogMocks.useCatalog.mockImplementation(mockedCatalog)
    render(<CapabilityStandardVersionsPage />)
    fireEvent.click(screen.getByRole('button', { name: /P01\.01.*能力标准/ }))
    const btn = screen.getByRole('button', {
      name: /复制 P7 → P8/,
    }) as HTMLButtonElement
    expect(btn.disabled).toBe(true)
  })

  it('empty selection issues no copy request', () => {
    catalogMocks.useMe.mockReturnValue({ isLeader: true, loading: false })
    catalogMocks.useCatalog.mockImplementation(mockedCatalog)
    render(<CapabilityStandardVersionsPage />)
    fireEvent.click(screen.getByRole('button', { name: /P01\.01.*能力标准/ }))
    fireEvent.click(screen.getByRole('button', { name: /复制 P7 → P8/ }))
    expect(catalogMocks.copyPrevious).not.toHaveBeenCalled()
  })
})

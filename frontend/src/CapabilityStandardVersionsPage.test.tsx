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

const model = {
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
              code: 'P01.01.01',
              name: '达成路径',
            },
          ],
        },
      ],
    },
  ],
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
  if (path === '/api/capability-model') return { data: model, refresh: vi.fn() }
  if (path === '/api/capability-standard-versions?model_id=9')
    return { data: [draft], refresh: vi.fn() }
  if (path === '/api/capability-standard-versions/11')
    return {
      data: {
        version: draft,
        items: ['P4', 'P5', 'P6', 'P7', 'P8'].map((job_level, index) => ({
          l3_node_id: 101,
          l1_code: 'P01',
          l1_name: '平台能力',
          l2_code: 'P01.01',
          l2_name: '能力标准',
          l3_code: 'P01.01.01',
          l3_name: '达成路径',
          job_level,
          applicable: true,
          target_level: index + 1,
          source: 'copied',
        })),
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
  it('keeps the 310x5 editor lazy: only an expanded L2 mounts its cells', () => {
    catalogMocks.useMe.mockReturnValue({ isLeader: true, loading: false })
    catalogMocks.useCatalog.mockImplementation(mockedCatalog)

    render(<CapabilityStandardVersionsPage />)

    expect(screen.queryByTestId('standard-l2-P01.01')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /P01\.01.*能力标准/ }))
    expect(screen.getByTestId('standard-l2-P01.01')).toBeTruthy()
    // 5 matrix cell comboboxes + 2 copy-level selectors = 7 total comboboxes
    expect(screen.getAllByRole('combobox')).toHaveLength(7)
  })

  it('writes with L3 node identity and reports a revision conflict precisely', async () => {
    catalogMocks.useMe.mockReturnValue({ isLeader: true, loading: false })
    catalogMocks.useCatalog.mockImplementation(mockedCatalog)
    catalogMocks.update.mockRejectedValueOnce(
      new Error('standard revision conflict'),
    )

    render(<CapabilityStandardVersionsPage />)
    fireEvent.click(screen.getByRole('button', { name: /P01\.01.*能力标准/ }))
    // comboboxes: [0]=source copy level, [1]=target copy level, [2..6]=P4..P8
    const matrixCombos = screen.getAllByRole('combobox').slice(2)
    fireEvent.change(matrixCombos[0], {
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

  it('does not expose draft metadata or editing controls to a non-Leader', () => {
    catalogMocks.useMe.mockReturnValue({ isLeader: false, loading: false })
    catalogMocks.useCatalog.mockImplementation(mockedCatalog)

    render(<CapabilityStandardVersionsPage />)

    expect(screen.getByText('仅 Leader 可维护能力标准版本。')).toBeTruthy()
    expect(screen.queryByText('标准版本 v2（草稿）')).toBeNull()
    expect(screen.queryByRole('combobox')).toBeNull()
  })

  it('offers validation, preview, copy, abandon and reconcile controls for a draft', () => {
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
})

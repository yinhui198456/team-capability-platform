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
import * as accessApi from './access'
import * as assessmentApi from './assessment'
import * as planningApi from './planning'
import { MemoryRouter } from 'react-router-dom'

function stubAuthAndYear() {
  vi.spyOn(accessApi, 'me').mockResolvedValue({
    id: 1,
    username: 'member',
    full_name: 'Member',
    roles: ['Member'],
  })
  vi.spyOn(planningApi, 'getAvailableYears').mockResolvedValue({
    available_years: [2026],
    active_year: 2026,
  })
}

function mockDraft(overrides: Partial<assessmentApi.Assessment> = {}) {
  return {
    id: 7,
    member_id: 1,
    year: 2026,
    version: 1,
    assessment_type: '年度',
    status: '草稿',
    created_at: '',
    submitted_at: null,
    archived_at: null,
    revision: 1,
    details: [
      {
        id: 1,
        l3_code: 'P01.01.01',
        l3_name: '数据管道',
        l1_code: 'P01',
        l1_name: '数据基础设施',
        l2_code: 'P01.01',
        l2_name: '数据基础',
        current_level: null,
        target_level: 4,
        standard_target_applicable: true,
        standard_target_level: 4,
        target_adjusted: false,
        adjusted_target_level: null,
        target_adjustment_reason: null,
        gap_value: null,
        evidence_note: '',
        plan_candidate: false,
        recommended_start_level: 'P4',
      },
    ],
    ...overrides,
  }
}

describe('AssessmentGapPage', () => {
  beforeEach(() => {
    stubAuthAndYear()
    vi.spyOn(assessmentApi, 'listAssessments').mockResolvedValue([])
  })
  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it('uses a single L1 view and keeps Gap details in a closed drawer', async () => {
    vi.spyOn(assessmentApi, 'listAssessments').mockResolvedValue([
      {
        ...mockDraft(),
        details: undefined,
      },
    ])
    vi.spyOn(assessmentApi, 'getAssessment').mockResolvedValue(
      mockDraft({
        details: [
          {
            ...mockDraft().details![0],
            l1_code: 'P01',
            l2_code: 'P01.01',
            l2_name: '数据基础',
            current_level: 2,
          },
        ],
      }),
    )
    render(
      <MemoryRouter initialEntries={['/capability/assessment']}>
        <App />
      </MemoryRouter>,
    )
    await screen.findByText('标准 4')
    expect(screen.queryByTestId('gap-sidebar')).toBeNull()
    expect(screen.queryByTestId('gap-drawer')).toBeNull()
    const content = screen.getByTestId('assessment-content-area')
    expect(
      within(content).getByRole('heading', {
        name: '能力自评与 Gap 分析',
      }),
    ).toBeTruthy()
    expect(within(content).getByTestId('assessment-main-area')).toBeTruthy()
    expect(
      within(screen.getByLabelText('一级能力域导航')).getByRole('button', {
        name: /P01/,
      }),
    ).toBeTruthy()
  })

  it('renders create button', async () => {
    render(
      <MemoryRouter initialEntries={['/capability/assessment']}>
        <App />
      </MemoryRouter>,
    )
    await waitFor(() => {
      expect(screen.getByRole('button', { name: '预览评估范围' })).toBeTruthy()
    })
  })

  it('shows L2 job requirements and keeps an empty L2 visible', async () => {
    vi.spyOn(assessmentApi, 'listAssessments').mockResolvedValue([
      { ...mockDraft(), details: undefined },
    ])
    vi.spyOn(assessmentApi, 'getAssessment').mockResolvedValue(
      mockDraft({
        member_current_level: 'P5',
        member_target_level: 'P6',
        l2_groups: [
          {
            l1_code: 'P01',
            l1_name: '数据基础设施',
            l2_code: 'P01.01',
            l2_name: '数据基础',
            l3_count: 1,
            is_empty: false,
            requirements: {
              P4: 'P4 要求',
              P5: 'P5 要求',
              P6: 'P6 要求',
              P7: 'P7 要求',
              P8: 'P8 要求',
            },
            details: [mockDraft().details![0]],
          },
          {
            l1_code: 'P01',
            l1_name: '数据基础设施',
            l2_code: 'P02.07',
            l2_name: '待补充标准',
            l3_count: 0,
            is_empty: true,
            requirements: {
              P4: 'P4 要求',
              P5: 'P5 要求',
              P6: 'P6 要求',
              P7: 'P7 要求',
              P8: 'P8 要求',
            },
            details: [],
          },
        ],
      }),
    )
    render(
      <MemoryRouter initialEntries={['/capability/assessment']}>
        <App />
      </MemoryRouter>,
    )
    await screen.findByRole('button', { name: /P02.07/ })
    expect(screen.getByText('目标职级 P6：P6 要求')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /P02.07/ }))
    expect(screen.getByText('暂无三级达成路径，当前无可评估项')).toBeTruthy()
  })

  it('creates draft with a read-only standard target and null current level', async () => {
    vi.spyOn(assessmentApi, 'fetchScopePreview').mockResolvedValue({
      member_id: 1,
      year: 2026,
      assessment_type: '年度',
      member_current_level: 'P4',
      member_target_level: 'P5',
      standard_version: { id: 1, label: 'Legacy Baseline v1' },
      scope_version: 'scope-v1',
      summary: {
        total: 10,
        current_required: 8,
        target_progressive: 2,
        by_l1: [],
      },
      empty_scope: false,
      scope_token: 'token-abc',
      open_draft_id: null,
    })
    vi.spyOn(assessmentApi, 'createAssessment').mockResolvedValue({
      id: 7,
      revision: 1,
      summary: {
        total: 10,
        current_required: 8,
        target_progressive: 2,
        by_l1: [],
      },
      scope_token: 'token-abc',
    })
    vi.spyOn(assessmentApi, 'getAssessment').mockResolvedValue(mockDraft())
    render(
      <MemoryRouter initialEntries={['/capability/assessment']}>
        <App />
      </MemoryRouter>,
    )
    await waitFor(() => {
      expect(screen.getByRole('button', { name: '预览评估范围' })).toBeTruthy()
    })
    fireEvent.click(screen.getByRole('button', { name: '预览评估范围' }))
    await waitFor(() => {
      expect(
        screen.getByRole('button', { name: '确认创建年度自评草稿' }),
      ).toBeTruthy()
    })
    fireEvent.click(
      screen.getByRole('button', { name: '确认创建年度自评草稿' }),
    )
    await waitFor(() => {
      expect(screen.getByText('能力自评与 Gap 分析')).toBeTruthy()
    })
    // Select should show "请选择" for null value
    const selects = screen.getAllByRole('combobox')
    const levelSelects = selects.filter(
      (s) => (s as HTMLSelectElement).value === '',
    )
    expect(levelSelects.length).toBeGreaterThanOrEqual(1)
    expect(screen.getByText('标准 4')).toBeTruthy()
  })

  it('submit disabled when null levels', async () => {
    vi.spyOn(assessmentApi, 'listAssessments').mockResolvedValue([
      {
        id: 7,
        member_id: 1,
        year: 2026,
        version: 1,
        assessment_type: '年度',
        status: '草稿',
        created_at: '',
        submitted_at: null,
        archived_at: null,
      },
    ])
    vi.spyOn(assessmentApi, 'getAssessment').mockResolvedValue(mockDraft())
    render(
      <MemoryRouter initialEntries={['/capability/assessment']}>
        <App />
      </MemoryRouter>,
    )
    await waitFor(() => {
      expect(screen.getByRole('button', { name: '提交自评' })).toBeTruthy()
    })
    expect(
      (screen.getByRole('button', { name: '提交自评' }) as HTMLButtonElement)
        .disabled,
    ).toBe(true)
  })

  it.each([
    [1, 2, 'old evidence'],
    [3, 4, 'old evidence'],
  ])(
    'requires new evidence when inherited level increases from %s to %s',
    async (inheritedLevel, currentLevel, evidence) => {
      const draft = mockDraft({
        details: [
          {
            ...mockDraft().details![0],
            current_level: currentLevel,
            evidence_note: evidence,
            inherited_from_assessment_id: 6,
            inherited_current_level: inheritedLevel,
            inherited_evidence_note: evidence,
          },
        ],
      })
      vi.spyOn(assessmentApi, 'listAssessments').mockResolvedValue([draft])
      vi.spyOn(assessmentApi, 'getAssessment').mockResolvedValue(draft)
      render(
        <MemoryRouter initialEntries={['/capability/assessment']}>
          <App />
        </MemoryRouter>,
      )
      await screen.findByText('需更新依据')
      expect(
        (screen.getByRole('button', { name: '提交自评' }) as HTMLButtonElement)
          .disabled,
      ).toBe(true)
      expect(
        (screen.getByLabelText('计划候选 P01.01.01') as HTMLInputElement)
          .disabled,
      ).toBe(true)
    },
  )

  it.each([
    [null, ''],
    [null, '   '],
    ['旧依据', ' 旧依据 '],
  ])(
    'requires normalized new evidence for an inherited increase (%s → %s)',
    async (inheritedEvidence, evidence) => {
      const draft = mockDraft({
        details: [
          {
            ...mockDraft().details![0],
            current_level: 2,
            evidence_note: evidence as string,
            inherited_from_assessment_id: 6,
            inherited_current_level: 1,
            inherited_evidence_note: inheritedEvidence as string | null,
          },
        ],
      })
      vi.spyOn(assessmentApi, 'listAssessments').mockResolvedValue([draft])
      vi.spyOn(assessmentApi, 'getAssessment').mockResolvedValue(draft)
      render(
        <MemoryRouter initialEntries={['/capability/assessment']}>
          <App />
        </MemoryRouter>,
      )
      await screen.findByText('需更新依据')
      expect(
        (screen.getByRole('button', { name: '提交自评' }) as HTMLButtonElement)
          .disabled,
      ).toBe(true)
      expect(
        (screen.getByLabelText('计划候选 P01.01.01') as HTMLInputElement)
          .disabled,
      ).toBe(true)
    },
  )

  it('allows an inherited increase with a non-empty normalized new evidence', async () => {
    const draft = mockDraft({
      details: [
        {
          ...mockDraft().details![0],
          current_level: 2,
          evidence_note: ' 新依据 ',
          inherited_from_assessment_id: 6,
          inherited_current_level: 1,
          inherited_evidence_note: null,
        },
      ],
    })
    vi.spyOn(assessmentApi, 'listAssessments').mockResolvedValue([draft])
    vi.spyOn(assessmentApi, 'getAssessment').mockResolvedValue(draft)
    render(
      <MemoryRouter initialEntries={['/capability/assessment']}>
        <App />
      </MemoryRouter>,
    )
    await screen.findByText('本次已更新')
    expect(
      (screen.getByRole('button', { name: '提交自评' }) as HTMLButtonElement)
        .disabled,
    ).toBe(false)
    expect(
      (screen.getByLabelText('计划候选 P01.01.01') as HTMLInputElement)
        .disabled,
    ).toBe(false)
  })

  it('excludes not-applicable items from page, L1, and L2 progress', async () => {
    const draft = mockDraft({
      details: [
        {
          ...mockDraft().details![0],
          l2_code: 'P01.01',
          l2_name: '数据基础',
          current_level: 2,
        },
        {
          ...mockDraft().details![0],
          id: 2,
          l3_code: 'P01.01.02',
          current_level: null,
          target_level: null,
          standard_target_applicable: false,
          standard_target_level: null,
          l2_code: 'P01.01',
          l2_name: '数据基础',
        },
      ],
    })
    vi.spyOn(assessmentApi, 'listAssessments').mockResolvedValue([draft])
    vi.spyOn(assessmentApi, 'getAssessment').mockResolvedValue(draft)
    render(
      <MemoryRouter initialEntries={['/capability/assessment']}>
        <App />
      </MemoryRouter>,
    )
    await screen.findByText('不适用')
    expect(screen.getByLabelText('评估摘要').textContent).toContain('进度 1/1')
    expect(screen.getByLabelText('评估摘要').textContent).toContain('未完成 0')
    expect(
      within(screen.getByLabelText('一级能力域导航')).getByRole('button', {
        name: /P01/,
      }).textContent,
    ).toContain('1/1')
    expect(
      within(screen.getByTestId('assessment-main-area')).getByText('1/1'),
    ).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '定位未完成' }))
    expect(document.querySelector('[id^="row-"]:focus')).toBeNull()
  })

  it('does not block progress or locate when every item is not applicable', async () => {
    const draft = mockDraft({
      details: [
        {
          ...mockDraft().details![0],
          current_level: null,
          target_level: null,
          standard_target_applicable: false,
          standard_target_level: null,
        },
      ],
    })
    vi.spyOn(assessmentApi, 'listAssessments').mockResolvedValue([draft])
    vi.spyOn(assessmentApi, 'getAssessment').mockResolvedValue(draft)
    render(
      <MemoryRouter initialEntries={['/capability/assessment']}>
        <App />
      </MemoryRouter>,
    )
    await screen.findByText('不适用')
    expect(screen.getByLabelText('评估摘要').textContent).toContain('进度 0/0')
    expect(screen.getByLabelText('评估摘要').textContent).toContain('未完成 0')
    fireEvent.click(screen.getByRole('button', { name: '定位未完成' }))
    expect(document.querySelector('[id^="row-"]:focus')).toBeNull()
  })

  it('blocks incomplete personal adjustments and unblocks after canceling them', async () => {
    const draft = mockDraft({
      details: [
        {
          ...mockDraft().details![0],
          current_level: 2,
          evidence_note: '已有依据',
        },
      ],
    })
    vi.spyOn(assessmentApi, 'listAssessments').mockResolvedValue([draft])
    vi.spyOn(assessmentApi, 'getAssessment').mockResolvedValue(draft)
    render(
      <MemoryRouter initialEntries={['/capability/assessment']}>
        <App />
      </MemoryRouter>,
    )
    await screen.findByText('标准 4')
    const submit = screen.getByRole('button', { name: '提交自评' })
    const adjustment = screen.getByLabelText('申请调整 P01.01.01')
    fireEvent.click(adjustment)
    expect(screen.getByText('需填写调整原因')).toBeTruthy()
    expect((submit as HTMLButtonElement).disabled).toBe(true)
    fireEvent.click(adjustment)
    await waitFor(() =>
      expect((submit as HTMLButtonElement).disabled).toBe(false),
    )
  })

  it('supports a valid personal adjustment target and reason', async () => {
    const draft = mockDraft({
      details: [
        {
          ...mockDraft().details![0],
          current_level: 2,
          evidence_note: '已有依据',
        },
      ],
    })
    vi.spyOn(assessmentApi, 'listAssessments').mockResolvedValue([draft])
    vi.spyOn(assessmentApi, 'getAssessment').mockResolvedValue(draft)
    render(
      <MemoryRouter initialEntries={['/capability/assessment']}>
        <App />
      </MemoryRouter>,
    )
    await screen.findByText('标准 4')
    fireEvent.click(screen.getByLabelText('申请调整 P01.01.01'))
    fireEvent.change(screen.getByLabelText('调整原因 P01.01.01'), {
      target: { value: '调整原因' },
    })
    expect(
      (screen.getByRole('button', { name: '提交自评' }) as HTMLButtonElement)
        .disabled,
    ).toBe(false)
  })

  it('allows an unchanged inherited value with valid inherited evidence', async () => {
    const draft = mockDraft({
      details: [
        {
          ...mockDraft().details![0],
          current_level: 2,
          evidence_note: '继承依据',
          inherited_from_assessment_id: 6,
          inherited_current_level: 2,
          inherited_evidence_note: '继承依据',
        },
      ],
    })
    vi.spyOn(assessmentApi, 'listAssessments').mockResolvedValue([draft])
    vi.spyOn(assessmentApi, 'getAssessment').mockResolvedValue(draft)
    render(
      <MemoryRouter initialEntries={['/capability/assessment']}>
        <App />
      </MemoryRouter>,
    )
    await screen.findByText('沿用上次评估')
    expect(
      (screen.getByRole('button', { name: '提交自评' }) as HTMLButtonElement)
        .disabled,
    ).toBe(false)
    expect(
      (screen.getByLabelText('计划候选 P01.01.01') as HTMLInputElement)
        .disabled,
    ).toBe(false)
  })

  it('does not offer L2 batch fill when the visible item is not applicable', async () => {
    const draft = mockDraft({
      details: [
        {
          ...mockDraft().details![0],
          current_level: null,
          standard_target_applicable: false,
          standard_target_level: null,
          target_level: null,
        },
      ],
    })
    vi.spyOn(assessmentApi, 'listAssessments').mockResolvedValue([draft])
    vi.spyOn(assessmentApi, 'getAssessment').mockResolvedValue(draft)
    render(
      <MemoryRouter initialEntries={['/capability/assessment']}>
        <App />
      </MemoryRouter>,
    )
    await screen.findByText('不适用')
    expect(screen.queryByRole('button', { name: '批量填 1' })).toBeNull()
    expect(screen.queryByRole('button', { name: '批量填 2' })).toBeNull()
  })

  it('saves dirty details with PATCH before direct submit', async () => {
    const draft = mockDraft({
      details: [
        {
          ...mockDraft().details![0],
          current_level: 1,
        },
      ],
    })
    vi.spyOn(assessmentApi, 'listAssessments').mockResolvedValue([draft])
    vi.spyOn(assessmentApi, 'getAssessment').mockResolvedValue(draft)
    const save = vi
      .spyOn(assessmentApi, 'saveDraft')
      .mockResolvedValue({ ok: true, revision: 2 })
    const submit = vi
      .spyOn(assessmentApi, 'submitAssessment')
      .mockResolvedValue({ ok: true, revision: 3 })
    render(
      <MemoryRouter initialEntries={['/capability/assessment']}>
        <App />
      </MemoryRouter>,
    )
    await screen.findByText('标准 4')
    fireEvent.change(screen.getByRole('combobox', { name: /当前等级/ }), {
      target: { value: '2' },
    })
    fireEvent.click(screen.getByRole('button', { name: '提交自评' }))
    await waitFor(() => expect(submit).toHaveBeenCalled())
    expect(save).toHaveBeenCalledWith(7, expect.any(Array), 1)
    expect(save.mock.invocationCallOrder[0]).toBeLessThan(
      submit.mock.invocationCallOrder[0],
    )
    expect(submit).toHaveBeenCalledWith(7, 2)
  })

  it('replaces the Gap summary after draft save', async () => {
    const draft = mockDraft({
      details: [
        {
          ...mockDraft().details![0],
          current_level: 2,
          gap_value: 2,
        },
      ],
      gap_summary: {
        total_gaps: 1,
        avg_gap: 2,
        high_priority: 0,
        medium_priority: 1,
        low_priority: 0,
      },
    })
    vi.spyOn(assessmentApi, 'listAssessments').mockResolvedValue([draft])
    vi.spyOn(assessmentApi, 'getAssessment').mockResolvedValue(draft)
    vi.spyOn(assessmentApi, 'saveDraft').mockResolvedValue({
      ok: true,
      revision: 2,
      gap_summary: {
        total_gaps: 0,
        avg_gap: 0,
        high_priority: 0,
        medium_priority: 0,
        low_priority: 0,
      },
    })
    render(
      <MemoryRouter initialEntries={['/capability/assessment']}>
        <App />
      </MemoryRouter>,
    )
    await screen.findByText('标准 4')
    fireEvent.change(screen.getByRole('combobox', { name: /当前等级/ }), {
      target: { value: '4' },
    })
    fireEvent.click(screen.getByRole('button', { name: '保存草稿' }))
    await waitFor(() => {
      expect(screen.getByLabelText('评估摘要').textContent).toContain('Gap 0')
    })
  })

  it('replaces the Gap summary after L2 batch fill', async () => {
    const draft = mockDraft({
      gap_summary: {
        total_gaps: 0,
        avg_gap: 0,
        high_priority: 0,
        medium_priority: 0,
        low_priority: 0,
      },
    })
    vi.spyOn(assessmentApi, 'listAssessments').mockResolvedValue([draft])
    vi.spyOn(assessmentApi, 'getAssessment').mockResolvedValue(draft)
    vi.spyOn(assessmentApi, 'batchFillL2').mockResolvedValue({
      revision: 2,
      updated_l3_codes: ['P01.01.01'],
      skipped_l3_codes: [],
      gap_summary: {
        total_gaps: 1,
        avg_gap: 4,
        high_priority: 1,
        medium_priority: 0,
        low_priority: 0,
      },
    })
    render(
      <MemoryRouter initialEntries={['/capability/assessment']}>
        <App />
      </MemoryRouter>,
    )
    await screen.findByText('标准 4')
    fireEvent.click(screen.getByRole('button', { name: '批量填 1' }))
    fireEvent.click(screen.getByRole('button', { name: '确认填 1' }))
    await waitFor(() => {
      expect(screen.getByLabelText('评估摘要').textContent).toContain('Gap 1')
    })
  })

  it('sends a personal adjustment without calculated target fields', async () => {
    vi.spyOn(assessmentApi, 'listAssessments').mockResolvedValue([
      {
        id: 7,
        member_id: 1,
        year: 2026,
        version: 1,
        assessment_type: '年度',
        status: '草稿',
        created_at: '',
        submitted_at: null,
        archived_at: null,
      },
    ])
    vi.spyOn(assessmentApi, 'getAssessment').mockResolvedValue(
      mockDraft({
        details: [
          {
            ...mockDraft().details![0],
            current_level: 2,
            evidence_note: '已有依据',
          },
        ],
      }),
    )
    const save = vi
      .spyOn(assessmentApi, 'saveDraft')
      .mockResolvedValue({ ok: true })
    render(
      <MemoryRouter initialEntries={['/capability/assessment']}>
        <App />
      </MemoryRouter>,
    )
    await screen.findByText('标准 4')

    fireEvent.click(screen.getByLabelText('申请调整 P01.01.01'))
    fireEvent.change(screen.getByLabelText('调整目标 P01.01.01'), {
      target: { value: '5' },
    })
    fireEvent.change(screen.getByLabelText('调整原因 P01.01.01'), {
      target: { value: '晋升准备' },
    })
    fireEvent.click(screen.getByRole('button', { name: '保存草稿' }))

    await waitFor(() => expect(save).toHaveBeenCalled())
    const detail = save.mock.calls[0][1][0]
    expect(detail).toMatchObject({
      target_adjusted: true,
      adjusted_target_level: 5,
      target_adjustment_reason: '晋升准备',
    })
  })

  it('treats a not-applicable snapshot as complete and disables adjustment', async () => {
    vi.spyOn(assessmentApi, 'listAssessments').mockResolvedValue([
      {
        id: 7,
        member_id: 1,
        year: 2026,
        version: 1,
        assessment_type: '年度',
        status: '草稿',
        created_at: '',
        submitted_at: null,
        archived_at: null,
      },
    ])
    vi.spyOn(assessmentApi, 'getAssessment').mockResolvedValue(
      mockDraft({
        details: [
          {
            ...mockDraft().details![0],
            target_level: null,
            standard_target_applicable: false,
            standard_target_level: null,
          },
        ],
      }),
    )
    render(
      <MemoryRouter initialEntries={['/capability/assessment']}>
        <App />
      </MemoryRouter>,
    )

    await screen.findByText('不适用')
    expect(
      (screen.getByLabelText('申请调整 P01.01.01') as HTMLInputElement)
        .disabled,
    ).toBe(true)
    expect(
      (screen.getByRole('button', { name: '提交自评' }) as HTMLButtonElement)
        .disabled,
    ).toBe(false)
  })

  it('keeps a legacy-preserved target visible but not adjustable', async () => {
    vi.spyOn(assessmentApi, 'listAssessments').mockResolvedValue([
      {
        id: 7,
        member_id: 1,
        year: 2026,
        version: 1,
        assessment_type: '年度',
        status: '草稿',
        created_at: '',
        submitted_at: null,
        archived_at: null,
      },
    ])
    vi.spyOn(assessmentApi, 'getAssessment').mockResolvedValue(
      mockDraft({
        details: [
          {
            ...mockDraft().details![0],
            current_level: 2,
            target_level: 5,
            standard_target_applicable: null,
            standard_target_level: null,
            target_snapshot_source: 'legacy_preserved',
            evidence_note: '历史依据',
          },
        ],
      }),
    )
    render(
      <MemoryRouter initialEntries={['/capability/assessment']}>
        <App />
      </MemoryRouter>,
    )

    await screen.findByText('历史保留')
    expect(
      (screen.getByLabelText('申请调整 P01.01.01') as HTMLInputElement)
        .disabled,
    ).toBe(true)
  })
})

describe('Assessment draft target repair', () => {
  beforeEach(() => {
    stubAuthAndYear()
  })
  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it('previews once, confirms once, and reloads the repaired assessment', async () => {
    const incompatible = mockDraft({
      details: [
        {
          ...mockDraft().details![0],
          target_compatibility_error: '历史明细缺少目标快照',
          standard_target_level: null,
          target_level: 3,
        },
      ],
    })
    const repaired = mockDraft({ revision: 2 })
    vi.spyOn(assessmentApi, 'listAssessments').mockResolvedValue([
      { ...incompatible, details: undefined },
    ])
    const getAssessment = vi
      .spyOn(assessmentApi, 'getAssessment')
      .mockResolvedValueOnce(incompatible)
      .mockResolvedValueOnce(repaired)
    const preview = vi
      .spyOn(assessmentApi, 'getDraftTargetRepairPreview')
      .mockResolvedValue({
        assessment_id: 7,
        status: '草稿',
        revision: 1,
        member_current_level: {
          value: 'P4',
          source: 'repair_time_user_profile',
        },
        member_target_level: {
          value: 'P5',
          source: 'repair_time_user_profile',
        },
        standard_version: {
          id: 1,
          version_no: 1,
          status: '已发布',
          source: 'legacy_derived',
        },
        summary: {
          rebuild_count: 1,
          preserve_count: 0,
          not_applicable_count: 0,
          unrepairable_count: 0,
          actionable_count: 1,
        },
        details: [{ l3_code: 'P01.01.01', action: 'rebuild', reason: null }],
        unrepairable_details: [],
      })
    const execute = vi
      .spyOn(assessmentApi, 'repairDraftTargetSnapshots')
      .mockResolvedValue({
        result: 'repaired',
        assessment_id: 7,
        old_revision: 1,
        revision: 2,
        audit_id: 9,
        summary: {
          rebuild_count: 1,
          preserve_count: 0,
          not_applicable_count: 0,
          unrepairable_count: 0,
          actionable_count: 1,
        },
        unrepairable_details: [],
      })

    render(
      <MemoryRouter initialEntries={['/capability/assessment']}>
        <App />
      </MemoryRouter>,
    )
    await screen.findByRole('alert', { name: '草稿目标快照需要兼容修复' })
    expect(screen.queryByText('需兼容修复')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '查看修复影响' }))
    await waitFor(() => {
      expect(screen.getByTestId('draft-repair-preview').textContent).toContain(
        '将重建 1 条明细',
      )
    })
    expect(preview).toHaveBeenCalledWith(7)
    expect(execute).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: '确认修复草稿' }))
    await waitFor(() => {
      expect(execute).toHaveBeenCalledWith(7, 1)
    })
    expect(getAssessment).toHaveBeenCalledTimes(2)
  })

  it.each([
    [409, '版本冲突', '草稿已被更新，请重新加载后查看修复影响。'],
    [403, '无权限执行修复', '无权限执行修复'],
    [422, '存在无法安全修复的明细', '存在无法安全修复的明细'],
    [undefined, '网络不可用', '网络不可用'],
  ])(
    'keeps the draft visible when repair returns %s',
    async (status, message, expectedMessage) => {
      const incompatible = mockDraft({
        details: [
          {
            ...mockDraft().details![0],
            target_compatibility_error: '历史明细缺少目标快照',
          },
        ],
      })
      vi.spyOn(assessmentApi, 'listAssessments').mockResolvedValue([
        { ...incompatible, details: undefined },
      ])
      vi.spyOn(assessmentApi, 'getAssessment').mockResolvedValue(incompatible)
      vi.spyOn(assessmentApi, 'getDraftTargetRepairPreview').mockResolvedValue({
        assessment_id: 7,
        status: '草稿',
        revision: 1,
        member_current_level: {
          value: 'P4',
          source: 'assessment_snapshot',
        },
        member_target_level: {
          value: 'P5',
          source: 'assessment_snapshot',
        },
        standard_version: {
          id: 1,
          version_no: 1,
          status: '已发布',
          source: 'legacy_derived',
        },
        summary: {
          rebuild_count: 1,
          preserve_count: 0,
          not_applicable_count: 0,
          unrepairable_count: 0,
          actionable_count: 1,
        },
        details: [{ l3_code: 'P01.01.01', action: 'rebuild', reason: null }],
        unrepairable_details: [],
      })
      const error = Object.assign(new Error(message), {
        status,
        detail: status === 409 ? undefined : { message },
      })
      vi.spyOn(assessmentApi, 'repairDraftTargetSnapshots').mockRejectedValue(
        error,
      )

      render(
        <MemoryRouter initialEntries={['/capability/assessment']}>
          <App />
        </MemoryRouter>,
      )
      await screen.findByRole('alert', { name: '草稿目标快照需要兼容修复' })
      fireEvent.click(screen.getByRole('button', { name: '查看修复影响' }))
      await screen.findByRole('button', { name: '确认修复草稿' })
      fireEvent.click(screen.getByRole('button', { name: '确认修复草稿' }))

      expect(await screen.findByText(expectedMessage)).toBeTruthy()
      expect(
        screen.getByRole('alert', { name: '草稿目标快照需要兼容修复' }),
      ).toBeTruthy()
      expect(screen.getByRole('button', { name: '确认修复草稿' })).toBeTruthy()
    },
  )
})

describe('AssessmentHistoryPage', () => {
  beforeEach(() => {
    stubAuthAndYear()
  })

  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it('shows current-model L2/L3 mapping without presenting live L2 requirements as history', async () => {
    vi.spyOn(assessmentApi, 'listAssessments').mockResolvedValue([
      {
        ...mockDraft({ status: '已归档', details: undefined }),
        submitted_at: '2026-01-02T00:00:00Z',
      },
    ])
    vi.spyOn(assessmentApi, 'getAssessment').mockResolvedValue(
      mockDraft({
        status: '已归档',
        l2_groups: [
          {
            l1_code: 'P01',
            l1_name: '数据基础设施',
            l2_code: 'P01.01',
            l2_name: '数据基础',
            l3_count: 1,
            is_empty: false,
            requirements: {
              P4: '不应作为历史事实展示的实时 P4 文本',
              P5: null,
              P6: null,
              P7: null,
              P8: null,
            },
            details: [mockDraft().details![0]],
          },
        ],
      }),
    )

    render(
      <MemoryRouter initialEntries={['/capability/assessment/history']}>
        <App />
      </MemoryRouter>,
    )

    const entry = await screen.findByRole('button', { name: /版本 1/ })
    fireEvent.click(entry)

    expect(
      await screen.findByText(
        /历史未分类：P01.01 · 数据基础 → P01.01.01 · 数据管道/,
      ),
    ).toBeTruthy()
    expect(screen.getByText(/当前掌握度.*目标掌握度.*Gap/)).toBeTruthy()
    expect(screen.queryByText(/实时 P4 文本/)).toBeNull()
  })
})

describe('R2-B filter/search', () => {
  beforeEach(() => {
    stubAuthAndYear()
  })
  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })
  const rich = (o: Partial<assessmentApi.AssessmentDetail> = {}) => ({
    id: 1,
    l3_code: 'P01.01.01',
    l3_name: '数据管道基础',
    l1_code: 'P01',
    l1_name: '数据基础设施',
    l2_code: 'P01.01',
    l2_name: '数据基础',
    current_level: 2,
    target_level: 4,
    gap_value: 2,
    evidence_note: 'done',
    plan_candidate: false,
    recommended_start_level: 'P4',
    ...o,
  })

  it('未完成 filter shows null-level items', async () => {
    vi.spyOn(assessmentApi, 'listAssessments').mockResolvedValue([
      {
        id: 7,
        member_id: 1,
        year: 2026,
        version: 1,
        assessment_type: '年度',
        status: '草稿',
        created_at: '',
        submitted_at: null,
        archived_at: null,
      },
    ])
    vi.spyOn(assessmentApi, 'getAssessment').mockResolvedValue({
      id: 7,
      member_id: 1,
      year: 2026,
      version: 1,
      assessment_type: '年度',
      status: '草稿',
      created_at: '',
      submitted_at: null,
      archived_at: null,
      details: [
        rich({ id: 1 }),
        {
          id: 2,
          l3_code: 'P01.01.02',
          l3_name: '文件规范',
          l1_code: 'P01',
          l1_name: '数据基础设施',
          l2_code: 'P01.01',
          l2_name: '数据基础',
          current_level: null,
          target_level: null,
          gap_value: 0,
          evidence_note: '',
          plan_candidate: false,
          recommended_start_level: 'P4',
        },
      ],
    })
    render(
      <MemoryRouter initialEntries={['/capability/assessment']}>
        <App />
      </MemoryRouter>,
    )
    await waitFor(() => {
      expect(screen.getByText('能力自评与 Gap 分析')).toBeTruthy()
    })
    fireEvent.change(screen.getByRole('combobox', { name: '状态筛选' }), {
      target: { value: '未完成' },
    })
    await waitFor(() => {
      expect(screen.getByText('P01.01.02')).toBeTruthy()
    })
  })
})

describe('assessment api helpers', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve({ ok: true, json: () => Promise.resolve({ id: 7 }) }),
      ),
    )
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })
  it('createAssessment', async () => {
    await assessmentApi.createAssessment(2026, 'token-abc')
    expect(fetch).toHaveBeenCalled()
    const body = JSON.parse(
      (vi.mocked(fetch).mock.calls[0][1] as RequestInit).body as string,
    )
    expect(body).toEqual({
      year: 2026,
      assessment_type: '年度',
      scope_token: 'token-abc',
    })
  })

  it('fetchScopePreview passes year and type as query params', async () => {
    await assessmentApi.fetchScopePreview(2026)
    const url = vi.mocked(fetch).mock.calls[0][0] as string
    expect(url).toContain('/api/assessments/scope-preview?')
    expect(url).toContain('year=2026')
  })

  it('saveDraft omits server-calculated target fields', async () => {
    await assessmentApi.saveDraft(
      7,
      [
        {
          l3_code: 'P01.01.01',
          current_level: 2,
          target_level: 5,
          standard_target_applicable: true,
          standard_target_level: 4,
          target_adjusted: true,
          adjusted_target_level: 5,
          target_adjustment_reason: '晋升准备',
          gap_value: 3,
        },
      ],
      1,
    )
    const body = JSON.parse(
      (vi.mocked(fetch).mock.calls[0][1] as RequestInit).body as string,
    )
    expect(body.details[0]).toEqual({
      l3_code: 'P01.01.01',
      current_level: 2,
      target_adjusted: true,
      adjusted_target_level: 5,
      target_adjustment_reason: '晋升准备',
      evidence_note: null,
      plan_candidate: false,
    })
    expect(body.expected_revision).toBe(1)
  })
})

describe('L2 职级要求选择', () => {
  const requirements = {
    P4: 'P4 要求',
    P5: 'P5 要求',
    P6: 'P6 要求',
    P7: 'P7 要求',
    P8: 'P8 要求',
  }

  it('prefers the target job level, then falls back to the current job level', () => {
    expect(assessmentApi.selectL2Requirement(requirements, 'P5', 'P7')).toEqual(
      { level: 'P7', label: '目标职级', text: 'P7 要求' },
    )
    expect(assessmentApi.selectL2Requirement(requirements, 'P5', null)).toEqual(
      { level: 'P5', label: '当前职级', text: 'P5 要求' },
    )
  })

  it('returns unavailable for missing, invalid, or blank job-level requirements', () => {
    expect(
      assessmentApi.selectL2Requirement(requirements, null, null),
    ).toBeNull()
    expect(
      assessmentApi.selectL2Requirement(requirements, 'P9', null),
    ).toBeNull()
    expect(
      assessmentApi.selectL2Requirement(
        { ...requirements, P6: ' ' },
        null,
        'P6',
      ),
    ).toBeNull()
  })
})

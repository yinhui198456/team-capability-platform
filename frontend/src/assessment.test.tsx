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
import {
  monthToQuarter,
  planMonthFromValue,
  planMonthValue,
  submitProblemDetails,
} from './AssessmentGapPage'
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
        include_in_plan: null,
        member_priority: null,
        plan_quarter: null,
        plan_month: null,
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

  it('renders 7-column table', async () => {
    vi.spyOn(assessmentApi, 'listAssessments').mockResolvedValue([
      { ...mockDraft(), details: undefined },
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
    await screen.findByText('能力自评与 Gap 分析')
    const headers = screen.getAllByRole('columnheader')
    expect(headers.length).toBe(7)
    expect(headers.map((h) => h.textContent)).toEqual([
      '能力项',
      '当前掌握度',
      '目标掌握度',
      'Gap',
      '优先级',
      '纳入计划',
      '计划时间',
    ])
  })

  it('0 is selectable in level dropdown', async () => {
    vi.spyOn(assessmentApi, 'listAssessments').mockResolvedValue([
      { ...mockDraft(), details: undefined },
    ])
    vi.spyOn(assessmentApi, 'getAssessment').mockResolvedValue(
      mockDraft({
        details: [
          {
            ...mockDraft().details![0],
            l1_code: 'P01',
            l2_code: 'P01.01',
            current_level: null,
          },
        ],
      }),
    )
    render(
      <MemoryRouter initialEntries={['/capability/assessment']}>
        <App />
      </MemoryRouter>,
    )
    await screen.findByText('能力自评与 Gap 分析')
    const select = screen.getByRole('combobox', { name: /当前等级/ })
    const options = Array.from((select as HTMLSelectElement).options).map(
      (o) => o.textContent,
    )
    expect(options).toContain('0 · 未接触/无可验证输出')
    expect(options).toContain('5 · 专家')
  })

  it('priority dropdown conditionally disabled when no gap', async () => {
    vi.spyOn(assessmentApi, 'listAssessments').mockResolvedValue([
      { ...mockDraft(), details: undefined },
    ])
    vi.spyOn(assessmentApi, 'getAssessment').mockResolvedValue(
      mockDraft({
        details: [
          {
            ...mockDraft().details![0],
            l1_code: 'P01',
            l2_code: 'P01.01',
            current_level: 5,
            standard_target_level: 4,
            target_level: 4,
          },
        ],
      }),
    )
    render(
      <MemoryRouter initialEntries={['/capability/assessment']}>
        <App />
      </MemoryRouter>,
    )
    await screen.findByText('能力自评与 Gap 分析')
    const prioSelect = screen.getByRole('combobox', {
      name: /优先级 P01.01.01/,
    })
    expect((prioSelect as HTMLSelectElement).disabled).toBe(true)
  })

  it('plan time conditionally visible when include_in_plan=true', async () => {
    vi.spyOn(assessmentApi, 'listAssessments').mockResolvedValue([
      { ...mockDraft(), details: undefined },
    ])
    vi.spyOn(assessmentApi, 'getAssessment').mockResolvedValue(
      mockDraft({
        details: [
          {
            ...mockDraft().details![0],
            l1_code: 'P01',
            l2_code: 'P01.01',
            current_level: 2,
            standard_target_level: 4,
            target_level: 4,
            include_in_plan: true,
          },
        ],
      }),
    )
    render(
      <MemoryRouter initialEntries={['/capability/assessment']}>
        <App />
      </MemoryRouter>,
    )
    await screen.findByText('能力自评与 Gap 分析')
    const month = screen.getByLabelText(
      '计划月份 P01.01.01',
    ) as HTMLInputElement
    expect(month.type).toBe('month')
    expect(month.value).toBe('')
    expect(month.min).toBe('2026-01')
    expect(month.max).toBe('2026-12')
  })

  it('clears a stale include decision when the gap vanishes (Issue #84)', async () => {
    // UAT failure path: the row was included (是 + June 2026, gap 2), then
    // the member raised current_level to the target — gap 0. The include
    // must revert to 未选择 immediately instead of silently surviving into
    // the save and producing an empty annual plan.
    const draft = mockDraft({
      details: [
        {
          ...mockDraft().details![0],
          current_level: 2,
          member_priority: '高',
          include_in_plan: true,
          plan_quarter: 'Q2',
          plan_month: 6,
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
    await screen.findByText('能力自评与 Gap 分析')
    const includeSelect = screen.getByRole('combobox', {
      name: '纳入计划 P01.01.01',
    }) as HTMLSelectElement
    expect(includeSelect.value).toBe('yes')
    expect(screen.getByLabelText('计划月份 P01.01.01')).not.toBeNull()

    fireEvent.change(screen.getByRole('combobox', { name: /当前等级/ }), {
      target: { value: '4' },
    })
    await waitFor(() => expect(includeSelect.value).toBe(''))
    expect(screen.queryByLabelText('计划月份 P01.01.01')).toBeNull()
  })

  it('filters work: 未评估, 有Gap, 已纳入计划, 暂缓', async () => {
    vi.spyOn(assessmentApi, 'listAssessments').mockResolvedValue([
      { ...mockDraft(), details: undefined },
    ])
    vi.spyOn(assessmentApi, 'getAssessment').mockResolvedValue(
      mockDraft({
        details: [
          {
            ...mockDraft().details![0],
            l1_code: 'P01',
            l2_code: 'P01.01',
            current_level: null,
            member_priority: null,
            include_in_plan: null,
          },
          {
            ...mockDraft().details![0],
            id: 2,
            l3_code: 'P01.01.02',
            l3_name: '任务2',
            l1_code: 'P01',
            l2_code: 'P01.01',
            current_level: 2,
            standard_target_level: 4,
            target_level: 4,
            member_priority: '暂缓',
            include_in_plan: true,
          },
        ],
      }),
    )
    render(
      <MemoryRouter initialEntries={['/capability/assessment']}>
        <App />
      </MemoryRouter>,
    )
    await screen.findByText('能力自评与 Gap 分析')

    const filterSelect = screen.getByTestId('status-filter')
    fireEvent.change(filterSelect, { target: { value: '未评估' } })
    await waitFor(() => {
      expect(screen.queryByText('任务2')).toBeNull()
      expect(screen.getByText('数据管道')).toBeTruthy()
    })

    fireEvent.change(filterSelect, { target: { value: '有Gap' } })
    await waitFor(() => {
      expect(screen.getByText('任务2')).toBeTruthy()
    })

    fireEvent.change(filterSelect, { target: { value: '已纳入计划' } })
    await waitFor(() => {
      expect(screen.getByText('任务2')).toBeTruthy()
    })

    fireEvent.change(filterSelect, { target: { value: '暂缓' } })
    await waitFor(() => {
      expect(screen.getByText('任务2')).toBeTruthy()
    })

    fireEvent.change(filterSelect, { target: { value: '全部' } })
    await waitFor(() => {
      expect(screen.getByText('数据管道')).toBeTruthy()
      expect(screen.getByText('任务2')).toBeTruthy()
    })
  })

  it('sticky bar counts show unfilled, no-priority, undecided', async () => {
    vi.spyOn(assessmentApi, 'listAssessments').mockResolvedValue([
      { ...mockDraft(), details: undefined },
    ])
    vi.spyOn(assessmentApi, 'getAssessment').mockResolvedValue(
      mockDraft({
        details: [
          {
            ...mockDraft().details![0],
            l1_code: 'P01',
            l2_code: 'P01.01',
            current_level: 2,
            standard_target_level: 4,
            target_level: 4,
            evidence_note: '有依据',
            include_in_plan: true,
            member_priority: null,
          },
        ],
      }),
    )
    render(
      <MemoryRouter initialEntries={['/capability/assessment']}>
        <App />
      </MemoryRouter>,
    )
    await screen.findByText('能力自评与 Gap 分析')
    // Should show "1 项纳入计划但未填优先级"
    expect(screen.getByText(/纳入计划但未填优先级/)).toBeTruthy()
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
    await screen.findByText('能力自评与 Gap 分析')
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

  it('creates draft with null current level', async () => {
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
    'allows inherited level increase from %s to %s without new evidence (#61)',
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
      // evidence is no longer a submit gate
      await screen.findByText('能力自评与 Gap 分析')
      expect(screen.queryByText('需更新依据')).toBeNull()
      expect(
        (screen.getByRole('button', { name: '提交自评' }) as HTMLButtonElement)
          .disabled,
      ).toBe(false)
    },
  )

  it.each([
    [null, ''],
    [null, '   '],
    ['旧依据', ' 旧依据 '],
  ])(
    'does not gate an inherited increase on normalized new evidence (%s → %s)',
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
      await screen.findByText('能力自评与 Gap 分析')
      expect(screen.queryByText('需更新依据')).toBeNull()
      expect(
        (screen.getByRole('button', { name: '提交自评' }) as HTMLButtonElement)
          .disabled,
      ).toBe(false)
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
      (screen.getByLabelText('纳入计划 P01.01.01') as HTMLInputElement)
        .disabled,
    ).toBe(false)
  })

  it('excludes not-applicable items from progress', async () => {
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
    expect(
      within(screen.getByLabelText('一级能力域导航')).getByRole('button', {
        name: /P01/,
      }).textContent,
    ).toContain('1/1')
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
    fireEvent.click(screen.getByRole('button', { name: '定位未完成' }))
    expect(document.querySelector('[id^="row-"]:focus')).toBeNull()
  })

  it('does not expose adjustment controls (#100)', async () => {
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
    await screen.findByText('能力自评与 Gap 分析')
    // No adjustment button, no checkbox, no inline controls
    expect(screen.queryByRole('button', { name: '调整个人目标' })).toBeNull()
    expect(screen.queryByLabelText('启用个人调整 P01.01.01')).toBeNull()
    expect(screen.queryByLabelText('调整目标 P01.01.01')).toBeNull()
    expect(screen.queryByLabelText('调整原因 P01.01.01')).toBeNull()
  })

  it('shows historical adjustment with 历史规则 label (#100)', async () => {
    const draft = mockDraft({
      details: [
        {
          ...mockDraft().details![0],
          current_level: 1,
          standard_target_level: 2,
          target_level: 4,
          target_adjusted: true,
          adjusted_target_level: 4,
          target_adjustment_reason: '岗位项目要求',
        },
      ],
    })
    vi.spyOn(assessmentApi, 'listAssessments').mockResolvedValue([draft])
    vi.spyOn(assessmentApi, 'getAssessment').mockResolvedValue(draft)
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          ok: true,
          revision: 2,
          gap_summary: {
            total_gaps: 1,
            avg_gap: 3.0,
            high_priority: 1,
            medium_priority: 0,
            low_priority: 0,
          },
        }),
        { status: 200 },
      ),
    )
    render(
      <MemoryRouter initialEntries={['/capability/assessment']}>
        <App />
      </MemoryRouter>,
    )
    await screen.findByText('能力自评与 Gap 分析')
    const row = document.getElementById('row-1') as HTMLElement
    // Preserved effective target (4) and gap (4−1=3) are displayed — never
    // the standard target (2) / standard gap (1) for an adjusted row.
    expect(within(row).getByText('4')).toBeTruthy()
    expect(within(row).getByText('3')).toBeTruthy()
    // Historical adjustment shown read-only with label; no editor exists.
    expect(within(row).getByText('[已调整]')).toBeTruthy()
    expect(screen.queryByRole('button', { name: '调整个人目标' })).toBeNull()
    // Plan save still omits every adjustment request field.
    fireEvent.change(screen.getByRole('combobox', { name: /优先级/ }), {
      target: { value: '高' },
    })
    fireEvent.click(screen.getByRole('button', { name: '保存草稿' }))
    await waitFor(() => expect(fetchSpy).toHaveBeenCalled())
    const fetchCall = fetchSpy.mock.calls.find(
      (call: [input: RequestInfo | URL, init?: RequestInit]) =>
        call[0].toString().includes('/api/assessments/') &&
        call[0].toString().includes('/draft'),
    )
    expect(fetchCall).toBeDefined()
    const body = JSON.parse((fetchCall![1] as RequestInit).body as string)
    expect(body.details[0]).not.toHaveProperty('target_adjusted')
    expect(body.details[0]).not.toHaveProperty('adjusted_target_level')
    expect(body.details[0]).not.toHaveProperty('target_adjustment_reason')
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
      (screen.getByLabelText('纳入计划 P01.01.01') as HTMLInputElement)
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
          member_priority: '中',
          include_in_plan: true,
          plan_quarter: 'Q2',
          plan_month: 6,
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
    await screen.findByText('能力自评与 Gap 分析')
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
    await screen.findByText('能力自评与 Gap 分析')
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
    await screen.findByText('能力自评与 Gap 分析')
    fireEvent.click(screen.getByRole('button', { name: '批量填 1' }))
    fireEvent.click(screen.getByRole('button', { name: '确认填 1' }))
    await waitFor(() => {
      expect(screen.getByLabelText('评估摘要').textContent).toContain('Gap 1')
    })
  })

  it('excludes adjustment fields from saveDraft payload (#100)', async () => {
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
            target_adjusted: false,
            adjusted_target_level: null,
            target_adjustment_reason: null,
          },
        ],
      }),
    )

    // Mock fetch to capture the actual HTTP payload
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          ok: true,
          revision: 2,
          gap_summary: {
            total_gaps: 1,
            avg_gap: 1.0,
            high_priority: 1,
            medium_priority: 0,
            low_priority: 0,
          },
        }),
        { status: 200 },
      ),
    )

    render(
      <MemoryRouter initialEntries={['/capability/assessment']}>
        <App />
      </MemoryRouter>,
    )
    await screen.findByText('能力自评与 Gap 分析')

    fireEvent.change(screen.getByRole('combobox', { name: /优先级/ }), {
      target: { value: '高' },
    })
    fireEvent.click(screen.getByRole('button', { name: '保存草稿' }))

    await waitFor(() => expect(fetchSpy).toHaveBeenCalled())

    const fetchCall = fetchSpy.mock.calls.find(
      (call: [input: RequestInfo | URL, init?: RequestInit]) =>
        call[0].toString().includes('/api/assessments/') &&
        call[0].toString().includes('/draft'),
    )
    expect(fetchCall).toBeDefined()

    const body = JSON.parse((fetchCall![1] as RequestInit).body as string)
    expect(body.details[0]).not.toHaveProperty('target_adjusted')
    expect(body.details[0]).not.toHaveProperty('adjusted_target_level')
    expect(body.details[0]).not.toHaveProperty('target_adjustment_reason')
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
    // The adjust button should not appear for non-applicable items
    expect(screen.queryByRole('button', { name: '调整个人目标' })).toBeNull()
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
    // No adjustment button since standard_target_level is null
    expect(screen.queryByRole('button', { name: '调整个人目标' })).toBeNull()
  })
})

describe('AssessmentGapPage plan time & submit contracts', () => {
  beforeEach(() => {
    stubAuthAndYear()
    vi.spyOn(assessmentApi, 'listAssessments').mockResolvedValue([])
    // jsdom has no scrollIntoView; locateDetail schedules it after focus.
    Element.prototype.scrollIntoView = vi.fn()
  })
  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it('monthToQuarter derives Q1-Q4 deterministically', () => {
    expect(monthToQuarter(1)).toBe('Q1')
    expect(monthToQuarter(3)).toBe('Q1')
    expect(monthToQuarter(4)).toBe('Q2')
    expect(monthToQuarter(6)).toBe('Q2')
    expect(monthToQuarter(7)).toBe('Q3')
    expect(monthToQuarter(9)).toBe('Q3')
    expect(monthToQuarter(10)).toBe('Q4')
    expect(monthToQuarter(12)).toBe('Q4')
  })

  it('planMonthValue maps month to YYYY-MM and normalizes out of range', () => {
    expect(planMonthValue(2026, 6)).toBe('2026-06')
    expect(planMonthValue(2026, 1)).toBe('2026-01')
    expect(planMonthValue(2026, null)).toBe('')
    expect(planMonthValue(2026, undefined)).toBe('')
    expect(planMonthValue(2026, 0)).toBe('')
    expect(planMonthValue(2026, 13)).toBe('')
  })

  it('planMonthFromValue rejects empty, cross-year and invalid months', () => {
    expect(planMonthFromValue(2026, '2026-06')).toEqual({
      month: 6,
      quarter: 'Q2',
    })
    expect(planMonthFromValue(2026, '2026-12')).toEqual({
      month: 12,
      quarter: 'Q4',
    })
    expect(planMonthFromValue(2026, '')).toBeNull()
    expect(planMonthFromValue(2026, '2027-06')).toBeNull()
    expect(planMonthFromValue(2026, '2026-00')).toBeNull()
    expect(planMonthFromValue(2026, '2026-13')).toBeNull()
    expect(planMonthFromValue(2026, 'not-a-month')).toBeNull()
  })

  it('renders the saved plan month as YYYY-MM and echoes on reload', async () => {
    vi.spyOn(assessmentApi, 'listAssessments').mockResolvedValue([
      { ...mockDraft(), details: undefined },
    ])
    vi.spyOn(assessmentApi, 'getAssessment').mockResolvedValue(
      mockDraft({
        details: [
          {
            ...mockDraft().details![0],
            current_level: 2,
            member_priority: '高',
            include_in_plan: true,
            plan_quarter: 'Q2',
            plan_month: 6,
          },
        ],
      }),
    )
    render(
      <MemoryRouter initialEntries={['/capability/assessment']}>
        <App />
      </MemoryRouter>,
    )
    await screen.findByText('能力自评与 Gap 分析')
    const month = screen.getByLabelText(
      '计划月份 P01.01.01',
    ) as HTMLInputElement
    expect(month.value).toBe('2026-06')
    expect(month.min).toBe('2026-01')
    expect(month.max).toBe('2026-12')
  })

  it('month change sends plan_month and derived plan_quarter in saveDraft', async () => {
    const draft = mockDraft({
      details: [
        {
          ...mockDraft().details![0],
          current_level: 2,
          member_priority: '高',
          include_in_plan: true,
        },
      ],
    })
    vi.spyOn(assessmentApi, 'listAssessments').mockResolvedValue([draft])
    vi.spyOn(assessmentApi, 'getAssessment').mockResolvedValue(draft)
    const save = vi
      .spyOn(assessmentApi, 'saveDraft')
      .mockResolvedValue({ ok: true, revision: 2 })
    render(
      <MemoryRouter initialEntries={['/capability/assessment']}>
        <App />
      </MemoryRouter>,
    )
    await screen.findByText('能力自评与 Gap 分析')
    fireEvent.change(screen.getByLabelText('计划月份 P01.01.01'), {
      target: { value: '2026-06' },
    })
    // Mark another field dirty so the save fires.
    fireEvent.change(screen.getByRole('combobox', { name: /当前等级/ }), {
      target: { value: '3' },
    })
    fireEvent.click(screen.getByRole('button', { name: '保存草稿' }))
    await waitFor(() => expect(save).toHaveBeenCalled())
    const detail = save.mock.calls[0][1][0]
    expect(detail.plan_month).toBe(6)
    expect(detail.plan_quarter).toBe('Q2')
  })

  it('clearing the month input clears plan_month and plan_quarter', async () => {
    const draft = mockDraft({
      details: [
        {
          ...mockDraft().details![0],
          current_level: 2,
          member_priority: '高',
          include_in_plan: true,
          plan_quarter: 'Q2',
          plan_month: 6,
        },
      ],
    })
    vi.spyOn(assessmentApi, 'listAssessments').mockResolvedValue([draft])
    vi.spyOn(assessmentApi, 'getAssessment').mockResolvedValue(draft)
    const save = vi
      .spyOn(assessmentApi, 'saveDraft')
      .mockResolvedValue({ ok: true, revision: 2 })
    render(
      <MemoryRouter initialEntries={['/capability/assessment']}>
        <App />
      </MemoryRouter>,
    )
    await screen.findByText('能力自评与 Gap 分析')
    fireEvent.change(screen.getByLabelText('计划月份 P01.01.01'), {
      target: { value: '' },
    })
    fireEvent.change(screen.getByRole('combobox', { name: /当前等级/ }), {
      target: { value: '3' },
    })
    fireEvent.click(screen.getByRole('button', { name: '保存草稿' }))
    await waitFor(() => expect(save).toHaveBeenCalled())
    const detail = save.mock.calls[0][1][0]
    expect(detail.plan_month).toBeNull()
    expect(detail.plan_quarter).toBeNull()
  })

  it('saving a draft with partial plan state is allowed and not blocked', async () => {
    const draft = mockDraft({
      details: [
        {
          ...mockDraft().details![0],
          current_level: 2,
          member_priority: '高',
          include_in_plan: true,
        },
      ],
    })
    vi.spyOn(assessmentApi, 'listAssessments').mockResolvedValue([draft])
    vi.spyOn(assessmentApi, 'getAssessment').mockResolvedValue(draft)
    const save = vi
      .spyOn(assessmentApi, 'saveDraft')
      .mockResolvedValue({ ok: true, revision: 2 })
    render(
      <MemoryRouter initialEntries={['/capability/assessment']}>
        <App />
      </MemoryRouter>,
    )
    await screen.findByText('能力自评与 Gap 分析')
    fireEvent.change(screen.getByRole('combobox', { name: /当前等级/ }), {
      target: { value: '3' },
    })
    fireEvent.click(screen.getByRole('button', { name: '保存草稿' }))
    await waitFor(() => expect(save).toHaveBeenCalled())
    expect(screen.getByText('草稿已保存')).toBeTruthy()
  })

  it('save 422 with structured reason shows Chinese copy and never raw English', async () => {
    const draft = mockDraft({
      details: [
        {
          ...mockDraft().details![0],
          current_level: 2,
          member_priority: '高',
          include_in_plan: true,
          plan_quarter: 'Q1',
          plan_month: 6,
        },
      ],
    })
    vi.spyOn(assessmentApi, 'listAssessments').mockResolvedValue([draft])
    vi.spyOn(assessmentApi, 'getAssessment').mockResolvedValue(draft)
    vi.spyOn(assessmentApi, 'saveDraft').mockRejectedValue({
      status: 422,
      detail: {
        code: 'plan_validation',
        l3_code: 'P01.01.01',
        l3_node_id: 1,
        field: 'plan_quarter',
        reason: 'invalid_quarter_month',
        message: 'invalid quarter-month combination: Q1+6',
      },
    })
    render(
      <MemoryRouter initialEntries={['/capability/assessment']}>
        <App />
      </MemoryRouter>,
    )
    await screen.findByText('能力自评与 Gap 分析')
    fireEvent.change(screen.getByRole('combobox', { name: /当前等级/ }), {
      target: { value: '3' },
    })
    fireEvent.click(screen.getByRole('button', { name: '保存草稿' }))
    await waitFor(() =>
      expect(
        screen.getByText('计划季度与月份不一致，请重新选择计划月份'),
      ).toBeTruthy(),
    )
    expect(screen.queryByText(/invalid quarter-month/)).toBeNull()
  })

  it('submit is blocked client-side when a REQUIRED item is unassessed', async () => {
    const draft = mockDraft({
      details: [
        {
          ...mockDraft().details![0],
          scope_type: 'current_required',
          current_level: null,
          member_priority: null,
          include_in_plan: null,
        },
      ],
    })
    vi.spyOn(assessmentApi, 'listAssessments').mockResolvedValue([draft])
    vi.spyOn(assessmentApi, 'getAssessment').mockResolvedValue(draft)
    const submit = vi
      .spyOn(assessmentApi, 'submitAssessment')
      .mockResolvedValue({ ok: true, revision: 2 })
    render(
      <MemoryRouter initialEntries={['/capability/assessment']}>
        <App />
      </MemoryRouter>,
    )
    await screen.findByText('能力自评与 Gap 分析')
    // The blocking UX: the submit button is disabled and the sticky bar
    // reports the precise REQUIRED-scope count.
    const submitButton = screen.getByRole('button', {
      name: '提交自评',
    }) as HTMLButtonElement
    expect(submitButton.disabled).toBe(true)
    expect(screen.getByText(/还有 1 项未完成/)).toBeTruthy()
    fireEvent.click(submitButton)
    expect(submit).not.toHaveBeenCalled()
  })

  it('submitProblemDetails blocks only REQUIRED-scope incompleteness', () => {
    const base = mockDraft().details![0]
    const problems = submitProblemDetails([
      { ...base, scope_type: 'current_required', current_level: null },
      { ...base, scope_type: 'target_progressive', current_level: null },
      {
        ...base,
        scope_type: 'current_required',
        current_level: 2,
        member_priority: null,
        include_in_plan: null,
      },
    ])
    expect(problems).toHaveLength(1)
    expect(problems[0].reason).toBe('requires_current_level')
  })

  it('submit proceeds when plan decisions are missing and shows the backlog note', async () => {
    const draft = mockDraft({
      details: [
        {
          ...mockDraft().details![0],
          scope_type: 'current_required',
          current_level: 2,
          member_priority: null,
          include_in_plan: null,
        },
      ],
    })
    vi.spyOn(assessmentApi, 'listAssessments').mockResolvedValue([draft])
    vi.spyOn(assessmentApi, 'getAssessment').mockResolvedValue(draft)
    const submit = vi
      .spyOn(assessmentApi, 'submitAssessment')
      .mockResolvedValue({ ok: true, revision: 2 })
    render(
      <MemoryRouter initialEntries={['/capability/assessment']}>
        <App />
      </MemoryRouter>,
    )
    await screen.findByText('能力自评与 Gap 分析')
    fireEvent.click(screen.getByRole('button', { name: '提交自评' }))
    await waitFor(() => expect(submit).toHaveBeenCalled())
    // Undecided Gaps are non-blocking and announced as growth backlog.
    expect(screen.getByText(/等待 Buddy 复核/)).toBeTruthy()
    expect(screen.getAllByText(/成长积压/).length).toBeGreaterThanOrEqual(1)
  })

  it('submit proceeds with unassessed ADVANCED items', async () => {
    const draft = mockDraft({
      details: [
        {
          ...mockDraft().details![0],
          scope_type: 'target_progressive',
          current_level: null,
        },
      ],
    })
    vi.spyOn(assessmentApi, 'listAssessments').mockResolvedValue([draft])
    vi.spyOn(assessmentApi, 'getAssessment').mockResolvedValue(draft)
    const submit = vi
      .spyOn(assessmentApi, 'submitAssessment')
      .mockResolvedValue({ ok: true, revision: 2 })
    render(
      <MemoryRouter initialEntries={['/capability/assessment']}>
        <App />
      </MemoryRouter>,
    )
    await screen.findByText('能力自评与 Gap 分析')
    fireEvent.click(screen.getByRole('button', { name: '提交自评' }))
    await waitFor(() => expect(submit).toHaveBeenCalled())
    expect(screen.queryByText(/尚无法提交/)).toBeNull()
  })

  it('applies the ?focus=required-incomplete deep link from the workspace', async () => {
    // Typed as Assessment so scope_type keeps the intended literal union
    // (current_required | target_progressive) instead of widening to string.
    const draft: assessmentApi.Assessment = {
      ...mockDraft(),
      assessment_scope_version: 'scope-v1',
      details: [
        {
          ...mockDraft().details![0],
          scope_type: 'current_required',
          current_level: null,
        },
      ],
    }
    vi.spyOn(assessmentApi, 'listAssessments').mockResolvedValue([draft])
    vi.spyOn(assessmentApi, 'getAssessment').mockResolvedValue(draft)
    render(
      <MemoryRouter
        initialEntries={['/capability/assessment?focus=required-incomplete']}
      >
        <App />
      </MemoryRouter>,
    )
    await screen.findByText('能力自评与 Gap 分析')
    const statusFilter = screen.getByLabelText('状态筛选') as HTMLSelectElement
    const scopeFilter = screen.getByLabelText('范围筛选') as HTMLSelectElement
    await waitFor(() => {
      expect(statusFilter.value).toBe('未评估')
    })
    expect(scopeFilter.value).toBe('current_required')
  })

  it('submit proceeds when plan fields are complete', async () => {
    const draft = mockDraft({
      details: [
        {
          ...mockDraft().details![0],
          current_level: 2,
          member_priority: '高',
          include_in_plan: true,
          plan_quarter: 'Q2',
          plan_month: 6,
        },
      ],
    })
    vi.spyOn(assessmentApi, 'listAssessments').mockResolvedValue([draft])
    vi.spyOn(assessmentApi, 'getAssessment').mockResolvedValue(draft)
    const submit = vi
      .spyOn(assessmentApi, 'submitAssessment')
      .mockResolvedValue({ ok: true, revision: 2 })
    render(
      <MemoryRouter initialEntries={['/capability/assessment']}>
        <App />
      </MemoryRouter>,
    )
    await screen.findByText('能力自评与 Gap 分析')
    fireEvent.click(screen.getByRole('button', { name: '提交自评' }))
    await waitFor(() => expect(submit).toHaveBeenCalled())
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

describe('AssessmentGapPage ownership gate (#81)', () => {
  beforeEach(() => {
    stubAuthAndYear()
    vi.spyOn(assessmentApi, 'listAssessments').mockResolvedValue([])
  })
  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it('a non-owner viewer sees the draft read-only: no edit/save/submit controls', async () => {
    // Viewer session in the same Member workspace whose id differs from the
    // draft owner — e.g. the assigned buddy viewing the member's draft.
    vi.mocked(accessApi.me).mockResolvedValue({
      id: 2,
      username: 'buddy',
      full_name: 'Buddy',
      roles: ['Member', 'Buddy'],
    })
    vi.spyOn(assessmentApi, 'listAssessments').mockResolvedValue([
      { ...mockDraft({ member_id: 1 }), details: undefined },
    ])
    vi.spyOn(assessmentApi, 'getAssessment').mockResolvedValue(
      mockDraft({ member_id: 1 }),
    )
    render(
      <MemoryRouter initialEntries={['/capability/assessment']}>
        <App />
      </MemoryRouter>,
    )
    await screen.findByText('能力自评与 Gap 分析')
    expect(screen.queryByRole('button', { name: '保存草稿' })).toBeNull()
    expect(screen.queryByRole('button', { name: '提交自评' })).toBeNull()
    expect(screen.queryByRole('button', { name: '批量填 1' })).toBeNull()
    expect(
      (screen.getByRole('combobox', { name: /当前等级/ }) as HTMLSelectElement)
        .disabled,
    ).toBe(true)
    expect(screen.getByTestId('readonly-notice').textContent).toContain(
      '仅可查看',
    )
  })

  it.each([
    [
      '保存草稿',
      '仅评估本人可以保存草稿，当前账号无修改权限，已保留本地输入。',
    ],
    [
      '提交自评',
      '仅评估本人可以提交自评，当前账号无提交权限，已保留本地输入。',
    ],
  ])(
    'maps a %s 403 to a specific Chinese permission message and preserves inputs',
    async (action, expected) => {
      const draft = mockDraft({
        details: [
          {
            ...mockDraft().details![0],
            current_level: 2,
            member_priority: '高',
            include_in_plan: true,
            plan_quarter: 'Q2',
            plan_month: 6,
          },
        ],
      })
      vi.spyOn(assessmentApi, 'listAssessments').mockResolvedValue([draft])
      vi.spyOn(assessmentApi, 'getAssessment').mockResolvedValue(draft)
      const save = vi.spyOn(assessmentApi, 'saveDraft').mockRejectedValue({
        status: 403,
        detail: 'insufficient permissions',
      })
      render(
        <MemoryRouter initialEntries={['/capability/assessment']}>
          <App />
        </MemoryRouter>,
      )
      await screen.findByText('能力自评与 Gap 分析')
      fireEvent.change(screen.getByRole('combobox', { name: /当前等级/ }), {
        target: { value: '3' },
      })
      fireEvent.click(screen.getByRole('button', { name: action }))
      expect(await screen.findByText(expected)).toBeTruthy()
      // No generic reload copy, no raw backend English.
      expect(screen.queryByText(/重新加载后再/)).toBeNull()
      expect(screen.queryByText(/insufficient permissions/)).toBeNull()
      // Inputs preserved; the action stays retryable.
      expect(
        (
          screen.getByRole('combobox', {
            name: /当前等级/,
          }) as HTMLSelectElement
        ).value,
      ).toBe('3')
      expect(
        (screen.getByRole('button', { name: action }) as HTMLButtonElement)
          .disabled,
      ).toBe(false)
      expect(save).toHaveBeenCalled()
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
    include_in_plan: null,
    member_priority: null,
    plan_quarter: null,
    plan_month: null,
    ...o,
  })

  it('未评估 filter shows null-level items', async () => {
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
          include_in_plan: null,
          member_priority: null,
          plan_quarter: null,
          plan_month: null,
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
    fireEvent.change(screen.getByTestId('status-filter'), {
      target: { value: '未评估' },
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

  it('saveDraft sends canonical fields and omits plan_candidate', async () => {
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
          member_priority: '高',
          include_in_plan: true,
          plan_quarter: 'Q1',
          plan_month: 3,
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
      evidence_note: null,
      member_priority: '高',
      include_in_plan: true,
      plan_quarter: 'Q1',
      plan_month: 3,
    })
    expect(body.details[0]).not.toHaveProperty('plan_candidate')
    expect(body.details[0]).not.toHaveProperty('target_adjusted')
    expect(body.details[0]).not.toHaveProperty('adjusted_target_level')
    expect(body.details[0]).not.toHaveProperty('target_adjustment_reason')
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

describe('newIdempotencyKey', () => {
  it('returns a non-empty string', () => {
    const key = assessmentApi.newIdempotencyKey()
    expect(key).toBeTruthy()
    expect(key.length).toBeGreaterThan(0)
  })

  it('produces distinct keys on successive calls', () => {
    const a = assessmentApi.newIdempotencyKey()
    const b = assessmentApi.newIdempotencyKey()
    expect(a).not.toBe(b)
  })

  it('falls back to getRandomValues when randomUUID is not available', () => {
    const orig = crypto.randomUUID as (() => string) | undefined
    Object.defineProperty(crypto, 'randomUUID', {
      value: undefined,
      writable: true,
    })
    try {
      const key = assessmentApi.newIdempotencyKey()
      expect(key).toBeTruthy()
      expect(key.length).toBeGreaterThanOrEqual(22)
    } finally {
      if (orig) {
        Object.defineProperty(crypto, 'randomUUID', {
          value: orig,
          writable: true,
        })
      } else {
        Object.defineProperty(crypto, 'randomUUID', {
          value: undefined,
          writable: true,
        })
      }
    }
  })

  it('uses randomUUID when available', () => {
    const key = assessmentApi.newIdempotencyKey()
    expect(key).toBeTruthy()
    if (typeof crypto.randomUUID === 'function') {
      expect(key).toContain('-')
    }
  })
})

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
    // Issue #194: single native month input (plan_quarter no longer exists
    // as an input; derived server-side only).
    const month = screen.getByLabelText('计划月份 P01.01.01')
    expect(month).toBeTruthy()
    expect(month).toHaveProperty('type', 'month')
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

  it('generate button not gated on unfilled levels (#187 contract #1)', async () => {
    // 评级允许任意部分逐项保存：未评级不阻断生成动作（未选中的项不参与
    // 生成；选中但缺月份才在生成时按项提示）。
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
      expect(
        screen.getByRole('button', { name: '生成所选学习任务' }),
      ).toBeTruthy()
    })
    expect(
      (
        screen.getByRole('button', {
          name: '生成所选学习任务',
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(false)
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
        (
          screen.getByRole('button', {
            name: '生成所选学习任务',
          }) as HTMLButtonElement
        ).disabled,
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
        (
          screen.getByRole('button', {
            name: '生成所选学习任务',
          }) as HTMLButtonElement
        ).disabled,
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
      (
        screen.getByRole('button', {
          name: '生成所选学习任务',
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(false)
    expect(
      (
        screen.getByRole('button', {
          name: /加入提升计划/,
        }) as HTMLButtonElement
      ).disabled,
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

  it('surfaces an incomplete personal adjustment reason at rating save', async () => {
    // Issue #194 P1（三独立动作）：生成所选学习任务不再夹带未保存评级，
    // 调整不完整由「保存能力评级」承接服务端 422（逐项中文提示）。
    const draft = mockDraft({
      details: [
        {
          ...mockDraft().details![0],
          current_level: 2,
          evidence_note: '已有依据',
          include_in_plan: true,
          plan_month: '2026-07',
        },
      ],
    })
    vi.spyOn(assessmentApi, 'listAssessments').mockResolvedValue([draft])
    vi.spyOn(assessmentApi, 'getAssessment').mockResolvedValue(draft)
    const save = vi.spyOn(assessmentApi, 'saveDraft').mockRejectedValue({
      status: 422,
      detail: {
        code: 'target_adjustment',
        l3_code: 'P01.01.01',
        reason: 'missing_reason',
        message: '请填写调整原因',
      },
    })
    render(
      <MemoryRouter initialEntries={['/capability/assessment']}>
        <App />
      </MemoryRouter>,
    )
    await screen.findByText('能力自评与 Gap 分析')
    const generate = screen.getByRole('button', { name: '生成所选学习任务' })
    // Click the adjustment expand button, enable without a reason
    fireEvent.click(screen.getByText('调整▸'))
    fireEvent.click(screen.getByLabelText('启用个人调整 P01.01.01'))
    expect(screen.getByText('需填写调整原因')).toBeTruthy()
    expect((generate as HTMLButtonElement).disabled).toBe(false)
    // 评级保存提交该调整（含缺原因），服务端 422 逐项提示、输入保留
    fireEvent.click(screen.getByRole('button', { name: '保存能力评级' }))
    await waitFor(() => expect(save).toHaveBeenCalled())
    expect(save.mock.calls[0][1][0]).toMatchObject({ target_adjusted: true })
    await waitFor(() => {
      expect(screen.getByText('请填写调整原因')).toBeTruthy()
    })
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
    await screen.findByText('能力自评与 Gap 分析')
    fireEvent.click(screen.getByText('调整▸'))
    fireEvent.click(screen.getByLabelText('启用个人调整 P01.01.01'))
    fireEvent.change(screen.getByLabelText('调整原因 P01.01.01'), {
      target: { value: '调整原因' },
    })
    expect(
      (
        screen.getByRole('button', {
          name: '生成所选学习任务',
        }) as HTMLButtonElement
      ).disabled,
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
      (
        screen.getByRole('button', {
          name: '生成所选学习任务',
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(false)
    expect(
      (
        screen.getByRole('button', {
          name: /加入提升计划/,
        }) as HTMLButtonElement
      ).disabled,
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

  it('saves dirty details with PATCH before explicit generation', async () => {
    const draft = mockDraft({
      details: [
        {
          ...mockDraft().details![0],
          current_level: 1,
          include_in_plan: true,
          plan_month: '2026-07',
        },
      ],
    })
    vi.spyOn(assessmentApi, 'listAssessments').mockResolvedValue([draft])
    vi.spyOn(assessmentApi, 'getAssessment').mockResolvedValue(draft)
    const save = vi
      .spyOn(assessmentApi, 'saveDraft')
      .mockResolvedValue({ ok: true, revision: 2 })
    const generate = vi
      .spyOn(assessmentApi, 'generatePlanItems')
      .mockResolvedValue({ ok: true, created: ['P01.01.01'], existing: [] })
    render(
      <MemoryRouter initialEntries={['/capability/assessment']}>
        <App />
      </MemoryRouter>,
    )
    await screen.findByText('能力自评与 Gap 分析')
    // Issue #194 P1：生成前的落草稿只涉及计划字段（三独立动作）
    fireEvent.change(
      screen.getByRole('combobox', { name: /优先级 P01\.01\.01/ }),
      { target: { value: '高' } },
    )
    fireEvent.click(screen.getByRole('button', { name: '生成所选学习任务' }))
    await waitFor(() => expect(generate).toHaveBeenCalled())
    expect(save).toHaveBeenCalledWith(7, expect.any(Array), 1)
    expect(save.mock.invocationCallOrder[0]).toBeLessThan(
      generate.mock.invocationCallOrder[0],
    )
    expect(generate).toHaveBeenCalledWith(
      7,
      ['P01.01.01'],
      2,
      expect.any(String),
    )
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
    fireEvent.click(screen.getByRole('button', { name: '保存能力评级' }))
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

  it('batch fill advances the same revision chain as plan auto-save (#194 P1)', async () => {
    const draft = mockDraft({
      details: [{ ...mockDraft().details![0], current_level: null }],
    })
    vi.spyOn(assessmentApi, 'listAssessments').mockResolvedValue([draft])
    vi.spyOn(assessmentApi, 'getAssessment').mockResolvedValue(draft)
    let resolveSave!: (value: { ok: boolean; revision: number }) => void
    let saveCalls = 0
    const save = vi.spyOn(assessmentApi, 'saveDraft').mockImplementation(() => {
      saveCalls += 1
      if (saveCalls === 1) {
        return new Promise((resolve) => {
          resolveSave = resolve
        })
      }
      return Promise.resolve({ ok: true, revision: 4 })
    })
    const batch = vi.spyOn(assessmentApi, 'batchFillL2').mockResolvedValue({
      revision: 3,
      updated_l3_codes: ['P01.01.01'],
      skipped_l3_codes: [],
    })
    render(
      <MemoryRouter initialEntries={['/capability/assessment']}>
        <App />
      </MemoryRouter>,
    )
    await screen.findByText('能力自评与 Gap 分析')

    // 计划变更 → 在途自动保存挂起
    fireEvent.change(
      screen.getByRole('combobox', { name: /优先级 P01\.01\.01/ }),
      { target: { value: '高' } },
    )
    await waitFor(() => expect(save).toHaveBeenCalledTimes(1))

    // 批量填必须与在途计划保存串行：保存完成前不发起请求
    fireEvent.click(screen.getByRole('button', { name: '批量填 1' }))
    fireEvent.click(screen.getByRole('button', { name: '确认填 1' }))
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(batch).not.toHaveBeenCalled()

    // 在途保存成功（revision 1→2），批量填随后发起并沿用同一 revision 链
    resolveSave({ ok: true, revision: 2 })
    await waitFor(() => expect(batch).toHaveBeenCalledTimes(1))
    expect(save.mock.invocationCallOrder[0]).toBeLessThan(
      batch.mock.invocationCallOrder[0],
    )
    expect(batch.mock.calls[0][3]).toBe(2)

    // 批量填成功返回新 revision 3 → 下一次计划草稿 PATCH 必须使用 3
    fireEvent.change(
      screen.getByRole('combobox', { name: /优先级 P01\.01\.01/ }),
      { target: { value: '中' } },
    )
    await waitFor(() => expect(save).toHaveBeenCalledTimes(2))
    expect(save.mock.calls[1][2]).toBe(3)
  })

  it('sends canonical fields instead of plan_candidate in saveDraft', async () => {
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
    await screen.findByText('能力自评与 Gap 分析')

    fireEvent.click(screen.getByText('调整▸'))
    fireEvent.click(screen.getByLabelText('启用个人调整 P01.01.01'))
    fireEvent.change(screen.getByLabelText('调整目标 P01.01.01'), {
      target: { value: '5' },
    })
    fireEvent.change(screen.getByLabelText('调整原因 P01.01.01'), {
      target: { value: '晋升准备' },
    })
    fireEvent.click(screen.getByRole('button', { name: '保存能力评级' }))

    await waitFor(() => expect(save).toHaveBeenCalled())
    const detail = save.mock.calls[0][1][0]
    expect(detail).toMatchObject({
      target_adjusted: true,
      adjusted_target_level: 5,
      target_adjustment_reason: '晋升准备',
    })
    // Issue #194 P1：保存能力评级与保存提升计划草稿是两个独立动作，
    // 评级保存（稀疏 PATCH）绝不夹带计划字段；计划草稿由
    // 「保存提升计划草稿」动作单独提交。
    expect(detail).not.toHaveProperty('member_priority')
    expect(detail).not.toHaveProperty('include_in_plan')
    expect(detail).not.toHaveProperty('plan_month')
  })

  it('sticky footer has exactly the two main actions (#194 M02 V1)', async () => {
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
    vi.spyOn(assessmentApi, 'saveDraft').mockResolvedValue({ ok: true })
    render(
      <MemoryRouter initialEntries={['/capability/assessment']}>
        <App />
      </MemoryRouter>,
    )
    await screen.findByText('能力自评与 Gap 分析')
    expect(screen.getByRole('button', { name: '保存能力评级' })).toBeTruthy()
    expect(
      screen.getByRole('button', { name: '生成所选学习任务' }),
    ).toBeTruthy()
    // M02 V1：无全局草稿保存按钮——计划草稿随行内变更自动保存。
    expect(
      screen.queryByRole('button', { name: '保存提升计划草稿' }),
    ).toBeNull()
  })

  it('row plan control is a single join/leave action (#194 M02 V1)', async () => {
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
    vi.spyOn(assessmentApi, 'saveDraft').mockResolvedValue({ ok: true })
    render(
      <MemoryRouter initialEntries={['/capability/assessment']}>
        <App />
      </MemoryRouter>,
    )
    await screen.findByText('能力自评与 Gap 分析')
    // M02 V1：三态下拉被单一加入/移出操作取代。
    expect(screen.queryByRole('combobox', { name: /纳入计划/ })).toBeNull()
    const join = screen.getByRole('button', { name: /加入提升计划/ })
    expect(join).toBeTruthy()
    fireEvent.click(join)
    expect(screen.getByRole('button', { name: /移出提升计划/ })).toBeTruthy()
  })

  it('plan change auto-saves a sparse plan payload, never ratings (#194 M02 V1)', async () => {
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
    const save = vi
      .spyOn(assessmentApi, 'saveDraft')
      .mockResolvedValue({ ok: true })
    render(
      <MemoryRouter initialEntries={['/capability/assessment']}>
        <App />
      </MemoryRouter>,
    )
    await screen.findByText('能力自评与 Gap 分析')

    // 未保存评级（当前等级 2 → 3）
    fireEvent.change(screen.getByRole('combobox', { name: /当前等级/ }), {
      target: { value: '3' },
    })
    // 行内加入 → 自动保存，仅计划字段
    fireEvent.click(screen.getByRole('button', { name: /加入提升计划/ }))
    await waitFor(() => expect(save).toHaveBeenCalledTimes(1))
    const row = save.mock.calls[0][1][0]
    expect(row).toMatchObject({ include_in_plan: true })
    expect(row).not.toHaveProperty('current_level')
    expect(row).not.toHaveProperty('target_adjusted')
    expect(row).not.toHaveProperty('evidence_note')
    // 未保存评级保留在本地
    expect(
      (
        screen.getByRole('combobox', {
          name: /当前等级/,
        }) as HTMLSelectElement
      ).value,
    ).toBe('3')
  })

  it('plan auto-save failure keeps input and shows a Chinese retry message (#194)', async () => {
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
    const save = vi
      .spyOn(assessmentApi, 'saveDraft')
      .mockRejectedValueOnce({ status: 409 })
      .mockResolvedValueOnce({ ok: true })
    render(
      <MemoryRouter initialEntries={['/capability/assessment']}>
        <App />
      </MemoryRouter>,
    )
    await screen.findByText('能力自评与 Gap 分析')
    fireEvent.click(screen.getByRole('button', { name: /加入提升计划/ }))
    await waitFor(() => expect(save).toHaveBeenCalledTimes(1))
    await waitFor(() => {
      expect(
        screen.getByText(
          '数据已被其他操作更新，已保留本地输入；请重新加载后再保存。',
        ),
      ).toBeTruthy()
    })
    // 输入保留：行内状态仍为已加入
    expect(screen.getByRole('button', { name: /移出提升计划/ })).toBeTruthy()
    // 脏集合未清：下一次计划变更自动重试补交
    fireEvent.change(
      screen.getByRole('combobox', { name: /优先级 P01\.01\.01/ }),
      { target: { value: '高' } },
    )
    await waitFor(() => expect(save).toHaveBeenCalledTimes(2))
    expect(save.mock.calls[1][1][0]).toMatchObject({
      include_in_plan: true,
      member_priority: '高',
    })
  })

  it('generation waits for the in-flight plan auto-save (#194)', async () => {
    const draft = mockDraft({
      details: [
        {
          ...mockDraft().details![0],
          current_level: 2,
          evidence_note: '已有依据',
          include_in_plan: true,
          plan_month: '2026-07',
        },
      ],
    })
    vi.spyOn(assessmentApi, 'listAssessments').mockResolvedValue([draft])
    vi.spyOn(assessmentApi, 'getAssessment').mockResolvedValue(draft)
    let resolveSave!: (value: { ok: boolean; revision: number }) => void
    const save = vi.spyOn(assessmentApi, 'saveDraft').mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveSave = resolve
        }),
    )
    const gen = vi
      .spyOn(assessmentApi, 'generatePlanItems')
      .mockResolvedValue({ ok: true, created: ['P01.01.01'], existing: [] })
    render(
      <MemoryRouter initialEntries={['/capability/assessment']}>
        <App />
      </MemoryRouter>,
    )
    await screen.findByText('能力自评与 Gap 分析')

    // 优先级变更触发在途自动保存
    fireEvent.change(
      screen.getByRole('combobox', { name: /优先级 P01\.01\.01/ }),
      { target: { value: '高' } },
    )
    await waitFor(() => expect(save).toHaveBeenCalledTimes(1))
    // 立即显式生成：必须等待在途保存完成
    fireEvent.click(screen.getByRole('button', { name: '生成所选学习任务' }))
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(gen).not.toHaveBeenCalled()
    resolveSave({ ok: true, revision: 2 })
    await waitFor(() => expect(gen).toHaveBeenCalledTimes(1))
    expect(save.mock.invocationCallOrder[0]).toBeLessThan(
      gen.mock.invocationCallOrder[0],
    )
    // 用保存响应返回的 revision 生成
    expect(gen.mock.calls[0][2]).toBe(2)
  })

  it('rating save and plan auto-save stay independent (#194)', async () => {
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
    const save = vi
      .spyOn(assessmentApi, 'saveDraft')
      .mockResolvedValue({ ok: true })
    render(
      <MemoryRouter initialEntries={['/capability/assessment']}>
        <App />
      </MemoryRouter>,
    )
    await screen.findByText('能力自评与 Gap 分析')

    // 评级变更归脏集合；计划变更入队自动保存（两动作互不夹带）
    fireEvent.change(screen.getByRole('combobox', { name: /当前等级/ }), {
      target: { value: '3' },
    })
    fireEvent.change(
      screen.getByRole('combobox', { name: /优先级 P01\.01\.01/ }),
      { target: { value: '高' } },
    )
    fireEvent.click(screen.getByRole('button', { name: /加入提升计划/ }))
    fireEvent.change(screen.getByLabelText('计划月份 P01.01.01'), {
      target: { value: '2026-05' },
    })

    // 保存能力评级：先等待计划自动保存落库，再只提交评级字段（稀疏 PATCH）
    fireEvent.click(screen.getByRole('button', { name: '保存能力评级' }))
    await waitFor(() => expect(save).toHaveBeenCalledTimes(2))
    const planRow = save.mock.calls[0][1][0]
    expect(planRow).toMatchObject({
      member_priority: '高',
      include_in_plan: true,
      plan_month: '2026-05',
    })
    expect(planRow).not.toHaveProperty('current_level')
    expect(planRow).not.toHaveProperty('target_adjusted')
    expect(planRow).not.toHaveProperty('evidence_note')
    const ratingRow = save.mock.calls[1][1][0]
    expect(ratingRow).toMatchObject({
      current_level: 3,
      target_adjusted: false,
      evidence_note: '已有依据',
    })
    expect(ratingRow).not.toHaveProperty('member_priority')
    expect(ratingRow).not.toHaveProperty('include_in_plan')
    expect(ratingRow).not.toHaveProperty('plan_month')
    // 本地计划选择与月份保留（自动保存成功，无全局草稿保存按钮）
    expect(
      (
        screen.getByRole('combobox', {
          name: /优先级 P01\.01\.01/,
        }) as HTMLSelectElement
      ).value,
    ).toBe('高')
    expect(screen.getByRole('button', { name: /移出提升计划/ })).toBeTruthy()
    expect(
      (screen.getByLabelText('计划月份 P01.01.01') as HTMLInputElement).value,
    ).toBe('2026-05')
  })

  it('plan auto-save failure keeps input and retries on the next plan change (#194)', async () => {
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
    const save = vi
      .spyOn(assessmentApi, 'saveDraft')
      .mockRejectedValueOnce({ status: 409 })
      .mockResolvedValueOnce({ ok: true })
    render(
      <MemoryRouter initialEntries={['/capability/assessment']}>
        <App />
      </MemoryRouter>,
    )
    await screen.findByText('能力自评与 Gap 分析')

    // 优先级变更触发自动保存 → 409：中文提示，输入与待保存计划变更均保留
    fireEvent.change(
      screen.getByRole('combobox', { name: /优先级 P01\.01\.01/ }),
      { target: { value: '高' } },
    )
    await waitFor(() => expect(save).toHaveBeenCalledTimes(1))
    await waitFor(() => {
      expect(
        screen.getByText(
          '数据已被其他操作更新，已保留本地输入；请重新加载后再保存。',
        ),
      ).toBeTruthy()
    })
    expect(
      (
        screen.getByRole('combobox', {
          name: /优先级 P01\.01\.01/,
        }) as HTMLSelectElement
      ).value,
    ).toBe('高')

    // 队列未清：下一次计划变更自动重试，提交合并后的最新状态
    fireEvent.change(
      screen.getByRole('combobox', { name: /优先级 P01\.01\.01/ }),
      { target: { value: '中' } },
    )
    await waitFor(() => expect(save).toHaveBeenCalledTimes(2))
    expect(save.mock.calls[1][1][0]).toMatchObject({ member_priority: '中' })
  })

  it('generate pre-save submits only plan fields, never unsaved ratings (#194)', async () => {
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
    const save = vi
      .spyOn(assessmentApi, 'saveDraft')
      .mockResolvedValue({ ok: true })
    const gen = vi
      .spyOn(assessmentApi, 'generatePlanItems')
      .mockResolvedValue({ ok: true, created: ['P01.01.01'], existing: [] })
    render(
      <MemoryRouter initialEntries={['/capability/assessment']}>
        <App />
      </MemoryRouter>,
    )
    await screen.findByText('能力自评与 Gap 分析')

    // 未保存评级：当前等级改 3 但不点保存
    fireEvent.change(screen.getByRole('combobox', { name: /当前等级/ }), {
      target: { value: '3' },
    })
    fireEvent.change(
      screen.getByRole('combobox', { name: /优先级 P01\.01\.01/ }),
      { target: { value: '高' } },
    )
    fireEvent.click(screen.getByRole('button', { name: /加入提升计划/ }))
    fireEvent.change(screen.getByLabelText('计划月份 P01.01.01'), {
      target: { value: '2026-05' },
    })

    fireEvent.click(screen.getByRole('button', { name: '生成所选学习任务' }))
    // 生成前先等待在途计划自动保存（稀疏 PATCH），落库后只提交最新计划快照
    await waitFor(() => expect(save).toHaveBeenCalledTimes(1))
    const planRow = save.mock.calls[0][1][0]
    expect(planRow).toMatchObject({
      member_priority: '高',
      include_in_plan: true,
      plan_month: '2026-05',
    })
    expect(planRow).not.toHaveProperty('current_level')
    expect(planRow).not.toHaveProperty('target_adjusted')
    await waitFor(() => expect(gen).toHaveBeenCalledTimes(1))
    expect(gen.mock.calls[0][1]).toEqual(['P01.01.01'])
  })

  it('generation success keeps unsaved local ratings (#194)', async () => {
    // P1-1：生成成功不得重载草稿（服务端旧评级会覆盖本地输入）。
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
    const save = vi
      .spyOn(assessmentApi, 'saveDraft')
      .mockResolvedValue({ ok: true })
    const gen = vi
      .spyOn(assessmentApi, 'generatePlanItems')
      .mockResolvedValue({ ok: true, created: ['P01.01.01'], existing: [] })
    render(
      <MemoryRouter initialEntries={['/capability/assessment']}>
        <App />
      </MemoryRouter>,
    )
    await screen.findByText('能力自评与 Gap 分析')

    // 未保存评级：当前等级 2 → 3；计划字段一并修改
    fireEvent.change(screen.getByRole('combobox', { name: /当前等级/ }), {
      target: { value: '3' },
    })
    fireEvent.change(
      screen.getByRole('combobox', { name: /优先级 P01\.01\.01/ }),
      { target: { value: '高' } },
    )
    fireEvent.click(screen.getByRole('button', { name: /加入提升计划/ }))
    fireEvent.change(screen.getByLabelText('计划月份 P01.01.01'), {
      target: { value: '2026-05' },
    })

    fireEvent.click(screen.getByRole('button', { name: '生成所选学习任务' }))
    await waitFor(() => expect(gen).toHaveBeenCalledTimes(1))
    // 生成前的计划自动保存只含计划字段
    expect(save.mock.calls[0][1][0]).not.toHaveProperty('current_level')
    expect(save.mock.calls[0][1][0]).not.toHaveProperty('target_adjusted')
    // 本地未保存评级与计划选择、月份均保留
    expect(
      (
        screen.getByRole('combobox', {
          name: /当前等级/,
        }) as HTMLSelectElement
      ).value,
    ).toBe('3')
    expect(
      (
        screen.getByRole('combobox', {
          name: /优先级 P01\.01\.01/,
        }) as HTMLSelectElement
      ).value,
    ).toBe('高')
    expect(screen.getByRole('button', { name: /移出提升计划/ })).toBeTruthy()
    expect(
      (screen.getByLabelText('计划月份 P01.01.01') as HTMLInputElement).value,
    ).toBe('2026-05')
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
    expect(screen.queryByText('调整▸')).toBeNull()
    expect(
      (
        screen.getByRole('button', {
          name: '生成所选学习任务',
        }) as HTMLButtonElement
      ).disabled,
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
    expect(screen.queryByText('调整▸')).toBeNull()
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
          plan_month: '2026-03',
        },
      ],
      1,
    )
    const body = JSON.parse(
      (vi.mocked(fetch).mock.calls[0][1] as RequestInit).body as string,
    )
    // 稀疏 PATCH：调用方提供的键全部透传（含评级与计划字段），
    // 未提供的键不发送；plan_candidate/plan_quarter 永不出现。
    expect(body.details[0]).toEqual({
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
      plan_month: '2026-03',
    })
    expect(body.details[0]).not.toHaveProperty('plan_candidate')
    expect(body.details[0]).not.toHaveProperty('plan_quarter')
    expect(body.expected_revision).toBe(1)
  })

  it('saveDraft sparse PATCH: only provided keys are sent (#194)', async () => {
    // 计划动作只给计划字段 → 请求体中不得出现评级字段
    await assessmentApi.saveDraft(
      7,
      [
        {
          l3_node_id: 1,
          l3_code: 'P01.01.01',
          member_priority: '高',
          include_in_plan: true,
          plan_month: '2026-03',
        },
      ],
      2,
    )
    const body = JSON.parse(
      (vi.mocked(fetch).mock.calls[0][1] as RequestInit).body as string,
    )
    expect(body.details[0]).toEqual({
      l3_node_id: 1,
      l3_code: 'P01.01.01',
      member_priority: '高',
      include_in_plan: true,
      plan_month: '2026-03',
    })
    expect(body.expected_revision).toBe(2)
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

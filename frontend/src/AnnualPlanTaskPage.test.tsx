/// @vitest-environment jsdom
import {
  cleanup,
  render,
  screen,
  waitFor,
  fireEvent,
  within,
} from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { App } from './App'
import * as planningApi from './planning'
import * as accessApi from './access'
import { MemoryRouter } from 'react-router-dom'
import type {
  AnnualPlan,
  Evidence,
  EvidenceReviewRecord,
  LearningTask,
  PlanItem,
  ProgressLog,
} from './planning'

function makeItem(overrides: Partial<PlanItem>): PlanItem {
  return {
    id: 1,
    annual_growth_plan_id: 1,
    growth_goal_id: 1,
    l3_code: 'P01.01.01',
    l3_name: '数据管道基础',
    current_level: 2,
    target_level: 4,
    priority: '中',
    learning_material: null,
    learning_task_content: '测试任务',
    expected_output: null,
    estimated_hours: '24',
    plan_start_date: '2026-03-01',
    plan_end_date: '2026-04-30',
    target_month: 3,
    status: '进行中',
    revision: 0,
    ...overrides,
  }
}

function makeTask(overrides: Partial<LearningTask>): LearningTask {
  return {
    id: 1,
    plan_item_id: 1,
    l3_code: 'P01.01.01',
    status: '未开始',
    actual_start_date: null,
    actual_end_date: null,
    actual_hours: 0,
    completion_quality: null,
    review_conclusion: null,
    next_action: null,
    revision: 0,
    actual_started_at: null,
    actual_completed_at: null,
    delay_reason: null,
    pause_reason: null,
    cancel_reason: null,
    revised_due_date: null,
    plan_item_current_level: 2,
    plan_item_target_level: 4,
    plan_item_priority: '中',
    plan_item_learning_material: null,
    plan_item_learning_task_content: '测试任务',
    plan_item_expected_output: null,
    plan_item_estimated_hours: '24',
    plan_item_target_month: 3,
    ...overrides,
  }
}

function makePlan(items: PlanItem[]): AnnualPlan {
  return {
    id: 1,
    member_id: 1,
    year: 2026,
    plan_cycle: 12,
    status: '执行中',
    start_date: '2026-01-01',
    end_date: '2026-12-31',
    created_at: '2026-01-01T00:00:00Z',
    items,
  }
}

function makeLog(overrides: Partial<ProgressLog> = {}): ProgressLog {
  return {
    id: 11,
    task_id: 1,
    record_date: '2026-05-10',
    actual_hours: 3,
    note: '阅读文档',
    recorder_id: 1,
    created_at: '2026-05-10T00:00:00Z',
    invalidated_at: null,
    invalidated_by: null,
    correction_of_log_id: null,
    idempotency_key: null,
    ...overrides,
  }
}

function makeEvidence(overrides: Partial<Evidence> = {}): Evidence {
  return {
    id: 9,
    learning_task_id: 1,
    l3_code: 'P01.01.01',
    version_number: 1,
    content: '实现说明',
    evidence_link: null,
    status: '草稿',
    submitted_at: null,
    created_at: '2026-05-10T00:00:00Z',
    submitted_by: 1,
    description: null,
    evidence_type: null,
    url: null,
    file_reference: null,
    file_name: null,
    mime_type: null,
    file_size: null,
    supersedes_evidence_id: null,
    revision: 0,
    ...overrides,
  }
}

function makeReview(
  overrides: Partial<EvidenceReviewRecord> = {},
): EvidenceReviewRecord {
  return {
    id: 1,
    evidence_id: 9,
    version_number: 1,
    status: '已闭环',
    conclusion: '需补充',
    feedback: '请补充口径说明',
    reviewed_at: '2026-05-02T00:00:00Z',
    created_at: '2026-05-02T00:00:00Z',
    ...overrides,
  }
}

function stubMember() {
  vi.spyOn(accessApi, 'me').mockResolvedValue({
    id: 1,
    username: 'member',
    full_name: 'Member',
    roles: ['Member'],
  })
}

type RenderOptions = {
  logs?: ProgressLog[]
  evidences?: Evidence[]
  reviews?: EvidenceReviewRecord[]
  planExtra?: Partial<AnnualPlan>
}

async function renderMember(
  items: PlanItem[],
  tasks: LearningTask[] = [],
  options: RenderOptions = {},
) {
  stubMember()
  vi.spyOn(planningApi, 'getAnnualPlan').mockResolvedValue({
    ...makePlan(items),
    ...(options.planExtra ?? {}),
  })
  vi.spyOn(planningApi, 'listLearningTasks').mockResolvedValue(tasks)
  vi.spyOn(planningApi, 'getLearningTask').mockImplementation(async (id) => {
    const task = tasks.find((t) => t.id === id)
    if (!task) throw new Error('not found')
    return task
  })
  vi.spyOn(planningApi, 'listProgressLogs').mockResolvedValue(
    options.logs ?? [],
  )
  vi.spyOn(planningApi, 'listEvidences').mockResolvedValue(
    options.evidences ?? [],
  )
  vi.spyOn(planningApi, 'listEvidenceReviewsForTask').mockResolvedValue(
    options.reviews ?? [],
  )
  vi.spyOn(planningApi, 'listTaskTransitionHistory').mockResolvedValue([])
  render(
    <MemoryRouter initialEntries={['/growth/annual-plan']}>
      <App />
    </MemoryRouter>,
  )
  await waitFor(() => {
    expect(screen.getByRole('heading', { name: '年度成长计划' })).toBeTruthy()
  })
}

function expandItem(itemId: number) {
  const rows = screen.getAllByTestId('plan-header')
  const row = rows.find((r) => r.textContent?.includes(String(itemId)))
  fireEvent.click(row ?? rows[0])
}

describe('AnnualPlanTaskPage display', () => {
  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it('renders page with plan items', async () => {
    await renderMember([makeItem({})])
    expect(planningApi.listLearningTasks).toHaveBeenCalledWith(2026)
    expect(
      screen.getByText((content) => content.includes('P01.01.01')),
    ).toBeTruthy()
    expect(screen.getByText('二级能力标准 → 三级达成路径')).toBeTruthy()
    expect(screen.getByText('掌握度提升')).toBeTruthy()
    expect(screen.getByText('计划时长')).toBeTruthy()
  })

  it('month filter shows only selected month items', async () => {
    await renderMember([
      makeItem({ id: 1, l3_name: '任务A', target_month: 3 }),
      makeItem({
        id: 2,
        l3_code: 'P02.01.01',
        l3_name: '任务B',
        target_month: 4,
      }),
    ])
    const btns = screen.getAllByRole('button', { name: /3 月/ })
    fireEvent.click(
      btns.find((b) => b.textContent?.startsWith('3 月')) || btns[0],
    )
    await waitFor(() => {
      expect(screen.getByText('P01.01.01 · 任务A')).toBeTruthy()
    })
    expect(screen.queryByText('P02.01.01 · 任务B')).toBeNull()
  })

  it('Issue #86: plan_month-only item counts in month axis, filter and row', async () => {
    // Assessment-approved items carry plan_month/plan_quarter only; task
    // start/end dates and legacy target_month are NULL.  The month axis,
    // month filter and row summary must still attribute the item to its
    // saved plan month.
    await renderMember([
      makeItem({
        id: 1,
        l3_code: 'P02.02.01',
        l3_name: 'LLMOps 平台部署',
        plan_start_date: null,
        plan_end_date: null,
        target_month: null,
        plan_month: 9,
        plan_quarter: 'Q3',
      }),
    ])

    const timeline = screen.getByTestId('month-timeline')
    const september = within(timeline)
      .getAllByRole('button')
      .find((b) => b.textContent?.startsWith('9 月'))
    expect(september?.textContent).toContain('1 项')

    const row = screen.getByTestId('plan-header')
    expect(row.textContent).toContain('9 月')
    expect(row.textContent).not.toContain('—')

    // The row column is labeled as the plan month, distinct from actual
    // hours/occurrence month (Issue #86 caliber separation).
    expect(screen.getByText('计划月份')).toBeTruthy()

    fireEvent.click(september!)
    await waitFor(() => {
      expect(screen.getByText('P02.02.01 · LLMOps 平台部署')).toBeTruthy()
    })
  })

  it('shows an estimated-hour range without coercing it to zero', async () => {
    await renderMember(
      [
        makeItem({
          estimated_hours: '4–6',
          estimated_hours_parsed: {
            raw: '4–6',
            min_hours: 4,
            max_hours: 6,
            is_valid: true,
            is_range: true,
          },
        }),
      ],
      [],
      {
        planExtra: {
          estimated_hours_summary: {
            min_hours: 4,
            max_hours: 6,
            has_values: true,
            has_unparsed: false,
          },
        },
      },
    )
    await waitFor(() => expect(screen.getAllByText('4–6 h')).toHaveLength(2))
  })

  it('falls back to l3_code when l3_name is missing', async () => {
    await renderMember([makeItem({ l3_name: undefined })])
    expect(screen.getByText('P01.01.01')).toBeTruthy()
  })

  it('shows unparsed warning when estimated hours summary has unparsed text', async () => {
    await renderMember(
      [
        makeItem({
          estimated_hours: '约半天',
          estimated_hours_parsed: {
            raw: '约半天',
            min_hours: null,
            max_hours: null,
            is_valid: false,
            is_range: false,
          },
        }),
      ],
      [],
      {
        planExtra: {
          estimated_hours_summary: {
            min_hours: 0,
            max_hours: 0,
            has_values: false,
            has_unparsed: true,
          },
        },
      },
    )
    await waitFor(() =>
      expect(
        screen.getByText((content) =>
          content.includes('部分计划项耗时为文本，未计入汇总'),
        ),
      ).toBeTruthy(),
    )
    expect(screen.getByText('约半天')).toBeTruthy()
  })
})

describe('learning task execution (v0010)', () => {
  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it('shows conditional actions per task status', async () => {
    await renderMember(
      [
        makeItem({ id: 1 }),
        makeItem({ id: 2, l3_code: 'P02.01.01' }),
        makeItem({ id: 3, l3_code: 'P03.01.01', status: '已完成' }),
      ],
      [
        makeTask({ id: 1, plan_item_id: 1, status: '未开始' }),
        makeTask({ id: 2, plan_item_id: 2, status: '进行中', revision: 2 }),
        makeTask({ id: 3, plan_item_id: 3, status: '已完成', revision: 5 }),
      ],
    )
    const headers = screen.getAllByTestId('plan-header')
    // 未开始 → 开始执行 + 取消任务
    fireEvent.click(headers[0])
    await waitFor(() =>
      expect(screen.getByRole('button', { name: '开始执行' })).toBeTruthy(),
    )
    expect(screen.getByRole('button', { name: '取消任务' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: '申请延期' })).toBeNull()
    fireEvent.click(headers[0])

    // 进行中 → 暂停 / 申请延期 / 完成任务 / 取消任务
    fireEvent.click(headers[1])
    await waitFor(() =>
      expect(screen.getByRole('button', { name: '暂停' })).toBeTruthy(),
    )
    expect(screen.getByRole('button', { name: '申请延期' })).toBeTruthy()
    expect(screen.getByRole('button', { name: '完成任务' })).toBeTruthy()
    expect(screen.getByRole('button', { name: '取消任务' })).toBeTruthy()
    fireEvent.click(headers[1])

    // 已完成 → no actions
    fireEvent.click(headers[2])
    await waitFor(() => {
      expect(screen.getAllByText('已完成').length).toBeGreaterThan(0)
    })
    expect(screen.queryByRole('button', { name: '开始执行' })).toBeNull()
    expect(screen.queryByRole('button', { name: '暂停' })).toBeNull()
    expect(screen.queryByRole('button', { name: '完成任务' })).toBeNull()
  })

  it('requires a reason before pausing', async () => {
    await renderMember(
      [makeItem({})],
      [makeTask({ id: 1, plan_item_id: 1, status: '进行中', revision: 1 })],
    )
    const transition = vi
      .spyOn(planningApi, 'transitionLearningTask')
      .mockResolvedValue(makeTask({ id: 1, plan_item_id: 1, status: '暂停' }))
    expandItem(1)
    await waitFor(() =>
      expect(screen.getByRole('button', { name: '暂停' })).toBeTruthy(),
    )
    fireEvent.click(screen.getByRole('button', { name: '暂停' }))
    fireEvent.click(screen.getByRole('button', { name: '确认暂停' }))
    await waitFor(() => {
      expect(
        screen.getByRole('alert').textContent?.includes('暂停原因'),
      ).toBeTruthy()
    })
    expect(transition).not.toHaveBeenCalled()
  })

  it('submits a delay with reason, revised date and CAS revision', async () => {
    const task = makeTask({
      id: 1,
      plan_item_id: 1,
      status: '进行中',
      revision: 3,
    })
    await renderMember([makeItem({})], [task])
    const transition = vi
      .spyOn(planningApi, 'transitionLearningTask')
      .mockResolvedValue(
        makeTask({ id: 1, plan_item_id: 1, status: '延期', revision: 4 }),
      )
    expandItem(1)
    await waitFor(() =>
      expect(screen.getByRole('button', { name: '申请延期' })).toBeTruthy(),
    )
    fireEvent.click(screen.getByRole('button', { name: '申请延期' }))
    fireEvent.change(screen.getByLabelText('延期原因'), {
      target: { value: '等待资源' },
    })
    fireEvent.change(screen.getByLabelText('修订截止日期'), {
      target: { value: '2026-08-31' },
    })
    fireEvent.click(screen.getByRole('button', { name: '确认延期' }))
    await waitFor(() => expect(transition).toHaveBeenCalledTimes(1))
    const payload = transition.mock.calls[0][1]
    expect(payload).toMatchObject({
      to_status: '延期',
      reason: '等待资源',
      revised_due_date: '2026-08-31',
      expected_revision: 3,
    })
    expect(payload.idempotency_key).toBeTruthy()
  })

  it('maps a completion-gate 422 to the failing block and keeps the form', async () => {
    await renderMember(
      [makeItem({})],
      [makeTask({ id: 1, plan_item_id: 1, status: '进行中', revision: 1 })],
    )
    vi.spyOn(planningApi, 'updateLearningTask').mockResolvedValue(
      makeTask({ id: 1, plan_item_id: 1, status: '进行中', revision: 2 }),
    )
    const gateError: unknown = Object.assign(
      new Error('task requires at least one approved evidence'),
      {
        status: 422,
        detail: {
          code: 'completion_gate_failed',
          entity_type: 'learning_task',
          entity_id: 1,
          field: 'evidence',
          reason: 'completion_gate_failed',
          message: 'task requires at least one approved evidence',
        },
      },
    )
    vi.spyOn(planningApi, 'transitionLearningTask').mockRejectedValue(gateError)
    expandItem(1)
    await waitFor(() =>
      expect(screen.getByRole('button', { name: '完成任务' })).toBeTruthy(),
    )
    fireEvent.click(screen.getByRole('button', { name: '完成任务' }))
    fireEvent.change(screen.getByLabelText('复盘结论'), {
      target: { value: '完成了数据管道' },
    })
    fireEvent.change(screen.getByLabelText('下一步行动'), {
      target: { value: '继续优化' },
    })
    fireEvent.click(screen.getByRole('button', { name: '确认完成' }))
    await waitFor(() => {
      const alert = screen.getByRole('alert')
      expect(alert.textContent).toContain('通过评审的任务成果证明')
    })
    // The unsubmitted inputs are preserved.
    const conclusion = screen.getByLabelText('复盘结论') as HTMLTextAreaElement
    expect(conclusion.value).toBe('完成了数据管道')
  })

  it('keeps input on revision 409, refreshes the task and retries with a new key', async () => {
    const task = makeTask({
      id: 1,
      plan_item_id: 1,
      status: '进行中',
      revision: 1,
    })
    await renderMember([makeItem({})], [task])
    const conflict: unknown = Object.assign(new Error('revision conflict'), {
      status: 409,
      detail: {
        code: 'task_revision_conflict',
        entity_type: 'learning_task',
        entity_id: 1,
        field: 'revision',
        reason: 'task_revision_conflict',
        message: 'learning task revision conflict',
      },
    })
    const transition = vi
      .spyOn(planningApi, 'transitionLearningTask')
      .mockRejectedValueOnce(conflict)
      .mockResolvedValueOnce(
        makeTask({ id: 1, plan_item_id: 1, status: '暂停', revision: 2 }),
      )
    // The refresh observes the newer revision.
    vi.mocked(planningApi.getLearningTask).mockResolvedValue(
      makeTask({ id: 1, plan_item_id: 1, status: '进行中', revision: 2 }),
    )
    expandItem(1)
    await waitFor(() =>
      expect(screen.getByRole('button', { name: '暂停' })).toBeTruthy(),
    )
    fireEvent.click(screen.getByRole('button', { name: '暂停' }))
    fireEvent.change(screen.getByLabelText('暂停原因'), {
      target: { value: '资源冲突' },
    })
    fireEvent.click(screen.getByRole('button', { name: '确认暂停' }))
    await waitFor(() => {
      expect(
        screen.getByRole('alert').textContent?.includes('任务数据已更新'),
      ).toBeTruthy()
    })
    // Input preserved and the task was refreshed.
    const reasonInput = screen.getByLabelText('暂停原因') as HTMLTextAreaElement
    expect(reasonInput.value).toBe('资源冲突')
    // Retry with the refreshed revision and a NEW idempotency key.
    fireEvent.click(screen.getByRole('button', { name: '确认暂停' }))
    await waitFor(() => expect(transition).toHaveBeenCalledTimes(2))
    const first = transition.mock.calls[0][1]
    const second = transition.mock.calls[1][1]
    expect(second.expected_revision).toBe(2)
    expect(second.idempotency_key).not.toBe(first.idempotency_key)
  })

  it('appends a progress log with an idempotency key; task hours stay read-only', async () => {
    await renderMember(
      [makeItem({})],
      [makeTask({ id: 1, plan_item_id: 1, status: '进行中', revision: 1 })],
    )
    const createLog = vi
      .spyOn(planningApi, 'createProgressLog')
      .mockResolvedValue(makeLog({ id: 11 }))
    expandItem(1)
    await waitFor(() =>
      expect(screen.getByRole('button', { name: '记录进展' })).toBeTruthy(),
    )
    fireEvent.change(screen.getByLabelText('记录日期'), {
      target: { value: '2026-05-10' },
    })
    fireEvent.change(screen.getByLabelText('本次时长（小时）'), {
      target: { value: '3' },
    })
    fireEvent.change(screen.getByLabelText('备注'), {
      target: { value: '阅读文档' },
    })
    fireEvent.click(screen.getByRole('button', { name: '记录进展' }))
    await waitFor(() => expect(createLog).toHaveBeenCalledTimes(1))
    const [taskId, payload] = createLog.mock.calls[0]
    expect(taskId).toBe(1)
    expect(payload).toMatchObject({
      record_date: '2026-05-10',
      actual_hours: 3,
      note: '阅读文档',
    })
    expect(payload.idempotency_key).toBeTruthy()
    // The task total is displayed, not editable.
    expect(screen.getByText(/实际耗时/)).toBeTruthy()
    expect(screen.queryByLabelText('任务实际时长')).toBeNull()
  })

  it('voids a log instead of deleting it', async () => {
    await renderMember(
      [makeItem({})],
      [makeTask({ id: 1, plan_item_id: 1, status: '进行中', revision: 1 })],
      { logs: [makeLog({})] },
    )
    const invalidate = vi
      .spyOn(planningApi, 'invalidateProgressLog')
      .mockResolvedValue(
        makeLog({ invalidated_at: '2026-05-11T00:00:00Z', invalidated_by: 1 }),
      )
    expandItem(1)
    await waitFor(() =>
      expect(screen.getByRole('button', { name: '作废' })).toBeTruthy(),
    )
    fireEvent.click(screen.getByRole('button', { name: '作废' }))
    fireEvent.click(screen.getByRole('button', { name: '确认作废' }))
    await waitFor(() => expect(invalidate).toHaveBeenCalledTimes(1))
    expect(invalidate.mock.calls[0][0]).toBe(11)
    expect(invalidate.mock.calls[0][1]).toBeTruthy()
  })

  it('creates a corrected log referencing the voided one', async () => {
    await renderMember(
      [makeItem({})],
      [makeTask({ id: 1, plan_item_id: 1, status: '进行中', revision: 1 })],
      {
        logs: [
          makeLog({
            invalidated_at: '2026-05-11T00:00:00Z',
            invalidated_by: 1,
          }),
        ],
      },
    )
    const createLog = vi
      .spyOn(planningApi, 'createProgressLog')
      .mockResolvedValue(
        makeLog({
          id: 12,
          actual_hours: 7,
          note: '更正',
          correction_of_log_id: 11,
        }),
      )
    expandItem(1)
    await waitFor(() =>
      expect(screen.getByRole('button', { name: '更正' })).toBeTruthy(),
    )
    fireEvent.click(screen.getByRole('button', { name: '更正' }))
    await waitFor(() => expect(screen.getByText(/基于已作废日志/)).toBeTruthy())
    fireEvent.change(screen.getByLabelText('本次时长（小时）'), {
      target: { value: '7' },
    })
    fireEvent.click(screen.getByRole('button', { name: '记录进展' }))
    await waitFor(() => expect(createLog).toHaveBeenCalledTimes(1))
    expect(createLog.mock.calls[0][1]).toMatchObject({
      correction_of_log_id: 11,
      actual_hours: 7,
    })
  })

  it('creates a new evidence version superseding 需补充 without overwriting it', async () => {
    const evidenceV1 = makeEvidence({
      status: '需补充',
      submitted_at: '2026-05-01T00:00:00Z',
      revision: 1,
    })
    await renderMember(
      [makeItem({})],
      [makeTask({ id: 1, plan_item_id: 1, status: '进行中', revision: 1 })],
      { evidences: [evidenceV1], reviews: [makeReview({})] },
    )
    const createEv = vi.spyOn(planningApi, 'createEvidence').mockResolvedValue(
      makeEvidence({
        id: 10,
        version_number: 2,
        status: '草稿',
        supersedes_evidence_id: 9,
      }),
    )
    expandItem(1)
    await waitFor(() =>
      expect(screen.getByRole('button', { name: '创建新版本' })).toBeTruthy(),
    )
    fireEvent.click(screen.getByRole('button', { name: '创建新版本' }))
    fireEvent.change(screen.getByLabelText('任务成果证明 内容'), {
      target: { value: '补充口径说明后的实现' },
    })
    fireEvent.click(screen.getByRole('button', { name: '保存草稿' }))
    await waitFor(() => expect(createEv).toHaveBeenCalledTimes(1))
    const [taskId, fields] = createEv.mock.calls[0]
    expect(taskId).toBe(1)
    expect(fields).toMatchObject({
      supersedes_evidence_id: 9,
      content: '补充口径说明后的实现',
    })
    // v1 stays readable with its review feedback.
    expect(screen.getByText(/请补充口径说明/)).toBeTruthy()
  })

  it('edits a draft with the CAS revision', async () => {
    const draft = makeEvidence({
      id: 10,
      version_number: 2,
      supersedes_evidence_id: 9,
    })
    await renderMember(
      [makeItem({})],
      [makeTask({ id: 1, plan_item_id: 1, status: '进行中', revision: 1 })],
      { evidences: [draft] },
    )
    const update = vi
      .spyOn(planningApi, 'updateEvidence')
      .mockResolvedValue({ ...draft, content: '修改后', revision: 1 })
    expandItem(1)
    await waitFor(() =>
      expect(screen.getByRole('button', { name: '编辑草稿' })).toBeTruthy(),
    )
    fireEvent.click(screen.getByRole('button', { name: '编辑草稿' }))
    await waitFor(() =>
      expect(screen.getByRole('button', { name: '保存草稿' })).toBeTruthy(),
    )
    const content = screen.getByLabelText(
      '任务成果证明 内容',
    ) as HTMLTextAreaElement
    fireEvent.change(content, { target: { value: '修改后' } })
    fireEvent.click(screen.getByRole('button', { name: '保存草稿' }))
    await waitFor(() => expect(update).toHaveBeenCalledTimes(1))
    expect(update.mock.calls[0][0]).toBe(10)
    expect(update.mock.calls[0][1]).toMatchObject({ content: '修改后' })
    expect(update.mock.calls[0][2]).toBe(0)
  })

  it('submits a draft evidence to review', async () => {
    const draft = makeEvidence({
      id: 10,
      status: '草稿',
      evidence_type: 'link',
      url: 'http://example.com/demo',
      evidence_link: 'http://example.com/demo',
    })
    await renderMember(
      [makeItem({})],
      [makeTask({ id: 1, plan_item_id: 1, status: '进行中', revision: 1 })],
      { evidences: [draft] },
    )
    const submit = vi.spyOn(planningApi, 'submitEvidence').mockResolvedValue({
      ...draft,
      status: '待 Review',
      submitted_at: '2026-05-11T00:00:00Z',
      revision: 1,
    })
    expandItem(1)
    await waitFor(() =>
      expect(screen.getByRole('button', { name: '提交评审' })).toBeTruthy(),
    )
    fireEvent.click(screen.getByRole('button', { name: '提交评审' }))
    await waitFor(() => expect(submit).toHaveBeenCalledWith(10))
  })

  it('keeps the draft form on a save 409, refreshes the evidence revision and retries only after confirm', async () => {
    const draft = makeEvidence({
      id: 10,
      version_number: 2,
      status: '草稿',
      supersedes_evidence_id: 9,
    })
    await renderMember(
      [makeItem({})],
      [makeTask({ id: 1, plan_item_id: 1, status: '进行中', revision: 1 })],
      { evidences: [draft] },
    )
    const conflict: unknown = Object.assign(
      new Error('evidence revision conflict'),
      {
        status: 409,
        detail: {
          code: 'evidence_revision_conflict',
          entity_type: 'evidence',
          entity_id: 10,
          field: 'revision',
          reason: 'evidence_revision_conflict',
          message: 'evidence revision conflict',
        },
      },
    )
    const update = vi
      .spyOn(planningApi, 'updateEvidence')
      .mockRejectedValueOnce(conflict)
      .mockResolvedValueOnce({ ...draft, content: '修改后', revision: 1 })
    // The refresh after the conflict observes the newer evidence revision.
    vi.mocked(planningApi.listEvidences).mockResolvedValueOnce([
      { ...draft, revision: 1 },
    ])
    expandItem(1)
    await waitFor(() =>
      expect(screen.getByRole('button', { name: '编辑草稿' })).toBeTruthy(),
    )
    fireEvent.click(screen.getByRole('button', { name: '编辑草稿' }))
    await waitFor(() =>
      expect(screen.getByRole('button', { name: '保存草稿' })).toBeTruthy(),
    )
    fireEvent.change(screen.getByLabelText('任务成果证明 内容'), {
      target: { value: '修改后' },
    })
    fireEvent.click(screen.getByRole('button', { name: '保存草稿' }))
    await waitFor(() => {
      expect(
        screen.getByRole('alert').textContent?.includes('请确认后重新保存'),
      ).toBeTruthy()
    })
    // The typed input survives, the form stays open, nothing was re-sent.
    expect(
      (screen.getByLabelText('任务成果证明 内容') as HTMLTextAreaElement).value,
    ).toBe('修改后')
    expect(screen.getByRole('button', { name: '保存草稿' })).toBeTruthy()
    expect(update).toHaveBeenCalledTimes(1)
    expect(update.mock.calls[0][2]).toBe(0)
    // Confirm retry uses ONLY the refreshed revision.
    fireEvent.click(screen.getByRole('button', { name: '保存草稿' }))
    await waitFor(() => expect(update).toHaveBeenCalledTimes(2))
    expect(update.mock.calls[1][2]).toBe(1)
    // The form closes only after the save actually succeeds.
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: '保存草稿' })).toBeNull(),
    )
  })

  it('keeps the new-version form on a create 409 and retries only after confirm', async () => {
    const evidenceV1 = makeEvidence({
      status: '需补充',
      submitted_at: '2026-05-01T00:00:00Z',
      revision: 1,
    })
    await renderMember(
      [makeItem({})],
      [makeTask({ id: 1, plan_item_id: 1, status: '进行中', revision: 1 })],
      { evidences: [evidenceV1], reviews: [makeReview({})] },
    )
    const conflict: unknown = Object.assign(new Error('draft already exists'), {
      status: 409,
      detail: {
        code: 'evidence_conflict',
        entity_type: 'evidence',
        entity_id: 9,
        field: 'status',
        reason: 'evidence_conflict',
        message: 'draft already exists',
      },
    })
    const createEv = vi
      .spyOn(planningApi, 'createEvidence')
      .mockRejectedValueOnce(conflict)
      .mockResolvedValueOnce(
        makeEvidence({
          id: 10,
          version_number: 2,
          status: '草稿',
          supersedes_evidence_id: 9,
        }),
      )
    expandItem(1)
    await waitFor(() =>
      expect(screen.getByRole('button', { name: '创建新版本' })).toBeTruthy(),
    )
    fireEvent.click(screen.getByRole('button', { name: '创建新版本' }))
    fireEvent.change(screen.getByLabelText('任务成果证明 内容'), {
      target: { value: '补充口径说明后的实现' },
    })
    fireEvent.click(screen.getByRole('button', { name: '保存草稿' }))
    await waitFor(() => {
      expect(
        screen.getByRole('alert').textContent?.includes('请确认后重新保存'),
      ).toBeTruthy()
    })
    // Input preserved, form open, nothing re-sent without confirm.
    expect(
      (screen.getByLabelText('任务成果证明 内容') as HTMLTextAreaElement).value,
    ).toBe('补充口径说明后的实现')
    expect(screen.getByRole('button', { name: '保存草稿' })).toBeTruthy()
    expect(createEv).toHaveBeenCalledTimes(1)
    // Confirm retry re-submits the same intent with the same supersede link.
    fireEvent.click(screen.getByRole('button', { name: '保存草稿' }))
    await waitFor(() => expect(createEv).toHaveBeenCalledTimes(2))
    expect(createEv.mock.calls[1][1]).toMatchObject({
      content: '补充口径说明后的实现',
      supersedes_evidence_id: 9,
    })
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: '保存草稿' })).toBeNull(),
    )
  })

  it.each([
    ['422', 'content is required'],
    ['403', 'not your evidence'],
  ] as [string, string][])(
    'a %s keeps the draft form and inputs without pretending success',
    async (status, message) => {
      const draft = makeEvidence({ id: 10, version_number: 2, status: '草稿' })
      await renderMember(
        [makeItem({})],
        [makeTask({ id: 1, plan_item_id: 1, status: '进行中', revision: 1 })],
        { evidences: [draft] },
      )
      const error: unknown = Object.assign(new Error(message), {
        status: Number(status),
        ...(status === '422'
          ? {
              detail: {
                code: 'validation_error',
                entity_type: 'evidence',
                entity_id: 10,
                field: 'content',
                reason: 'validation_error',
                message,
              },
            }
          : {}),
      })
      vi.spyOn(planningApi, 'updateEvidence').mockRejectedValue(error)
      expandItem(1)
      await waitFor(() =>
        expect(screen.getByRole('button', { name: '编辑草稿' })).toBeTruthy(),
      )
      fireEvent.click(screen.getByRole('button', { name: '编辑草稿' }))
      await waitFor(() =>
        expect(screen.getByRole('button', { name: '保存草稿' })).toBeTruthy(),
      )
      fireEvent.change(screen.getByLabelText('任务成果证明 内容'), {
        target: { value: '修改后' },
      })
      fireEvent.click(screen.getByRole('button', { name: '保存草稿' }))
      await waitFor(() => {
        expect(screen.getByRole('alert').textContent).toContain(message)
      })
      // The form and the typed input stay; no success is claimed.
      expect(
        (screen.getByLabelText('任务成果证明 内容') as HTMLTextAreaElement)
          .value,
      ).toBe('修改后')
      expect(screen.getByRole('button', { name: '保存草稿' })).toBeTruthy()
      expect(screen.queryByText(/草稿已保存/)).toBeNull()
    },
  )

  it.each([
    ['422', 'content is required'],
    ['403', 'cannot create evidence here'],
  ] as [string, string][])(
    'a %s keeps the new-version form and inputs without pretending success',
    async (status, message) => {
      const evidenceV1 = makeEvidence({
        status: '需补充',
        submitted_at: '2026-05-01T00:00:00Z',
        revision: 1,
      })
      await renderMember(
        [makeItem({})],
        [makeTask({ id: 1, plan_item_id: 1, status: '进行中', revision: 1 })],
        { evidences: [evidenceV1], reviews: [makeReview({})] },
      )
      const error: unknown = Object.assign(new Error(message), {
        status: Number(status),
        ...(status === '422'
          ? {
              detail: {
                code: 'validation_error',
                entity_type: 'evidence',
                entity_id: 9,
                field: 'content',
                reason: 'validation_error',
                message,
              },
            }
          : {}),
      })
      vi.spyOn(planningApi, 'createEvidence').mockRejectedValue(error)
      expandItem(1)
      await waitFor(() =>
        expect(screen.getByRole('button', { name: '创建新版本' })).toBeTruthy(),
      )
      fireEvent.click(screen.getByRole('button', { name: '创建新版本' }))
      fireEvent.change(screen.getByLabelText('任务成果证明 内容'), {
        target: { value: '补充口径说明后的实现' },
      })
      fireEvent.click(screen.getByRole('button', { name: '保存草稿' }))
      await waitFor(() => {
        expect(screen.getByRole('alert').textContent).toContain(message)
      })
      expect(
        (screen.getByLabelText('任务成果证明 内容') as HTMLTextAreaElement)
          .value,
      ).toBe('补充口径说明后的实现')
      expect(screen.getByRole('button', { name: '保存草稿' })).toBeTruthy()
      expect(screen.queryByText(/草稿已保存/)).toBeNull()
    },
  )

  it('filters plan items by status', async () => {
    await renderMember(
      [
        makeItem({ id: 1, status: '进行中' }),
        makeItem({ id: 2, l3_code: 'P02.01.01', status: '已完成' }),
      ],
      [],
    )
    fireEvent.change(screen.getByLabelText('状态筛选'), {
      target: { value: '已完成' },
    })
    await waitFor(() => {
      expect(screen.getAllByTestId('plan-header')).toHaveLength(1)
    })
    const headers = screen.getAllByTestId('plan-header')
    expect(headers[0].textContent).toContain('已完成')
  })
})

describe('plan item source summary (issue #63)', () => {
  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it('renders learning material, task content, expected output and source summary read-only', async () => {
    await renderMember(
      [
        makeItem({
          learning_material: '数据管道教材',
          learning_task_content: '完成管道设计',
          expected_output: '设计文档与评审记录',
          source_assessment_id: 1,
          plan_quarter: 'Q2',
          plan_month: 6,
          planning_source_type: 'assessment_approval',
          assessment_revision: 2,
          include_in_plan: true,
        }),
      ],
      [makeTask({ id: 1, plan_item_id: 1 })],
    )
    expandItem(1)
    await waitFor(() => expect(screen.getByText('学习材料')).toBeTruthy())
    expect(screen.getByText('数据管道教材')).toBeTruthy()
    expect(screen.getByText('任务内容')).toBeTruthy()
    expect(screen.getByText('完成管道设计')).toBeTruthy()
    expect(screen.getByText('预期输出')).toBeTruthy()
    expect(screen.getByText('设计文档与评审记录')).toBeTruthy()
    // #62 frozen source snapshot, read-only.
    expect(screen.getByText('来源评估')).toBeTruthy()
    expect(screen.getByText('评估 #1')).toBeTruthy()
    expect(screen.getByText('计划季度')).toBeTruthy()
    expect(screen.getByText('Q2')).toBeTruthy()
    // Scoped: the column header is also labeled 计划月份 (Issue #86).
    expect(
      within(screen.getByTestId('task-detail-panel')).getByText('计划月份'),
    ).toBeTruthy()
    // Scoped: the month timeline also renders a "6 月" button.
    expect(
      within(screen.getByTestId('task-detail-panel')).getByText('6 月'),
    ).toBeTruthy()
    expect(screen.getByText('来源类型')).toBeTruthy()
    expect(screen.getByText('评估认可生成')).toBeTruthy()
    expect(screen.getByText('评估版本')).toBeTruthy()
    expect(screen.getByText('2')).toBeTruthy()
    expect(screen.getByText('纳入计划')).toBeTruthy()
    expect(screen.getByText('是')).toBeTruthy()
    // None of the snapshot fields are editable.
    expect(screen.queryByLabelText('来源评估')).toBeNull()
    expect(screen.queryByLabelText('学习材料')).toBeNull()
  })
})

describe('plan item schedule editing (issue #63)', () => {
  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it('lets the member edit only the two schedule dates with a CAS payload', async () => {
    const item = makeItem({ revision: 2, plan_quarter: 'Q2', plan_month: 6 })
    await renderMember([item], [makeTask({ id: 1, plan_item_id: 1 })])
    const update = vi.spyOn(planningApi, 'updatePlanItem').mockResolvedValue({
      ...item,
      plan_start_date: '2026-04-15',
      revision: 3,
    })
    expandItem(1)
    await waitFor(() =>
      expect(screen.getByRole('button', { name: '保存日期' })).toBeTruthy(),
    )
    fireEvent.change(screen.getByLabelText('计划开始日期'), {
      target: { value: '2026-04-15' },
    })
    fireEvent.change(screen.getByLabelText('计划结束日期'), {
      target: { value: '2026-06-30' },
    })
    fireEvent.click(screen.getByRole('button', { name: '保存日期' }))
    await waitFor(() => expect(update).toHaveBeenCalledTimes(1))
    expect(update.mock.calls[0][0]).toBe(1)
    // The payload carries ONLY the two editable dates + the revision —
    // no target_month, status or #62 source snapshot fields.
    expect(update.mock.calls[0][1]).toEqual({
      plan_start_date: '2026-04-15',
      plan_end_date: '2026-06-30',
    })
    expect(update.mock.calls[0][2]).toBe(2)
    // Non-schedule fields stay read-only.
    expect(screen.queryByLabelText('优先级')).toBeNull()
    expect(screen.queryByLabelText('状态')).toBeNull()
  })

  it('rejects a start later than the end locally without calling the API', async () => {
    await renderMember(
      [makeItem({ revision: 1, plan_quarter: 'Q2', plan_month: 6 })],
      [makeTask({ id: 1, plan_item_id: 1 })],
    )
    const update = vi
      .spyOn(planningApi, 'updatePlanItem')
      .mockResolvedValue(makeItem({ revision: 2 }))
    expandItem(1)
    await waitFor(() =>
      expect(screen.getByRole('button', { name: '保存日期' })).toBeTruthy(),
    )
    fireEvent.change(screen.getByLabelText('计划开始日期'), {
      target: { value: '2026-06-30' },
    })
    fireEvent.change(screen.getByLabelText('计划结束日期'), {
      target: { value: '2026-06-01' },
    })
    fireEvent.click(screen.getByRole('button', { name: '保存日期' }))
    await waitFor(() => {
      expect(screen.getByRole('alert').textContent).toContain('不得晚于')
    })
    expect(update).not.toHaveBeenCalled()
  })

  it('rejects an end date outside the source plan month', async () => {
    await renderMember(
      [makeItem({ revision: 1, plan_quarter: 'Q2', plan_month: 6 })],
      [makeTask({ id: 1, plan_item_id: 1 })],
    )
    const update = vi
      .spyOn(planningApi, 'updatePlanItem')
      .mockResolvedValue(makeItem({ revision: 2 }))
    expandItem(1)
    await waitFor(() =>
      expect(screen.getByRole('button', { name: '保存日期' })).toBeTruthy(),
    )
    fireEvent.change(screen.getByLabelText('计划结束日期'), {
      target: { value: '2026-07-01' },
    })
    fireEvent.click(screen.getByRole('button', { name: '保存日期' }))
    await waitFor(() => {
      expect(screen.getByRole('alert').textContent).toContain('来源计划月')
    })
    expect(update).not.toHaveBeenCalled()
  })

  it('rejects a start date outside the source quarter', async () => {
    await renderMember(
      [
        makeItem({
          revision: 1,
          plan_start_date: '2026-04-01',
          plan_end_date: '2026-06-30',
          plan_quarter: 'Q2',
          plan_month: 6,
        }),
      ],
      [makeTask({ id: 1, plan_item_id: 1 })],
    )
    const update = vi
      .spyOn(planningApi, 'updatePlanItem')
      .mockResolvedValue(makeItem({ revision: 2 }))
    expandItem(1)
    await waitFor(() =>
      expect(screen.getByRole('button', { name: '保存日期' })).toBeTruthy(),
    )
    fireEvent.change(screen.getByLabelText('计划开始日期'), {
      target: { value: '2026-03-31' },
    })
    fireEvent.click(screen.getByRole('button', { name: '保存日期' }))
    await waitFor(() => {
      expect(screen.getByRole('alert').textContent).toContain('来源季度')
    })
    expect(update).not.toHaveBeenCalled()
  })

  it('rejects dates outside the source quarter when the source month is missing', async () => {
    await renderMember(
      [
        makeItem({
          revision: 1,
          plan_start_date: '2026-04-01',
          plan_end_date: '2026-06-30',
          plan_quarter: 'Q2',
          plan_month: null,
          target_month: null,
        }),
      ],
      [makeTask({ id: 1, plan_item_id: 1 })],
    )
    const update = vi
      .spyOn(planningApi, 'updatePlanItem')
      .mockResolvedValue(makeItem({ revision: 2 }))
    expandItem(1)
    await waitFor(() =>
      expect(screen.getByRole('button', { name: '保存日期' })).toBeTruthy(),
    )

    fireEvent.change(screen.getByLabelText('计划开始日期'), {
      target: { value: '2026-03-31' },
    })
    fireEvent.click(screen.getByRole('button', { name: '保存日期' }))
    await waitFor(() => {
      expect(screen.getByRole('alert').textContent).toContain('来源季度')
    })
    expect(update).not.toHaveBeenCalled()

    fireEvent.change(screen.getByLabelText('计划开始日期'), {
      target: { value: '2026-04-01' },
    })
    fireEvent.change(screen.getByLabelText('计划结束日期'), {
      target: { value: '2026-07-01' },
    })
    fireEvent.click(screen.getByRole('button', { name: '保存日期' }))
    await waitFor(() => {
      expect(screen.getByRole('alert').textContent).toContain('来源季度')
    })
    expect(update).not.toHaveBeenCalled()

    fireEvent.change(screen.getByLabelText('计划结束日期'), {
      target: { value: '2026-06-30' },
    })
    fireEvent.click(screen.getByRole('button', { name: '保存日期' }))
    await waitFor(() => expect(update).toHaveBeenCalledTimes(1))
  })

  it('keeps the edited dates on a 409, refreshes the plan and retries only after confirm', async () => {
    const item = makeItem({
      revision: 1,
      plan_start_date: '2026-04-01',
      plan_end_date: '2026-06-30',
      plan_quarter: 'Q2',
      plan_month: 6,
    })
    await renderMember([item], [makeTask({ id: 1, plan_item_id: 1 })])
    const conflict: unknown = Object.assign(
      new Error('plan item revision conflict'),
      {
        status: 409,
        detail: {
          code: 'plan_revision_conflict',
          entity_type: 'plan_item',
          entity_id: 1,
          field: 'revision',
          reason: 'plan_revision_conflict',
          message: 'plan item revision conflict',
        },
      },
    )
    const update = vi
      .spyOn(planningApi, 'updatePlanItem')
      .mockRejectedValueOnce(conflict)
      .mockResolvedValueOnce({
        ...item,
        plan_start_date: '2026-04-15',
        revision: 2,
      })
    // The plan refresh after the conflict observes the bumped revision.
    vi.mocked(planningApi.getAnnualPlan).mockResolvedValue(
      makePlan([{ ...item, revision: 2 }]),
    )
    expandItem(1)
    await waitFor(() =>
      expect(screen.getByRole('button', { name: '保存日期' })).toBeTruthy(),
    )
    fireEvent.change(screen.getByLabelText('计划开始日期'), {
      target: { value: '2026-04-15' },
    })
    fireEvent.click(screen.getByRole('button', { name: '保存日期' }))
    await waitFor(() => {
      expect(
        screen.getByRole('alert').textContent?.includes('请确认后重新保存'),
      ).toBeTruthy()
    })
    // The typed input survives and nothing was re-sent.
    expect(
      (screen.getByLabelText('计划开始日期') as HTMLInputElement).value,
    ).toBe('2026-04-15')
    expect(update).toHaveBeenCalledTimes(1)
    expect(update.mock.calls[0][2]).toBe(1)
    // Confirm retry uses ONLY the refreshed revision.
    fireEvent.click(screen.getByRole('button', { name: '保存日期' }))
    await waitFor(() => expect(update).toHaveBeenCalledTimes(2))
    expect(update.mock.calls[1][2]).toBe(2)
  })

  it.each([
    ['422', 'invalid plan item date'],
    ['403', 'not your plan item'],
  ] as [string, string][])(
    'a %s keeps the edited dates without pretending success',
    async (status, message) => {
      const item = makeItem({
        revision: 1,
        plan_start_date: '2026-04-01',
        plan_end_date: '2026-06-30',
        plan_quarter: 'Q2',
        plan_month: 6,
      })
      await renderMember([item], [makeTask({ id: 1, plan_item_id: 1 })])
      const error: unknown = Object.assign(new Error(message), {
        status: Number(status),
        ...(status === '422'
          ? {
              detail: {
                code: 'invalid_plan_item',
                entity_type: 'plan_item',
                entity_id: 1,
                field: 'plan_start_date',
                reason: 'invalid_plan_item',
                message,
              },
            }
          : {}),
      })
      vi.spyOn(planningApi, 'updatePlanItem').mockRejectedValue(error)
      expandItem(1)
      await waitFor(() =>
        expect(screen.getByRole('button', { name: '保存日期' })).toBeTruthy(),
      )
      fireEvent.change(screen.getByLabelText('计划开始日期'), {
        target: { value: '2026-04-15' },
      })
      fireEvent.click(screen.getByRole('button', { name: '保存日期' }))
      await waitFor(() => {
        expect(screen.getByRole('alert').textContent).toContain(message)
      })
      // The form and the typed input stay; no success is claimed.
      expect(
        (screen.getByLabelText('计划开始日期') as HTMLInputElement).value,
      ).toBe('2026-04-15')
      expect(screen.queryByText(/日期已保存/)).toBeNull()
    },
  )
})

describe('plan item filters (issue #63)', () => {
  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it('filters by priority and resets on 全部优先级', async () => {
    await renderMember([
      makeItem({ id: 1, priority: '高' }),
      makeItem({ id: 2, l3_code: 'P02.01.01', priority: '中' }),
    ])
    fireEvent.change(screen.getByLabelText('优先级筛选'), {
      target: { value: '高' },
    })
    await waitFor(() => {
      expect(screen.getAllByTestId('plan-header')).toHaveLength(1)
    })
    expect(screen.getAllByTestId('plan-header')[0].textContent).toContain(
      'P01.01.01',
    )
    fireEvent.change(screen.getByLabelText('优先级筛选'), {
      target: { value: '全部优先级' },
    })
    await waitFor(() => {
      expect(screen.getAllByTestId('plan-header')).toHaveLength(2)
    })
  })

  it('filters by capability domain and shows an empty state', async () => {
    await renderMember([
      makeItem({ id: 1, l1_code: 'P01' }),
      makeItem({ id: 2, l3_code: 'C01.01.01', l1_code: 'C01' }),
    ])
    fireEvent.change(screen.getByLabelText('能力域筛选'), {
      target: { value: 'C01' },
    })
    await waitFor(() => {
      expect(screen.getAllByTestId('plan-header')).toHaveLength(1)
    })
    expect(screen.getAllByTestId('plan-header')[0].textContent).toContain(
      'C01.01.01',
    )
    // A domain with no items shows an empty result.
    fireEvent.change(screen.getByLabelText('能力域筛选'), {
      target: { value: 'C02' },
    })
    await waitFor(() => {
      expect(screen.queryByTestId('plan-header')).toBeNull()
    })
    expect(screen.getByText(/暂无计划项/)).toBeTruthy()
  })

  it('combines month, status, priority and domain filters', async () => {
    await renderMember([
      makeItem({
        id: 1,
        target_month: 3,
        status: '进行中',
        priority: '高',
        l1_code: 'P01',
      }),
      makeItem({
        id: 2,
        l3_code: 'P02.01.01',
        target_month: 3,
        status: '进行中',
        priority: '中',
        l1_code: 'P01',
      }),
      makeItem({
        id: 3,
        l3_code: 'P03.01.01',
        target_month: 4,
        status: '进行中',
        priority: '高',
        l1_code: 'P01',
      }),
      makeItem({
        id: 4,
        l3_code: 'P04.01.01',
        target_month: 3,
        status: '已完成',
        priority: '高',
        l1_code: 'P01',
      }),
    ])
    const monthBtns = screen.getAllByRole('button', { name: /3 月/ })
    fireEvent.click(
      monthBtns.find((b) => b.textContent?.startsWith('3 月')) || monthBtns[0],
    )
    fireEvent.change(screen.getByLabelText('状态筛选'), {
      target: { value: '进行中' },
    })
    fireEvent.change(screen.getByLabelText('优先级筛选'), {
      target: { value: '高' },
    })
    fireEvent.change(screen.getByLabelText('能力域筛选'), {
      target: { value: 'P01' },
    })
    await waitFor(() => {
      expect(screen.getAllByTestId('plan-header')).toHaveLength(1)
    })
    expect(screen.getAllByTestId('plan-header')[0].textContent).toContain(
      'P01.01.01',
    )
  })
})

describe('start execution from 未开始 (issue #84 flow2)', () => {
  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it('persists 未开始 → 进行中 and refreshes the panel to 进行中', async () => {
    // In-memory store mirroring the backend contract: the transition POST
    // mutates the row, the follow-up GET reads the mutated state back.
    const tasks = [
      makeTask({ id: 1, plan_item_id: 1, status: '未开始', revision: 1 }),
    ]
    const transition = vi
      .spyOn(planningApi, 'transitionLearningTask')
      .mockImplementation(async (taskId, payload) => {
        const task = tasks.find((t) => t.id === taskId)
        if (!task) throw new Error('not found')
        const updated = {
          ...task,
          status: payload.to_status,
          revision: task.revision + 1,
        }
        tasks[0] = updated
        return updated
      })
    await renderMember([makeItem({ status: '未开始' })], tasks)
    expandItem(1)
    await waitFor(() =>
      expect(screen.getByRole('button', { name: '开始执行' })).toBeTruthy(),
    )
    fireEvent.click(screen.getByRole('button', { name: '开始执行' }))
    fireEvent.click(screen.getByRole('button', { name: '确认开始执行' }))
    await waitFor(() => expect(transition).toHaveBeenCalledTimes(1))
    expect(transition.mock.calls[0][1]).toMatchObject({
      to_status: '进行中',
      expected_revision: 1,
    })
    expect(transition.mock.calls[0][1].idempotency_key).toBeTruthy()
    // The panel must reflect the persisted transition, not the stale 未开始.
    await waitFor(() => {
      expect(screen.getAllByText('进行中').length).toBeGreaterThan(0)
    })
    expect(screen.queryByRole('button', { name: '开始执行' })).toBeNull()
    expect(screen.getByRole('button', { name: '暂停' })).toBeTruthy()
  })
})

describe('evidence draft link persistence (issue #63)', () => {
  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it('sends the edited link when updating a draft', async () => {
    const draft = makeEvidence({
      id: 10,
      version_number: 2,
      status: '草稿',
      evidence_link: 'http://example.com/old',
    })
    await renderMember(
      [makeItem({})],
      [makeTask({ id: 1, plan_item_id: 1, status: '进行中', revision: 1 })],
      { evidences: [draft] },
    )
    const update = vi.spyOn(planningApi, 'updateEvidence').mockResolvedValue({
      ...draft,
      evidence_link: 'http://example.com/new',
      revision: 1,
    })
    expandItem(1)
    await waitFor(() =>
      expect(screen.getByRole('button', { name: '编辑草稿' })).toBeTruthy(),
    )
    fireEvent.click(screen.getByRole('button', { name: '编辑草稿' }))
    fireEvent.change(screen.getByLabelText('证据链接'), {
      target: { value: 'http://example.com/new' },
    })
    fireEvent.click(screen.getByRole('button', { name: '保存草稿' }))
    await waitFor(() => expect(update).toHaveBeenCalledTimes(1))
    expect(update.mock.calls[0][0]).toBe(10)
    expect(update.mock.calls[0][1]).toMatchObject({
      evidence_link: 'http://example.com/new',
    })
    expect(update.mock.calls[0][2]).toBe(0)
  })

  it('clears a previously saved link by sending evidence_link null', async () => {
    const draft = makeEvidence({
      id: 10,
      version_number: 2,
      status: '草稿',
      evidence_link: 'http://example.com/old',
    })
    await renderMember(
      [makeItem({})],
      [makeTask({ id: 1, plan_item_id: 1, status: '进行中', revision: 1 })],
      { evidences: [draft] },
    )
    const update = vi
      .spyOn(planningApi, 'updateEvidence')
      .mockResolvedValue({ ...draft, evidence_link: null, revision: 1 })
    expandItem(1)
    await waitFor(() =>
      expect(screen.getByRole('button', { name: '编辑草稿' })).toBeTruthy(),
    )
    fireEvent.click(screen.getByRole('button', { name: '编辑草稿' }))
    fireEvent.change(screen.getByLabelText('证据链接'), {
      target: { value: '' },
    })
    fireEvent.click(screen.getByRole('button', { name: '保存草稿' }))
    await waitFor(() => expect(update).toHaveBeenCalledTimes(1))
    expect(update.mock.calls[0][1]).toMatchObject({
      content: '实现说明',
      description: null,
      evidence_link: null,
    })
  })
})

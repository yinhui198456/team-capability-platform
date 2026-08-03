/// @vitest-environment jsdom
import {
  cleanup,
  render,
  screen,
  waitFor,
  fireEvent,
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
      expect(alert.textContent).toContain('通过评审的 Evidence')
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
    fireEvent.change(screen.getByLabelText('Evidence 内容'), {
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
      'Evidence 内容',
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

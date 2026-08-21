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
    expect(screen.getByRole('heading', { name: '月度计划时间轴' })).toBeTruthy()
  })
  // 默认展开首个非空月由数据到达后的 effect 应用；等组内计划项真正渲染，
  // 避免后续同步断言落在默认展开应用前的那一帧。
  await waitFor(() => {
    expect(screen.getAllByTestId('plan-header').length).toBeGreaterThan(0)
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
    // 默认展开由数据到达后的 effect 应用，需等待首个非空月展开。
    await waitFor(() => {
      expect(
        screen.getByText((content) => content.includes('P01.01.01')),
      ).toBeTruthy()
    })
    // Issue #194 P1 复审修正：原型 M03 V1 月卡头（标题+项数+真实状态摘要+
    // aria-expanded）替代全局表头。
    const head = screen.getByRole('button', { name: /3 月任务/ })
    expect(head.getAttribute('aria-expanded')).toBe('true')
    expect(head.textContent).toContain('1 项')
    expect(head.textContent).toContain('进行中 1')
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
    // 复审修正后语义：默认展开第一个非空月（3 月）；点击其它月份只展开
    // 目标月。点击 4 月 → 只见 4 月组内项。
    const btns = screen.getAllByRole('button', { name: /4 月/ })
    fireEvent.click(
      btns.find((b) => b.textContent?.startsWith('4 月')) || btns[0],
    )
    await waitFor(() => {
      expect(screen.getByText('P02.01.01 · 任务B')).toBeTruthy()
    })
    expect(screen.queryByText('P01.01.01 · 任务A')).toBeNull()
  })

  it('M03: plan_month is the canonical month — filters and shows YYYY-MM', async () => {
    await renderMember([
      makeItem({
        id: 1,
        l3_name: '任务A',
        plan_month: '2026-03',
        target_month: 3,
      }),
      makeItem({
        id: 2,
        l3_code: 'P02.01.01',
        l3_name: '任务B',
        plan_month: '2026-04',
        target_month: 3,
      }),
      makeItem({
        id: 3,
        l3_code: 'P03.01.01',
        l3_name: '任务C',
        target_month: 5,
      }),
    ])
    // Timeline count derives from plan_month (B is April's only item).
    const april = screen
      .getAllByRole('button', { name: /4 月/ })
      .find((b) => b.textContent?.startsWith('4 月'))
    expect(april?.textContent).toContain('1 项')
    // 复审修正后语义：默认展开按时间排序的第一个非空月（3 月）。
    // plan_month wins over target_month: B 的 target_month=3 但 plan_month
    // 属 4 月，故默认视角下 B 不可见（4 月组收起）。
    await waitFor(() => {
      expect(screen.getByText('P01.01.01 · 任务A')).toBeTruthy()
    })
    expect(screen.queryByText('P02.01.01 · 任务B')).toBeNull()
    // Row shows the YYYY-MM plan_month.
    const rows = screen.getAllByTestId('plan-header')
    expect(within(rows[0]).getByText('2026-03')).toBeTruthy()
    // 无 plan_month 的遗留项 C 按 target_month 归入 5 月组，卡头常驻；
    // 点击展开后，其行回退显示 '5 月'。
    fireEvent.click(screen.getByRole('button', { name: /5 月任务/ }))
    await waitFor(() => {
      const legacy = screen
        .getAllByTestId('plan-header')
        .find((r) => r.textContent?.includes('任务C'))
      expect(legacy && within(legacy).getByText('5 月')).toBeTruthy()
    })
  })

  it('M03 prototype: plan items form vertical month groups, not a filter strip plus flat list', async () => {
    await renderMember([
      makeItem({
        id: 1,
        l3_name: '任务A',
        plan_month: '2026-03',
        target_month: 3,
      }),
      makeItem({
        id: 2,
        l3_code: 'P02.01.01',
        l3_name: '任务B',
        plan_month: '2026-04',
        target_month: 4,
      }),
    ])
    // 权威原型 M03 V1 的月度时间轴按月份纵向分组：月份 marker 与该月计划
    // 项同组。从计划项向外找最小包含子树——含该月 marker 且不含其它月份的
    // 计划项。横向 12 月筛选按钮 + 扁平列表无法满足：marker 在列表之外，
    // 任何同时覆盖 marker 与计划项的子树必然同时包含两个月份的计划项。
    // 复审修正后同一时刻仅一个月卡展开，故按月依次验证。
    const findMonthGroup = (
      item: HTMLElement,
      other: HTMLElement | null,
      marker: RegExp,
    ): HTMLElement | null => {
      let node: HTMLElement | null = item
      while (node) {
        if (
          (!other || !node.contains(other)) &&
          marker.test(node.textContent ?? '')
        ) {
          return node
        }
        node = node.parentElement
      }
      return null
    }
    // 默认展开的 3 月组：marker 与计划项 A 同组。
    const itemA = screen.getByText('P01.01.01 · 任务A')
    const marchGroup = findMonthGroup(itemA, null, /3\s*月/)
    expect(marchGroup).not.toBeNull()
    expect(within(marchGroup!).getByText('P01.01.01 · 任务A')).toBeTruthy()
    // 切换到 4 月：3 月组收起（A 不在 DOM），marker 与计划项 B 同组。
    fireEvent.click(screen.getByRole('button', { name: /4 月任务/ }))
    await waitFor(() => {
      expect(screen.getByText('P02.01.01 · 任务B')).toBeTruthy()
    })
    expect(screen.queryByText('P01.01.01 · 任务A')).toBeNull()
    const itemB = screen.getByText('P02.01.01 · 任务B')
    const aprilGroup = findMonthGroup(itemB, itemA, /4\s*月/)
    expect(aprilGroup).not.toBeNull()
    expect(within(aprilGroup!).getByText('P02.01.01 · 任务B')).toBeTruthy()
  })

  // Issue #194 P1 复审修正：最小组件回归——默认仅展开按时间排序的第一个
  // 非空月；点击其它月只展开目标月；点击当前月收起全部；卡头与节点常驻。
  // null=全展开的旧状态解释与旧的预过滤简化实现在此均失败。
  it('M03 regression: month card heads persist; only the selected month expands', async () => {
    await renderMember([
      makeItem({
        id: 1,
        l3_name: '任务A',
        plan_month: '2026-03',
        target_month: 3,
      }),
      makeItem({
        id: 2,
        l3_code: 'P02.01.01',
        l3_name: '任务B',
        plan_month: '2026-04',
        target_month: 4,
      }),
    ])
    // 锚定「N 月任务」卡头，避免误匹配头部「继续本月任务」动作按钮。
    const heads = () => screen.getAllByRole('button', { name: /^\d+ 月任务/ })
    const marchHead = () => screen.getByRole('button', { name: /3 月任务/ })
    const aprilHead = () => screen.getByRole('button', { name: /4 月任务/ })
    const assertChrome = () => {
      // 所有卡头与时间轴节点 i（aria-hidden）始终存在。
      expect(heads()).toHaveLength(2)
      for (const head of heads()) {
        expect(head.textContent).toContain('（1 项）')
      }
      expect(document.querySelectorAll('i[aria-hidden="true"]')).toHaveLength(2)
    }
    // 初始：第一月（3 月）展开、第二月（4 月）收起，只见第一月组内项。
    assertChrome()
    await waitFor(() => {
      expect(marchHead().getAttribute('aria-expanded')).toBe('true')
    })
    expect(aprilHead().getAttribute('aria-expanded')).toBe('false')
    expect(screen.getByText('P01.01.01 · 任务A')).toBeTruthy()
    expect(screen.queryByText('P02.01.01 · 任务B')).toBeNull()
    // 切换到 4 月：反向。
    fireEvent.click(aprilHead())
    await waitFor(() => {
      expect(screen.getByText('P02.01.01 · 任务B')).toBeTruthy()
    })
    assertChrome()
    expect(marchHead().getAttribute('aria-expanded')).toBe('false')
    expect(aprilHead().getAttribute('aria-expanded')).toBe('true')
    expect(screen.queryByText('P01.01.01 · 任务A')).toBeNull()
    // 再点 4 月：全部收起——两者均 false，两组计划项均不可见。
    fireEvent.click(aprilHead())
    await waitFor(() => {
      expect(aprilHead().getAttribute('aria-expanded')).toBe('false')
    })
    assertChrome()
    expect(marchHead().getAttribute('aria-expanded')).toBe('false')
    expect(screen.queryByText('P01.01.01 · 任务A')).toBeNull()
    expect(screen.queryByText('P02.01.01 · 任务B')).toBeNull()
  })

  // Issue #194: 定版原型 M03 V1 摘要改为任务总数/已完成/进行中/逾期，任务行
  // 只含编码/名称·说明·状态(+进度)·计划月份·进入任务——预计时长列与预计时长
  // 汇总卡随旧布局移除。预计时长解析/格式化合同由 estimatedHours.test.ts 与
  // 仪表盘展示承接，此处不再重复断言旧展示位。
  it('falls back to l3_code when l3_name is missing', async () => {
    await renderMember([makeItem({ l3_name: undefined })])
    expect(screen.getByText('P01.01.01')).toBeTruthy()
  })
})

describe('learning task execution (v0010)', () => {
  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it('M03: hydrates only tasks of the current plan items, never other years', async () => {
    // listLearningTasks returns tasks across ALL years. Only the task that
    // belongs to this plan's item 1 may be hydrated; the unrelated task
    // (other year / no current plan item) must never be loaded.
    const unrelated = makeTask({
      id: 99,
      plan_item_id: 99,
      l3_code: 'P99.01.01',
    })
    await renderMember(
      [makeItem({ id: 1 })],
      [
        makeTask({ id: 1, plan_item_id: 1, status: '进行中', revision: 1 }),
        unrelated,
      ],
    )
    // Page completes loading and item 1's detail is hydrated.
    const headers = screen.getAllByTestId('plan-header')
    fireEvent.click(headers[0])
    await waitFor(() =>
      expect(screen.getByRole('button', { name: '暂停' })).toBeTruthy(),
    )
    // The unrelated task id is never hydrated — neither the task itself nor
    // its detail chain (logs/evidences/reviews/history).
    expect(
      vi.mocked(planningApi.getLearningTask).mock.calls.map(([id]) => id),
    ).not.toContain(99)
    expect(
      vi.mocked(planningApi.listProgressLogs).mock.calls.map(([id]) => id),
    ).not.toContain(99)
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

  it('M03 prototype inventory: title, four metrics, continue entry, task rows, no filter layer', async () => {
    await renderMember(
      [
        makeItem({
          id: 1,
          status: '进行中',
          plan_month: '2026-03',
          target_month: 3,
          learning_task_content: '完成管道设计',
          expected_output: '设计文档',
          estimated_hours: '24',
          estimated_hours_parsed: {
            raw: '24',
            min_hours: 24,
            max_hours: 24,
            is_valid: true,
            is_range: false,
          },
        }),
        makeItem({
          id: 2,
          l3_code: 'P02.01.01',
          l3_name: '任务B',
          status: '延期',
          plan_month: '2026-04',
          target_month: 4,
          learning_task_content: null,
          expected_output: null,
        }),
      ],
      [
        makeTask({
          id: 1,
          plan_item_id: 1,
          status: '进行中',
          actual_hours: 12,
        }),
      ],
    )
    // 定版原型标题/说明
    expect(screen.getByRole('heading', { name: '月度计划时间轴' })).toBeTruthy()
    expect(screen.getByText('按月推进学习任务，持续提升能力。')).toBeTruthy()
    const header = screen
      .getByRole('heading', { name: '月度计划时间轴' })
      .closest('header')
    expect(header).toBeTruthy()
    expect(within(header!).getByText('我的计划')).toBeTruthy()
    // 摘要改为任务总数/已完成/进行中/逾期（真实计数）
    const summary = screen.getByTestId('plan-summary')
    expect(summary.textContent).toContain('任务总数')
    expect(summary.textContent).toContain('已完成')
    expect(summary.textContent).toContain('进行中')
    expect(summary.textContent).toContain('逾期')
    expect(summary.textContent).not.toContain('总体进度')
    expect(summary.textContent).not.toContain('预计时长')
    expect(within(summary).getAllByTestId('plan-summary-icon')).toHaveLength(4)
    const iconWraps = within(summary).getAllByTestId('plan-summary-icon-wrap')
    expect(iconWraps).toHaveLength(4)
    expect(
      iconWraps.map((wrapper) => wrapper.getAttribute('data-tone')),
    ).toEqual(['blue', 'green', 'blue', 'red'])
    // 「继续本月任务」入口存在
    const continueButton = screen.getByRole('button', { name: /继续本月任务/ })
    expect(continueButton).toBeTruthy()
    expect(
      within(continueButton).getByTestId('plan-continue-icon'),
    ).toBeTruthy()
    // 原型没有的三筛选区移除
    expect(screen.queryByLabelText('状态筛选')).toBeNull()
    expect(screen.queryByLabelText('优先级筛选')).toBeNull()
    expect(screen.queryByLabelText('能力域筛选')).toBeNull()
    // 展开月卡的任务行：编码/名称、任务说明、状态、已有进度、计划月份、
    // 「进入任务」入口
    const march = screen
      .getAllByTestId('plan-item')
      .find((el) => el.textContent?.includes('P01.01.01'))
    expect(march).toBeTruthy()
    expect(within(march!).getByText('完成管道设计')).toBeTruthy()
    expect(within(march!).getByText('进行中')).toBeTruthy()
    expect(within(march!).getByText('50%')).toBeTruthy()
    expect(within(march!).getByText('2026-03')).toBeTruthy()
    expect(
      screen.getByRole('button', { name: '2026 年 3 月，1 项' }),
    ).toBeTruthy()
    const expandedMonth = screen.getByRole('button', { name: /3 月任务/ })
    const collapsedMonth = screen.getByRole('button', { name: /4 月任务/ })
    expect(
      within(expandedMonth!)
        .getByTestId('month-card-toggle-icon')
        .getAttribute('data-direction'),
    ).toBe('up')
    expect(
      within(collapsedMonth!)
        .getByTestId('month-card-toggle-icon')
        .getAttribute('data-direction'),
    ).toBe('down')
    // Issue #194 R5：行内唯一可访问「进入任务」入口（外层行不再以同名
    // button 暴露——外层 role 断言见专项回归）。
    expect(
      within(march!).getAllByRole('button', { name: '进入任务' }),
    ).toHaveLength(1)
    // 说明缺失时不编造：4 月任务行无任务说明/预期输出占位
    fireEvent.click(screen.getByRole('button', { name: /4 月任务/ }))
    await waitFor(() => {
      const april = screen
        .getAllByTestId('plan-item')
        .find((el) => el.textContent?.includes('P02.01.01'))
      expect(april).toBeTruthy()
      expect(within(april!).queryByTestId('task-output')).toBeNull()
      expect(within(april!).getByText('延期')).toBeTruthy()
      expect(
        within(april!).getAllByRole('button', { name: '进入任务' }),
      ).toHaveLength(1)
    })
  })

  // Issue #194 R5：行身份按定版原型只显示 L3 code + L3 name，不把完整
  // L2→L3 路径塞进首列（1024 下首列放不下长路径，详情面板保留完整上下文）。
  it('M03 row identity shows only L3 code + name, not the full L2→L3 path', async () => {
    await renderMember([makeItem({ l2_code: 'P01.01', l2_name: '数据平台' })])
    const row = screen.getByTestId('plan-header')
    expect(within(row).getByText('P01.01.01 · 数据管道基础')).toBeTruthy()
    expect(row.textContent).not.toContain('数据平台')
    expect(row.textContent).not.toContain('→')
  })

  // Issue #194 R5：planHeader 曾以 role=button 暴露且包含内层「进入任务」
  // button，getByRole(button, {name:'进入任务'}) 命中两个元素、语义不唯一。
  // 外层行不再以 button 暴露；唯一可访问入口是真正的「进入任务」按钮，
  // 展开功能由它承担（aria-expanded 随行展开/收起翻转）。
  it('M03 row shell is not a button; the single accessible entry is 进入任务', async () => {
    await renderMember([makeItem({})])
    const row = screen.getByTestId('plan-header')
    expect(row.getAttribute('role')).not.toBe('button')
    const entries = within(row).getAllByRole('button', { name: '进入任务' })
    expect(entries).toHaveLength(1)
    expect(entries[0].getAttribute('aria-expanded')).toBe('false')
    fireEvent.click(entries[0])
    await waitFor(() => {
      expect(entries[0].getAttribute('aria-expanded')).toBe('true')
    })
  })

  it('继续本月任务 expands the current month card', async () => {
    const nowMonth = new Date().getMonth() + 1
    const otherMonth = nowMonth === 3 ? 4 : 3
    await renderMember([
      makeItem({ id: 1, l3_name: '任务A', target_month: otherMonth }),
      makeItem({
        id: 2,
        l3_code: 'P02.01.01',
        l3_name: '任务B',
        target_month: nowMonth,
      }),
    ])
    fireEvent.click(screen.getByRole('button', { name: /继续本月任务/ }))
    await waitFor(() => {
      expect(
        screen
          .getByRole('button', { name: new RegExp(`${nowMonth} 月任务`) })
          .getAttribute('aria-expanded'),
      ).toBe('true')
    })
    expect(
      screen
        .getByRole('button', { name: new RegExp(`${otherMonth} 月任务`) })
        .getAttribute('aria-expanded'),
    ).toBe('false')
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
          plan_month: '2026-06',
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
    // Issue #194: 任务行 simple-row 也回显任务说明（完成管道设计），故面板内
    // 断言需限定在 task-detail-panel 作用域内避免多元素命中。
    const panel = screen.getByTestId('task-detail-panel')
    expect(within(panel).getByText('完成管道设计')).toBeTruthy()
    expect(screen.getByText('预期输出')).toBeTruthy()
    expect(screen.getByText('设计文档与评审记录')).toBeTruthy()
    // #62 frozen source snapshot, read-only.
    expect(screen.getByText('来源评估')).toBeTruthy()
    expect(screen.getByText('评估 #1')).toBeTruthy()
    expect(screen.getByText('计划季度')).toBeTruthy()
    expect(screen.getByText('Q2')).toBeTruthy()
    expect(screen.getByText('计划月份')).toBeTruthy()
    // Issue #194: plan_month is 'YYYY-MM' — displayed as-is, not "N 月".
    expect(
      within(screen.getByTestId('task-detail-panel')).getByText('2026-06'),
    ).toBeTruthy()
    expect(screen.getByText('来源类型')).toBeTruthy()
    expect(screen.getByText('显式选择生成')).toBeTruthy()
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
    const item = makeItem({
      revision: 2,
      plan_quarter: 'Q2',
      plan_month: '2026-06',
    })
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
      [makeItem({ revision: 1, plan_quarter: 'Q2', plan_month: '2026-06' })],
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
      [makeItem({ revision: 1, plan_quarter: 'Q2', plan_month: '2026-06' })],
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
          plan_month: '2026-06',
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
      plan_month: '2026-06',
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
        plan_month: '2026-06',
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

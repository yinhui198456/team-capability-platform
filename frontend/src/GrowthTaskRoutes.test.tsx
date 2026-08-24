// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MemoryRouter, Route, Routes, useNavigate } from 'react-router-dom'
import { App } from './App'
import * as access from './access'
import * as planning from './planning'
import { AnnualPlanTimelinePage } from './AnnualPlanTimelinePage'
import { TaskDetailPage } from './TaskDetailPage'
import { TaskListPage } from './TaskListPage'
import { YearContext } from './YearContext'

const tasks = [
  {
    id: 7,
    plan_item_id: 1,
    l3_code: 'P01.01.01',
    l3_name: '文件规范',
    status: '进行中' as const,
    actual_start_date: null,
    actual_end_date: null,
    actual_hours: 2,
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
    plan_item_current_level: 1,
    plan_item_target_level: 2,
    plan_item_priority: '中' as const,
    plan_item_learning_material: null,
    plan_item_learning_task_content: null,
    plan_item_expected_output: '旧要求',
    plan_item_estimated_hours: '8-10h',
    plan_item_estimated_hours_parsed: {
      raw: '8-10h',
      min_hours: 8,
      max_hours: 10,
      is_valid: true,
      is_range: true,
    },
    plan_item_target_month: null,
    plan_item_plan_month: '2026-09',
  },
  {
    id: 8,
    plan_item_id: 2,
    l3_code: 'P02.01.01',
    l3_name: '沟通准备',
    status: '未开始' as const,
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
    plan_item_current_level: 1,
    plan_item_target_level: 2,
    plan_item_priority: '中' as const,
    plan_item_learning_material: null,
    plan_item_learning_task_content: null,
    plan_item_expected_output: '沟通材料',
    plan_item_estimated_hours: '8',
    plan_item_target_month: 10,
    plan_item_plan_month: '2026-10',
  },
]

function stub() {
  vi.spyOn(access, 'me').mockResolvedValue({
    id: 1,
    username: 'member',
    full_name: 'Member',
    roles: ['Member'],
  })
  vi.spyOn(planning, 'getAvailableYears').mockResolvedValue({
    available_years: [2026],
    active_year: 2026,
  })
  vi.spyOn(planning, 'getAnnualPlan').mockResolvedValue({
    id: 1,
    member_id: 1,
    year: 2026,
    plan_cycle: 12,
    status: '执行中',
    start_date: null,
    end_date: null,
    created_at: '',
    items: [],
  })
  vi.spyOn(planning, 'listLearningTasks').mockResolvedValue([
    {
      ...tasks[0],
      requirement_change: {
        proposal_detail_id: 8,
        new_snapshot_id: 2,
        current_snapshot_id: 1,
        current: {
          expected_output: '旧要求',
          output_type: '说明',
          notes: '旧验收要求',
        },
        proposed: {
          expected_output: '新要求',
          output_type: '清单',
          notes: '新验收要求',
        },
        decision: null,
      },
    },
    tasks[1],
  ])
  vi.spyOn(planning, 'getLearningTask').mockResolvedValue({
    ...tasks[0],
    effective_requirement: {
      snapshot_id: 1,
      expected_output: '旧要求',
      output_type: '说明',
      notes: '旧验收要求',
    },
    requirement_change: {
      proposal_detail_id: 8,
      new_snapshot_id: 2,
      current_snapshot_id: 1,
      current: {
        expected_output: '旧要求',
        output_type: '说明',
        notes: '旧验收要求',
      },
      proposed: {
        expected_output: '新要求',
        output_type: '清单',
        notes: '新验收要求',
      },
      decision: null,
    },
  })
  vi.spyOn(planning, 'listProgressLogs').mockResolvedValue([])
  vi.spyOn(planning, 'listEvidences').mockResolvedValue([])
  vi.spyOn(planning, 'createProgressLog').mockResolvedValue({} as never)
  vi.spyOn(planning, 'createEvidence').mockResolvedValue({
    id: 11,
    learning_task_id: 7,
    l3_code: 'P01.01.01',
    version_number: 1,
    content: '成果',
    evidence_link: null,
    status: '草稿',
    submitted_at: null,
    created_at: '',
    submitted_by: null,
    description: null,
    evidence_type: null,
    url: null,
    file_reference: null,
    file_name: null,
    mime_type: null,
    file_size: null,
    supersedes_evidence_id: null,
    revision: 0,
  })
  vi.spyOn(planning, 'submitEvidence').mockResolvedValue({} as never)
  vi.spyOn(planning, 'decideTaskRequirement').mockResolvedValue({
    proposal_detail_id: 8,
    decision: { choice: 'adopt_new', revision: 0, selected_snapshot_id: 2 },
  } as never)
}

describe('S2 approved M03–M05 routes', () => {
  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })
  it('groups M03 by month with real task progress and reaches M04 context', async () => {
    stub()
    render(
      <MemoryRouter initialEntries={['/growth/annual-plan?year=2026&month=9']}>
        <App />
      </MemoryRouter>,
    )
    await screen.findByRole('button', { name: /2026年09月/ })
    expect(screen.getByText('要求已更新 · 待确认')).toBeTruthy()
    expect(
      screen.queryByRole('progressbar', { name: 'P01.01.01 进度' }),
    ).toBeNull()
    expect(document.body.textContent).toContain('进度待计算')
    expect(
      screen
        .getAllByRole('link', { name: '查看本月任务' })[0]
        .getAttribute('href'),
    ).toContain('month=9')
  })
  it.each([
    ['M03', AnnualPlanTimelinePage, '年度计划加载中…', true],
    ['M04', TaskListPage, '学习任务加载中…', false],
  ])(
    'clears stale tasks while %s changes year',
    async (_, Page, loading, timeline) => {
      const pending = new Map<
        number,
        { resolve: (value: typeof tasks) => void }
      >()
      vi.spyOn(planning, 'listLearningTasks').mockImplementation(
        (year) =>
          new Promise((resolve) =>
            pending.set(year ?? 0, { resolve }),
          ) as ReturnType<typeof planning.listLearningTasks>,
      )
      const view = render(
        <MemoryRouter>
          <YearContext.Provider value={2026}>
            <Page />
          </YearContext.Provider>
        </MemoryRouter>,
      )
      await screen.findByText(loading)
      view.rerender(
        <MemoryRouter>
          <YearContext.Provider value={2025}>
            <Page />
          </YearContext.Provider>
        </MemoryRouter>,
      )
      expect(await screen.findByText(loading)).toBeTruthy()
      expect(screen.queryByText('文件规范')).toBeNull()
      await waitFor(() => expect(pending.has(2025)).toBe(true))
      pending.get(2025)!.resolve([{ ...tasks[1], l3_name: '新年任务' }])
      if (timeline) {
        expect(
          await screen.findByRole('button', { name: /2025年10月/ }),
        ).toBeTruthy()
      } else {
        expect(await screen.findByText('新年任务')).toBeTruthy()
      }
      pending.get(2026)!.resolve(tasks)
      await waitFor(() => {
        expect(screen.queryByText('文件规范')).toBeNull()
        if (timeline)
          expect(
            screen.queryByRole('button', { name: /2026年09月/ }),
          ).toBeNull()
        else expect(screen.getByText('新年任务')).toBeTruthy()
      })
    },
  )
  it('keeps M03 loading, error and empty states distinct', async () => {
    stub()
    vi.mocked(planning.listLearningTasks).mockImplementationOnce(
      () => new Promise(() => {}),
    )
    const view = render(
      <MemoryRouter initialEntries={['/growth/annual-plan?year=2026']}>
        <App />
      </MemoryRouter>,
    )
    expect(await screen.findByText('年度计划加载中…')).toBeTruthy()
    expect(screen.queryByText('本年度暂无学习任务。')).toBeNull()
    view.unmount()

    vi.mocked(planning.listLearningTasks).mockRejectedValueOnce(new Error())
    render(
      <MemoryRouter initialEntries={['/growth/annual-plan?year=2026']}>
        <App />
      </MemoryRouter>,
    )
    expect((await screen.findByRole('alert')).textContent).toContain(
      '年度计划加载失败',
    )
  })
  it.each([
    ['M03', AnnualPlanTimelinePage, '年度计划加载中…', true],
    ['M04', TaskListPage, '学习任务加载中…', false],
  ])(
    'shows loading on the first %s year-change render',
    async (_, Page, loading, timeline) => {
      let resolve: (value: typeof tasks) => void
      vi.spyOn(planning, 'listLearningTasks').mockImplementation(
        () =>
          new Promise((next) => (resolve = next)) as ReturnType<
            typeof planning.listLearningTasks
          >,
      )
      const view = render(
        <MemoryRouter>
          <YearContext.Provider value={2026}>
            <Page />
          </YearContext.Provider>
        </MemoryRouter>,
      )
      await screen.findByText(loading)
      resolve!(tasks)
      if (timeline) await screen.findByRole('button', { name: /2026年09月/ })
      else await screen.findByText('文件规范')
      view.rerender(
        <MemoryRouter>
          <YearContext.Provider value={2025}>
            <Page />
          </YearContext.Provider>
        </MemoryRouter>,
      )
      expect(screen.getByText(loading)).toBeTruthy()
      expect(screen.queryByText('本年度暂无学习任务。')).toBeNull()
      expect(screen.queryByText('当前条件下暂无学习任务。')).toBeNull()
    },
  )
  it('keeps task identity and ignores a late prior task response', async () => {
    const pending = new Map<
      number,
      { resolve: (value: (typeof tasks)[number]) => void }
    >()
    vi.spyOn(planning, 'getLearningTask').mockImplementation(
      (id) =>
        new Promise((resolve) => pending.set(id, { resolve })) as ReturnType<
          typeof planning.getLearningTask
        >,
    )
    vi.spyOn(planning, 'listProgressLogs').mockResolvedValue([])
    vi.spyOn(planning, 'listEvidences').mockResolvedValue([])
    function DetailRoute() {
      const navigate = useNavigate()
      return (
        <>
          <button
            onClick={() =>
              navigate('/growth/tasks/8?year=2099&search=沟通&status=未开始')
            }
          >
            切换任务
          </button>
          <Routes>
            <Route path="/growth/tasks/:taskId" element={<TaskDetailPage />} />
          </Routes>
        </>
      )
    }
    render(
      <MemoryRouter initialEntries={['/growth/tasks/7']}>
        <DetailRoute />
      </MemoryRouter>,
    )
    await waitFor(() => expect(pending.has(7)).toBe(true))
    fireEvent.click(screen.getByRole('button', { name: '切换任务' }))
    expect(screen.getByText('正在加载任务…')).toBeTruthy()
    await waitFor(() => expect(pending.has(8)).toBe(true))
    pending.get(8)!.resolve({ ...tasks[1], plan_item_plan_month: '2025-10' })
    expect(await screen.findByText('沟通准备')).toBeTruthy()
    expect(screen.getByText(/计划月份：2025年10月/)).toBeTruthy()
    const returned = new URL(
      screen.getByRole('link', { name: '学习任务' }).getAttribute('href') ?? '',
      'http://tcp.test',
    ).searchParams
    expect(Object.fromEntries(returned)).toMatchObject({
      year: '2025',
      month: '10',
      l3_code: 'P02.01.01',
      plan_item_id: '2',
      task_id: '8',
      search: '沟通',
      status: '未开始',
    })
    pending.get(7)!.resolve(tasks[0])
    await waitFor(() => expect(screen.queryByText('文件规范')).toBeNull())
    expect(screen.getByText('沟通准备')).toBeTruthy()
  })
  it('rejects an invalid task id before calling task APIs', () => {
    const getTask = vi.spyOn(planning, 'getLearningTask')
    const getLogs = vi.spyOn(planning, 'listProgressLogs')
    const getEvidence = vi.spyOn(planning, 'listEvidences')
    render(
      <MemoryRouter initialEntries={['/growth/tasks/not-a-number']}>
        <Routes>
          <Route path="/growth/tasks/:taskId" element={<TaskDetailPage />} />
        </Routes>
      </MemoryRouter>,
    )
    expect(screen.getByRole('alert').textContent).toContain('任务标识无效')
    expect(getTask).not.toHaveBeenCalled()
    expect(getLogs).not.toHaveBeenCalled()
    expect(getEvidence).not.toHaveBeenCalled()
  })
  it('shows M04 empty state after loading', async () => {
    stub()
    vi.mocked(planning.listLearningTasks).mockResolvedValueOnce([])
    render(
      <MemoryRouter initialEntries={['/growth/tasks?year=2026']}>
        <App />
      </MemoryRouter>,
    )
    expect(await screen.findByText('当前条件下暂无学习任务。')).toBeTruthy()
    expect(document.querySelector('.annual-plan-summary')).toBeTruthy()
  })
  it('filters M04 by month, search and status while retaining task context', async () => {
    stub()
    render(
      <MemoryRouter
        initialEntries={[
          '/growth/tasks?year=2026&month=9&search=文件&status=进行中',
        ]}
      >
        <App />
      </MemoryRouter>,
    )
    await screen.findByText('文件规范')
    expect(screen.queryByText('沟通准备')).toBeNull()
    expect(screen.getByText('进行中 1')).toBeTruthy()
    const href =
      screen.getByRole('link', { name: '进入任务' }).getAttribute('href') ?? ''
    expect(href).toContain('month=9')
    expect(href).toContain('search=%E6%96%87%E4%BB%B6')
    expect(href).toContain('status=%E8%BF%9B%E8%A1%8C%E4%B8%AD')
  })
  it('uses M05 log/evidence actions and keeps inputs when confirmation blocks submit', async () => {
    stub()
    render(
      <MemoryRouter
        initialEntries={[
          '/growth/tasks/7?year=2026&month=9&search=文件&status=进行中',
        ]}
      >
        <App />
      </MemoryRouter>,
    )
    await screen.findByRole('button', { name: '学习记录' })
    expect(
      screen.queryByRole('progressbar', { name: '任务真实进度' }),
    ).toBeNull()
    expect(screen.getAllByText('进度待计算').length).toBeGreaterThan(0)
    fireEvent.change(screen.getByLabelText('本次学习内容'), {
      target: { value: '整理目录' },
    })
    fireEvent.change(screen.getByLabelText('投入时长'), {
      target: { value: '2' },
    })
    fireEvent.change(screen.getByLabelText('记录日期'), {
      target: { value: '2026-09-01' },
    })
    fireEvent.click(screen.getByRole('button', { name: '保存学习记录' }))
    await waitFor(() => expect(planning.createProgressLog).toHaveBeenCalled())
    fireEvent.click(screen.getByRole('button', { name: '阶段产出' }))
    fireEvent.change(screen.getByLabelText('阶段产出说明'), {
      target: { value: '检查清单' },
    })
    fireEvent.click(screen.getByRole('button', { name: '保存阶段产出' }))
    await waitFor(() => expect(planning.createEvidence).toHaveBeenCalled())
    fireEvent.click(screen.getAllByRole('button', { name: '提交成果' })[0])
    fireEvent.change(screen.getByLabelText('成果说明'), {
      target: { value: '已完成清单' },
    })
    fireEvent.click(screen.getAllByRole('button', { name: '提交成果' })[1])
    expect(
      (screen.getByLabelText('成果说明') as HTMLTextAreaElement).value,
    ).toBe('已完成清单')
    expect(screen.getByText(/请先确认任务要求版本/)).toBeTruthy()
  })
})

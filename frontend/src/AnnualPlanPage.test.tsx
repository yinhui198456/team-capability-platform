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
import * as accessApi from './access'
import * as planningApi from './planning'
import { MemoryRouter } from 'react-router-dom'

function mockMemberUser() {
  vi.spyOn(accessApi, 'me').mockResolvedValue({
    id: 1,
    username: 'member',
    full_name: 'Member',
    roles: ['Member'],
  })
}

function mockEligible() {
  vi.spyOn(planningApi, 'getAnnualPlanEligibility').mockResolvedValue({
    eligible: true,
    reason: null,
  })
}

function mockPlanWithOneItem(overrides: Partial<planningApi.PlanItem> = {}) {
  vi.spyOn(planningApi, 'getAnnualPlan').mockResolvedValue({
    id: 10,
    member_id: 1,
    year: 2026,
    plan_cycle: 12,
    status: '执行中',
    start_date: '2026-01-01',
    end_date: '2026-12-31',
    created_at: '2026-01-01T00:00:00Z',
    items: [
      {
        id: 1,
        annual_growth_plan_id: 10,
        growth_goal_id: 5,
        l3_code: 'P01-L2A-L3A',
        current_level: 2,
        target_level: 4,
        priority: '高',
        learning_material: '课程 A',
        learning_task_content: '完成数据管道练习',
        expected_output: '可复用脚本',
        estimated_hours: '10',
        plan_start_date: '2026-03-01',
        plan_end_date: '2026-03-31',
        target_month: 3,
        status: '进行中',
        ...overrides,
      },
    ],
  })
}

function mockTask(taskOverrides: Partial<planningApi.LearningTask> = {}) {
  vi.spyOn(planningApi, 'listLearningTasks').mockResolvedValue([
    {
      id: 100,
      plan_item_id: 1,
      l3_code: 'P01-L2A-L3A',
      status: '进行中',
      actual_start_date: '2026-03-01',
      actual_end_date: null,
      actual_hours: 4,
      completion_quality: null,
      review_conclusion: null,
      next_action: '补充日志',
      plan_item_current_level: 2,
      plan_item_target_level: 4,
      plan_item_priority: '高',
      plan_item_learning_material: '课程 A',
      plan_item_learning_task_content: '完成数据管道练习',
      plan_item_expected_output: '可复用脚本',
      plan_item_estimated_hours: '10',
      plan_item_target_month: 3,
      ...taskOverrides,
    },
  ])
}

describe('AnnualPlanPage – combined UI-03', () => {
  beforeEach(() => {
    vi.spyOn(planningApi, 'getAnnualPlan').mockResolvedValue(null)
    vi.spyOn(planningApi, 'getAnnualPlanEligibility').mockResolvedValue({
      eligible: true,
      reason: null,
    })
    vi.spyOn(planningApi, 'listPlanItems').mockResolvedValue([])
    vi.spyOn(planningApi, 'listLearningTasks').mockResolvedValue([])
    vi.spyOn(planningApi, 'listProgressLogs').mockResolvedValue([])
    vi.spyOn(planningApi, 'listEvidences').mockResolvedValue([])
    vi.spyOn(planningApi, 'listEvidenceReviewsForTask').mockResolvedValue([])
    vi.spyOn(planningApi, 'getMonthlyHours').mockResolvedValue([])
  })

  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it('renders the annual plan overview with progress and hours', async () => {
    mockMemberUser()
    mockEligible()
    mockPlanWithOneItem()
    mockTask()

    render(
      <MemoryRouter initialEntries={['/growth/annual-plan']}>
        <App />
      </MemoryRouter>
    )
    await waitFor(() => {
      expect(
        screen.getByRole('heading', { name: '年度成长计划', level: 1 }),
      ).toBeTruthy()
    })

    expect(screen.getByRole('region', { name: '年度计划总览' })).toBeTruthy()
    expect(screen.getByText(/2026 \/ 12 个月/)).toBeTruthy()
    expect(screen.getByText('预计时长')).toBeTruthy()
    expect(screen.getByText('实际时长')).toBeTruthy()
  })

  it('aggregates annual actual hours from learning progress logs', async () => {
    mockMemberUser()
    mockEligible()
    mockPlanWithOneItem()
    mockTask({ actual_hours: 99 })
    vi.spyOn(planningApi, 'getMonthlyHours').mockResolvedValue([
      { month: 3, total_hours: 6 },
      { month: 4, total_hours: 2 },
    ])

    render(
      <MemoryRouter initialEntries={['/growth/annual-plan']}>
        <App />
      </MemoryRouter>
    )
    await waitFor(() => {
      expect(screen.getByText('8 小时')).toBeTruthy()
    })
    expect(screen.queryByText('99 小时')).toBeNull()
  })

  it('shows monthly timeline with 12 months and plan distribution', async () => {
    mockMemberUser()
    mockEligible()
    mockPlanWithOneItem({ target_month: 3 })

    render(
      <MemoryRouter initialEntries={['/growth/annual-plan']}>
        <App />
      </MemoryRouter>
    )
    await waitFor(() => {
      expect(screen.getByRole('region', { name: '月度时间轴' })).toBeTruthy()
    })

    // All 12 month buttons should be present
    for (let month = 1; month <= 12; month++) {
      expect(
        screen.getByRole('button', { name: new RegExp(`^${month} 月`) }),
      ).toBeTruthy()
    }
  })

  it('filters plan items when a month is selected', async () => {
    mockMemberUser()
    mockEligible()
    mockPlanWithOneItem({ target_month: 3 })

    render(
      <MemoryRouter initialEntries={['/growth/annual-plan']}>
        <App />
      </MemoryRouter>
    )
    await waitFor(() => {
      expect(screen.getAllByText(/P01-L2A-L3A/).length).toBeGreaterThan(0)
    })

    // Select month 5 (which has no items)
    fireEvent.click(screen.getByRole('button', { name: /^5 月/ }))

    await waitFor(() => {
      expect(screen.getByText(/当前筛选：5 月/)).toBeTruthy()
      expect(screen.getByText(/当前筛选下暂无计划项/)).toBeTruthy()
    })
  })

  it('shows plan item list with status and priority', async () => {
    mockMemberUser()
    mockEligible()
    mockPlanWithOneItem({ status: '进行中' })

    render(
      <MemoryRouter initialEntries={['/growth/annual-plan']}>
        <App />
      </MemoryRouter>
    )
    await waitFor(() => {
      expect(screen.getAllByText(/P01-L2A-L3A/).length).toBeGreaterThan(0)
      expect(screen.getAllByText('进行中').length).toBeGreaterThan(0)
      expect(screen.getByText(/优先级：高/)).toBeTruthy()
    })
  })

  it('shows plan item detail workspace when a plan item is selected', async () => {
    mockMemberUser()
    mockEligible()
    mockPlanWithOneItem({
      learning_task_content: '完成数据管道练习',
      expected_output: '可复用脚本',
      learning_material: '课程 A',
    })
    mockTask()

    render(
      <MemoryRouter initialEntries={['/growth/annual-plan']}>
        <App />
      </MemoryRouter>
    )
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /P01-L2A-L3A/ })).toBeTruthy()
    })

    fireEvent.click(screen.getByRole('button', { name: /P01-L2A-L3A/ }))

    await waitFor(() => {
      expect(
        screen.getByRole('complementary', { name: '计划项详情与学习任务' }),
      ).toBeTruthy()
    })

    expect(screen.getByText('完成数据管道练习')).toBeTruthy()
  })

  it('shows learning task execution controls in the detail workspace', async () => {
    mockMemberUser()
    mockEligible()
    mockPlanWithOneItem()
    mockTask()

    render(
      <MemoryRouter initialEntries={['/growth/annual-plan']}>
        <App />
      </MemoryRouter>
    )
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /P01-L2A-L3A/ })).toBeTruthy()
    })

    fireEvent.click(screen.getByRole('button', { name: /P01-L2A-L3A/ }))

    await waitFor(() => {
      expect(screen.getByRole('region', { name: '学习任务' })).toBeTruthy()
      expect(screen.getByLabelText(/状态/)).toBeTruthy()
    })
  })

  it('limits the embedded task summary to the selected plan item', async () => {
    mockMemberUser()
    mockEligible()
    mockPlanWithOneItem()
    vi.spyOn(planningApi, 'listLearningTasks').mockResolvedValue([
      {
        id: 100,
        plan_item_id: 1,
        l3_code: 'P01-L2A-L3A',
        status: '进行中',
        actual_start_date: null,
        actual_end_date: null,
        actual_hours: 2,
        completion_quality: null,
        review_conclusion: null,
        next_action: null,
        plan_item_current_level: 2,
        plan_item_target_level: 4,
        plan_item_priority: '高',
        plan_item_learning_material: '课程 A',
        plan_item_learning_task_content: '完成数据管道练习',
        plan_item_expected_output: '可复用脚本',
        plan_item_estimated_hours: '10',
      },
      {
        id: 200,
        plan_item_id: 2,
        l3_code: 'P02-L2A-L3A',
        status: '进行中',
        actual_start_date: null,
        actual_end_date: null,
        actual_hours: 8,
        completion_quality: null,
        review_conclusion: null,
        next_action: null,
        plan_item_current_level: 2,
        plan_item_target_level: 4,
        plan_item_priority: '高',
        plan_item_learning_material: '课程 B',
        plan_item_learning_task_content: '其他任务',
        plan_item_expected_output: '其他输出',
        plan_item_estimated_hours: '10',
      },
    ])
    vi.spyOn(planningApi, 'listProgressLogs').mockImplementation((taskId) =>
      Promise.resolve(
        taskId === 100
          ? [
              {
                id: 1,
                task_id: 100,
                record_date: '2026-07-10',
                actual_hours: 2,
                note: null,
                recorder_id: 1,
              },
            ]
          : [
              {
                id: 2,
                task_id: 200,
                record_date: '2026-07-11',
                actual_hours: 8,
                note: null,
                recorder_id: 1,
              },
            ],
      ),
    )

    render(
      <MemoryRouter initialEntries={['/growth/annual-plan']}>
        <App />
      </MemoryRouter>
    )
    await waitFor(() => {
      expect(screen.getByRole('region', { name: '学习任务摘要' })).toBeTruthy()
    })

    expect(
      screen.getByRole('region', { name: '学习任务摘要' }).textContent,
    ).toContain('任务总数1')
    expect(
      screen.getByRole('region', { name: '学习任务摘要' }).textContent,
    ).toContain('累计日志时长2 小时')
  })

  it('shows progress logs in the detail workspace', async () => {
    mockMemberUser()
    mockEligible()
    mockPlanWithOneItem()
    mockTask()
    vi.spyOn(planningApi, 'listProgressLogs').mockResolvedValue([
      {
        id: 1,
        task_id: 100,
        record_date: '2026-07-10',
        actual_hours: 3,
        note: '阅读文档',
        recorder_id: 1,
      },
    ])

    render(
      <MemoryRouter initialEntries={['/growth/annual-plan']}>
        <App />
      </MemoryRouter>
    )
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /P01-L2A-L3A/ })).toBeTruthy()
    })

    fireEvent.click(screen.getByRole('button', { name: /P01-L2A-L3A/ }))

    await waitFor(() => {
      expect(screen.getByText('总时长：3 小时')).toBeTruthy()
      expect(screen.getByText('2026-07-10')).toBeTruthy()
    })
  })

  it('adds a progress log for a learning task', async () => {
    mockMemberUser()
    mockEligible()
    mockPlanWithOneItem()
    mockTask()
    const createProgressLog = vi
      .spyOn(planningApi, 'createProgressLog')
      .mockResolvedValue({
        id: 2,
        task_id: 100,
        record_date: '2026-07-18',
        actual_hours: 2,
        note: '练习',
        recorder_id: 1,
      })

    render(
      <MemoryRouter initialEntries={['/growth/annual-plan']}>
        <App />
      </MemoryRouter>
    )
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /P01-L2A-L3A/ })).toBeTruthy()
    })

    fireEvent.click(screen.getByRole('button', { name: /P01-L2A-L3A/ }))

    await waitFor(() => {
      expect(screen.getByText('添加日志')).toBeTruthy()
    })

    // Fill in the log form
    const dateInputs = screen.getAllByLabelText('日期')
    fireEvent.change(dateInputs[dateInputs.length - 1], {
      target: { value: '2026-07-18' },
    })
    const hoursInputs = screen.getAllByLabelText('时长（小时）')
    fireEvent.change(hoursInputs[hoursInputs.length - 1], {
      target: { value: '2' },
    })
    const noteInputs = screen.getAllByLabelText('备注')
    fireEvent.change(noteInputs[noteInputs.length - 1], {
      target: { value: '练习' },
    })
    fireEvent.click(screen.getByText('添加日志'))

    await waitFor(() => {
      expect(createProgressLog).toHaveBeenCalledWith(
        100,
        '2026-07-18',
        2,
        '练习',
      )
    })
  })

  it('shows evidence versions for a learning task', async () => {
    mockMemberUser()
    mockEligible()
    mockPlanWithOneItem()
    mockTask()
    vi.spyOn(planningApi, 'listEvidences').mockResolvedValue([
      {
        id: 10,
        learning_task_id: 100,
        l3_code: 'P01-L2A-L3A',
        version_number: 1,
        content: '完成实践项目',
        evidence_link: 'http://example.com',
        status: '已归档',
        submitted_at: '2026-07-16T10:00:00Z',
        created_at: '2026-07-16T09:00:00Z',
      },
    ])
    vi.spyOn(planningApi, 'listEvidenceReviewsForTask').mockResolvedValue([
      {
        id: 20,
        evidence_id: 10,
        version_number: 1,
        status: '通过',
        conclusion: '通过',
        feedback: '符合预期',
        reviewed_at: '2026-07-16T11:00:00Z',
      },
    ])

    render(
      <MemoryRouter initialEntries={['/growth/annual-plan']}>
        <App />
      </MemoryRouter>
    )
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /P01-L2A-L3A/ })).toBeTruthy()
    })

    fireEvent.click(screen.getByRole('button', { name: /P01-L2A-L3A/ }))

    await waitFor(() => {
      expect(screen.getByText('版本 1')).toBeTruthy()
      expect(screen.getByText(/Review 结论：通过/)).toBeTruthy()
    })
  })

  it('creates a new evidence draft', async () => {
    mockMemberUser()
    mockEligible()
    mockPlanWithOneItem()
    mockTask()
    let listEvidencesCallCount = 0
    vi.spyOn(planningApi, 'listEvidences').mockImplementation(() => {
      listEvidencesCallCount += 1
      return Promise.resolve(
        listEvidencesCallCount === 1
          ? []
          : [
              {
                id: 10,
                learning_task_id: 100,
                l3_code: 'P01-L2A-L3A',
                version_number: 1,
                content: '实践项目',
                evidence_link: 'http://example.com',
                status: '草稿',
                submitted_at: null,
                created_at: '2026-07-16T10:00:00Z',
              },
            ],
      )
    })
    const createEvidence = vi
      .spyOn(planningApi, 'createEvidence')
      .mockResolvedValue({
        id: 10,
        learning_task_id: 100,
        l3_code: 'P01-L2A-L3A',
        version_number: 1,
        content: '实践项目',
        evidence_link: 'http://example.com',
        status: '草稿',
        submitted_at: null,
        created_at: '2026-07-16T10:00:00Z',
      })

    render(
      <MemoryRouter initialEntries={['/growth/annual-plan']}>
        <App />
      </MemoryRouter>
    )
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /P01-L2A-L3A/ })).toBeTruthy()
    })

    fireEvent.click(screen.getByRole('button', { name: /P01-L2A-L3A/ }))

    await waitFor(() => {
      expect(screen.getByText('新增版本')).toBeTruthy()
    })

    fireEvent.click(screen.getByText('新增版本'))

    fireEvent.change(screen.getByLabelText('提交内容'), {
      target: { value: '实践项目' },
    })
    fireEvent.change(screen.getByLabelText('证据链接'), {
      target: { value: 'http://example.com' },
    })
    fireEvent.click(screen.getByText('保存'))

    await waitFor(() => {
      expect(createEvidence).toHaveBeenCalledWith(
        100,
        '实践项目',
        'http://example.com',
      )
    })
  })

  it('shows gate reason and disables generate when gate is blocked', async () => {
    mockMemberUser()
    vi.spyOn(planningApi, 'getAnnualPlanEligibility').mockResolvedValue({
      eligible: false,
      reason: '暂无已提交的能力评估',
    })

    render(
      <MemoryRouter initialEntries={['/growth/annual-plan']}>
        <App />
      </MemoryRouter>
    )
    await waitFor(() => {
      expect(screen.getByText(/年度计划生成受限/)).toBeTruthy()
    })

    expect(screen.queryByText('生成计划项')).toBeNull()
  })

  it('calls generatePlanItems and refreshes on generate', async () => {
    mockMemberUser()
    mockEligible()
    vi.spyOn(planningApi, 'getAnnualPlan').mockResolvedValue({
      id: 10,
      member_id: 1,
      year: 2026,
      plan_cycle: 12,
      status: '制定中',
      start_date: '2026-01-01',
      end_date: '2026-12-31',
      created_at: '2026-01-01T00:00:00Z',
      items: [],
    })
    const generatePlanItems = vi
      .spyOn(planningApi, 'generatePlanItems')
      .mockResolvedValue({
        created: 1,
        items: [
          {
            id: 1,
            annual_growth_plan_id: 10,
            growth_goal_id: 5,
            l3_code: 'P01-L2A-L3A',
            current_level: 2,
            target_level: 4,
            priority: '中',
            learning_material: null,
            learning_task_content: null,
            expected_output: null,
            estimated_hours: '10',
            plan_start_date: null,
            plan_end_date: null,
            target_month: null,
            status: '未开始',
          },
        ],
      })

    render(
      <MemoryRouter initialEntries={['/growth/annual-plan']}>
        <App />
      </MemoryRouter>
    )
    await waitFor(() => {
      expect(screen.getByText('生成计划项')).toBeTruthy()
    })

    fireEvent.click(screen.getByText('生成计划项'))

    await waitFor(() => {
      expect(generatePlanItems).toHaveBeenCalled()
    })
  })

  it('updates learning task status when plan-item-level status is changed', async () => {
    mockMemberUser()
    mockEligible()
    mockPlanWithOneItem()
    mockTask({ status: '进行中' })

    const updateLearningTask = vi
      .spyOn(planningApi, 'updateLearningTask')
      .mockResolvedValue({
        id: 100,
        plan_item_id: 1,
        l3_code: 'P01-L2A-L3A',
        status: '暂停',
        actual_start_date: '2026-03-01',
        actual_end_date: null,
        actual_hours: 4,
        completion_quality: null,
        review_conclusion: null,
        next_action: null,
        plan_item_current_level: 2,
        plan_item_target_level: 4,
        plan_item_priority: '高',
        plan_item_learning_material: '课程 A',
        plan_item_learning_task_content: '练习',
        plan_item_expected_output: '脚本',
        plan_item_estimated_hours: '10',
      })

    render(
      <MemoryRouter initialEntries={['/growth/annual-plan']}>
        <App />
      </MemoryRouter>
    )
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /P01-L2A-L3A/ })).toBeTruthy()
    })

    fireEvent.click(screen.getByRole('button', { name: /P01-L2A-L3A/ }))

    await waitFor(() => {
      expect(screen.getByLabelText('状态')).toBeTruthy()
    })

    fireEvent.change(screen.getByLabelText('状态'), {
      target: { value: '暂停' },
    })

    await waitFor(() => {
      expect(updateLearningTask).toHaveBeenCalledWith(100, { status: '暂停' })
    })
  })

  it('keeps Evidence Review and completion out of member task status controls', async () => {
    mockMemberUser()
    mockEligible()
    mockPlanWithOneItem()
    mockTask({ status: '进行中' })

    render(
      <MemoryRouter initialEntries={['/growth/annual-plan']}>
        <App />
      </MemoryRouter>
    )
    await waitFor(() => {
      expect(screen.getByLabelText('状态')).toBeTruthy()
    })
    const options = Array.from(
      screen.getByLabelText('状态').querySelectorAll('option'),
    ).map((option) => option.textContent)
    expect(options).not.toContain('待 Evidence Review')
    expect(options).not.toContain('已完成')
  })

  it('submits a draft Evidence version for Buddy Review', async () => {
    mockMemberUser()
    mockEligible()
    mockPlanWithOneItem()
    mockTask()
    vi.spyOn(planningApi, 'listEvidences').mockResolvedValue([
      {
        id: 10,
        learning_task_id: 100,
        l3_code: 'P01-L2A-L3A',
        version_number: 1,
        content: '实践输出',
        evidence_link: null,
        status: '草稿',
        submitted_at: null,
        created_at: '2026-07-16T10:00:00Z',
      },
    ])
    const submitEvidence = vi
      .spyOn(planningApi, 'submitEvidence')
      .mockResolvedValue({
        id: 10,
        learning_task_id: 100,
        l3_code: 'P01-L2A-L3A',
        version_number: 1,
        content: '实践输出',
        evidence_link: null,
        status: '待 Review',
        submitted_at: '2026-07-18T10:00:00Z',
        created_at: '2026-07-16T10:00:00Z',
      })

    render(
      <MemoryRouter initialEntries={['/growth/annual-plan']}>
        <App />
      </MemoryRouter>
    )
    await waitFor(() => {
      expect(screen.getByText('提交')).toBeTruthy()
    })
    fireEvent.click(screen.getByText('提交'))
    await waitFor(() => expect(submitEvidence).toHaveBeenCalledWith(10))
  })

  it('updates a selected plan item through the execution controls', async () => {
    mockMemberUser()
    mockEligible()
    mockPlanWithOneItem()
    mockTask()
    const updatePlanItem = vi
      .spyOn(planningApi, 'updatePlanItem')
      .mockResolvedValue({
        id: 1,
        annual_growth_plan_id: 10,
        growth_goal_id: 5,
        l3_code: 'P01-L2A-L3A',
        current_level: 2,
        target_level: 4,
        priority: '高',
        learning_material: '课程 A',
        learning_task_content: '完成数据管道练习',
        expected_output: '可复用脚本',
        estimated_hours: '10',
        plan_start_date: '2026-03-01',
        plan_end_date: '2026-03-31',
        target_month: 3,
        status: '暂停',
      })

    render(
      <MemoryRouter initialEntries={['/growth/annual-plan']}>
        <App />
      </MemoryRouter>
    )
    await waitFor(() =>
      expect(screen.getByRole('button', { name: '暂停' })).toBeTruthy(),
    )
    fireEvent.click(screen.getByRole('button', { name: '暂停' }))
    await waitFor(() => {
      expect(updatePlanItem).toHaveBeenCalledWith(1, { status: '暂停' })
    })
  })

  it('shows empty state when plan items list is empty', async () => {
    mockMemberUser()
    mockEligible()
    vi.spyOn(planningApi, 'getAnnualPlan').mockResolvedValue({
      id: 10,
      member_id: 1,
      year: 2026,
      plan_cycle: 12,
      status: '制定中',
      start_date: null,
      end_date: null,
      created_at: '2026-01-01T00:00:00Z',
      items: [],
    })

    render(
      <MemoryRouter initialEntries={['/growth/annual-plan']}>
        <App />
      </MemoryRouter>
    )
    await waitFor(() => {
      expect(
        screen.getByRole('heading', { name: '年度成长计划', level: 1 }),
      ).toBeTruthy()
    })

    expect(screen.getByText(/全部月份/)).toBeTruthy()
  })

  it('renders the combined page with all UI-03 regions', async () => {
    mockMemberUser()
    mockEligible()
    mockPlanWithOneItem({
      learning_task_content: '数据管道练习',
      expected_output: '可复用脚本',
      plan_start_date: '2026-03-01',
      plan_end_date: '2026-03-31',
      target_month: 3,
    })
    mockTask()
    vi.spyOn(planningApi, 'listProgressLogs').mockResolvedValue([
      {
        id: 1,
        task_id: 100,
        record_date: '2026-07-10',
        actual_hours: 3,
        note: '阅读',
        recorder_id: 1,
      },
    ])

    render(
      <MemoryRouter initialEntries={['/growth/annual-plan']}>
        <App />
      </MemoryRouter>
    )
    await waitFor(() => {
      expect(screen.getByRole('region', { name: '年度计划总览' })).toBeTruthy()
      expect(screen.getByRole('region', { name: '月度时间轴' })).toBeTruthy()
    })

    expect(screen.getByText('计划项列表')).toBeTruthy()
    expect(screen.getAllByText(/P01-L2A-L3A/).length).toBeGreaterThan(0)

    fireEvent.click(screen.getByRole('button', { name: /P01-L2A-L3A/ }))

    await waitFor(() => {
      expect(screen.getByRole('region', { name: '学习任务' })).toBeTruthy()
      expect(screen.getByRole('region', { name: '学习执行日志' })).toBeTruthy()
      expect(screen.getByRole('region', { name: 'Evidence 版本' })).toBeTruthy()
    })
  })
})

describe('annual plan api helpers', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ id: 1 }),
        }),
      ),
    )
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('getAnnualPlan fetches with year query and credentials include', async () => {
    await planningApi.getAnnualPlan(2026)
    expect(fetch).toHaveBeenCalledWith(
      '/api/planning/annual-plan?year=2026',
      expect.objectContaining({
        credentials: 'include',
      }),
    )
  })

  it('generatePlanItems posts with credentials include', async () => {
    await planningApi.generatePlanItems()
    expect(fetch).toHaveBeenCalledWith(
      '/api/planning/annual-plan/generate',
      expect.objectContaining({
        method: 'POST',
        credentials: 'include',
        body: JSON.stringify({}),
      }),
    )
  })
})

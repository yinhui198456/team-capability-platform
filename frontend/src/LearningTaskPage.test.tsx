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

describe('LearningTaskPage', () => {
  beforeEach(() => {
    vi.spyOn(planningApi, 'getAnnualPlan').mockResolvedValue(null)
    vi.spyOn(planningApi, 'listLearningTasks').mockResolvedValue([])
    vi.spyOn(planningApi, 'listProgressLogs').mockResolvedValue([])
    vi.spyOn(planningApi, 'listEvidences').mockResolvedValue([])
    vi.spyOn(planningApi, 'getMonthlyHours').mockResolvedValue([])
  })

  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it('renders task list and create buttons for plan items without tasks', async () => {
    vi.spyOn(accessApi, 'me').mockResolvedValue({
      id: 1,
      username: 'member',
      full_name: 'Member',
      roles: ['Member'],
    })
    vi.spyOn(planningApi, 'getAnnualPlan').mockResolvedValue({
      id: 10,
      member_id: 1,
      year: 2026,
      plan_cycle: 12,
      status: '制定中',
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
    vi.spyOn(planningApi, 'listLearningTasks').mockResolvedValue([
      {
        id: 100,
        plan_item_id: 2,
        l3_code: 'P01-L2A-L3B',
        status: '未开始',
        actual_start_date: null,
        actual_end_date: null,
        actual_hours: 0,
        completion_quality: null,
        review_conclusion: null,
        next_action: null,
        plan_item_current_level: 1,
        plan_item_target_level: 3,
        plan_item_priority: '中',
        plan_item_learning_material: null,
        plan_item_learning_task_content: null,
        plan_item_expected_output: null,
        plan_item_estimated_hours: '10',
      },
    ])

    window.history.pushState({}, '', '/growth/tasks')
    render(<App />)

    await waitFor(() => {
      expect(screen.getByText('学习任务')).toBeTruthy()
    })

    expect(screen.getByText(/P01-L2A-L3A/)).toBeTruthy()
    expect(screen.getByText('创建学习任务')).toBeTruthy()
    expect(screen.getByText(/P01-L2A-L3B/)).toBeTruthy()
  })

  it('calls createLearningTask and refreshes on create', async () => {
    vi.spyOn(accessApi, 'me').mockResolvedValue({
      id: 1,
      username: 'member',
      full_name: 'Member',
      roles: ['Member'],
    })
    vi.spyOn(planningApi, 'getAnnualPlan').mockResolvedValue({
      id: 10,
      member_id: 1,
      year: 2026,
      plan_cycle: 12,
      status: '制定中',
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
    const createLearningTask = vi
      .spyOn(planningApi, 'createLearningTask')
      .mockResolvedValue({
        id: 100,
        plan_item_id: 1,
        l3_code: 'P01-L2A-L3A',
        status: '未开始',
        actual_start_date: null,
        actual_end_date: null,
        actual_hours: 0,
        completion_quality: null,
        review_conclusion: null,
        next_action: null,
        plan_item_current_level: 2,
        plan_item_target_level: 4,
        plan_item_priority: '中',
        plan_item_learning_material: null,
        plan_item_learning_task_content: null,
        plan_item_expected_output: null,
        plan_item_estimated_hours: '10',
      })

    window.history.pushState({}, '', '/growth/tasks')
    render(<App />)

    await waitFor(() => {
      expect(screen.getByText('创建学习任务')).toBeTruthy()
    })

    fireEvent.click(screen.getByText('创建学习任务'))

    await waitFor(() => {
      expect(createLearningTask).toHaveBeenCalledWith(1)
    })
  })

  it('calls updateLearningTask when status changes', async () => {
    vi.spyOn(accessApi, 'me').mockResolvedValue({
      id: 1,
      username: 'member',
      full_name: 'Member',
      roles: ['Member'],
    })
    const updateLearningTask = vi
      .spyOn(planningApi, 'updateLearningTask')
      .mockResolvedValue({
        id: 100,
        plan_item_id: 2,
        l3_code: 'P01-L2A-L3B',
        status: '进行中',
        actual_start_date: null,
        actual_end_date: null,
        actual_hours: 0,
        completion_quality: null,
        review_conclusion: null,
        next_action: null,
        plan_item_current_level: 1,
        plan_item_target_level: 3,
        plan_item_priority: '中',
        plan_item_learning_material: null,
        plan_item_learning_task_content: null,
        plan_item_expected_output: null,
        plan_item_estimated_hours: '10',
      })
    vi.spyOn(planningApi, 'listLearningTasks').mockResolvedValue([
      {
        id: 100,
        plan_item_id: 2,
        l3_code: 'P01-L2A-L3B',
        status: '未开始',
        actual_start_date: null,
        actual_end_date: null,
        actual_hours: 0,
        completion_quality: null,
        review_conclusion: null,
        next_action: null,
        plan_item_current_level: 1,
        plan_item_target_level: 3,
        plan_item_priority: '中',
        plan_item_learning_material: null,
        plan_item_learning_task_content: null,
        plan_item_expected_output: null,
        plan_item_estimated_hours: '10',
      },
    ])

    window.history.pushState({}, '', '/growth/tasks')
    render(<App />)

    await waitFor(() => {
      expect(screen.getByText('我的学习任务')).toBeTruthy()
    })

    fireEvent.change(screen.getByLabelText('状态'), {
      target: { value: '进行中' },
    })

    await waitFor(() => {
      expect(updateLearningTask).toHaveBeenCalledWith(100, {
        status: '进行中',
      })
    })
  })

  it('does not show create button for non-member users', async () => {
    vi.spyOn(accessApi, 'me').mockResolvedValue({
      id: 1,
      username: 'buddy',
      full_name: 'Buddy',
      roles: ['Buddy'],
    })
    vi.spyOn(planningApi, 'getAnnualPlan').mockResolvedValue({
      id: 10,
      member_id: 1,
      year: 2026,
      plan_cycle: 12,
      status: '制定中',
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

    window.history.pushState({}, '', '/growth/tasks')
    render(<App />)

    await waitFor(() => {
      expect(screen.getByText('学习任务')).toBeTruthy()
    })

    expect(screen.queryByText('创建学习任务')).toBeNull()
  })

  it('renders progress logs and total hours for a task', async () => {
    vi.spyOn(accessApi, 'me').mockResolvedValue({
      id: 1,
      username: 'member',
      full_name: 'Member',
      roles: ['Member'],
    })
    vi.spyOn(planningApi, 'listLearningTasks').mockResolvedValue([
      {
        id: 100,
        plan_item_id: 2,
        l3_code: 'P01-L2A-L3B',
        status: '进行中',
        actual_start_date: null,
        actual_end_date: null,
        actual_hours: 0,
        completion_quality: null,
        review_conclusion: null,
        next_action: null,
        plan_item_current_level: 1,
        plan_item_target_level: 3,
        plan_item_priority: '中',
        plan_item_learning_material: null,
        plan_item_learning_task_content: null,
        plan_item_expected_output: null,
        plan_item_estimated_hours: '10',
      },
    ])
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

    window.history.pushState({}, '', '/growth/tasks')
    render(<App />)

    await waitFor(() => {
      expect(screen.getByText('学习日志')).toBeTruthy()
    })

    expect(screen.getByText('总时长：3 小时')).toBeTruthy()
    expect(screen.getByText('2026-07-10')).toBeTruthy()
    expect(screen.getByText('阅读文档')).toBeTruthy()
  })

  it('calls createProgressLog and refreshes logs on add', async () => {
    vi.spyOn(accessApi, 'me').mockResolvedValue({
      id: 1,
      username: 'member',
      full_name: 'Member',
      roles: ['Member'],
    })
    vi.spyOn(planningApi, 'listLearningTasks').mockResolvedValue([
      {
        id: 100,
        plan_item_id: 2,
        l3_code: 'P01-L2A-L3B',
        status: '进行中',
        actual_start_date: null,
        actual_end_date: null,
        actual_hours: 0,
        completion_quality: null,
        review_conclusion: null,
        next_action: null,
        plan_item_current_level: 1,
        plan_item_target_level: 3,
        plan_item_priority: '中',
        plan_item_learning_material: null,
        plan_item_learning_task_content: null,
        plan_item_expected_output: null,
        plan_item_estimated_hours: '10',
      },
    ])
    const createProgressLog = vi
      .spyOn(planningApi, 'createProgressLog')
      .mockResolvedValue({
        id: 2,
        task_id: 100,
        record_date: '2026-07-12',
        actual_hours: 4,
        note: '练习',
        recorder_id: 1,
      })
    vi.spyOn(planningApi, 'listProgressLogs').mockResolvedValue([
      {
        id: 2,
        task_id: 100,
        record_date: '2026-07-12',
        actual_hours: 4,
        note: '练习',
        recorder_id: 1,
      },
    ])

    window.history.pushState({}, '', '/growth/tasks')
    render(<App />)

    await waitFor(() => {
      expect(screen.getByText('添加日志')).toBeTruthy()
    })

    fireEvent.change(screen.getAllByLabelText('日期')[0], {
      target: { value: '2026-07-12' },
    })
    fireEvent.change(screen.getAllByLabelText('时长（小时）')[0], {
      target: { value: '4' },
    })
    fireEvent.change(screen.getAllByLabelText('备注')[0], {
      target: { value: '练习' },
    })
    fireEvent.click(screen.getByText('添加日志'))

    await waitFor(() => {
      expect(createProgressLog).toHaveBeenCalledWith(
        100,
        '2026-07-12',
        4,
        '练习',
      )
    })
  })

  it('calls deleteProgressLog and refreshes logs on delete', async () => {
    vi.spyOn(accessApi, 'me').mockResolvedValue({
      id: 1,
      username: 'member',
      full_name: 'Member',
      roles: ['Member'],
    })
    vi.spyOn(planningApi, 'listLearningTasks').mockResolvedValue([
      {
        id: 100,
        plan_item_id: 2,
        l3_code: 'P01-L2A-L3B',
        status: '进行中',
        actual_start_date: null,
        actual_end_date: null,
        actual_hours: 0,
        completion_quality: null,
        review_conclusion: null,
        next_action: null,
        plan_item_current_level: 1,
        plan_item_target_level: 3,
        plan_item_priority: '中',
        plan_item_learning_material: null,
        plan_item_learning_task_content: null,
        plan_item_expected_output: null,
        plan_item_estimated_hours: '10',
      },
    ])
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
    const deleteProgressLog = vi
      .spyOn(planningApi, 'deleteProgressLog')
      .mockResolvedValue(undefined)

    window.history.pushState({}, '', '/growth/tasks')
    render(<App />)

    await waitFor(() => {
      expect(screen.getByText('删除')).toBeTruthy()
    })

    fireEvent.click(screen.getByText('删除'))

    await waitFor(() => {
      expect(deleteProgressLog).toHaveBeenCalledWith(1)
    })
  })

  it('renders evidence list and allows creating a draft', async () => {
    vi.spyOn(accessApi, 'me').mockResolvedValue({
      id: 1,
      username: 'member',
      full_name: 'Member',
      roles: ['Member'],
    })
    vi.spyOn(planningApi, 'listLearningTasks').mockResolvedValue([
      {
        id: 100,
        plan_item_id: 2,
        l3_code: 'P01-L2A-L3B',
        status: '进行中',
        actual_start_date: null,
        actual_end_date: null,
        actual_hours: 0,
        completion_quality: null,
        review_conclusion: null,
        next_action: null,
        plan_item_current_level: 1,
        plan_item_target_level: 3,
        plan_item_priority: '中',
        plan_item_learning_material: null,
        plan_item_learning_task_content: null,
        plan_item_expected_output: null,
        plan_item_estimated_hours: '10',
      },
    ])
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
                l3_code: 'P01-L2A-L3B',
                version_number: 1,
                content: '完成 P01 实践项目',
                evidence_link: 'http://example.com/demo',
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
        l3_code: 'P01-L2A-L3B',
        version_number: 1,
        content: '完成 P01 实践项目',
        evidence_link: 'http://example.com/demo',
        status: '草稿',
        submitted_at: null,
        created_at: '2026-07-16T10:00:00Z',
      })

    window.history.pushState({}, '', '/growth/tasks')
    render(<App />)

    await waitFor(() => {
      expect(screen.getByText('新增版本')).toBeTruthy()
    })

    fireEvent.click(screen.getByText('新增版本'))

    fireEvent.change(screen.getByLabelText('提交内容'), {
      target: { value: '完成 P01 实践项目' },
    })
    fireEvent.change(screen.getByLabelText('证据链接'), {
      target: { value: 'http://example.com/demo' },
    })
    fireEvent.click(screen.getByText('保存'))

    await waitFor(() => {
      expect(createEvidence).toHaveBeenCalledWith(
        100,
        '完成 P01 实践项目',
        'http://example.com/demo',
      )
    })

    await waitFor(() => {
      expect(screen.getByText('版本 1')).toBeTruthy()
    })
  })

  it('submits a draft evidence', async () => {
    vi.spyOn(accessApi, 'me').mockResolvedValue({
      id: 1,
      username: 'member',
      full_name: 'Member',
      roles: ['Member'],
    })
    vi.spyOn(planningApi, 'listLearningTasks').mockResolvedValue([
      {
        id: 100,
        plan_item_id: 2,
        l3_code: 'P01-L2A-L3B',
        status: '进行中',
        actual_start_date: null,
        actual_end_date: null,
        actual_hours: 0,
        completion_quality: null,
        review_conclusion: null,
        next_action: null,
        plan_item_current_level: 1,
        plan_item_target_level: 3,
        plan_item_priority: '中',
        plan_item_learning_material: null,
        plan_item_learning_task_content: null,
        plan_item_expected_output: null,
        plan_item_estimated_hours: '10',
      },
    ])
    let listEvidencesCallCount = 0
    vi.spyOn(planningApi, 'listEvidences').mockImplementation(() => {
      listEvidencesCallCount += 1
      return Promise.resolve(
        listEvidencesCallCount === 1
          ? [
              {
                id: 10,
                learning_task_id: 100,
                l3_code: 'P01-L2A-L3B',
                version_number: 1,
                content: '完成 P01 实践项目',
                evidence_link: 'http://example.com/demo',
                status: '草稿',
                submitted_at: null,
                created_at: '2026-07-16T10:00:00Z',
              },
            ]
          : [
              {
                id: 10,
                learning_task_id: 100,
                l3_code: 'P01-L2A-L3B',
                version_number: 1,
                content: '完成 P01 实践项目',
                evidence_link: 'http://example.com/demo',
                status: '待 Review',
                submitted_at: '2026-07-16T10:05:00Z',
                created_at: '2026-07-16T10:00:00Z',
              },
            ],
      )
    })
    const submitEvidence = vi
      .spyOn(planningApi, 'submitEvidence')
      .mockResolvedValue({
        id: 10,
        learning_task_id: 100,
        l3_code: 'P01-L2A-L3B',
        version_number: 1,
        content: '完成 P01 实践项目',
        evidence_link: 'http://example.com/demo',
        status: '待 Review',
        submitted_at: '2026-07-16T10:05:00Z',
        created_at: '2026-07-16T10:00:00Z',
      })

    window.history.pushState({}, '', '/growth/tasks')
    render(<App />)

    await waitFor(() => {
      expect(screen.getByText('提交')).toBeTruthy()
    })

    fireEvent.click(screen.getByText('提交'))

    await waitFor(() => {
      expect(submitEvidence).toHaveBeenCalledWith(10)
    })

    await waitFor(() => {
      expect(screen.getByText('待 Review')).toBeTruthy()
    })
  })
})

describe('learning task api helpers', () => {
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

  it('createLearningTask posts to plan item learning task endpoint', async () => {
    await planningApi.createLearningTask(5)
    expect(fetch).toHaveBeenCalledWith(
      '/api/planning/plan-items/5/learning-task',
      expect.objectContaining({
        method: 'POST',
        credentials: 'include',
        body: JSON.stringify({}),
      }),
    )
  })

  it('listLearningTasks fetches with credentials include', async () => {
    await planningApi.listLearningTasks()
    expect(fetch).toHaveBeenCalledWith(
      '/api/planning/learning-tasks',
      expect.objectContaining({
        method: 'GET',
        credentials: 'include',
      }),
    )
  })

  it('getLearningTask fetches by id', async () => {
    await planningApi.getLearningTask(7)
    expect(fetch).toHaveBeenCalledWith(
      '/api/planning/learning-tasks/7',
      expect.objectContaining({
        method: 'GET',
        credentials: 'include',
      }),
    )
  })

  it('updateLearningTask puts fields', async () => {
    await planningApi.updateLearningTask(7, {
      status: '进行中',
      actual_hours: 5,
    })
    expect(fetch).toHaveBeenCalledWith(
      '/api/planning/learning-tasks/7',
      expect.objectContaining({
        method: 'PUT',
        credentials: 'include',
        body: JSON.stringify({ status: '进行中', actual_hours: 5 }),
      }),
    )
  })
})

describe('progress log api helpers', () => {
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

  it('createProgressLog posts log fields', async () => {
    await planningApi.createProgressLog(100, '2026-07-10', 3, '阅读文档')
    expect(fetch).toHaveBeenCalledWith(
      '/api/planning/learning-tasks/100/progress-logs',
      expect.objectContaining({
        method: 'POST',
        credentials: 'include',
        body: JSON.stringify({
          record_date: '2026-07-10',
          actual_hours: 3,
          note: '阅读文档',
        }),
      }),
    )
  })

  it('listProgressLogs fetches by task id', async () => {
    await planningApi.listProgressLogs(100)
    expect(fetch).toHaveBeenCalledWith(
      '/api/planning/learning-tasks/100/progress-logs',
      expect.objectContaining({
        method: 'GET',
        credentials: 'include',
      }),
    )
  })

  it('updateProgressLog puts fields', async () => {
    await planningApi.updateProgressLog(1, { actual_hours: 4 })
    expect(fetch).toHaveBeenCalledWith(
      '/api/planning/progress-logs/1',
      expect.objectContaining({
        method: 'PUT',
        credentials: 'include',
        body: JSON.stringify({ actual_hours: 4 }),
      }),
    )
  })

  it('deleteProgressLog deletes by id', async () => {
    await planningApi.deleteProgressLog(1)
    expect(fetch).toHaveBeenCalledWith(
      '/api/planning/progress-logs/1',
      expect.objectContaining({
        method: 'DELETE',
        credentials: 'include',
      }),
    )
  })

  it('getMonthlyHours fetches with year query', async () => {
    await planningApi.getMonthlyHours(2026)
    expect(fetch).toHaveBeenCalledWith(
      '/api/planning/progress-logs/monthly?year=2026',
      expect.objectContaining({
        method: 'GET',
        credentials: 'include',
      }),
    )
  })
})

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

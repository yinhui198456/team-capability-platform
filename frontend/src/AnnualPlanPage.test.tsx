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

describe('AnnualPlanPage', () => {
  beforeEach(() => {
    vi.spyOn(planningApi, 'getAnnualPlan').mockResolvedValue(null)
    vi.spyOn(planningApi, 'listPlanItems').mockResolvedValue([])
    vi.spyOn(planningApi, 'listLearningTasks').mockResolvedValue([])
  })

  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it('renders annual plan page and plan item list', async () => {
    vi.spyOn(accessApi, 'me').mockResolvedValue({
      id: 1,
      username: 'member',
      full_name: 'Member',
      roles: ['Member'],
    })
    vi.spyOn(planningApi, 'getAnnualPlanEligibility').mockResolvedValue({
      eligible: true,
      reason: null,
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

    window.history.pushState({}, '', '/growth/annual-plan')
    render(<App />)

    await waitFor(() => {
      expect(
        screen.getByRole('heading', { name: '年度成长计划', level: 1 }),
      ).toBeTruthy()
    })

    expect(screen.getAllByText(/P01-L2A-L3A/).length).toBeGreaterThan(0)
    expect(screen.getByText(/预计 10 小时/)).toBeTruthy()
    expect(screen.getAllByText('未开始').length).toBeGreaterThan(0)
  })

  it('calls generatePlanItems and refreshes list on generate', async () => {
    vi.spyOn(accessApi, 'me').mockResolvedValue({
      id: 1,
      username: 'member',
      full_name: 'Member',
      roles: ['Member'],
    })
    vi.spyOn(planningApi, 'getAnnualPlanEligibility').mockResolvedValue({
      eligible: true,
      reason: null,
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

    window.history.pushState({}, '', '/growth/annual-plan')
    render(<App />)

    await waitFor(() => {
      expect(screen.getByText('生成计划项')).toBeTruthy()
    })

    fireEvent.click(screen.getByText('生成计划项'))

    await waitFor(() => {
      expect(generatePlanItems).toHaveBeenCalled()
    })
  })

  it('shows gate reason and disables generate when gate is blocked', async () => {
    vi.spyOn(accessApi, 'me').mockResolvedValue({
      id: 1,
      username: 'member',
      full_name: 'Member',
      roles: ['Member'],
    })
    vi.spyOn(planningApi, 'getAnnualPlanEligibility').mockResolvedValue({
      eligible: false,
      reason: '暂无已提交的能力评估',
    })

    window.history.pushState({}, '', '/growth/annual-plan')
    render(<App />)

    await waitFor(() => {
      expect(screen.getByText(/年度计划生成受限/)).toBeTruthy()
    })

    expect(screen.getByText(/暂无已提交的能力评估/)).toBeTruthy()
    expect(screen.queryByText('生成计划项')).toBeNull()
  })

  it('shows the annual plan overview landmark with the plan summary', async () => {
    vi.spyOn(accessApi, 'me').mockResolvedValue({
      id: 1,
      username: 'member',
      full_name: 'Member',
      roles: ['Member'],
    })
    vi.spyOn(planningApi, 'getAnnualPlanEligibility').mockResolvedValue({
      eligible: true,
      reason: null,
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

    window.history.pushState({}, '', '/growth/annual-plan')
    render(<App />)

    await waitFor(() => {
      expect(screen.getByRole('region', { name: '年度计划总览' })).toBeTruthy()
    })

    expect(screen.getByText(/2026 \/ 12 个月/)).toBeTruthy()
    expect(screen.getAllByText(/P01-L2A-L3A/).length).toBeGreaterThan(0)
  })

  it('renders the UI-03 plan timeline, status summary, and item detail workspace', async () => {
    vi.spyOn(accessApi, 'me').mockResolvedValue({
      id: 1,
      username: 'member',
      full_name: 'Member',
      roles: ['Member'],
    })
    vi.spyOn(planningApi, 'getAnnualPlanEligibility').mockResolvedValue({
      eligible: true,
      reason: null,
    })
    vi.spyOn(planningApi, 'getAnnualPlan').mockResolvedValue({
      id: 10, member_id: 1, year: 2026, plan_cycle: 12, status: '制定中', start_date: '2026-01-01', end_date: '2026-12-31', created_at: '2026-01-01T00:00:00Z',
      items: [{ id: 1, annual_growth_plan_id: 10, growth_goal_id: 5, l3_code: 'P01-L2A-L3A', current_level: 2, target_level: 4, priority: '高', learning_material: '课程 A', learning_task_content: '完成数据管道练习', expected_output: '可复用脚本', estimated_hours: '10', plan_start_date: '2026-03-01', plan_end_date: '2026-03-31', target_month: 3, status: '进行中' }],
    })
    vi.spyOn(planningApi, 'listLearningTasks').mockResolvedValue([
      { id: 100, plan_item_id: 1, l3_code: 'P01-L2A-L3A', status: '进行中', actual_start_date: '2026-03-01', actual_end_date: null, actual_hours: 4, completion_quality: null, review_conclusion: null, next_action: '补充日志', plan_item_current_level: 2, plan_item_target_level: 4, plan_item_priority: '高', plan_item_learning_material: '课程 A', plan_item_learning_task_content: '完成数据管道练习', plan_item_expected_output: '可复用脚本', plan_item_estimated_hours: '10', plan_item_target_month: 3 },
    ])

    window.history.pushState({}, '', '/growth/annual-plan')
    render(<App />)

    await waitFor(() => expect(screen.getByRole('region', { name: '月度时间轴' })).toBeTruthy())
    expect(screen.getByText('计划项状态')).toBeTruthy()
    expect(screen.getByText('实际时长')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /P01-L2A-L3A/ }))
    expect(screen.getByRole('complementary', { name: '计划项详情' })).toBeTruthy()
    expect(screen.getByText('完成数据管道练习')).toBeTruthy()
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
        method: 'GET',
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

  it('listPlanItems fetches with credentials include', async () => {
    await planningApi.listPlanItems()
    expect(fetch).toHaveBeenCalledWith(
      '/api/planning/plan-items',
      expect.objectContaining({
        method: 'GET',
        credentials: 'include',
      }),
    )
  })
})

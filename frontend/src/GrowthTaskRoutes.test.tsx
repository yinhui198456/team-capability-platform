// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import { App } from './App'
import * as access from './access'
import * as planning from './planning'

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
  vi.spyOn(planning, 'listLearningTasks').mockResolvedValue([])
  vi.spyOn(planning, 'getLearningTask').mockResolvedValue({
    id: 7,
    plan_item_id: 1,
    l3_code: 'P01.01.01',
    l3_name: '文件规范',
    status: '进行中',
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
    plan_item_priority: '中',
    plan_item_learning_material: null,
    plan_item_learning_task_content: null,
    plan_item_expected_output: '旧要求',
    plan_item_estimated_hours: null,
    plan_item_target_month: 9,
    effective_requirement: {
      snapshot_id: 1,
      expected_output: '旧要求',
      output_type: '说明',
    },
    requirement_change: {
      proposal_detail_id: 8,
      new_snapshot_id: 2,
      current_snapshot_id: 1,
      current: { expected_output: '旧要求', output_type: '说明' },
      proposed: { expected_output: '新要求', output_type: '清单' },
      decision: null,
    },
  })
  vi.spyOn(planning, 'decideTaskRequirement').mockResolvedValue({
    proposal_detail_id: 8,
    new_snapshot_id: 2,
    current_snapshot_id: 1,
    current: { expected_output: '旧要求', output_type: '说明' },
    proposed: { expected_output: '新要求', output_type: '清单' },
    decision: { choice: 'adopt_new', revision: 0, selected_snapshot_id: 2 },
  })
}
describe('S2 independent M03–M05 routes', () => {
  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })
  it('does not merge M03 into the task detail', async () => {
    stub()
    render(
      <MemoryRouter initialEntries={['/growth/annual-plan?year=2026']}>
        <App />
      </MemoryRouter>,
    )
    await waitFor(() =>
      expect(
        screen.getByRole('heading', { name: '月度计划时间轴' }),
      ).toBeTruthy(),
    )
    expect(
      screen.getByRole('progressbar', { name: '年度完成进度' }),
    ).toBeTruthy()
  })
  it('keeps M04 as a list route with a single filter entry', async () => {
    stub()
    render(
      <MemoryRouter initialEntries={['/growth/tasks?year=2026&search=P01']}>
        <App />
      </MemoryRouter>,
    )
    await waitFor(() =>
      expect(screen.getByRole('heading', { name: '学习任务' })).toBeTruthy(),
    )
    expect(
      screen.getByRole('searchbox', { name: '搜索任务或能力项' }),
    ).toBeTruthy()
    expect(screen.getByText('筛选')).toBeTruthy()
  })
  it('persists an explicit M05 requirement choice', async () => {
    stub()
    render(
      <MemoryRouter initialEntries={['/growth/tasks/7?year=2026']}>
        <App />
      </MemoryRouter>,
    )
    await screen.findByRole('button', { name: '采用新要求' })
    screen.getByRole('button', { name: '采用新要求' }).click()
    await waitFor(() =>
      expect(planning.decideTaskRequirement).toHaveBeenCalledWith(
        7,
        8,
        'adopt_new',
        0,
      ),
    )
  })
})

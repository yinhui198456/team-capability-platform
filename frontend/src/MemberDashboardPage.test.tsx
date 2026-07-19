/// @vitest-environment jsdom

import { cleanup, render, screen, waitFor, fireEvent } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { App } from './App'
import * as accessApi from './access'
import * as planningApi from './planning'
import { MemoryRouter } from 'react-router-dom'

describe('MemberDashboardPage', () => {
  afterEach(() => { cleanup(); vi.restoreAllMocks() })

  it('renders the member summary, gaps, and current tasks', async () => {
    vi.spyOn(accessApi, 'me').mockResolvedValue({ id: 1, username: 'member', full_name: 'Member', roles: ['Member'] })
    vi.spyOn(planningApi, 'getMemberDashboard').mockResolvedValue({
      year: 2026,
      summary: { annual_actual_hours: 5, annual_planned_hours: 20, current_month_actual_hours: 2, current_month_planned_hours: 8, completed_task_count: 1, pending_evidence_count: 2 },
      plan_progress: { total: 4, 未开始: 1, 进行中: 1, '待 Evidence Review': 1, 已完成: 0, 延期: 1 },
      domain_radar: [
        { domain_code: 'P01', score: 2 }, { domain_code: 'P02', score: 0 }, { domain_code: 'P03', score: 0 },
        { domain_code: 'C01', score: 0 }, { domain_code: 'C02', score: 0 }, { domain_code: 'C03', score: 0 },
      ],
      gaps: [{ id: 1, assessment_id: 1, l3_code: 'P01.01.01', current_level: 2, target_level: 4, gap_value: 2, priority: '高', plan_candidate: true }],
      current_tasks: [{ id: 1, plan_item_id: 1, l3_code: 'P01.01.01', l3_name: '数据建模与设计', status: '进行中' as const, actual_start_date: null, actual_end_date: null, actual_hours: 5, completion_quality: null, review_conclusion: null, next_action: null, plan_item_current_level: 2, plan_item_target_level: 4, plan_item_priority: '高', plan_item_learning_material: null, plan_item_learning_task_content: '数据建模规范与实践', plan_item_expected_output: null, plan_item_estimated_hours: '10', plan_item_target_month: 6 }],
    })
    render(<MemoryRouter initialEntries={['/dashboard/member']}><App /></MemoryRouter>)
    await waitFor(() => { expect(screen.getByText('我的成长总览')).toBeTruthy() })
    expect(screen.getByText('数据范围：本人')).toBeTruthy()
    expect(screen.getByRole('link', { name: '能力自评与 Gap' })).toBeTruthy()
    expect(screen.getByText('全年累计时长')).toBeTruthy()
    expect(screen.getByText('全年计划时长')).toBeTruthy()
    expect(screen.getByText('当月累计时长')).toBeTruthy()
    expect(screen.getByText('当月计划时长')).toBeTruthy()
    expect(screen.getByText('年度计划进度')).toBeTruthy()
  })

  it('filters gaps by domain and restores on 全部', async () => {
    vi.spyOn(accessApi, 'me').mockResolvedValue({ id: 1, username: 'member', full_name: 'Member', roles: ['Member'] })
    vi.spyOn(planningApi, 'getMemberDashboard').mockResolvedValue({
      year: 2026,
      summary: { annual_actual_hours: 0, annual_planned_hours: 0, current_month_actual_hours: 0, current_month_planned_hours: 0, completed_task_count: 0, pending_evidence_count: 0 },
      plan_progress: { total: 0, 未开始: 0, 进行中: 0, '待 Evidence Review': 0, 已完成: 0, 延期: 0 },
      domain_radar: [{ domain_code: 'P01', score: 0 }, { domain_code: 'P02', score: 0 }, { domain_code: 'P03', score: 0 }, { domain_code: 'C01', score: 0 }, { domain_code: 'C02', score: 0 }, { domain_code: 'C03', score: 0 }],
      gaps: [
        { id: 1, assessment_id: 1, l3_code: 'P01.01.01', current_level: 2, target_level: 4, gap_value: 2, priority: '高', plan_candidate: true },
        { id: 2, assessment_id: 1, l3_code: 'C01.01.01', current_level: 3, target_level: 5, gap_value: 2, priority: '中', plan_candidate: true },
      ],
      current_tasks: [],
    })
    render(<MemoryRouter initialEntries={['/dashboard/member']}><App /></MemoryRouter>)
    await waitFor(() => { expect(screen.getByText('我的成长总览')).toBeTruthy() })
    expect(screen.getByText('P01.01.01')).toBeTruthy()
    expect(screen.getByText('C01.01.01')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /P01/ }))
    await waitFor(() => { expect(screen.queryByText('C01.01.01')).toBeNull() })
    fireEvent.click(screen.getByRole('button', { name: '全部' }))
    await waitFor(() => { expect(screen.getByText('C01.01.01')).toBeTruthy() })
  })
})

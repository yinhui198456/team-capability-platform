/// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { App } from './App'
import * as accessApi from './access'
import * as planningApi from './planning'

describe('MemberDashboardPage', () => {
  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it('renders the member summary, gaps, and current tasks', async () => {
    vi.spyOn(accessApi, 'me').mockResolvedValue({
      id: 1,
      username: 'member',
      full_name: 'Member',
      roles: ['Member'],
    })
    vi.spyOn(planningApi, 'getMemberDashboard').mockResolvedValue({
      year: 2026,
      summary: {
        annual_actual_hours: 5,
        annual_planned_hours: 20,
        current_month_actual_hours: 2,
        current_month_planned_hours: 8,
        completed_task_count: 1,
        pending_evidence_count: 2,
      },
      plan_progress: {
        total: 4,
        未开始: 1,
        进行中: 1,
        '待 Evidence Review': 1,
        已完成: 0,
        延期: 1,
      },
      domain_radar: [
        { domain_code: 'P01', score: 2 },
        { domain_code: 'P02', score: 0 },
        { domain_code: 'P03', score: 0 },
        { domain_code: 'C01', score: 0 },
        { domain_code: 'C02', score: 0 },
        { domain_code: 'C03', score: 0 },
      ],
      gaps: [
        {
          id: 1,
          assessment_id: 1,
          l3_code: 'P01-L2A-L3A',
          current_level: 2,
          target_level: 4,
          gap_value: 2,
          priority: '高',
          plan_candidate: true,
        },
      ],
      current_tasks: [
        {
          id: 1,
          plan_item_id: 1,
          l3_code: 'P01-L2A-L3A',
          l3_name: '数据建模与设计',
          status: '进行中',
          actual_start_date: null,
          actual_end_date: null,
          actual_hours: 5,
          completion_quality: null,
          review_conclusion: null,
          next_action: null,
          plan_item_current_level: 2,
          plan_item_target_level: 4,
          plan_item_priority: '高',
          plan_item_learning_material: null,
          plan_item_learning_task_content: '数据建模规范与实践',
          plan_item_expected_output: null,
          plan_item_estimated_hours: '10',
          plan_item_target_month: 6,
        },
      ],
    })

    window.history.pushState({}, '', '/dashboard/member')
    render(<App />)

    await waitFor(() => {
      expect(screen.getByText('我的成长总览')).toBeTruthy()
    })
    await waitFor(() => {
      expect(
        screen.getByRole('navigation', { name: '顶部主导航' }),
      ).toBeTruthy()
      expect(screen.getByRole('navigation', { name: '侧边导航' })).toBeTruthy()
      expect(screen.getByText('数据范围：本人')).toBeTruthy()
    })
    expect(screen.getByRole('link', { name: '成长管理' })).toBeTruthy()
    expect(screen.queryByRole('link', { name: '团队能力分析' })).toBeNull()
    expect(screen.getByText('全年累计时长')).toBeTruthy()
    expect(screen.getByText('全年计划时长')).toBeTruthy()
    expect(screen.getByText('当月累计时长')).toBeTruthy()
    expect(screen.getByText('当月计划时长')).toBeTruthy()
    expect(document.body.textContent).toContain('5 h')
    expect(document.body.textContent).toContain('20 h')
    expect(screen.getByText('年度计划进度')).toBeTruthy()
    expect(
      screen.getByLabelText('六大领域能力雷达').querySelector('svg'),
    ).toBeTruthy()
    expect(screen.getByText('计划月份')).toBeTruthy()
    expect(screen.getByText('6 月')).toBeTruthy()
    expect(screen.getByText('数据建模规范与实践')).toBeTruthy()
    expect(screen.getByText('数据建模与设计')).toBeTruthy()
    expect(screen.getByText('待提交 Evidence')).toBeTruthy()
    expect(screen.getByRole('link', { name: '进入能力自评' })).toHaveProperty(
      'href',
      expect.stringContaining('/capability/assessment'),
    )
  })
})

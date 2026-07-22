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

describe('AnnualPlanTaskPage', () => {
  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it('renders page with mock data', async () => {
    vi.spyOn(accessApi, 'me').mockResolvedValue({
      id: 1,
      username: 'member',
      full_name: 'Member',
      roles: ['Member'],
    })
    vi.spyOn(planningApi, 'getAnnualPlan').mockResolvedValue({
      id: 1,
      member_id: 1,
      year: 2026,
      plan_cycle: 12,
      status: '执行中',
      start_date: '2026-01-01',
      end_date: '2026-12-31',
      created_at: '',
      items: [
        {
          id: 1,
          annual_growth_plan_id: 1,
          growth_goal_id: 1,
          l3_code: 'P01.01.01',
          l3_name: 'TDC / TDH / ArgoDB / TDS 产品定位',
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
        },
        {
          id: 2,
          annual_growth_plan_id: 1,
          growth_goal_id: 2,
          l3_code: 'P02.01.01',
          current_level: 1,
          target_level: 3,
          priority: '中',
          learning_material: null,
          learning_task_content: '延期任务',
          expected_output: null,
          estimated_hours: '32',
          plan_start_date: '2026-02-01',
          plan_end_date: '2026-05-31',
          target_month: 4,
          status: '延期',
        },
      ],
    })
    render(
      <MemoryRouter initialEntries={['/growth/annual-plan']}>
        <App />
      </MemoryRouter>,
    )
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: '年度成长计划' })).toBeTruthy()
    })
    expect(
      screen.getByText((content) =>
        content.includes('TDC / TDH / ArgoDB / TDS 产品定位（P01.01.01）'),
      ),
    ).toBeTruthy()
    // Column headers
    expect(screen.getByText('能力项')).toBeTruthy()
    expect(screen.getByText('等级提升')).toBeTruthy()
    expect(screen.getByText('计划时长')).toBeTruthy()
  })

  it('month filter shows only selected month items', async () => {
    vi.spyOn(accessApi, 'me').mockResolvedValue({
      id: 1,
      username: 'member',
      full_name: 'Member',
      roles: ['Member'],
    })
    vi.spyOn(planningApi, 'getAnnualPlan').mockResolvedValue({
      id: 1,
      member_id: 1,
      year: 2026,
      plan_cycle: 12,
      status: '执行中',
      start_date: '',
      end_date: '',
      created_at: '',
      items: [
        {
          id: 1,
          annual_growth_plan_id: 1,
          growth_goal_id: 1,
          l3_code: 'P01.01.01',
          l3_name: 'TDC / TDH / ArgoDB / TDS 产品定位',
          current_level: 2,
          target_level: 4,
          priority: '中',
          learning_material: null,
          learning_task_content: '任务A',
          expected_output: null,
          estimated_hours: '10',
          plan_start_date: '',
          plan_end_date: '',
          target_month: 3,
          status: '进行中',
        },
        {
          id: 2,
          annual_growth_plan_id: 1,
          growth_goal_id: 2,
          l3_code: 'P02.01.01',
          l3_name: '主流 AI Infra 技术体系认知',
          current_level: 1,
          target_level: 3,
          priority: '中',
          learning_material: null,
          learning_task_content: '任务B',
          expected_output: null,
          estimated_hours: '20',
          plan_start_date: '',
          plan_end_date: '',
          target_month: 4,
          status: '延期',
        },
      ],
    })
    render(
      <MemoryRouter initialEntries={['/growth/annual-plan']}>
        <App />
      </MemoryRouter>,
    )
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: '年度成长计划' })).toBeTruthy()
    })
    // Click month 3
    const btns = screen.getAllByRole('button', { name: /3 月/ })
    fireEvent.click(
      btns.find((b) => b.textContent?.startsWith('3 月')) || btns[0],
    )
    await waitFor(() => {
      expect(
        screen.getByText('TDC / TDH / ArgoDB / TDS 产品定位（P01.01.01）'),
      ).toBeTruthy()
    })
    expect(
      screen.queryByText('主流 AI Infra 技术体系认知（P02.01.01）'),
    ).toBeNull()
    // aria-pressed on the clicked month button
    const pressedBtn = btns.find((b) =>
      b.textContent?.startsWith('3 月'),
    ) as HTMLButtonElement
    expect(pressedBtn?.getAttribute('aria-pressed')).toBe('true')
  })

  it('falls back to l3_code when l3_name is missing', async () => {
    vi.spyOn(accessApi, 'me').mockResolvedValue({
      id: 1,
      username: 'member',
      full_name: 'Member',
      roles: ['Member'],
    })
    vi.spyOn(planningApi, 'getAnnualPlan').mockResolvedValue({
      id: 1,
      member_id: 1,
      year: 2026,
      plan_cycle: 12,
      status: '执行中',
      start_date: '',
      end_date: '',
      created_at: '',
      items: [
        {
          id: 1,
          annual_growth_plan_id: 1,
          growth_goal_id: 1,
          l3_code: 'P01.01.01',
          current_level: 2,
          target_level: 4,
          priority: '中',
          learning_material: null,
          learning_task_content: '无名称任务',
          expected_output: null,
          estimated_hours: '10',
          plan_start_date: '',
          plan_end_date: '',
          target_month: 3,
          status: '进行中',
        },
      ],
    })
    render(
      <MemoryRouter initialEntries={['/growth/annual-plan']}>
        <App />
      </MemoryRouter>,
    )
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: '年度成长计划' })).toBeTruthy()
    })
    expect(screen.getByText('P01.01.01')).toBeTruthy()
    expect(screen.queryByText('无名称任务')).toBeNull()
  })

  it('shows month and count when month is selected', async () => {
    vi.spyOn(accessApi, 'me').mockResolvedValue({
      id: 1,
      username: 'member',
      full_name: 'Member',
      roles: ['Member'],
    })
    vi.spyOn(planningApi, 'getAnnualPlan').mockResolvedValue({
      id: 1,
      member_id: 1,
      year: 2026,
      plan_cycle: 12,
      status: '执行中',
      start_date: '',
      end_date: '',
      created_at: '',
      items: [
        {
          id: 1,
          annual_growth_plan_id: 1,
          growth_goal_id: 1,
          l3_code: 'P01.01.01',
          current_level: 2,
          target_level: 4,
          priority: '中',
          learning_material: null,
          learning_task_content: '任务A',
          expected_output: null,
          estimated_hours: '10',
          plan_start_date: '',
          plan_end_date: '',
          target_month: 4,
          status: '进行中',
        },
        {
          id: 2,
          annual_growth_plan_id: 1,
          growth_goal_id: 2,
          l3_code: 'P02.01.01',
          current_level: 1,
          target_level: 3,
          priority: '中',
          learning_material: null,
          learning_task_content: '任务B',
          expected_output: null,
          estimated_hours: '20',
          plan_start_date: '',
          plan_end_date: '',
          target_month: 4,
          status: '延期',
        },
      ],
    })
    render(
      <MemoryRouter initialEntries={['/growth/annual-plan']}>
        <App />
      </MemoryRouter>,
    )
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: '年度成长计划' })).toBeTruthy()
    })
    const btn = screen.getByRole('button', { name: /4 月/, pressed: false })
    fireEvent.click(btn)
    expect(btn.getAttribute('aria-pressed')).toBe('true')
    expect(btn.textContent).toContain('4 月')
    expect(btn.textContent).toContain('2 项')
  })
})

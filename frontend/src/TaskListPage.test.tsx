/// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import { TaskListPage } from './TaskListPage'
import { YearContext } from './YearContext'
import * as planning from './planning'
import type { LearningTask, PlanItem } from './planning'

const item = {
  id: 1,
  l3_code: 'C01.01.02',
  l3_name: '文件命名与目录结构规范',
  learning_task_content: '整理并记录目录规范',
  plan_month: '2026-09',
  estimated_hours_parsed: { is_valid: true, min_hours: 8 },
} as PlanItem
const task = {
  id: 9,
  plan_item_id: 1,
  l3_code: item.l3_code,
  status: '进行中',
  actual_hours: 4,
} as LearningTask

describe('TaskListPage', () => {
  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it('renders the M04 status filter, pending badge and task progress', async () => {
    vi.spyOn(planning, 'getAnnualPlan').mockResolvedValue({
      items: [item],
    } as never)
    vi.spyOn(planning, 'listLearningTasks').mockResolvedValue([task])
    vi.spyOn(planning, 'listChangeProposals').mockResolvedValue([
      { details: [{ l3_code: item.l3_code, requirement_decision: null }] },
    ] as never)
    render(
      <MemoryRouter>
        <YearContext.Provider value={2026}>
          <TaskListPage />
        </YearContext.Provider>
      </MemoryRouter>,
    )
    await waitFor(() =>
      expect(screen.getByText('文件命名与目录结构规范')).toBeTruthy(),
    )
    expect(screen.getByText('待确认')).toBeTruthy()
    expect(screen.getByText('能力要求已更新 · 待确认')).toBeTruthy()
    const card = screen.getByTestId('task-card-9')
    expect(card.querySelector('[data-testid="task-card-content"]')).toBeTruthy()
    expect(
      card.querySelector('[data-testid="task-card-content"]')?.textContent,
    ).toContain('文件命名与目录结构规范')
    expect(card.querySelector('.task-card-status')?.textContent).toBe('进行中')
    expect(card.querySelector('[data-testid="task-progress"]')).toBeTruthy()
    expect(
      card.querySelector('[data-testid="task-progress"]')?.textContent,
    ).toContain('50%')
    expect(card.querySelector('[data-testid="task-card-enter"]')).toBeTruthy()
    expect(screen.getByRole('button', { name: '逾期' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '已完成' }))
    expect(screen.getByText('暂无符合条件的学习任务。')).toBeTruthy()
  })

  it('composes status, month and capability-domain filters without losing task links', async () => {
    const sameMonthOtherDomain = {
      ...item,
      id: 2,
      l3_code: 'C02.01.01',
      l3_name: '其他能力域任务',
      l1_code: 'C02',
    } as PlanItem
    const sameDomainOtherStatus = {
      ...item,
      id: 3,
      l3_code: 'C01.02.01',
      l3_name: '未开始任务',
      l1_code: 'C01',
    } as PlanItem
    vi.spyOn(planning, 'getAnnualPlan').mockResolvedValue({
      items: [
        { ...item, l1_code: 'C01' },
        sameMonthOtherDomain,
        sameDomainOtherStatus,
      ],
    } as never)
    vi.spyOn(planning, 'listLearningTasks').mockResolvedValue([
      task,
      {
        ...task,
        id: 10,
        plan_item_id: 2,
        l3_code: sameMonthOtherDomain.l3_code,
      },
      {
        ...task,
        id: 11,
        plan_item_id: 3,
        l3_code: sameDomainOtherStatus.l3_code,
        status: '未开始',
      },
    ])
    vi.spyOn(planning, 'listChangeProposals').mockResolvedValue([
      { details: [{ l3_code: item.l3_code, requirement_decision: null }] },
    ] as never)
    render(
      <MemoryRouter>
        <YearContext.Provider value={2026}>
          <TaskListPage />
        </YearContext.Provider>
      </MemoryRouter>,
    )
    await screen.findByText('文件命名与目录结构规范')
    fireEvent.click(screen.getByRole('button', { name: '进行中' }))
    fireEvent.change(screen.getByLabelText('筛选月份'), {
      target: { value: '2026-09' },
    })
    fireEvent.change(screen.getByLabelText('筛选能力域'), {
      target: { value: 'C01' },
    })
    expect(
      screen.getByTestId('task-card-9').querySelector('.task-card-status')
        ?.textContent,
    ).toBe('进行中')
    expect(screen.getByTestId('task-progress').textContent).toContain('50%')
    expect(screen.getByText('能力要求已更新 · 待确认')).toBeTruthy()
    expect(screen.queryByText('其他能力域任务')).toBeNull()
    expect(screen.queryByText('未开始任务')).toBeNull()
    expect(
      screen.getByRole('link', { name: '进入任务' }).getAttribute('href'),
    ).toBe('/growth/tasks/9?year=2026')
  })

  it('shows a directed load failure', async () => {
    vi.spyOn(planning, 'getAnnualPlan').mockRejectedValue(
      new Error('网络不可用'),
    )
    vi.spyOn(planning, 'listLearningTasks').mockResolvedValue([])
    vi.spyOn(planning, 'listChangeProposals').mockResolvedValue([])
    render(
      <MemoryRouter>
        <YearContext.Provider value={2026}>
          <TaskListPage />
        </YearContext.Provider>
      </MemoryRouter>,
    )
    await waitFor(() =>
      expect(screen.getByRole('alert').textContent).toContain('网络不可用'),
    )
  })
})

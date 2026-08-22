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
    expect(screen.getByText('进行中 · 50%')).toBeTruthy()
    expect(screen.getByRole('button', { name: '逾期' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '已完成' }))
    expect(screen.getByText('暂无符合条件的学习任务。')).toBeTruthy()
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

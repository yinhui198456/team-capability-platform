/// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { TaskDetailPage } from './TaskDetailPage'
import { YearContext } from './YearContext'
import * as planning from './planning'
import type { LearningTask, PlanItem } from './planning'

const item = {
  id: 1,
  l3_code: 'C01.01.02',
  l3_name: '文件命名与目录结构规范',
  current_level: 2,
  target_level: 4,
  expected_output: '规范目录结构与检查清单',
  learning_material: '规范说明',
  learning_task_content: '梳理目录',
  plan_month: '2026-09',
  status: '进行中',
} as PlanItem
const task = {
  id: 9,
  plan_item_id: 1,
  l3_code: item.l3_code,
  status: '进行中',
  actual_hours: 4,
} as LearningTask

function renderPage() {
  vi.spyOn(planning, 'getAnnualPlan').mockResolvedValue({
    items: [item],
  } as never)
  vi.spyOn(planning, 'listLearningTasks').mockResolvedValue([task])
  vi.spyOn(planning, 'getLearningTask').mockResolvedValue(task)
  vi.spyOn(planning, 'listProgressLogs').mockResolvedValue([])
  vi.spyOn(planning, 'listEvidences').mockResolvedValue([])
  vi.spyOn(planning, 'listEvidenceReviewsForTask').mockResolvedValue([])
  vi.spyOn(planning, 'listTaskTransitionHistory').mockResolvedValue([])
  vi.spyOn(planning, 'listChangeProposals').mockResolvedValue([])
  render(
    <MemoryRouter initialEntries={['/growth/tasks/9?year=2026']}>
      <YearContext.Provider value={2026}>
        <Routes>
          <Route path="/growth/tasks/:taskId" element={<TaskDetailPage />} />
        </Routes>
      </YearContext.Provider>
    </MemoryRouter>,
  )
}

describe('TaskDetailPage', () => {
  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it('keeps requirement change and overview before the M05 execution tabs', async () => {
    renderPage()
    await waitFor(() =>
      expect(screen.getByRole('heading', { name: '要求变化' })).toBeTruthy(),
    )
    expect(screen.getByRole('heading', { name: '任务概览' })).toBeTruthy()
    expect(screen.getByRole('button', { name: '暂停' })).toBeTruthy()
    expect(
      screen
        .getByRole('tab', { name: '学习记录' })
        .getAttribute('aria-selected'),
    ).toBe('true')
  })

  it('moves WAI tabs with arrow keys while preserving task actions', async () => {
    renderPage()
    const logs = await screen.findByRole('tab', { name: '学习记录' })
    logs.focus()
    fireEvent.keyDown(logs, { key: 'ArrowRight' })
    const outputs = screen.getByRole('tab', { name: '阶段产出' })
    expect(document.activeElement).toBe(outputs)
    expect(outputs.getAttribute('aria-selected')).toBe('true')
    fireEvent.keyDown(outputs, { key: 'Home' })
    expect(screen.getByRole('button', { name: '暂停' })).toBeTruthy()
  })
})

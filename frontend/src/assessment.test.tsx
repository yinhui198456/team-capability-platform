/// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { App } from './App'
import * as assessmentApi from './assessment'
import { MemoryRouter } from 'react-router-dom'

function mockDraft(overrides: Partial<assessmentApi.Assessment> = {}) {
  return {
    id: 7, member_id: 1, year: 2026, version: 1, assessment_type: '年度', status: '草稿',
    created_at: '', submitted_at: null, archived_at: null,
    details: [{ id: 1, l3_code: 'P01.01.01', l3_name: '数据管道', l1_code: 'P01', l1_name: '数据基础设施', current_level: null, target_level: null, gap_value: 0, evidence_note: '', plan_candidate: false, recommended_start_level: 'P4' }],
    ...overrides,
  }
}

describe('AssessmentGapPage', () => {
  beforeEach(() => { vi.spyOn(assessmentApi, 'listAssessments').mockResolvedValue([]) })
  afterEach(() => { cleanup(); vi.restoreAllMocks() })

  it('renders create button', async () => {
    render(<MemoryRouter initialEntries={['/capability/assessment']}><App /></MemoryRouter>)
    await waitFor(() => { expect(screen.getByRole('button', { name: '创建年度自评草稿' })).toBeTruthy() })
  })

  it('creates draft with null levels', async () => {
    vi.spyOn(assessmentApi, 'createAssessment').mockResolvedValue({ id: 7 })
    vi.spyOn(assessmentApi, 'getAssessment').mockResolvedValue(mockDraft())
    render(<MemoryRouter initialEntries={['/capability/assessment']}><App /></MemoryRouter>)
    await waitFor(() => { expect(screen.getByRole('button', { name: '创建年度自评草稿' })).toBeTruthy() })
    fireEvent.click(screen.getByRole('button', { name: '创建年度自评草稿' }))
    await waitFor(() => { expect(screen.getByText('能力自评与 Gap 分析')).toBeTruthy() })
    // Select should show "请选择" for null value
    const selects = screen.getAllByRole('combobox')
    const levelSelects = selects.filter(s => (s as HTMLSelectElement).value === '')
    expect(levelSelects.length).toBeGreaterThanOrEqual(2)
  })

  it('submit disabled when null levels', async () => {
    vi.spyOn(assessmentApi, 'listAssessments').mockResolvedValue([{ id: 7, member_id: 1, year: 2026, version: 1, assessment_type: '年度', status: '草稿', created_at: '', submitted_at: null, archived_at: null }])
    vi.spyOn(assessmentApi, 'getAssessment').mockResolvedValue(mockDraft())
    render(<MemoryRouter initialEntries={['/capability/assessment']}><App /></MemoryRouter>)
    await waitFor(() => { expect(screen.getByRole('button', { name: '提交自评' })).toBeTruthy() })
    expect((screen.getByRole('button', { name: '提交自评' }) as HTMLButtonElement).disabled).toBe(true)
  })
})

describe('R2-B filter/search', () => {
  afterEach(() => { cleanup(); vi.restoreAllMocks() })
  const rich = (o: any = {}) => ({ id: 1, l3_code: 'P01.01.01', l3_name: '数据管道基础', l1_code: 'P01', l1_name: '数据基础设施', current_level: 2, target_level: 4, gap_value: 2, evidence_note: 'done', plan_candidate: false, recommended_start_level: 'P4', ...o })

  it('未完成 filter shows null-level items', async () => {
    vi.spyOn(assessmentApi, 'listAssessments').mockResolvedValue([{ id: 7, member_id: 1, year: 2026, version: 1, assessment_type: '年度', status: '草稿', created_at: '', submitted_at: null, archived_at: null }])
    vi.spyOn(assessmentApi, 'getAssessment').mockResolvedValue({ id: 7, member_id: 1, year: 2026, version: 1, assessment_type: '年度', status: '草稿', created_at: '', submitted_at: null, archived_at: null, details: [rich({ id: 1 }), { id: 2, l3_code: 'P01.01.02', l3_name: '文件规范', l1_code: 'P01', l1_name: '数据基础设施', current_level: null, target_level: null, gap_value: 0, evidence_note: '', plan_candidate: false, recommended_start_level: 'P4' }] })
    render(<MemoryRouter initialEntries={['/capability/assessment']}><App /></MemoryRouter>)
    await waitFor(() => { expect(screen.getByText('能力自评与 Gap 分析')).toBeTruthy() })
    fireEvent.change(screen.getByRole('combobox', { name: '状态筛选' }), { target: { value: '未完成' } })
    await waitFor(() => { expect(screen.getByText('P01.01.02')).toBeTruthy() })
  })
})

describe('assessment api helpers', () => {
  beforeEach(() => { vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve({ id: 7 }) }))) })
  afterEach(() => { vi.unstubAllGlobals() })
  it('createAssessment', async () => { await assessmentApi.createAssessment(2026); expect(fetch).toHaveBeenCalled() })
})

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
    details: [{ id: 1, l3_code: 'P01.01.01', l3_name: '数据管道', l1_code: 'P01', l1_name: '数据基础设施', current_level: 1, target_level: 1, gap_value: 0, evidence_note: '', plan_candidate: false, recommended_start_level: 'P4' }],
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

  it('creates draft', async () => {
    vi.spyOn(assessmentApi, 'createAssessment').mockResolvedValue({ id: 7 })
    vi.spyOn(assessmentApi, 'getAssessment').mockResolvedValue(mockDraft())
    render(<MemoryRouter initialEntries={['/capability/assessment']}><App /></MemoryRouter>)
    await waitFor(() => { expect(screen.getByRole('button', { name: '创建年度自评草稿' })).toBeTruthy() })
    fireEvent.click(screen.getByRole('button', { name: '创建年度自评草稿' }))
    await waitFor(() => { expect(screen.getByText('能力自评与 Gap 分析')).toBeTruthy() })
  })

  it('submit disabled when unfilled', async () => {
    vi.spyOn(assessmentApi, 'listAssessments').mockResolvedValue([{ id: 7, member_id: 1, year: 2026, version: 1, assessment_type: '年度', status: '草稿', created_at: '', submitted_at: null, archived_at: null }])
    vi.spyOn(assessmentApi, 'getAssessment').mockResolvedValue(mockDraft())
    render(<MemoryRouter initialEntries={['/capability/assessment']}><App /></MemoryRouter>)
    await waitFor(() => { expect(screen.getByRole('button', { name: '提交自评' })).toBeTruthy() })
    expect((screen.getByRole('button', { name: '提交自评' }) as HTMLButtonElement).disabled).toBe(true)
  })
})

describe('AssessmentHistoryPage', () => {
  afterEach(() => { cleanup(); vi.restoreAllMocks() })
  it('renders list', async () => {
    vi.spyOn(assessmentApi, 'listAssessments').mockResolvedValue([{ id: 7, member_id: 1, year: 2026, version: 1, assessment_type: '年度', status: '待复核', created_at: '', submitted_at: '', archived_at: null }])
    vi.spyOn(assessmentApi, 'getAssessment').mockResolvedValue({ id: 7, member_id: 1, year: 2026, version: 1, assessment_type: '年度', status: '待复核', created_at: '', submitted_at: '', archived_at: null, details: [{ id: 1, l3_code: 'P01.01.01', current_level: 2, target_level: 4, gap_value: 2, evidence_note: 't', plan_candidate: true }] })
    render(<MemoryRouter initialEntries={['/capability/assessment/history']}><App /></MemoryRouter>)
    await waitFor(() => { expect(screen.getByText(/2026 · 版本 1 · 待复核/)).toBeTruthy() })
  })
})

describe('R2-B filter/search/submit gate', () => {
  afterEach(() => { cleanup(); vi.restoreAllMocks() })
  const rich = (o: any = {}) => ({ id: 1, l3_code: 'P01.01.01', l3_name: '数据管道基础', l1_code: 'P01', l1_name: '数据基础设施', current_level: 2, target_level: 4, gap_value: 2, evidence_note: '', plan_candidate: false, recommended_start_level: 'P4', ...o })

  it('status filter 未完成', async () => {
    vi.spyOn(assessmentApi, 'listAssessments').mockResolvedValue([{ id: 7, member_id: 1, year: 2026, version: 1, assessment_type: '年度', status: '草稿', created_at: '', submitted_at: null, archived_at: null }])
    vi.spyOn(assessmentApi, 'getAssessment').mockResolvedValue({ id: 7, member_id: 1, year: 2026, version: 1, assessment_type: '年度', status: '草稿', created_at: '', submitted_at: null, archived_at: null, details: [rich({ id: 1, evidence_note: 'done' }), rich({ id: 2, l3_code: 'P01.01.02', current_level: 1, target_level: 1, evidence_note: '' })] })
    render(<MemoryRouter initialEntries={['/capability/assessment']}><App /></MemoryRouter>)
    await waitFor(() => { expect(screen.getByText('能力自评与 Gap 分析')).toBeTruthy() })
    fireEvent.change(screen.getByRole('combobox', { name: '状态筛选' }), { target: { value: '未完成' } })
    await waitFor(() => { expect(screen.getByText('P01.01.02')).toBeTruthy() })
  })

  it('search by name', async () => {
    vi.spyOn(assessmentApi, 'listAssessments').mockResolvedValue([{ id: 7, member_id: 1, year: 2026, version: 1, assessment_type: '年度', status: '草稿', created_at: '', submitted_at: null, archived_at: null }])
    vi.spyOn(assessmentApi, 'getAssessment').mockResolvedValue({ id: 7, member_id: 1, year: 2026, version: 1, assessment_type: '年度', status: '草稿', created_at: '', submitted_at: null, archived_at: null, details: [rich({ id: 1 }), rich({ id: 2, l3_code: 'C01.01.01', l3_name: '办公工具' })] })
    render(<MemoryRouter initialEntries={['/capability/assessment']}><App /></MemoryRouter>)
    await waitFor(() => { expect(screen.getByText('能力自评与 Gap 分析')).toBeTruthy() })
    fireEvent.change(screen.getByPlaceholderText(/搜索/), { target: { value: '管道' } })
    await waitFor(() => { expect(screen.getByText('数据管道基础')).toBeTruthy() })
  })
})

describe('assessment api helpers', () => {
  beforeEach(() => { vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve({ id: 7 }) }))) })
  afterEach(() => { vi.unstubAllGlobals() })
  it('createAssessment', async () => { await assessmentApi.createAssessment(2026); expect(fetch).toHaveBeenCalled() })
})

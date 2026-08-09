/// @vitest-environment jsdom

import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { App } from './App'
import * as accessApi from './access'
import * as planningApi from './planning'
import { MemoryRouter } from 'react-router-dom'

function reviewFixture(
  overrides: Partial<planningApi.MonthlyReview> = {},
): planningApi.MonthlyReview {
  return {
    summary: {
      planned_count: 4,
      completed_count: 1,
      in_progress_count: 1,
      delayed_count: 1,
      paused_count: 0,
      cancelled_count: 1,
      completion_rate: 0.25,
      actual_hours: 2,
      estimated_hours_summary: {
        min_hours: 16,
        max_hours: 18,
        has_values: true,
        has_unparsed: false,
      },
    },
    details: [
      {
        plan_item_id: 11,
        task_id: 21,
        l3_code: 'P01.01.01',
        status: '已完成',
        estimated_hours: '6-8',
        estimated_hours_parsed: {
          raw: '6-8',
          min_hours: 6,
          max_hours: 8,
          is_valid: true,
          is_range: true,
        },
        actual_hours: 2,
      },
      {
        plan_item_id: 12,
        task_id: 22,
        l3_code: 'C01.01.01',
        status: '延期',
        estimated_hours: null,
        estimated_hours_parsed: {
          raw: null,
          min_hours: null,
          max_hours: null,
          is_valid: false,
          is_range: false,
        },
        actual_hours: 0,
      },
      {
        plan_item_id: 13,
        task_id: 23,
        l3_code: 'P02.01.01',
        status: '进行中',
        estimated_hours: '10',
        estimated_hours_parsed: {
          raw: '10',
          min_hours: 10,
          max_hours: 10,
          is_valid: true,
          is_range: false,
        },
        actual_hours: 0,
      },
      {
        plan_item_id: 14,
        task_id: null,
        l3_code: 'C03.01.01',
        status: '取消',
        estimated_hours: '随时',
        estimated_hours_parsed: {
          raw: '随时',
          min_hours: null,
          max_hours: null,
          is_valid: false,
          is_range: false,
        },
        actual_hours: 0,
      },
    ],
    written: {
      id: 9,
      member_id: 1,
      year: 2026,
      month: 5,
      revision: 2,
      main_output: '完成数据建模规范初稿',
      problems: '排期紧张',
      next_month_focus: '推进 C01 任务',
      notes: '备注文本',
      created_at: '2026-05-31T10:00:00Z',
      updated_at: '2026-06-02T09:00:00Z',
    },
    history: [
      {
        revision: 1,
        main_output: '完成数据建模规范初稿',
        problems: null,
        next_month_focus: null,
        notes: null,
        changed_by: 1,
        changed_at: '2026-05-31T10:00:00Z',
      },
      {
        revision: 2,
        main_output: '完成数据建模规范初稿',
        problems: '排期紧张',
        next_month_focus: '推进 C01 任务',
        notes: '备注文本',
        changed_by: 1,
        changed_at: '2026-06-02T09:00:00Z',
      },
    ],
    meta: {
      year: 2026,
      month: 5,
      scope: '本人',
      as_of: '2026-06-02T09:00:00Z',
      source: 'monthly_review.v1',
    },
    ...overrides,
  }
}

function stubMember() {
  return vi.spyOn(accessApi, 'me').mockResolvedValue({
    id: 1,
    username: 'member',
    full_name: 'Member',
    roles: ['Member'],
  })
}

function stubYear() {
  return vi
    .spyOn(planningApi, 'getAvailableYears')
    .mockResolvedValue({ available_years: [2026], active_year: 2026 })
}

function renderPage(month = 5) {
  return render(
    <MemoryRouter initialEntries={[`/growth/review/monthly?month=${month}`]}>
      <App />
    </MemoryRouter>,
  )
}

describe('MonthlyReviewPage', () => {
  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it('renders the reconcilable summary, six states, and estimated/actual hours', async () => {
    stubYear()
    stubMember()
    vi.spyOn(planningApi, 'getMonthlyReview').mockResolvedValue(reviewFixture())
    renderPage()
    await waitFor(() => {
      expect(
        screen.getByRole('heading', { name: '月度复盘', level: 1 }),
      ).toBeTruthy()
    })

    const summary = screen.getByTestId('monthly-summary')
    expect(summary.textContent).toContain('计划4')
    expect(summary.textContent).toContain('已完成1')
    expect(summary.textContent).toContain('进行中1')
    expect(summary.textContent).toContain('延期1')
    expect(summary.textContent).toContain('暂停0')
    expect(summary.textContent).toContain('取消1')
    expect(summary.textContent).toContain('完成率25%')
    expect(summary.textContent).toContain('预计耗时16–18 h')
    expect(summary.textContent).toContain('实际耗时2 h')

    // 明细行携带原始值 + 可解释解析结果；汇总与明细可复算。
    const details = screen.getByTestId('monthly-details')
    expect(details.textContent).toContain('P01.01.01')
    expect(details.textContent).toContain('6–8 h')
    expect(details.textContent).toContain('随时')
    expect(details.textContent).toContain('暂未填写')
  })

  it('renders written fields, revision and immutable history', async () => {
    stubYear()
    stubMember()
    vi.spyOn(planningApi, 'getMonthlyReview').mockResolvedValue(reviewFixture())
    renderPage()
    await waitFor(() => {
      expect(
        screen.getByRole('heading', { name: '月度复盘', level: 1 }),
      ).toBeTruthy()
    })

    expect(screen.getByTestId('current-revision').textContent).toContain('v2')
    expect(
      (screen.getByLabelText('本月主要产出') as HTMLTextAreaElement).value,
    ).toBe('完成数据建模规范初稿')
    expect(
      (screen.getByLabelText('遇到的问题') as HTMLTextAreaElement).value,
    ).toBe('排期紧张')
    expect(
      (screen.getByLabelText('下月重点') as HTMLTextAreaElement).value,
    ).toBe('推进 C01 任务')
    expect((screen.getByLabelText('备注') as HTMLTextAreaElement).value).toBe(
      '备注文本',
    )

    const history = screen.getByTestId('review-history')
    expect(history.textContent).toContain('v1')
    expect(history.textContent).toContain('v2')
    expect(history.textContent).toContain('2026-05-31')
    expect(history.textContent).toContain('2026-06-02')
  })

  it('saves with the current revision as the CAS expected_revision', async () => {
    stubYear()
    stubMember()
    vi.spyOn(planningApi, 'getMonthlyReview').mockResolvedValue(reviewFixture())
    const upsert = vi
      .spyOn(planningApi, 'upsertMonthlyReview')
      .mockResolvedValue({
        written: { ...reviewFixture().written!, revision: 3 },
        history: reviewFixture().history,
      })
    renderPage()
    await waitFor(() => {
      expect(
        screen.getByRole('heading', { name: '月度复盘', level: 1 }),
      ).toBeTruthy()
    })

    fireEvent.change(screen.getByLabelText('本月主要产出'), {
      target: { value: '新的产出内容' },
    })
    fireEvent.click(screen.getByRole('button', { name: '保存月度复盘' }))
    await waitFor(() => {
      expect(upsert).toHaveBeenCalledWith(
        2026,
        5,
        {
          main_output: '新的产出内容',
          problems: '排期紧张',
          next_month_focus: '推进 C01 任务',
          notes: '备注文本',
        },
        2,
      )
    })
    await waitFor(() => {
      expect(screen.getByTestId('current-revision').textContent).toContain('v3')
    })
  })

  it('keeps input on 409 and allows precise retry after reloading the latest revision', async () => {
    stubYear()
    stubMember()
    const getReview = vi
      .spyOn(planningApi, 'getMonthlyReview')
      .mockResolvedValueOnce(reviewFixture())
      .mockResolvedValueOnce(
        reviewFixture({
          written: { ...reviewFixture().written!, revision: 3 },
          history: [
            ...reviewFixture().history,
            {
              revision: 3,
              main_output: '完成数据建模规范初稿',
              problems: '排期紧张',
              next_month_focus: '推进 C01 任务',
              notes: '备注文本',
              changed_by: 1,
              changed_at: '2026-06-03T09:00:00Z',
            },
          ],
        }),
      )
    const upsert = vi
      .spyOn(planningApi, 'upsertMonthlyReview')
      .mockRejectedValueOnce(
        Object.assign(new Error('版本冲突'), {
          status: 409,
          detail: { code: 'monthly_review_revision_conflict' },
        }),
      )
      .mockResolvedValueOnce({
        written: { ...reviewFixture().written!, revision: 4 },
        history: reviewFixture().history,
      })
    renderPage()
    await waitFor(() => {
      expect(
        screen.getByRole('heading', { name: '月度复盘', level: 1 }),
      ).toBeTruthy()
    })

    fireEvent.change(screen.getByLabelText('本月主要产出'), {
      target: { value: '冲突后的草稿' },
    })
    fireEvent.click(screen.getByRole('button', { name: '保存月度复盘' }))
    await waitFor(() => {
      expect(screen.getByRole('alert').textContent).toContain('版本冲突')
    })
    // 409 不清空用户输入。
    expect(
      (screen.getByLabelText('本月主要产出') as HTMLTextAreaElement).value,
    ).toBe('冲突后的草稿')

    // 精确重试：重新加载最新版本（修订号刷新），草稿保留。
    fireEvent.click(screen.getByRole('button', { name: '重新加载最新版本' }))
    await waitFor(() => {
      expect(getReview).toHaveBeenCalledTimes(2)
    })
    await waitFor(() => {
      expect(screen.queryByRole('alert')).toBeNull()
    })
    expect(
      (screen.getByLabelText('本月主要产出') as HTMLTextAreaElement).value,
    ).toBe('冲突后的草稿')
    expect(screen.getByTestId('current-revision').textContent).toContain('v3')

    // 重试按最新修订号提交。
    fireEvent.click(screen.getByRole('button', { name: '保存月度复盘' }))
    await waitFor(() => {
      expect(upsert).toHaveBeenCalledTimes(2)
    })
    expect(upsert.mock.calls[1][3]).toBe(3)
  })

  it('keeps input on 422 validation error', async () => {
    stubYear()
    stubMember()
    vi.spyOn(planningApi, 'getMonthlyReview').mockResolvedValue(reviewFixture())
    vi.spyOn(planningApi, 'upsertMonthlyReview').mockRejectedValue(
      Object.assign(new Error('expected_revision 校验失败'), {
        status: 422,
        detail: { code: 'monthly_review_validation_error' },
      }),
    )
    renderPage()
    await waitFor(() => {
      expect(
        screen.getByRole('heading', { name: '月度复盘', level: 1 }),
      ).toBeTruthy()
    })

    fireEvent.change(screen.getByLabelText('备注'), {
      target: { value: '422 草稿' },
    })
    fireEvent.click(screen.getByRole('button', { name: '保存月度复盘' }))
    await waitFor(() => {
      expect(screen.getByRole('alert').textContent).toContain(
        'expected_revision 校验失败',
      )
    })
    expect((screen.getByLabelText('备注') as HTMLTextAreaElement).value).toBe(
      '422 草稿',
    )
  })

  it('submits the current input values when the save click lands in the same batching window as the last input event', async () => {
    stubYear()
    stubMember()
    vi.spyOn(planningApi, 'getMonthlyReview').mockResolvedValue(
      reviewFixture({ written: null, history: [] }),
    )
    const upsert = vi
      .spyOn(planningApi, 'upsertMonthlyReview')
      .mockResolvedValue({
        written: { ...reviewFixture().written!, revision: 1 },
        history: [],
      })
    renderPage()
    await waitFor(() => {
      expect(
        screen.getByRole('heading', { name: '月度复盘', level: 1 }),
      ).toBeTruthy()
    })
    expect(screen.getByTestId('current-revision').textContent).toContain(
      '未创建',
    )

    const notes = screen.getByLabelText('备注') as HTMLTextAreaElement
    const save = screen.getByRole('button', { name: '保存月度复盘' })
    const tooLong = 'a'.repeat(3001)

    // Browser race: a fast fill→click can dispatch the input event and the
    // click in the same task, before React commits the draft update.  The
    // click then runs against the previous render's draft closure — the
    // submit must still use the input's current value (E2E-64-02 CI fail).
    await act(async () => {
      fireEvent.input(notes, { target: { value: tooLong } })
      save.click()
    })

    expect(upsert).toHaveBeenCalledTimes(1)
    expect(upsert).toHaveBeenCalledWith(
      2026,
      5,
      expect.objectContaining({ notes: tooLong }),
      0,
    )
  })

  it('shows the permission error on 403 without breaking the form', async () => {
    stubYear()
    stubMember()
    vi.spyOn(planningApi, 'getMonthlyReview').mockRejectedValue(
      Object.assign(new Error('无权查看该成员的月度复盘'), { status: 403 }),
    )
    renderPage()
    await waitFor(() => {
      expect(screen.getByRole('alert').textContent).toContain(
        '无权查看该成员的月度复盘',
      )
    })
  })

  it('renders an empty month with placeholder estimated hours', async () => {
    stubYear()
    stubMember()
    vi.spyOn(planningApi, 'getMonthlyReview').mockResolvedValue(
      reviewFixture({
        summary: {
          planned_count: 0,
          completed_count: 0,
          in_progress_count: 0,
          delayed_count: 0,
          paused_count: 0,
          cancelled_count: 0,
          completion_rate: 0,
          actual_hours: 0,
          estimated_hours_summary: {
            min_hours: 0,
            max_hours: 0,
            has_values: false,
            has_unparsed: false,
          },
        },
        details: [],
        written: null,
        history: [],
      }),
    )
    renderPage()
    await waitFor(() => {
      expect(
        screen.getByRole('heading', { name: '月度复盘', level: 1 }),
      ).toBeTruthy()
    })
    expect(screen.getByTestId('monthly-summary').textContent).toContain(
      '预计耗时暂未填写',
    )
    expect(screen.getByText('本月暂无计划项')).toBeTruthy()
    expect(screen.getByTestId('current-revision').textContent).toContain(
      '未创建',
    )
  })
})

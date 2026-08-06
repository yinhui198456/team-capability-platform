import { useCallback, useEffect, useRef, useState } from 'react'
import type { ChangeEvent } from 'react'
import { useSearchParams } from 'react-router-dom'

import { useYear } from './YearContext'
import {
  formatEstimatedHours,
  formatEstimatedHoursSummary,
} from './estimatedHours'
import {
  getMonthlyReview,
  upsertMonthlyReview,
  type MonthlyReview,
  type MonthlyReviewWriteFields,
} from './planning'
import type { ApiError } from './shared/api'

function revisionLabel(revision: number | null): string {
  return revision === null ? '未创建' : `v${revision}`
}

export function MonthlyReviewPage() {
  const year = useYear()
  const [searchParams] = useSearchParams()
  const [month, setMonth] = useState(() => {
    const parsed = Number(searchParams.get('month'))
    return Number.isInteger(parsed) && parsed >= 1 && parsed <= 12
      ? parsed
      : new Date().getMonth() + 1
  })
  const [data, setData] = useState<MonthlyReview | null>(null)
  const [draft, setDraft] = useState<MonthlyReviewWriteFields | null>(null)
  // The submit reads the inputs' live values, not the render closure's
  // draft: a fast fill→click can dispatch both events in one task, before
  // React commits the draft update (E2E-64-02 CI race).
  const mainOutputRef = useRef<HTMLTextAreaElement>(null)
  const problemsRef = useRef<HTMLTextAreaElement>(null)
  const nextMonthFocusRef = useRef<HTMLTextAreaElement>(null)
  const notesRef = useRef<HTMLTextAreaElement>(null)
  const [error, setError] = useState('')
  const [conflict, setConflict] = useState(false)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  const load = useCallback(
    (targetMonth: number, keepDraft = false) => {
      setLoading(true)
      setError('')
      setConflict(false)
      getMonthlyReview(year, targetMonth)
        .then((review) => {
          setData(review)
          if (!keepDraft) {
            setDraft({
              main_output: review.written?.main_output ?? '',
              problems: review.written?.problems ?? '',
              next_month_focus: review.written?.next_month_focus ?? '',
              notes: review.written?.notes ?? '',
            })
          }
        })
        .catch((err) => {
          setError(err instanceof Error ? err.message : '加载失败')
        })
        .finally(() => setLoading(false))
    },
    [year],
  )

  useEffect(() => {
    load(month)
  }, [month, load])

  function setDraftField(field: keyof MonthlyReviewWriteFields) {
    return (event: ChangeEvent<HTMLTextAreaElement>) =>
      setDraft((prev) =>
        prev ? { ...prev, [field]: event.target.value } : prev,
      )
  }

  async function handleSave() {
    if (!data || !draft) return
    // Read the inputs' current values; the draft state may lag one render
    // behind a rapid fill→click (same-task input+click batch).
    const current: MonthlyReviewWriteFields = {
      main_output: mainOutputRef.current?.value ?? draft.main_output ?? '',
      problems: problemsRef.current?.value ?? draft.problems ?? '',
      next_month_focus:
        nextMonthFocusRef.current?.value ?? draft.next_month_focus ?? '',
      notes: notesRef.current?.value ?? draft.notes ?? '',
    }
    setSaving(true)
    setError('')
    setConflict(false)
    try {
      const result = await upsertMonthlyReview(
        year,
        month,
        current,
        data.written?.revision ?? 0,
      )
      setData({ ...data, written: result.written, history: result.history })
      setDraft({
        main_output: result.written.main_output ?? '',
        problems: result.written.problems ?? '',
        next_month_focus: result.written.next_month_focus ?? '',
        notes: result.written.notes ?? '',
      })
    } catch (err) {
      const apiError = err as ApiError
      if (apiError.status === 409) {
        // CAS: another revision exists.  Keep the draft so nothing is lost;
        // the user reloads the latest version, then retries with the fresh
        // expected_revision.
        setConflict(true)
        setError('版本冲突：已有人更新该月复盘，请重新加载最新版本后重试')
      } else {
        setError(err instanceof Error ? err.message : '保存失败')
      }
    } finally {
      setSaving(false)
    }
  }

  if (loading && !data) return <p className="muted">加载中…</p>

  const summary = data?.summary
  const written = data?.written ?? null
  const percent =
    summary && summary.planned_count > 0
      ? Math.round(summary.completion_rate * 100)
      : 0

  return (
    <section className="page">
      <header className="page-heading">
        <div>
          <p className="eyebrow">Member 工作台 · {year} 年</p>
          <h1>月度复盘</h1>
          <p className="muted">
            按计划项聚合六态与预计/实际耗时；汇总与明细由同一查询计算，可复算。
          </p>
        </div>
        <label>
          月份
          <select
            data-testid="month-select"
            value={month}
            onChange={(event) => setMonth(Number(event.target.value))}
          >
            {Array.from({ length: 12 }, (_, index) => index + 1).map((m) => (
              <option key={m} value={m}>
                {m} 月
              </option>
            ))}
          </select>
        </label>
      </header>
      {error && (
        <p className="error" role="alert">
          {error}
          {conflict && (
            <button type="button" onClick={() => load(month, true)}>
              重新加载最新版本
            </button>
          )}
        </p>
      )}
      {!data ? null : (
        <>
          <section className="card" data-testid="monthly-summary">
            <h2>本月汇总</h2>
            <dl>
              <div>
                <dt>计划</dt>
                <dd>{summary?.planned_count}</dd>
              </div>
              <div>
                <dt>已完成</dt>
                <dd>{summary?.completed_count}</dd>
              </div>
              <div>
                <dt>进行中</dt>
                <dd>{summary?.in_progress_count}</dd>
              </div>
              <div>
                <dt>延期</dt>
                <dd>{summary?.delayed_count}</dd>
              </div>
              <div>
                <dt>暂停</dt>
                <dd>{summary?.paused_count}</dd>
              </div>
              <div>
                <dt>取消</dt>
                <dd>{summary?.cancelled_count}</dd>
              </div>
              <div>
                <dt>完成率</dt>
                <dd>{percent}%</dd>
              </div>
              <div>
                <dt>预计耗时</dt>
                <dd>
                  {formatEstimatedHoursSummary(
                    summary?.estimated_hours_summary,
                  )}
                </dd>
              </div>
              <div>
                <dt>实际耗时</dt>
                <dd>{summary?.actual_hours} h</dd>
              </div>
            </dl>
          </section>
          <section className="card" data-testid="monthly-details">
            <h2>本月明细</h2>
            {!summary || summary.planned_count === 0 ? (
              <p className="muted">本月暂无计划项</p>
            ) : (
              <table>
                <thead>
                  <tr>
                    <th>L3 达成路径</th>
                    <th>状态</th>
                    <th>预计耗时</th>
                    <th>实际耗时</th>
                  </tr>
                </thead>
                <tbody>
                  {data.details.map((detail) => (
                    <tr key={detail.plan_item_id}>
                      <td>{detail.l3_code}</td>
                      <td>{detail.status}</td>
                      <td>
                        {formatEstimatedHours(
                          detail.estimated_hours,
                          detail.estimated_hours_parsed,
                        )}
                      </td>
                      <td>{detail.actual_hours} h</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>
          <section className="card">
            <div className="card-heading">
              <h2>本月复盘填写</h2>
              <span data-testid="current-revision">
                当前版本 {revisionLabel(written?.revision ?? null)}
              </span>
            </div>
            {written === null && (
              <p className="muted">
                该月复盘尚未创建，填写后保存将按版本 1 创建。
              </p>
            )}
            {draft && (
              <>
                <label>
                  本月主要产出
                  <textarea
                    ref={mainOutputRef}
                    rows={3}
                    value={draft.main_output ?? ''}
                    onChange={setDraftField('main_output')}
                  />
                </label>
                <label>
                  遇到的问题
                  <textarea
                    ref={problemsRef}
                    rows={3}
                    value={draft.problems ?? ''}
                    onChange={setDraftField('problems')}
                  />
                </label>
                <label>
                  下月重点
                  <textarea
                    ref={nextMonthFocusRef}
                    rows={2}
                    value={draft.next_month_focus ?? ''}
                    onChange={setDraftField('next_month_focus')}
                  />
                </label>
                <label>
                  备注
                  <textarea
                    ref={notesRef}
                    rows={2}
                    value={draft.notes ?? ''}
                    onChange={setDraftField('notes')}
                  />
                </label>
                <div className="form-actions">
                  <button type="button" disabled={saving} onClick={handleSave}>
                    保存月度复盘
                  </button>
                </div>
              </>
            )}
          </section>
          <section className="card" data-testid="review-history">
            <h2>修订历史</h2>
            {data.history.length === 0 ? (
              <p className="muted">暂无修订记录。</p>
            ) : (
              <ol>
                {data.history.map((entry) => (
                  <li key={entry.revision}>
                    <strong>{revisionLabel(entry.revision)}</strong>
                    <span className="muted">
                      {entry.changed_at?.slice(0, 10) ?? '—'}
                    </span>
                    <p className="muted">{entry.main_output ?? '—'}</p>
                  </li>
                ))}
              </ol>
            )}
          </section>
        </>
      )}
    </section>
  )
}

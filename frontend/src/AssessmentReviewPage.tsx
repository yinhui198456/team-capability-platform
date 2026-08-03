import { useEffect, useMemo, useRef, useState } from 'react'

import { newIdempotencyKey } from './assessment'
import {
  getBuddyReviewWorkspace,
  listPendingReviews,
  submitReview,
  type BuddyReviewWorkspace,
  type PendingReview,
} from './assessmentReview'

export function AssessmentReviewPage() {
  const [reviews, setReviews] = useState<PendingReview[]>([])
  const [selected, setSelected] = useState<PendingReview | null>(null)
  const [workspace, setWorkspace] = useState<BuddyReviewWorkspace | null>(null)
  const [conclusion, setConclusion] = useState<'认可' | '建议调整' | ''>('')
  const [feedback, setFeedback] = useState('')
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const idemKeyRef = useRef<string | null>(null)

  useEffect(() => {
    let cancelled = false
    async function load() {
      try {
        const list = await listPendingReviews()
        if (!cancelled) setReviews(list)
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : '加载失败')
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => {
      cancelled = true
    }
  }, [])

  async function selectReview(review: PendingReview) {
    setSelected(review)
    setConclusion('')
    setFeedback('')
    setMessage('')
    setError('')
    idemKeyRef.current = null
    try {
      const ws = await getBuddyReviewWorkspace(review.assessment_id)
      setWorkspace(ws)
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载详情失败')
      setWorkspace(null)
    }
  }

  async function handleSubmit() {
    if (!selected || !conclusion) return
    setError('')
    setMessage('')
    try {
      let idemKey = idemKeyRef.current
      if (!idemKey) {
        idemKey = newIdempotencyKey()
        idemKeyRef.current = idemKey
      }
      const result = await submitReview(
        selected.assessment_id,
        selected.id,
        {
          conclusion,
          feedback: feedback || undefined,
          expected_revision: workspace?.revision ?? 0,
        },
        idemKey,
      )
      setReviews((prev) => prev.filter((r) => r.id !== selected.id))
      setSelected(null)
      setWorkspace(null)
      setConclusion('')
      setFeedback('')
      idemKeyRef.current = null
      if (result.idempotent_replayed) {
        setMessage('已提交（幂等重放，未重复写入）。')
      } else if (conclusion === '认可') {
        setMessage(
          result.proposal?.created
            ? '已认可；已生成变更提案（只读），正式计划保持不变。'
            : `已认可并归档；年度计划已生成（${result.plan?.items_created ?? 0} 项 / ${result.plan?.tasks_created ?? 0} 个任务）。`,
        )
      } else {
        setMessage('已建议调整，等待成员修改')
      }
    } catch (err) {
      // Keep the idempotency key and local inputs for a safe retry.
      setError(err instanceof Error ? err.message : '提交失败')
    }
  }

  const detailGroups = useMemo(() => {
    if (!workspace) return []
    const groups = new Map<string, typeof workspace.details>()
    for (const detail of workspace.details) {
      const key = `${detail.l1_code ?? '未映射'}|${detail.l2_code ?? '未映射'}`
      if (!groups.has(key)) groups.set(key, [])
      groups.get(key)!.push(detail)
    }
    return [...groups.entries()].sort((a, b) => a[0].localeCompare(b[0]))
  }, [workspace])

  if (loading) return <p className="muted">加载中…</p>

  return (
    <section className="page">
      <h1>自评复核</h1>
      {message && (
        <p className="success" role="status">
          {message}
        </p>
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {reviews.length === 0 && !selected && (
        <p className="muted">暂无待复核项。</p>
      )}
      <ul className="assessment-list">
        {reviews.map((review) => (
          <li key={review.id}>
            <button
              className="assessment-summary"
              onClick={() => selectReview(review)}
            >
              成员 {review.member_id} · {review.year} · 版本 {review.version} ·
              提交于{' '}
              {review.submitted_at
                ? new Date(review.submitted_at).toLocaleString()
                : '未知'}
            </button>
          </li>
        ))}
      </ul>
      {selected && workspace && (
        <div className="review-detail">
          <h2>复核详情</h2>
          <p className="muted">
            {selected.year} · 版本 {selected.version} · 当前职级{' '}
            {workspace.member_current_level_snapshot ?? '—'} → 目标职级{' '}
            {workspace.member_target_level_snapshot ?? '—'}
          </p>
          <div className="review-summary-grid" aria-label="自评复核汇总">
            <span>适用 {workspace.summary.total}</span>
            <span>必备 {workspace.summary.current_required}</span>
            <span>进阶 {workspace.summary.target_progressive}</span>
            <span>Gap {workspace.summary.gap_items}</span>
            <span>纳入计划 {workspace.summary.in_plan}</span>
            <span>个人调整 {workspace.summary.adjustments}</span>
            <span>数据异常 {workspace.summary.data_issues}</span>
          </div>
          <div className="review-notices" role="status" aria-live="polite">
            {workspace.summary.existing_formal_plan ? (
              <p>该 Member 年度已有正式计划；本次认可只生成只读变更提案。</p>
            ) : (
              <p>首次认可将原子生成正式年度计划（零选中项也生成计划壳）。</p>
            )}
          </div>
          <div className="assessment-details">
            {detailGroups.length === 0 && <p className="muted">没有详情。</p>}
            {detailGroups.map(([key, details]) => {
              const [, l2] = key.split('|')
              return (
                <section key={key}>
                  <h3>{l2}</h3>
                  <ul>
                    {details.map((detail) => (
                      <li key={detail.l3_code}>
                        {detail.l3_code}：当前 {detail.current_level ?? '—'} →
                        标准{' '}
                        {detail.standard_target_applicable === false
                          ? '不适用'
                          : (detail.standard_target_level ?? '历史保留')}
                        {detail.target_adjusted
                          ? `；个人调整 ${detail.adjusted_target_level ?? '—'}（${detail.target_adjustment_reason ?? '未填写原因'}）`
                          : '；未调整'}
                        ；生效 {detail.target_level ?? '—'}（Gap{' '}
                        {detail.gap_value ?? '—'}）
                        {detail.include_in_plan !== undefined
                          ? ` · 年度计划: ${detail.include_in_plan === true ? '是' : detail.include_in_plan === false ? '否' : '未选择'}`
                          : ''}
                        {detail.member_priority
                          ? ` · Member优先级: ${detail.member_priority}`
                          : ''}
                        {detail.plan_quarter && detail.plan_month
                          ? ` · 计划时间: ${detail.plan_quarter} ${detail.plan_month}月`
                          : ''}
                        {detail.data_issue ? ' · 数据异常' : ''}
                      </li>
                    ))}
                  </ul>
                </section>
              )
            })}
          </div>
          <fieldset>
            <legend>复核结论</legend>
            <label className="radio">
              <input
                type="radio"
                name="conclusion"
                value="认可"
                checked={conclusion === '认可'}
                onChange={(event) =>
                  setConclusion(event.target.value as '认可' | '建议调整')
                }
              />
              认可
            </label>
            <label className="radio">
              <input
                type="radio"
                name="conclusion"
                value="建议调整"
                checked={conclusion === '建议调整'}
                onChange={(event) =>
                  setConclusion(event.target.value as '认可' | '建议调整')
                }
              />
              建议调整
            </label>
          </fieldset>
          <label>
            反馈
            <textarea
              value={feedback}
              onChange={(event) => setFeedback(event.target.value)}
              placeholder="请输入复核反馈"
            />
          </label>
          <div className="actions">
            <button onClick={handleSubmit} disabled={!conclusion}>
              提交复核
            </button>
          </div>
        </div>
      )}
    </section>
  )
}

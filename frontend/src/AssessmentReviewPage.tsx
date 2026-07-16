import { useEffect, useState } from 'react'

import { AssessmentDetail, getAssessment } from './assessment'
import {
  listPendingReviews,
  PendingReview,
  submitReview,
} from './assessmentReview'

export function AssessmentReviewPage() {
  const [reviews, setReviews] = useState<PendingReview[]>([])
  const [selected, setSelected] = useState<PendingReview | null>(null)
  const [details, setDetails] = useState<AssessmentDetail[]>([])
  const [conclusion, setConclusion] = useState<'认可' | '建议调整' | ''>('')
  const [feedback, setFeedback] = useState('')
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)

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
    try {
      const assessment = await getAssessment(review.assessment_id)
      setDetails(assessment.details ?? [])
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载详情失败')
      setDetails([])
    }
  }

  async function handleSubmit() {
    if (!selected || !conclusion) return
    setError('')
    setMessage('')
    try {
      await submitReview(selected.assessment_id, selected.id, {
        conclusion,
        feedback: feedback || undefined,
      })
      setReviews((prev) => prev.filter((r) => r.id !== selected.id))
      setSelected(null)
      setDetails([])
      setConclusion('')
      setFeedback('')
      setMessage(
        conclusion === '认可' ? '已认可并归档' : '已建议调整，等待成员修改',
      )
    } catch (err) {
      setError(err instanceof Error ? err.message : '提交失败')
    }
  }

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
      {selected && (
        <div className="review-detail">
          <h2>复核详情</h2>
          <p className="muted">
            {selected.year} · 版本 {selected.version}
          </p>
          <div className="assessment-details">
            {details.length === 0 && <p className="muted">没有详情。</p>}
            <ul>
              {details.map((detail) => (
                <li key={detail.l3_code}>
                  {detail.l3_code}：当前 {detail.current_level} → 目标{' '}
                  {detail.target_level}（Gap {detail.gap_value}）
                  {detail.plan_candidate ? ' · 计划候选' : ''}
                </li>
              ))}
            </ul>
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

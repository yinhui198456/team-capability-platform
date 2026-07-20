import { useEffect, useState } from 'react'

import {
  EvidenceReview,
  listPendingEvidenceReviews,
  submitEvidenceReview,
  type EvidenceReviewConclusion,
} from './planning'

const CONCLUSIONS: EvidenceReviewConclusion[] = ['通过', '需补充', '驳回']

function formatDateTime(value: string | null | undefined): string {
  if (!value) return '未知'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString('zh-CN')
}

export function EvidenceReviewPage() {
  const [reviews, setReviews] = useState<EvidenceReview[]>([])
  const [selected, setSelected] = useState<EvidenceReview | null>(null)
  const [conclusion, setConclusion] = useState<EvidenceReviewConclusion | ''>(
    '',
  )
  const [feedback, setFeedback] = useState('')
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    async function load() {
      try {
        const list = await listPendingEvidenceReviews()
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

  function selectReview(review: EvidenceReview) {
    setSelected(review)
    setConclusion('')
    setFeedback('')
    setMessage('')
    setError('')
  }

  async function handleSubmit() {
    if (!selected || !conclusion) return
    setError('')
    setMessage('')
    try {
      await submitEvidenceReview(selected.id, conclusion, feedback)
      setReviews((prev) => prev.filter((r) => r.id !== selected.id))
      setSelected(null)
      setConclusion('')
      setFeedback('')
      setMessage(
        conclusion === '通过'
          ? '已通过并归档'
          : conclusion === '需补充'
            ? '已要求补充，等待成员提交新版本'
            : '已驳回，等待成员提交新版本',
      )
    } catch (err) {
      setError(err instanceof Error ? err.message : '提交失败')
    }
  }

  if (loading) return <p className="muted">加载中…</p>

  return (
    <section className="page">
      <h1>Evidence Review</h1>
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
        <p className="muted">暂无待 Review 项。</p>
      )}
      <ul className="evidence-review-list">
        {reviews.map((review) => (
          <li key={review.id}>
            <button
              className="evidence-review-summary"
              onClick={() => selectReview(review)}
            >
              {review.username ?? `成员 ${review.member_id}`} · {review.l3_code}{' '}
              · 版本 {review.version_number} · 提交于{' '}
              {formatDateTime(review.submitted_at)}
            </button>
          </li>
        ))}
      </ul>
      {selected && (
        <div className="review-detail">
          <h2>Review 工作区</h2>
          <p className="muted">
            {selected.username ?? `成员 ${selected.member_id}`} ·{' '}
            {selected.l3_code} · 版本 {selected.version_number}
          </p>
          <div className="evidence-content">
            <h3>提交内容</h3>
            <p>{selected.content || '未提供'}</p>
          </div>
          {selected.evidence_link && (
            <div className="evidence-link">
              <strong>证据链接：</strong>{' '}
              <a href={selected.evidence_link} target="_blank" rel="noreferrer">
                {selected.evidence_link}
              </a>
            </div>
          )}
          <fieldset>
            <legend>Review 结论</legend>
            {CONCLUSIONS.map((value) => (
              <label className="radio" key={value}>
                <input
                  type="radio"
                  name="conclusion"
                  value={value}
                  checked={conclusion === value}
                  onChange={(event) =>
                    setConclusion(
                      event.target.value as EvidenceReviewConclusion,
                    )
                  }
                />
                {value}
              </label>
            ))}
          </fieldset>
          <label>
            反馈
            <textarea
              value={feedback}
              onChange={(event) => setFeedback(event.target.value)}
              placeholder="请输入 Review 反馈"
            />
          </label>
          <div className="actions">
            <button onClick={handleSubmit} disabled={!conclusion}>
              提交 Review 反馈
            </button>
          </div>
        </div>
      )}
    </section>
  )
}

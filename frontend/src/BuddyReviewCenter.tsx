import { useEffect, useState } from 'react'

import { listPendingReviews, type PendingReview } from './assessmentReview'
import { listPendingEvidenceReviews, type EvidenceReview } from './planning'

export function BuddyReviewCenter() {
  const [assessmentReviews, setAssessmentReviews] = useState<PendingReview[]>(
    [],
  )
  const [evidenceReviews, setEvidenceReviews] = useState<EvidenceReview[]>([])
  const [error, setError] = useState('')

  useEffect(() => {
    async function load() {
      try {
        const [assessments, evidences] = await Promise.all([
          listPendingReviews(),
          listPendingEvidenceReviews(),
        ])
        setAssessmentReviews(assessments)
        setEvidenceReviews(evidences)
      } catch (err) {
        setError(err instanceof Error ? err.message : '加载失败')
      }
    }
    load()
  }, [])

  return (
    <section className="page dashboard-page">
      <header className="page-heading">
        <div>
          <p className="eyebrow">Buddy 工作台</p>
          <h1>Buddy 审核中心</h1>
          <p className="muted">
            按待办进入既有自评复核和 Evidence Review，不替代既有审核结论。
          </p>
        </div>
      </header>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <div className="metric-grid" aria-label="Buddy 待办摘要">
        <article>
          <span>待复核自评</span>
          <strong>{assessmentReviews.length}</strong>
        </article>
        <article>
          <span>待 Review Evidence</span>
          <strong>{evidenceReviews.length}</strong>
        </article>
      </div>
      <div className="dashboard-grid">
        <article className="dashboard-card">
          <h2>待复核自评</h2>
          {assessmentReviews.length === 0 ? (
            <p className="muted">暂无待复核自评。</p>
          ) : (
            <ul className="compact-list">
              {assessmentReviews.map((review) => (
                <li key={review.id}>
                  <strong>
                    成员 {review.member_id} · {review.year} 年度自评
                  </strong>
                  <span>
                    版本 {review.version} · {review.status}
                  </span>
                </li>
              ))}
            </ul>
          )}
          <a href="/mentoring/assessment-review">处理自评复核</a>
        </article>
        <article className="dashboard-card">
          <h2>待 Review Evidence</h2>
          {evidenceReviews.length === 0 ? (
            <p className="muted">暂无待 Review Evidence。</p>
          ) : (
            <ul className="compact-list">
              {evidenceReviews.map((review) => (
                <li key={review.id}>
                  <strong>
                    {review.username ?? `成员 ${review.member_id}`} ·{' '}
                    {review.l3_code}
                  </strong>
                  <span>
                    版本 {review.version_number} · {review.status}
                  </span>
                </li>
              ))}
            </ul>
          )}
          <a href="/mentoring/evidence-review">处理 Evidence Review</a>
        </article>
      </div>
    </section>
  )
}

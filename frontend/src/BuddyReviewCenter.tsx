import { useEffect, useMemo, useState } from 'react'

import {
  getAssessment,
  getAssessmentHistory,
  type AssessmentDetail,
  type AssessmentReview,
} from './assessment'
import {
  listPendingReviews,
  submitReview,
  type PendingReview,
} from './assessmentReview'
import { useMe } from './catalog'
import {
  listEvidenceReviewsForTask,
  listPendingEvidenceReviews,
  submitEvidenceReview,
  type EvidenceReviewConclusion,
  type EvidenceReview,
} from './planning'

type QueueFilter = '全部待复核' | '自评复核' | 'Evidence Review'

type QueueItem =
  | { key: string; kind: 'assessment'; review: PendingReview; memberId: number }
  | { key: string; kind: 'evidence'; review: EvidenceReview; memberId: number }

type HistoryItem = Pick<
  AssessmentReview,
  'id' | 'status' | 'conclusion' | 'feedback' | 'reviewed_at'
>

function formatDateTime(value: string | null | undefined) {
  if (!value) return '未记录'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString('zh-CN')
}

export function BuddyReviewCenter() {
  const { user } = useMe()
  const [assessmentReviews, setAssessmentReviews] = useState<PendingReview[]>(
    [],
  )
  const [evidenceReviews, setEvidenceReviews] = useState<EvidenceReview[]>([])
  const [memberId, setMemberId] = useState<number | null>(null)
  const [queueFilter, setQueueFilter] = useState<QueueFilter>('全部待复核')
  const [selectedKey, setSelectedKey] = useState<string | null>(null)
  const [assessmentDetails, setAssessmentDetails] = useState<
    AssessmentDetail[]
  >([])
  const [history, setHistory] = useState<HistoryItem[]>([])
  const [conclusion, setConclusion] = useState<
    '认可' | '建议调整' | EvidenceReviewConclusion | ''
  >('')
  const [feedback, setFeedback] = useState('')
  const [message, setMessage] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    let active = true
    async function load() {
      try {
        const [assessments, evidences] = await Promise.all([
          listPendingReviews(),
          listPendingEvidenceReviews(),
        ])
        if (!active) return
        setAssessmentReviews(assessments)
        setEvidenceReviews(evidences)
      } catch (err) {
        if (active) setError(err instanceof Error ? err.message : '加载失败')
      }
    }
    load()
    return () => {
      active = false
    }
  }, [])

  const queueItems = useMemo<QueueItem[]>(() => {
    const assignedIds = new Set(
      (user?.assigned_members ?? []).map((member) => member.id),
    )
    return [
      ...assessmentReviews.map((review) => ({
        key: `assessment-${review.id}`,
        kind: 'assessment' as const,
        review,
        memberId: review.member_id,
      })),
      ...evidenceReviews.map((review) => ({
        key: `evidence-${review.id}`,
        kind: 'evidence' as const,
        review,
        memberId: review.member_id ?? -1,
      })),
    ].filter((item) => assignedIds.has(item.memberId))
  }, [assessmentReviews, evidenceReviews, user?.assigned_members])
  const members = user?.assigned_members ?? []
  const assessmentCount = queueItems.filter(
    (item) => item.kind === 'assessment',
  ).length
  const evidenceCount = queueItems.filter(
    (item) => item.kind === 'evidence',
  ).length
  const memberName = (id: number) =>
    members.find((member) => member.id === id)?.full_name ?? `成员 ${id}`
  const filteredQueue = queueItems.filter((item) => {
    if (memberId !== null && item.memberId !== memberId) return false
    return (
      queueFilter === '全部待复核' ||
      (queueFilter === '自评复核' && item.kind === 'assessment') ||
      (queueFilter === 'Evidence Review' && item.kind === 'evidence')
    )
  })
  const selected =
    filteredQueue.find((item) => item.key === selectedKey) ??
    filteredQueue[0] ??
    null

  useEffect(() => {
    let active = true
    async function loadWorkspace() {
      if (!selected) {
        setAssessmentDetails([])
        setHistory([])
        return
      }
      setError('')
      try {
        if (selected.kind === 'assessment') {
          const [assessment, reviews] = await Promise.all([
            getAssessment(selected.review.assessment_id),
            getAssessmentHistory(selected.review.assessment_id),
          ])
          if (!active) return
          setAssessmentDetails(assessment.details ?? [])
          setHistory(reviews.filter((review) => review.status === '已闭环'))
        } else {
          const reviews = await listEvidenceReviewsForTask(
            selected.review.learning_task_id ?? 0,
          )
          if (!active) return
          setAssessmentDetails([])
          setHistory(reviews.filter((review) => review.conclusion !== null))
        }
      } catch (err) {
        if (active) {
          setAssessmentDetails([])
          setHistory([])
          setError(err instanceof Error ? err.message : '加载复核工作区失败')
        }
      }
    }
    loadWorkspace()
    return () => {
      active = false
    }
  }, [selected])

  function selectQueue(filter: QueueFilter) {
    setQueueFilter(filter)
    setSelectedKey(null)
    setConclusion('')
    setFeedback('')
  }

  function selectItem(key: string) {
    setSelectedKey(key)
    setConclusion('')
    setFeedback('')
    setMessage('')
  }

  async function submitFeedback() {
    if (!selected || !conclusion) return
    setError('')
    setMessage('')
    setSubmitting(true)
    try {
      if (selected.kind === 'assessment') {
        const value = conclusion as '认可' | '建议调整'
        await submitReview(selected.review.assessment_id, selected.review.id, {
          conclusion: value,
          feedback: feedback || undefined,
        })
        setAssessmentReviews((items) =>
          items.filter((item) => item.id !== selected.review.id),
        )
        setMessage(`已${value}，反馈已归入历史。`)
      } else {
        const value = conclusion as EvidenceReviewConclusion
        await submitEvidenceReview(selected.review.id, value, feedback)
        setEvidenceReviews((items) =>
          items.filter((item) => item.id !== selected.review.id),
        )
        setMessage(
          value === '通过'
            ? 'Evidence 已通过，反馈已归入历史。'
            : `Evidence 已${value}，反馈已归入历史。`,
        )
      }
      setSelectedKey(null)
      setConclusion('')
      setFeedback('')
    } catch (err) {
      setError(err instanceof Error ? err.message : '提交反馈失败')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <section className="page dashboard-page buddy-review-center">
      <header className="page-heading">
        <div>
          <p className="eyebrow">Buddy 工作台</p>
          <h1>Buddy 复核中心</h1>
          <p className="muted">
            按负责成员查看待办，在同一工作区提供辅导性复核与反馈。
          </p>
        </div>
      </header>
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

      <div className="metric-grid buddy-summary" aria-label="Buddy 待办摘要">
        <button
          type="button"
          onClick={() => {
            setMemberId(null)
            selectQueue('全部待复核')
          }}
        >
          <span>辅导成员</span>
          <strong>{members.length}</strong>
        </button>
        <button type="button" onClick={() => selectQueue('自评复核')}>
          <span>待复核自评</span>
          <strong>{assessmentCount}</strong>
        </button>
        <button type="button" onClick={() => selectQueue('Evidence Review')}>
          <span>待 Review Evidence</span>
          <strong>{evidenceCount}</strong>
        </button>
        <button
          type="button"
          onClick={() => {
            setMemberId(null)
            selectQueue('全部待复核')
          }}
        >
          <span>需跟进</span>
          <strong>{queueItems.length}</strong>
        </button>
      </div>

      <div className="buddy-review-layout">
        <aside className="dashboard-card buddy-member-list">
          <h2>辅导成员</h2>
          <button
            className={memberId === null ? 'active' : ''}
            onClick={() => {
              setMemberId(null)
              selectItem('')
            }}
            type="button"
          >
            全部成员
          </button>
          {members.map((member) => (
            <button
              className={memberId === member.id ? 'active' : ''}
              key={member.id}
              onClick={() => {
                setMemberId(member.id)
                selectItem('')
              }}
              type="button"
            >
              <strong>{member.full_name}</strong>
              <span>
                {
                  queueItems.filter((item) => item.memberId === member.id)
                    .length
                }{' '}
                项待复核
              </span>
            </button>
          ))}
        </aside>

        <article className="dashboard-card buddy-queue">
          <div className="card-heading">
            <h2>复核队列</h2>
          </div>
          <div className="queue-tabs" role="tablist" aria-label="复核队列类型">
            {(
              ['全部待复核', '自评复核', 'Evidence Review'] as QueueFilter[]
            ).map((filter) => (
              <button
                aria-selected={queueFilter === filter}
                className={queueFilter === filter ? 'active' : ''}
                key={filter}
                onClick={() => selectQueue(filter)}
                role="tab"
                type="button"
              >
                {filter}
              </button>
            ))}
          </div>
          {filteredQueue.length === 0 ? (
            <p className="muted">当前范围暂无待复核项。</p>
          ) : (
            <table className="analytics-table buddy-queue-table">
              <thead>
                <tr>
                  <th>成员</th>
                  <th>类型</th>
                  <th>L3 / 依据</th>
                  <th>提交时间</th>
                  <th>状态</th>
                </tr>
              </thead>
              <tbody>
                {filteredQueue.map((item) => (
                  <tr
                    className={selected?.key === item.key ? 'selected' : ''}
                    key={item.key}
                  >
                    <td>
                      <button
                        onClick={() => selectItem(item.key)}
                        type="button"
                      >
                        {memberName(item.memberId)}
                      </button>
                    </td>
                    <td>
                      {item.kind === 'assessment'
                        ? '自评复核'
                        : 'Evidence Review'}
                    </td>
                    <td>
                      {item.kind === 'assessment'
                        ? `${item.review.year} 年度自评`
                        : (item.review.l3_code ?? '未关联 L3')}
                    </td>
                    <td>{formatDateTime(item.review.submitted_at)}</td>
                    <td>{item.review.status}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </article>

        <article className="dashboard-card buddy-workspace">
          <h2>复核工作区</h2>
          {!selected ? (
            <p className="muted">选择一项待复核内容后查看依据和历史反馈。</p>
          ) : (
            <>
              <p>
                <strong>{memberName(selected.memberId)}</strong> ·{' '}
                {selected.kind === 'assessment'
                  ? `${selected.review.year} 年度自评`
                  : selected.review.l3_code}
              </p>
              {selected.kind === 'assessment' ? (
                <>
                  <h3>自评依据与 Gap</h3>
                  {assessmentDetails.length === 0 ? (
                    <p className="muted">暂无逐项自评依据。</p>
                  ) : (
                    <ul className="compact-list">
                      {assessmentDetails.map((detail) => (
                        <li key={detail.l3_code}>
                          {detail.l3_code}：当前 {detail.current_level} → 目标{' '}
                          {detail.target_level}（Gap{' '}
                          {detail.gap_value ??
                            detail.target_level - detail.current_level}
                          ）
                        </li>
                      ))}
                    </ul>
                  )}
                  <fieldset>
                    <legend>复核结论</legend>
                    {(['认可', '建议调整'] as const).map((value) => (
                      <label className="radio" key={value}>
                        <input
                          checked={conclusion === value}
                          name="conclusion"
                          onChange={() => setConclusion(value)}
                          type="radio"
                          value={value}
                        />
                        {value}
                      </label>
                    ))}
                  </fieldset>
                </>
              ) : (
                <>
                  <h3>Evidence 版本 {selected.review.version_number}</h3>
                  <p>{selected.review.content || '未提供提交内容。'}</p>
                  {selected.review.evidence_link && (
                    <a
                      href={selected.review.evidence_link}
                      rel="noreferrer"
                      target="_blank"
                    >
                      查看 Evidence 链接
                    </a>
                  )}
                  <fieldset>
                    <legend>Review 结论</legend>
                    {(['通过', '需补充', '驳回'] as const).map((value) => (
                      <label className="radio" key={value}>
                        <input
                          checked={conclusion === value}
                          name="conclusion"
                          onChange={() => setConclusion(value)}
                          type="radio"
                          value={value}
                        />
                        {value}
                      </label>
                    ))}
                  </fieldset>
                </>
              )}
              <label>
                反馈
                <textarea
                  onChange={(event) => setFeedback(event.target.value)}
                  placeholder="请输入复核反馈"
                  value={feedback}
                />
              </label>
              <div className="actions">
                <button
                  disabled={!conclusion || submitting}
                  onClick={submitFeedback}
                  type="button"
                >
                  {selected.kind === 'assessment'
                    ? '提交复核反馈'
                    : '提交 Review 反馈'}
                </button>
              </div>
              <h3>反馈历史（只读）</h3>
              {history.length === 0 ? (
                <p className="muted">暂无已闭环的反馈记录。</p>
              ) : (
                <ul className="compact-list">
                  {history.map((item) => (
                    <li key={item.id}>
                      <strong>{item.conclusion ?? item.status}</strong>
                      <span>
                        {item.feedback || '未填写反馈'} ·{' '}
                        {formatDateTime(item.reviewed_at)}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
        </article>
      </div>
    </section>
  )
}

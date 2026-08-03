import { useEffect, useRef, useState } from 'react'

import {
  listEvidenceReviewsForTask,
  listPendingEvidenceReviews,
  parseApiErrorDetail,
  submitEvidenceReview,
  type EvidenceReviewConclusion,
  type EvidenceReviewRecord,
  type PendingEvidenceReview,
} from './planning'
import type { ApiError } from './shared/api'

const CONCLUSIONS: EvidenceReviewConclusion[] = ['通过', '需补充']

function formatDateTime(value: string | null | undefined): string {
  if (!value) return '未知'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString('zh-CN')
}

function capabilityPath(ev: PendingEvidenceReview): string {
  const l2 = ev.l2_name
    ? `${ev.l2_code ?? '未映射'} · ${ev.l2_name}`
    : (ev.l2_code ?? '未映射')
  const l3 = ev.l3_name ? `${ev.l3_code} · ${ev.l3_name}` : ev.l3_code
  return `${l2} → ${l3}`
}

export function EvidenceReviewPage() {
  const [queue, setQueue] = useState<PendingEvidenceReview[]>([])
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [history, setHistory] = useState<EvidenceReviewRecord[]>([])
  const [conclusion, setConclusion] = useState<EvidenceReviewConclusion | ''>(
    '',
  )
  const [feedback, setFeedback] = useState('')
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  // Idempotency: the key is bound to the exact payload fingerprint; an
  // unchanged retry replays server-side, a changed payload gets a new key.
  const idemRef = useRef<{ key: string; fp: string } | null>(null)

  const selected = queue.find((ev) => ev.id === selectedId) ?? queue[0] ?? null

  async function loadQueue() {
    const list = await listPendingEvidenceReviews()
    setQueue(list)
    return list
  }

  useEffect(() => {
    let cancelled = false
    async function load() {
      try {
        const list = await listPendingEvidenceReviews()
        if (!cancelled) setQueue(list)
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

  useEffect(() => {
    if (!selected) {
      setHistory([])
      return
    }
    let cancelled = false
    async function loadHistory() {
      try {
        const reviews = await listEvidenceReviewsForTask(
          selected.learning_task_id,
        )
        if (!cancelled) {
          setHistory(reviews.filter((r) => r.conclusion !== null))
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : '加载复核历史失败')
        }
      }
    }
    loadHistory()
    return () => {
      cancelled = true
    }
  }, [selected?.id, selected?.learning_task_id])

  function selectItem(id: number) {
    setSelectedId(id)
    setConclusion('')
    setFeedback('')
    setMessage('')
    setError('')
    idemRef.current = null
  }

  async function handleSubmit() {
    if (!selected || !conclusion) return
    if (conclusion === '需补充' && !feedback.trim()) {
      setError('需补充必须填写反馈。')
      return
    }
    setError('')
    setMessage('')
    setSubmitting(true)
    const fp = `${conclusion}|${feedback}`
    let idem = idemRef.current
    if (!idem || idem.fp !== fp) {
      idem = { key: crypto.randomUUID(), fp }
      idemRef.current = idem
    }
    try {
      await submitEvidenceReview(
        selected.id,
        conclusion,
        feedback.trim(),
        idem.key,
      )
      idemRef.current = null
      setMessage(
        conclusion === '通过'
          ? '已通过，评审结论不可变更；Evidence 已归档。'
          : '已要求补充，等待成员提交新版本。',
      )
      const list = queue.filter((ev) => ev.id !== selected.id)
      setQueue(list)
      setSelectedId(null)
      setConclusion('')
      setFeedback('')
    } catch (err) {
      const mapped = parseApiErrorDetail(err as ApiError)
      if (mapped.status === 403) {
        // Relationship or permission is gone: explicit state, not a generic
        // failure, and the item stays for review once access is restored.
        setError('当前有效辅导关系不存在或已失效，无法评审该成果。')
      } else if (mapped.isConflict) {
        // Already reviewed or key collision: reload the queue so the
        // immutable result replaces the stale pending item.
        setError('该 Evidence 已被评审或重复提交，队列已刷新。')
        idemRef.current = null
        void loadQueue().catch(() => undefined)
      } else if (
        mapped.code === 'invalid_review' &&
        mapped.field === 'feedback'
      ) {
        setError('需补充必须填写反馈。')
      } else {
        // Keep the idempotency key: an unchanged retry replays server-side.
        setError(mapped.message)
      }
    } finally {
      setSubmitting(false)
    }
  }

  if (loading) return <p className="muted">加载中…</p>

  return (
    <section className="page evidence-review-page">
      <header className="page-heading">
        <div>
          <p className="eyebrow">Buddy 工作台 / 验收</p>
          <h1>待验收成果</h1>
          <p className="muted">
            仅展示当前有效辅导关系下的待评审 Evidence，与自评复核相互独立。
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
      {queue.length === 0 ? (
        <p className="muted">暂无待验收成果。</p>
      ) : (
        <div className="buddy-review-layout">
          <aside className="dashboard-card buddy-member-list">
            <h2>待验收队列</h2>
            {queue.map((ev) => (
              <button
                className={selected?.id === ev.id ? 'active' : ''}
                key={ev.id}
                onClick={() => selectItem(ev.id)}
                type="button"
              >
                <strong>{ev.username ?? `成员 ${ev.member_id}`}</strong>
                <span className="member-count">
                  版本 {ev.version_number} · {ev.l3_code}
                </span>
              </button>
            ))}
          </aside>

          <article className="dashboard-card buddy-workspace">
            <h2>验收工作区</h2>
            {!selected ? (
              <p className="muted">选择一项待验收成果后查看依据和历史反馈。</p>
            ) : (
              <>
                <p>
                  <strong>
                    {selected.username ?? `成员 ${selected.member_id}`}
                  </strong>{' '}
                  · {capabilityPath(selected)} · Evidence 版本{' '}
                  {selected.version_number} · 提交于{' '}
                  {formatDateTime(selected.submitted_at)}
                </p>
                <div className="evidence-content">
                  <h3>提交内容</h3>
                  {selected.description && (
                    <p className="muted">{selected.description}</p>
                  )}
                  <p>{selected.content || '未提供提交内容。'}</p>
                  {selected.evidence_link && (
                    <a
                      href={selected.evidence_link}
                      rel="noreferrer"
                      target="_blank"
                    >
                      查看 Evidence 链接
                    </a>
                  )}
                </div>
                <fieldset>
                  <legend>评审结论</legend>
                  {CONCLUSIONS.map((value) => (
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
                <label>
                  反馈
                  <textarea
                    onChange={(event) => setFeedback(event.target.value)}
                    placeholder="请输入评审反馈"
                    value={feedback}
                  />
                </label>
                {conclusion === '需补充' && (
                  <p className="muted">需补充必须填写反馈。</p>
                )}
                <div className="actions">
                  <button
                    disabled={!conclusion || submitting}
                    onClick={() => void handleSubmit()}
                    type="button"
                  >
                    提交评审结论
                  </button>
                </div>

                <h3>历史版本与评审（只读）</h3>
                {history.length === 0 ? (
                  <p className="muted">暂无历史评审记录。</p>
                ) : (
                  <ul className="compact-list">
                    {history.map((item) => (
                      <li key={item.id}>
                        <strong>
                          版本 {item.version_number} · {item.conclusion}
                        </strong>
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
      )}
    </section>
  )
}

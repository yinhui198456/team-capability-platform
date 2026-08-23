import { useEffect, useRef, useState } from 'react'
import {
  CheckCircleOutlined,
  ClockCircleOutlined,
  ExclamationCircleOutlined,
  FileTextOutlined,
  InboxOutlined,
} from '@ant-design/icons'

import {
  getEvidenceReviewSummary,
  listEvidenceReviewsForTask,
  listPendingEvidenceReviews,
  parseApiErrorDetail,
  submitEvidenceReview,
  type EvidenceReviewConclusion,
  type EvidenceReviewRecord,
  type PendingEvidenceReview,
  type ReviewSummary,
} from './planning'
import type { ApiError } from './shared/api'

const CONCLUSIONS: EvidenceReviewConclusion[] = ['通过', '需补充']

function formatDateTime(value: string | null | undefined): string {
  if (!value) return '未知'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString('zh-CN')
}

function formatResponseTime(seconds: number | null | undefined): string {
  if (seconds == null) return '—'
  const hours = seconds / 3600
  if (hours >= 24) return `${(hours / 24).toFixed(1)} 天`
  return `${hours.toFixed(hours % 1 === 0 ? 0 : 1)} 小时`
}

export function EvidenceReviewPage() {
  const [queue, setQueue] = useState<PendingEvidenceReview[]>([])
  const [summary, setSummary] = useState<ReviewSummary | null>(null)
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
  const historyRef = useRef<HTMLElement | null>(null)
  // Idempotency: the key is bound to the exact payload fingerprint; an
  // unchanged retry replays server-side, a changed payload gets a new key.
  const idemRef = useRef<{ key: string; fp: string } | null>(null)

  // Strict binding: the workspace always follows the user's selection id.
  // The initial load auto-selects the first item, but a selection is never
  // silently retargeted to whatever happens to be first afterwards — a
  // conflict that removes the item must end the form, not re-target it.
  const selected = queue.find((ev) => ev.id === selectedId) ?? null
  const selectedEvidenceId = selected?.id ?? null
  const selectedTaskId = selected?.learning_task_id ?? null

  async function loadQueue() {
    const list = await listPendingEvidenceReviews()
    setQueue(list)
    return list
  }

  async function loadSummary() {
    const metrics = await getEvidenceReviewSummary()
    setSummary(metrics)
    return metrics
  }

  useEffect(() => {
    let cancelled = false
    async function load() {
      const [queueResult, summaryResult] = await Promise.allSettled([
        listPendingEvidenceReviews(),
        getEvidenceReviewSummary(),
      ])
      if (!cancelled) {
        if (queueResult.status === 'fulfilled') {
          const list = queueResult.value
          setQueue(list)
          // First load picks the first item; later refreshes (e.g. after a
          // conflict) never re-target a selection the user already made.
          setSelectedId((prev) => prev ?? list[0]?.id ?? null)
        }
        if (summaryResult.status === 'fulfilled') {
          setSummary(summaryResult.value)
        }
        if (queueResult.status === 'rejected') {
          setError(
            queueResult.reason instanceof Error
              ? queueResult.reason.message
              : '加载待办队列失败',
          )
        } else if (summaryResult.status === 'rejected') {
          setError(
            summaryResult.reason instanceof Error
              ? summaryResult.reason.message
              : '加载验收指标失败',
          )
        }
        setLoading(false)
      }
    }
    load()
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (selectedTaskId === null) {
      setHistory([])
      return
    }
    const taskId = selectedTaskId
    let cancelled = false
    async function loadHistory() {
      try {
        const reviews = await listEvidenceReviewsForTask(taskId)
        if (!cancelled) {
          setHistory(reviews.filter((r) => r.conclusion !== null))
        }
      } catch (err) {
        if (!cancelled) {
          // The current item's history failed: never leave the previous
          // item's records on screen under this one.
          setHistory([])
          setError(err instanceof Error ? err.message : '加载复核历史失败')
        }
      }
    }
    loadHistory()
    return () => {
      cancelled = true
    }
  }, [selectedEvidenceId, selectedTaskId])

  function selectItem(id: number) {
    if (id === selectedId) return
    setSelectedId(id)
    // Clear the previous item's history before the new one loads, so a slow
    // or failing response can never show stale records under the new item.
    setHistory([])
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
    try {
      const fp = `${conclusion}|${feedback}`
      let idem = idemRef.current
      if (!idem || idem.fp !== fp) {
        // crypto.randomUUID exists only on secure origins; plain-http LAN
        // deployments must fall back or the submit freezes silently.
        idem = {
          key:
            typeof crypto !== 'undefined' && 'randomUUID' in crypto
              ? crypto.randomUUID()
              : `${Date.now()}-${Math.random().toString(36).slice(2)}`,
          fp,
        }
        idemRef.current = idem
      }
      await submitEvidenceReview(
        selected.id,
        conclusion,
        feedback.trim(),
        idem.key,
      )
      idemRef.current = null
      setMessage(
        conclusion === '通过'
          ? '已通过，评审结论不可变更；任务成果证明已通过。'
          : '已要求补充，等待成员提交新版本。',
      )
      const list = queue.filter((ev) => ev.id !== selected.id)
      setQueue(list)
      setSelectedId(null)
      setConclusion('')
      setFeedback('')
      void loadSummary().catch(() => setError('验收指标刷新失败，请稍后重试。'))
    } catch (err) {
      const mapped = parseApiErrorDetail(err as ApiError)
      if (mapped.status === 403) {
        // Relationship or permission is gone: explicit state, not a generic
        // failure, and the item stays for review once access is restored.
        setError('当前有效辅导关系不存在或已失效，无法评审该成果。')
      } else if (mapped.isConflict) {
        // The conflict result is bound to the submitted evidence id: reload
        // the queue, then keep that id selected if it still exists. If the
        // conflict removed it, clear the form and require an explicit
        // re-selection — never retarget the conclusion to another item.
        idemRef.current = null
        const submittedId = selected.id
        try {
          const refreshed = await loadQueue()
          void loadSummary().catch(() => undefined)
          if (!refreshed.some((ev) => ev.id === submittedId)) {
            setSelectedId(null)
            setConclusion('')
            setFeedback('')
            setError('该任务成果证明已被评审，队列已刷新；请重新选择待验收项。')
          } else {
            setError('提交冲突，队列已刷新；请确认后重新提交。')
          }
        } catch {
          setError('提交冲突，队列刷新失败，请稍后重试。')
        }
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

  function focusHistory() {
    historyRef.current?.scrollIntoView?.({ behavior: 'smooth', block: 'start' })
    historyRef.current?.focus()
  }

  return (
    <section className="page evidence-review-page">
      <header className="page-heading">
        <div>
          <p className="eyebrow">导师指导</p>
          <h1>成果验收</h1>
          <p className="muted">
            筛选成员、处理成果验收队列并留下反馈；不审核评级或计划。
          </p>
        </div>
        <button disabled={!selected} onClick={focusHistory} type="button">
          查看历史反馈
        </button>
      </header>
      <dl className="metric-grid evidence-review-summary" aria-label="验收概览">
        <div className="metric amber">
          <InboxOutlined aria-hidden="true" className="metric-icon" />
          <dt>待验收</dt>
          <dd>{summary?.pending_count ?? '—'}</dd>
        </div>
        <div className="metric red">
          <ExclamationCircleOutlined
            aria-hidden="true"
            className="metric-icon"
          />
          <dt>需补充</dt>
          <dd>{summary?.needs_supplement_count ?? '—'}</dd>
        </div>
        <div className="metric green">
          <CheckCircleOutlined aria-hidden="true" className="metric-icon" />
          <dt>本月通过</dt>
          <dd>{summary?.monthly_approved_count ?? '—'}</dd>
        </div>
        <div className="metric">
          <ClockCircleOutlined aria-hidden="true" className="metric-icon" />
          <dt>平均响应</dt>
          <dd>{formatResponseTime(summary?.average_response_seconds)}</dd>
        </div>
      </dl>
      {loading && (
        <p className="muted" role="status">
          加载中…
        </p>
      )}
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
      <div className="buddy-review-layout">
        <aside className="dashboard-card buddy-member-list">
          <h2>待办队列</h2>
          {queue.length === 0 ? (
            <p className="muted">暂无待验收成果。</p>
          ) : (
            queue.map((ev) => (
              <button
                className={selected?.id === ev.id ? 'active' : ''}
                key={ev.id}
                onClick={() => selectItem(ev.id)}
                aria-pressed={selected?.id === ev.id}
                type="button"
              >
                <span className="review-queue-heading">
                  <span
                    className={`review-queue-status ${
                      ev.queue_status === '补充后重提' ? 'red' : 'amber'
                    }`}
                  >
                    {ev.queue_status}
                  </span>
                  <strong>{ev.username ?? `成员 ${ev.member_id}`}</strong>
                </span>
                <small>{ev.l3_name ?? ev.l3_code}</small>
              </button>
            ))
          )}
        </aside>

        <article className="dashboard-card buddy-workspace">
          {!selected ? (
            <>
              <h2>验收工作区</h2>
              <p className="muted">选择一项待办成果后查看预览和历史反馈。</p>
            </>
          ) : (
            <>
              <div className="review-workspace-title">
                <div>
                  <small>
                    {selected.username ?? `成员 ${selected.member_id}`} ·{' '}
                    {selected.l3_code}
                  </small>
                  <h2>{selected.l3_name ?? selected.l3_code}</h2>
                </div>
                <span aria-label={`成果 v${selected.version_number}`}>
                  <small>成果</small> v{selected.version_number}
                </span>
              </div>
              <p className="muted">
                提交于 {formatDateTime(selected.submitted_at)}
              </p>
              <div className="evidence-content">
                <h3>
                  <FileTextOutlined aria-hidden="true" /> Evidence 预览
                </h3>
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
                    查看任务成果证明链接
                  </a>
                )}
              </div>
              <section
                aria-label="当前任务历史反馈"
                className="review-history"
                ref={historyRef}
                tabIndex={-1}
              >
                <h3>历史反馈（只读）</h3>
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
              </section>
              <fieldset>
                <legend>验收结果</legend>
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
                反馈建议
                <textarea
                  onChange={(event) => setFeedback(event.target.value)}
                  placeholder="通过时可填写建议；需补充时请具体说明缺少什么。"
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
                  提交验收结果
                </button>
              </div>
            </>
          )}
        </article>
      </div>
    </section>
  )
}

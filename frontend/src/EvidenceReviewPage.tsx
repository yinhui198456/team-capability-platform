import { useEffect, useRef, useState } from 'react'

import {
  listEvidenceReviewsForTask,
  getEvidenceReviewWorkspace,
  parseApiErrorDetail,
  submitEvidenceReview,
  type EvidenceReviewConclusion,
  type EvidenceReviewRecord,
  type EvidenceReviewWorkspace,
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

function taskTitle(ev: PendingEvidenceReview): string {
  return ev.l3_name || ev.l3_code
}

export function EvidenceReviewPage() {
  const [queue, setQueue] = useState<PendingEvidenceReview[]>([])
  const [workspace, setWorkspace] = useState<EvidenceReviewWorkspace | null>(
    null,
  )
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

  // Strict binding: the workspace always follows the user's selection id.
  // The initial load auto-selects the first item, but a selection is never
  // silently retargeted to whatever happens to be first afterwards — a
  // conflict that removes the item must end the form, not re-target it.
  const selected = queue.find((ev) => ev.id === selectedId) ?? null
  const selectedTaskId = selected?.learning_task_id

  async function loadWorkspace() {
    const next = await getEvidenceReviewWorkspace()
    setWorkspace(next)
    setQueue(next.queue)
    return next.queue
  }

  useEffect(() => {
    let cancelled = false
    async function load() {
      try {
        const next = await getEvidenceReviewWorkspace()
        if (!cancelled) {
          setWorkspace(next)
          setQueue(next.queue)
          // First load picks the first item; later refreshes (e.g. after a
          // conflict) never re-target a selection the user already made.
          setSelectedId((prev) => prev ?? next.queue[0]?.id ?? null)
        }
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
    if (selectedTaskId === undefined) {
      setHistory([])
      return
    }
    // Capture before the closure so the narrowed non-null value stays typed.
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
  }, [selectedId, selectedTaskId])

  function selectItem(id: number) {
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
    if (!selected) return
    if (!conclusion) {
      setError('请先选择“通过”或“需补充”，再提交验收结果。')
      return
    }
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
      setSelectedId(null)
      setConclusion('')
      setFeedback('')
      setMessage(
        conclusion === '通过'
          ? '已通过，评审结论不可变更；任务成果证明已通过。'
          : '已要求补充，等待成员提交新版本。',
      )
      try {
        await loadWorkspace()
      } catch {
        setError('评审已保存，但工作台刷新失败；请刷新页面后继续。')
      }
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
          const refreshed = await loadWorkspace()
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

  if (loading) return <p className="muted">加载中…</p>

  function focusHistory() {
    if (!selected) return
    const historyTarget = document.getElementById(
      `evidence-history-${selected.learning_task_id}`,
    )
    historyTarget?.scrollIntoView?.({ block: 'nearest' })
    historyTarget?.focus()
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
        <button
          className="evidence-review-history-button"
          disabled={!selected}
          onClick={focusHistory}
          title={selected ? undefined : '暂无待验收成果，无法查看历史反馈'}
          type="button"
        >
          查看历史反馈
        </button>
      </header>
      <div className="dashboard-grid" aria-label="验收指标">
        <article className="dashboard-card">
          <span>待验收</span>
          <strong>{workspace?.summary.pending_count ?? 0}</strong>
        </article>
        <article className="dashboard-card">
          <span>需补充</span>
          <strong>{workspace?.summary.needs_supplement_count ?? 0}</strong>
        </article>
        <article className="dashboard-card">
          <span>本月通过</span>
          <strong>{workspace?.summary.approved_this_month_count ?? 0}</strong>
        </article>
        <article className="dashboard-card">
          <span>平均响应</span>
          <strong>
            {workspace?.summary.average_response_days == null
              ? '—'
              : `${workspace.summary.average_response_days.toFixed(1)} 天`}
          </strong>
        </article>
      </div>
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
      <div className="buddy-review-layout evidence-review-layout">
        <aside className="dashboard-card buddy-member-list evidence-review-queue">
          <h2>待办队列</h2>
          {queue.length === 0 ? (
            <p className="muted">暂无待验收成果。</p>
          ) : (
            queue.map((ev) => (
              <button
                className={selected?.id === ev.id ? 'active' : ''}
                key={ev.id}
                onClick={() => selectItem(ev.id)}
                type="button"
              >
                <span
                  className={`status-pill ${
                    ev.is_resubmission ? 'error' : 'warning'
                  }`}
                >
                  {ev.is_resubmission ? '补充后重提' : '待验收'}
                </span>
                <strong>{ev.username ?? `成员 ${ev.member_id}`}</strong>
                <span className="evidence-review-task">
                  {ev.l3_name ?? ev.l3_code} · 版本 {ev.version_number}
                </span>
              </button>
            ))
          )}
        </aside>

        <article
          aria-label="验收工作区"
          className="dashboard-card buddy-workspace evidence-review-workspace"
        >
          {!selected ? (
            <>
              <h2>验收工作区</h2>
              <p className="muted">选择一项待验收成果后查看依据和历史反馈。</p>
            </>
          ) : (
            <>
              <div className="evidence-review-title">
                <div>
                  <small>
                    {selected.username ?? `成员 ${selected.member_id}`} ·{' '}
                    {selected.l3_code}
                  </small>
                  <h2>{taskTitle(selected)}</h2>
                </div>
                <span className="status-pill status-待-Evidence-Review">
                  成果 v{selected.version_number}
                </span>
              </div>
              <div className="evidence-content evidence-review-preview">
                <h3>
                  {selected.description?.trim() ||
                    selected.content?.trim() ||
                    '未提供成果内容。'}
                </h3>
                {selected.description?.trim() && selected.content?.trim() && (
                  <p className="muted">{selected.content}</p>
                )}
                {selected.evidence_link && (
                  <a
                    href={selected.evidence_link}
                    rel="noreferrer"
                    target="_blank"
                  >
                    查看成果文件
                  </a>
                )}
              </div>
              <div aria-label="评审结论" className="decision-row">
                {CONCLUSIONS.map((value) => (
                  <button
                    aria-pressed={conclusion === value}
                    className="evidence-review-decision"
                    data-conclusion={value}
                    key={value}
                    onClick={() => setConclusion(value)}
                    type="button"
                  >
                    {value}
                  </button>
                ))}
              </div>
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
                  className="evidence-review-submit-button"
                  disabled={submitting}
                  onClick={() => void handleSubmit()}
                  type="button"
                >
                  提交验收结果
                </button>
              </div>

              <h3
                id={`evidence-history-${selected.learning_task_id}`}
                tabIndex={-1}
              >
                历史反馈
              </h3>
              <p className="muted">只读历史记录。</p>
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
    </section>
  )
}

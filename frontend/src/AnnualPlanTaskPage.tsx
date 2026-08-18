import { useEffect, useRef, useState } from 'react'
import { newIdempotencyKey } from './assessment'
import {
  formatEstimatedHours,
  formatEstimatedHoursSummary,
} from './estimatedHours'
import s from './AnnualPlanTaskPage.module.css'
import { useYear } from './YearContext'
import {
  COMPLETION_QUALITY_VALUES,
  STATUS_REASON_FIELDS,
  TASK_TRANSITIONS,
  createEvidence,
  createProgressLog,
  formatCapabilityPath,
  getAnnualPlan,
  getLearningTask,
  invalidateProgressLog,
  listEvidenceReviewsForTask,
  listEvidences,
  listLearningTasks,
  listProgressLogs,
  listTaskTransitionHistory,
  parseApiErrorDetail,
  submitEvidence,
  transitionLearningTask,
  updateEvidence,
  updateLearningTask,
  updatePlanItem,
  type AnnualPlan,
  type Evidence,
  type EvidenceReviewRecord,
  type LearningTask,
  type LearningTaskStatus,
  type PlanItem,
  type PlanItemStatus,
  type ProgressLog,
  type TransitionHistoryItem,
} from './planning'

const MONTHS = Array.from({ length: 12 }, (_, i) => i + 1)

// Issue #194: plan_month 'YYYY-MM' is the canonical month source (the
// filter/display key); legacy rows fall back to target_month.
function monthOf(item: PlanItem): number | null {
  if (typeof item.plan_month === 'string') {
    return Number(item.plan_month.slice(5, 7))
  }
  return item.plan_month ?? item.target_month
}
// Capability-model L1 domains, fixed (matches dashboard domain radar).
const DOMAIN_OPTIONS = ['P01', 'P02', 'P03', 'C01', 'C02', 'C03']
const STATUS_LABELS: Record<string, string> = {
  未开始: '未开始',
  进行中: '进行中',
  已完成: '已完成',
  延期: '延期',
  暂停: '暂停',
  取消: '取消',
}
const ACTION_LABELS: Record<LearningTaskStatus, string> = {
  未开始: '开始执行',
  进行中: '恢复执行',
  已完成: '完成任务',
  延期: '申请延期',
  暂停: '暂停',
  取消: '取消任务',
}
const CONFIRM_LABELS: Record<LearningTaskStatus, string> = {
  未开始: '确认开始执行',
  进行中: '确认恢复执行',
  已完成: '确认完成',
  延期: '确认延期',
  暂停: '确认暂停',
  取消: '确认取消',
}
function actionLabel(task: LearningTask, to: LearningTaskStatus): string {
  // The button is keyed by the TARGET status; 进行中 reads as "start" only
  // when the task is still 未开始, otherwise as "resume".
  if (to === '进行中') return task.status === '未开始' ? '开始执行' : '恢复执行'
  return ACTION_LABELS[to]
}
const REASON_LABELS: Record<string, string> = {
  delay_reason: '延期原因',
  pause_reason: '暂停原因',
  cancel_reason: '取消原因',
}
// Server completion-gate fields → member-facing labels for 422 mapping.
const GATE_FIELD_LABELS: Record<string, string> = {
  evidence: '至少一份通过评审的任务成果证明',
  review_conclusion: '复盘结论',
  actual_hours: '有效日志聚合实际时长大于 0',
  completion_quality: '合法的完成质量（达到预期/部分达到/超出预期）',
  next_action: '下一步行动（200 字内）',
}

type TaskDetail = {
  task: LearningTask
  logs: ProgressLog[]
  evidences: Evidence[]
  reviews: EvidenceReviewRecord[]
  history: TransitionHistoryItem[]
}

function statusClass(st: string) {
  return st === '已完成'
    ? s.statusDone
    : st === '延期'
      ? s.statusOverdue
      : st === '进行中'
        ? s.statusActive
        : s.statusTodo
}

function evBadge(ev: Evidence) {
  const cls =
    ev.status === '通过'
      ? s.evidencePass
      : ev.status === '待 Review'
        ? s.evidencePending
        : ev.status === '需补充'
          ? s.evidenceNeedMore
          : ev.status === '草稿'
            ? s.evidenceDraft
            : s.evidenceClosed
  return <span className={`${s.evidenceBadge} ${cls}`}>{ev.status}</span>
}

function formatDateTime(value: string | null | undefined): string {
  if (!value) return '—'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString('zh-CN')
}

export function AnnualPlanTaskPage() {
  const year = useYear()
  const [plan, setPlan] = useState<AnnualPlan | null>(null)
  const [tasks, setTasks] = useState<Record<number, TaskDetail>>({})
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [loading, setLoading] = useState(true)
  const [selectedMonth, setSelectedMonth] = useState<number | null>(null)
  const [statusFilter, setStatusFilter] = useState<PlanItemStatus | '全部状态'>(
    '全部状态',
  )
  const [priorityFilter, setPriorityFilter] = useState<
    '全部优先级' | '高' | '中' | '低'
  >('全部优先级')
  const [domainFilter, setDomainFilter] = useState<string>('全部能力域')
  const [expandedId, setExpandedId] = useState<number | null>(null)
  const [conflictTask, setConflictTask] = useState<number | null>(null)

  // Idempotency keys: bound to the exact payload fingerprint, so an unchanged
  // retry replays server-side; a changed payload (or a revision 409 that
  // invalidated the attempt) gets a fresh key.
  const idemRef = useRef(new Map<string, { fp: string; key: string }>())

  function keyFor(scope: string, fp: string): { key: string } {
    const existing = idemRef.current.get(scope)
    if (existing && existing.fp === fp) return { key: existing.key }
    // crypto.randomUUID is undefined on plain-http LAN origins; the shared
    // helper falls back to getRandomValues for those deploys.
    const key = newIdempotencyKey()
    idemRef.current.set(scope, { fp, key })
    return { key }
  }

  function clearKey(scope: string) {
    idemRef.current.delete(scope)
  }

  async function loadTaskDetail(taskId: number): Promise<TaskDetail> {
    const [task, logs, evidences, reviews, history] = await Promise.all([
      getLearningTask(taskId),
      listProgressLogs(taskId),
      listEvidences(taskId),
      listEvidenceReviewsForTask(taskId),
      listTaskTransitionHistory(taskId),
    ])
    return { task, logs, evidences, reviews, history }
  }

  async function refreshTask(taskId: number) {
    const detail = await loadTaskDetail(taskId)
    setTasks((prev) => ({ ...prev, [detail.task.plan_item_id]: detail }))
    return detail
  }

  async function reloadPlan() {
    const p = await getAnnualPlan(year)
    setPlan(p)
    return p
  }

  // Plan-item schedule CAS: only the two dates are editable; a stale item
  // revision is a 409 that keeps the typed input and demands explicit
  // confirmation before resending with the refreshed revision.
  async function handleSaveDates(
    item: PlanItem,
    fields: { plan_start_date: string | null; plan_end_date: string | null },
  ): Promise<'saved' | 'conflict' | 'error'> {
    try {
      await updatePlanItem(item.id, fields, item.revision)
      await reloadPlan()
      setNotice('计划日期已保存。')
      return 'saved'
    } catch (err) {
      const mapped = parseApiErrorDetail(err)
      if (mapped.isConflict) {
        await reloadPlan().catch(() => undefined)
        setError('计划数据已被其他会话更新，请确认后重新保存。')
        return 'conflict'
      }
      // 422/403 and terminal errors: keep the exact typed input.
      setError(mapped.message)
      return 'error'
    }
  }

  useEffect(() => {
    let cancelled = false
    async function load() {
      try {
        const [p, taskList] = await Promise.all([
          getAnnualPlan(year),
          listLearningTasks(),
        ])
        if (cancelled) return
        setPlan(p)
        const details = await Promise.all(
          taskList.map((t) => loadTaskDetail(t.id).catch(() => null)),
        )
        if (cancelled) return
        const record: Record<number, TaskDetail> = {}
        taskList.forEach((task, index) => {
          if (details[index]) record[task.plan_item_id] = details[index]
        })
        setTasks(record)
      } catch (err) {
        if (!cancelled)
          setError(err instanceof Error ? err.message : '加载失败')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => {
      cancelled = true
    }
  }, [year])

  const items = plan?.items ?? []
  const visibleItems = items
    .filter((i) => !selectedMonth || monthOf(i) === selectedMonth)
    .filter((i) => statusFilter === '全部状态' || i.status === statusFilter)
    .filter(
      (i) => priorityFilter === '全部优先级' || i.priority === priorityFilter,
    )
    .filter((i) => domainFilter === '全部能力域' || i.l1_code === domainFilter)
  const hasActiveFilters =
    statusFilter !== '全部状态' ||
    priorityFilter !== '全部优先级' ||
    domainFilter !== '全部能力域'
  const totalEstimated = formatEstimatedHoursSummary(
    plan?.estimated_hours_summary,
  )
  const hasUnparsedHours = plan?.estimated_hours_summary?.has_unparsed ?? false
  const totalActual = Object.values(tasks).reduce(
    (sum, t) => sum + (t.task.actual_hours ?? 0),
    0,
  )
  const completed = items.filter((i) => i.status === '已完成').length
  const progress =
    items.length === 0 ? 0 : Math.round((completed / items.length) * 100)

  async function handleTransition(
    task: LearningTask,
    to: LearningTaskStatus,
    reason: string,
    revisedDueDate: string,
  ) {
    const reasonField = STATUS_REASON_FIELDS[to]
    if (reasonField && !reason.trim()) {
      setError(`请填写${REASON_LABELS[reasonField]}后再提交。`)
      return
    }
    const fp = `${to}|${reason}|${revisedDueDate}`
    const { key } = keyFor(`task-${task.id}-${to}`, fp)
    try {
      await transitionLearningTask(task.id, {
        to_status: to,
        reason: reason || undefined,
        revised_due_date: revisedDueDate || undefined,
        expected_revision: task.revision,
        idempotency_key: key,
      })
      clearKey(`task-${task.id}-${to}`)
      setConflictTask(null)
      await refreshTask(task.id)
      setNotice(`任务已${actionLabel(task, to)}。`)
    } catch (err) {
      const mapped = parseApiErrorDetail(err)
      if (mapped.isConflict) {
        // Keep the unsubmitted input; the server state moved under us.
        clearKey(`task-${task.id}-${to}`)
        setConflictTask(task.id)
        void refreshTask(task.id)
      } else if (mapped.code === 'completion_gate_failed' && mapped.field) {
        setError(
          `完成门禁未满足：需要${GATE_FIELD_LABELS[mapped.field] ?? mapped.field}。`,
        )
      } else {
        // Keep the key: an unchanged retry replays instead of double-writing.
        setError(mapped.message)
      }
    }
  }

  async function handleComplete(
    task: LearningTask,
    fields: {
      completionQuality: string
      reviewConclusion: string
      nextAction: string
    },
  ) {
    const fp = 'complete'
    const { key } = keyFor(`task-${task.id}-已完成`, fp)
    try {
      const updated = await updateLearningTask(
        task.id,
        {
          completion_quality: fields.completionQuality || null,
          review_conclusion: fields.reviewConclusion,
          next_action: fields.nextAction,
        },
        task.revision,
      )
      await transitionLearningTask(updated.id, {
        to_status: '已完成',
        expected_revision: updated.revision,
        idempotency_key: key,
      })
      clearKey(`task-${task.id}-已完成`)
      setConflictTask(null)
      await refreshTask(task.id)
      setNotice('任务已完成，复盘已归档。')
    } catch (err) {
      const mapped = parseApiErrorDetail(err)
      if (mapped.isConflict) {
        clearKey(`task-${task.id}-已完成`)
        setConflictTask(task.id)
        void refreshTask(task.id)
      } else if (mapped.code === 'completion_gate_failed' && mapped.field) {
        setError(
          `完成门禁未满足：需要${GATE_FIELD_LABELS[mapped.field] ?? mapped.field}。`,
        )
      } else {
        setError(mapped.message)
      }
    }
  }

  async function handleCreateLog(
    taskId: number,
    fields: {
      recordDate: string
      hours: number
      note: string
      correctionOfLogId?: number
    },
  ) {
    const fp = `${fields.recordDate}|${fields.hours}|${fields.note}|${fields.correctionOfLogId ?? ''}`
    const { key } = keyFor(`log-${taskId}`, fp)
    try {
      await createProgressLog(taskId, {
        record_date: fields.recordDate,
        actual_hours: fields.hours,
        note: fields.note || undefined,
        idempotency_key: key,
        correction_of_log_id: fields.correctionOfLogId,
      })
      clearKey(`log-${taskId}`)
      await refreshTask(taskId)
      setNotice(
        fields.correctionOfLogId ? '已写入更正日志。' : '进展日志已记录。',
      )
    } catch (err) {
      const mapped = parseApiErrorDetail(err)
      if (mapped.isConflict) {
        clearKey(`log-${taskId}`)
        setError('该日志键已存在；如需调整，请作废后创建更正日志。')
      } else {
        setError(mapped.message)
      }
    }
  }

  async function handleVoidLog(taskId: number, log: ProgressLog) {
    const { key } = keyFor(`void-${log.id}`, 'void')
    try {
      await invalidateProgressLog(log.id, key)
      clearKey(`void-${log.id}`)
      await refreshTask(taskId)
      setNotice('日志已作废，历史保留；可创建更正日志。')
    } catch (err) {
      const mapped = parseApiErrorDetail(err)
      if (mapped.isConflict) {
        clearKey(`void-${log.id}`)
        setError('该日志已被处理，请刷新后查看。')
      } else {
        setError(mapped.message)
      }
    }
  }

  async function handleSaveEvidenceDraft(
    taskId: number,
    evidence: Evidence | null,
    fields: { content: string; description: string; link: string },
    superseded: Evidence | null,
  ): Promise<'saved' | 'conflict' | 'error'> {
    try {
      if (evidence) {
        const updated = await updateEvidence(
          evidence.id,
          {
            content: fields.content || null,
            description: fields.description || null,
            // The edited link travels with the draft; a cleared input must
            // explicitly null the stored link.
            evidence_link: fields.link || null,
          },
          evidence.revision,
        )
        await refreshTask(taskId)
        setNotice(`任务成果证明 v${updated.version_number} 草稿已保存。`)
      } else {
        const created = await createEvidence(taskId, {
          content: fields.content || null,
          description: fields.description || null,
          evidence_link: fields.link || null,
          supersedes_evidence_id: superseded?.id,
        })
        await refreshTask(taskId)
        setNotice(
          superseded
            ? `已创建 v${created.version_number} 新版本（基于需补充版本）。`
            : `任务成果证明 v${created.version_number} 草稿已创建。`,
        )
      }
      return 'saved'
    } catch (err) {
      const mapped = parseApiErrorDetail(err)
      if (mapped.isConflict) {
        // Keep the typed input and the form open; the server revision moved
        // under us. Refresh so the retry uses ONLY the latest revision, and
        // require the user to confirm before resending.
        await refreshTask(taskId).catch(() => undefined)
        setError('任务成果证明已被其他会话更新，请确认后重新保存。')
        return 'conflict'
      }
      // 422/403 and terminal errors: keep the form and the exact input; a
      // later edit must not silently overwrite what the user typed.
      setError(mapped.message)
      return 'error'
    }
  }

  async function handleSubmitEvidence(taskId: number, evidence: Evidence) {
    try {
      await submitEvidence(evidence.id)
      await refreshTask(taskId)
      setNotice(`任务成果证明 v${evidence.version_number} 已提交评审。`)
    } catch (err) {
      setError(parseApiErrorDetail(err).message)
    }
  }

  if (loading) return <p className="muted">加载中…</p>

  return (
    <section className="page">
      <header className="page-heading">
        <div>
          <p className="eyebrow">我的计划 / 年度闭环</p>
          <h1>年度成长计划</h1>
          <p className="muted">
            {year} 年度 · {plan?.plan_cycle ?? 12} 个月周期 ·{' '}
            {plan?.status ?? '制定中'}
          </p>
        </div>
        <div>
          {items.length === 0 && (
            <p className="muted">
              暂无计划项：请在评估页勾选提升项并显式生成所选学习任务。
            </p>
          )}
          <a
            href="/growth/review/monthly"
            style={{ marginLeft: 'var(--space-3)' }}
          >
            查看月度复盘
          </a>
        </div>
      </header>
      {plan?.source_assessment_id != null && (
        <p className="muted">
          来源：评估 #{plan.source_assessment_id}
          {plan.source_standard_version_label
            ? ` · ${plan.source_standard_version_label}`
            : ''}
          {plan.planning_source_type === 'assessment_approval'
            ? ' · 显式选择生成'
            : ''}
        </p>
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {notice && (
        <p className="success" role="status">
          {notice}
        </p>
      )}
      {conflictTask !== null && (
        <p className="error" role="alert">
          任务数据已更新，请确认后重试。
        </p>
      )}

      {/* Summary cards */}
      <dl className={s.summary} data-testid="plan-summary">
        <div className={s.summaryCard}>
          <dt>总体进度</dt>
          <dd>{progress}%</dd>
          <div className={s.progressBar}>
            <div className={s.progressFill} style={{ width: `${progress}%` }} />
          </div>
        </div>
        <div className={s.summaryCard}>
          <dt>预计时长</dt>
          <dd>
            {totalEstimated}
            {hasUnparsedHours && '（部分计划项耗时为文本，未计入汇总）'}
          </dd>
        </div>
        <div className={s.summaryCard}>
          <dt>实际时长</dt>
          <dd>{totalActual} h</dd>
        </div>
        <div className={s.summaryCard}>
          <dt>已完成</dt>
          <dd>
            {completed}/{items.length}
          </dd>
        </div>
      </dl>

      {/* Monthly timeline */}
      <div className={s.timeline} data-testid="month-timeline">
        {MONTHS.map((m) => {
          const count = items.filter((i) => monthOf(i) === m).length
          return (
            <button
              key={m}
              className={`${s.timelineBtn} ${selectedMonth === m ? s.timelineBtnActive : ''}`}
              onClick={() => setSelectedMonth(selectedMonth === m ? null : m)}
              aria-pressed={selectedMonth === m}
            >
              <span className={s.timelineBtnMonth}>{m} 月</span>
              <span className={s.timelineBtnCount}>{count} 项</span>
            </button>
          )
        })}
      </div>

      {/* Filters: month timeline + status / priority / domain, combinable */}
      <div className={s.filterRow}>
        <label htmlFor="status-filter">状态筛选</label>
        <select
          id="status-filter"
          aria-label="状态筛选"
          value={statusFilter}
          onChange={(event) =>
            setStatusFilter(event.target.value as PlanItemStatus | '全部状态')
          }
        >
          <option value="全部状态">全部状态</option>
          {Object.keys(STATUS_LABELS).map((st) => (
            <option key={st} value={st}>
              {st}
            </option>
          ))}
        </select>
        <label htmlFor="priority-filter">优先级筛选</label>
        <select
          id="priority-filter"
          aria-label="优先级筛选"
          value={priorityFilter}
          onChange={(event) =>
            setPriorityFilter(
              event.target.value as '全部优先级' | '高' | '中' | '低',
            )
          }
        >
          <option value="全部优先级">全部优先级</option>
          <option value="高">高</option>
          <option value="中">中</option>
          <option value="低">低</option>
        </select>
        <label htmlFor="domain-filter">能力域筛选</label>
        <select
          id="domain-filter"
          aria-label="能力域筛选"
          value={domainFilter}
          onChange={(event) => setDomainFilter(event.target.value)}
        >
          <option value="全部能力域">全部能力域</option>
          {DOMAIN_OPTIONS.map((d) => (
            <option key={d} value={d}>
              {d}
            </option>
          ))}
        </select>
      </div>

      {/* Plan items */}
      <div className={s.planList}>
        <div
          className={`${s.planHeader} ${s.planHeaderLabel}`}
          style={{
            cursor: 'default',
            borderBottom: '2px solid var(--color-gray-200)',
          }}
        >
          <strong>二级能力标准 → 三级达成路径</strong>
          <strong>掌握度提升</strong>
          <strong>计划时长</strong>
          <strong>实际时长</strong>
          <strong>月份</strong>
          <strong>状态</strong>
          <span />
        </div>
        {visibleItems.length === 0 && (
          <p className="muted">
            {selectedMonth
              ? `${selectedMonth} 月暂无计划项`
              : hasActiveFilters
                ? '该筛选条件下暂无计划项'
                : '暂无计划项，请先生成年度计划。'}
          </p>
        )}
        {visibleItems.map((item) => {
          const td = tasks[item.id]
          const isExpanded = expandedId === item.id
          const st = item.status
          return (
            <div className={s.planItem} key={item.id} data-testid="plan-item">
              <div
                className={s.planHeader}
                data-testid="plan-header"
                onClick={() => setExpandedId(isExpanded ? null : item.id)}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    setExpandedId(isExpanded ? null : item.id)
                  }
                }}
              >
                <div>
                  <span className={s.l3name}>{formatCapabilityPath(item)}</span>
                </div>
                <span>
                  {item.current_level}→{item.target_level}
                </span>
                <span>
                  {formatEstimatedHours(
                    item.estimated_hours,
                    item.estimated_hours_parsed,
                  )}
                </span>
                <span>{td ? td.task.actual_hours : 0} h</span>
                <span>
                  {item.plan_month ??
                    (item.target_month ? `${item.target_month} 月` : '—')}
                </span>
                <span className={`${s.status} ${statusClass(st)}`}>
                  {STATUS_LABELS[st] ?? st}
                </span>
                <span>{isExpanded ? '▾' : '▸'}</span>
              </div>
              {isExpanded && td && (
                <TaskExecutionPanel
                  item={item}
                  year={year}
                  detail={td}
                  onTransition={(to, reason, date) =>
                    void handleTransition(td.task, to, reason, date)
                  }
                  onComplete={(fields) => void handleComplete(td.task, fields)}
                  onCreateLog={(fields) =>
                    void handleCreateLog(td.task.id, fields)
                  }
                  onVoidLog={(log) => void handleVoidLog(td.task.id, log)}
                  onSaveEvidence={(evidence, fields, superseded) =>
                    handleSaveEvidenceDraft(
                      td.task.id,
                      evidence,
                      fields,
                      superseded,
                    )
                  }
                  onSaveDates={(fields) => handleSaveDates(item, fields)}
                  onSubmitEvidence={(evidence) =>
                    void handleSubmitEvidence(td.task.id, evidence)
                  }
                />
              )}
              {isExpanded && !td && (
                <div className={s.taskPanel}>
                  <p className="muted">暂无任务执行数据。</p>
                </div>
              )}
            </div>
          )
        })}
      </div>
    </section>
  )
}

type PanelProps = {
  item: PlanItem
  year: number
  detail: TaskDetail
  onTransition: (
    to: LearningTaskStatus,
    reason: string,
    revisedDueDate: string,
  ) => void
  onComplete: (fields: {
    completionQuality: string
    reviewConclusion: string
    nextAction: string
  }) => void
  onCreateLog: (fields: {
    recordDate: string
    hours: number
    note: string
    correctionOfLogId?: number
  }) => void
  onVoidLog: (log: ProgressLog) => void
  onSaveEvidence: (
    evidence: Evidence | null,
    fields: { content: string; description: string; link: string },
    superseded: Evidence | null,
  ) => Promise<'saved' | 'conflict' | 'error'>
  onSubmitEvidence: (evidence: Evidence) => void
  onSaveDates: (fields: {
    plan_start_date: string | null
    plan_end_date: string | null
  }) => Promise<'saved' | 'conflict' | 'error'>
}

function TaskExecutionPanel({
  item,
  year,
  detail,
  onTransition,
  onComplete,
  onCreateLog,
  onVoidLog,
  onSaveEvidence,
  onSubmitEvidence,
  onSaveDates,
}: PanelProps) {
  const { task, logs, evidences, reviews } = detail
  const [actionTo, setActionTo] = useState<LearningTaskStatus | null>(null)
  const [reason, setReason] = useState('')
  const [revisedDueDate, setRevisedDueDate] = useState('')
  const [completionQuality, setCompletionQuality] = useState('')
  const [reviewConclusion, setReviewConclusion] = useState('')
  const [nextAction, setNextAction] = useState('')
  const [logDate, setLogDate] = useState('')
  const [logHours, setLogHours] = useState('')
  const [logNote, setLogNote] = useState('')
  const [correctionOfLogId, setCorrectionOfLogId] = useState<number | null>(
    null,
  )
  const [confirmVoidId, setConfirmVoidId] = useState<number | null>(null)
  const [evidenceContent, setEvidenceContent] = useState('')
  const [evidenceDescription, setEvidenceDescription] = useState('')
  const [evidenceLink, setEvidenceLink] = useState('')
  const [newVersionOf, setNewVersionOf] = useState<Evidence | null>(null)
  const [creatingDraft, setCreatingDraft] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [panelError, setPanelError] = useState('')
  // Plan-item schedule editing: only these two dates are editable, seeded
  // once from the item so a refresh (e.g. after a 409) never wipes input.
  const [startDate, setStartDate] = useState(item.plan_start_date ?? '')
  const [endDate, setEndDate] = useState(item.plan_end_date ?? '')
  const [savingDates, setSavingDates] = useState(false)

  const draft = evidences.find((e) => e.status === '草稿') ?? null
  const needMore = evidences.filter((e) => e.status === '需补充')
  const hasPendingReview = evidences.some((e) => e.status === '待 Review')
  const taskIsClosed = ['已完成', '暂停', '取消'].includes(task.status)
  const reviewByVersion = new Map(reviews.map((r) => [r.version_number, r]))

  function beginAction(to: LearningTaskStatus) {
    setActionTo(actionTo === to ? null : to)
    setReason('')
    setRevisedDueDate('')
    setCompletionQuality('')
    setReviewConclusion('')
    setNextAction('')
  }

  function confirmAction() {
    if (!actionTo) return
    if (actionTo === '已完成') {
      onComplete({ completionQuality, reviewConclusion, nextAction })
      return
    }
    onTransition(actionTo, reason, revisedDueDate)
  }

  const reasonField = actionTo ? STATUS_REASON_FIELDS[actionTo] : undefined
  const allowedActions = TASK_TRANSITIONS[task.status]

  function submitLog() {
    const hours = Number(logHours)
    if (!logDate || !Number.isInteger(hours) || hours < 1 || hours > 24) {
      setPanelError('日志需要记录日期，时长须为 1–24 的整数。')
      return
    }
    setPanelError('')
    onCreateLog({
      recordDate: logDate,
      hours,
      note: logNote,
      correctionOfLogId: correctionOfLogId ?? undefined,
    })
  }

  // Mirrors the server rules: start <= due; both dates inside the source
  // quarter; due inside the source plan month when one is present. ISO strings
  // compare lexically.
  function validateDates(start: string, end: string): string | null {
    if (start && end && start > end) {
      return '计划开始日期不得晚于计划结束日期。'
    }
    const month = monthOf(item)
    const pad = (n: number) => String(n).padStart(2, '0')
    if (month != null) {
      if (
        end &&
        !(
          end >= `${year}-${pad(month)}-01` &&
          end <=
            `${year}-${pad(month)}-${pad(new Date(year, month, 0).getDate())}`
        )
      ) {
        return '计划结束日期需保持在来源计划月内。'
      }
    }
    const quarter =
      item.plan_quarter ??
      (month != null
        ? (`Q${Math.floor((month - 1) / 3) + 1}` as 'Q1' | 'Q2' | 'Q3' | 'Q4')
        : null)
    if (quarter != null) {
      const qStart = { Q1: 1, Q2: 4, Q3: 7, Q4: 10 }[quarter]
      if (qStart != null) {
        const qFirst = `${year}-${pad(qStart)}-01`
        const qLast = `${year}-${pad(qStart + 2)}-${pad(new Date(year, qStart + 2, 0).getDate())}`
        if (start && !(start >= qFirst && start <= qLast)) {
          return '计划开始日期需保持在来源季度内。'
        }
        if (month == null && end && !(end >= qFirst && end <= qLast)) {
          return '计划结束日期需保持在来源季度内。'
        }
      }
    }
    return null
  }

  async function saveDates() {
    const validationError = validateDates(startDate, endDate)
    if (validationError) {
      setPanelError(validationError)
      return
    }
    setPanelError('')
    setSavingDates(true)
    await onSaveDates({
      plan_start_date: startDate || null,
      plan_end_date: endDate || null,
    })
    setSavingDates(false)
  }

  return (
    <div className={s.taskPanel} data-testid="task-detail-panel">
      <div className={s.taskGrid}>
        <div className={s.taskField}>
          <span>任务状态</span>
          <strong>{task.status}</strong>
        </div>
        <div className={s.taskField}>
          <span>实际耗时</span>
          <strong>{task.actual_hours} h</strong>
        </div>
        <div className={s.taskField}>
          <span>计划开始日期</span>
          <input
            aria-label="计划开始日期"
            type="date"
            value={startDate}
            onChange={(event) => setStartDate(event.target.value)}
          />
        </div>
        <div className={s.taskField}>
          <span>计划结束日期</span>
          <input
            aria-label="计划结束日期"
            type="date"
            value={endDate}
            onChange={(event) => setEndDate(event.target.value)}
          />
        </div>
        <div className={s.taskField}>
          <span />
          <button
            type="button"
            onClick={() => void saveDates()}
            disabled={savingDates}
          >
            保存日期
          </button>
        </div>
        <div className={s.taskField}>
          <span>学习材料</span>
          <strong>{item.learning_material ?? '—'}</strong>
        </div>
        <div className={s.taskField}>
          <span>任务内容</span>
          <strong>{item.learning_task_content ?? '—'}</strong>
        </div>
        <div className={s.taskField}>
          <span>预期输出</span>
          <strong>{item.expected_output ?? '—'}</strong>
        </div>
        <div className={s.taskField}>
          <span>优先级</span>
          <strong>{item.priority}</strong>
        </div>
        <div className={s.taskField}>
          <span>来源评估</span>
          <strong>
            {item.source_assessment_id != null
              ? `评估 #${item.source_assessment_id}`
              : '—'}
          </strong>
        </div>
        <div className={s.taskField}>
          <span>计划季度</span>
          <strong>{item.plan_quarter ?? '—'}</strong>
        </div>
        <div className={s.taskField}>
          <span>计划月份</span>
          {/* plan_month is 'YYYY-MM' (Issue #194) — display as-is. */}
          <strong>{item.plan_month ?? '—'}</strong>
        </div>
        <div className={s.taskField}>
          <span>来源类型</span>
          <strong>
            {item.planning_source_type === 'assessment_approval'
              ? '显式选择生成'
              : '—'}
          </strong>
        </div>
        <div className={s.taskField}>
          <span>评估版本</span>
          <strong>{item.assessment_revision ?? '—'}</strong>
        </div>
        <div className={s.taskField}>
          <span>纳入计划</span>
          <strong>
            {item.include_in_plan == null
              ? '—'
              : item.include_in_plan
                ? '是'
                : '否'}
          </strong>
        </div>
        <div className={s.taskField}>
          <span>实际开始时间</span>
          <strong>{formatDateTime(task.actual_started_at)}</strong>
        </div>
        <div className={s.taskField}>
          <span>完成时间</span>
          <strong>{formatDateTime(task.actual_completed_at)}</strong>
        </div>
        <div className={s.taskField}>
          <span>修订截止日期</span>
          <strong>{task.revised_due_date ?? '—'}</strong>
        </div>
        <div className={s.taskField}>
          <span>延期原因</span>
          <strong>{task.delay_reason || '—'}</strong>
        </div>
        <div className={s.taskField}>
          <span>暂停原因</span>
          <strong>{task.pause_reason || '—'}</strong>
        </div>
        <div className={s.taskField}>
          <span>取消原因</span>
          <strong>{task.cancel_reason || '—'}</strong>
        </div>
        <div className={s.taskField}>
          <span>复盘结论</span>
          <strong>{task.review_conclusion || '待补充'}</strong>
        </div>
        <div className={s.taskField}>
          <span>下一步行动</span>
          <strong>{task.next_action || '待补充'}</strong>
        </div>
        <div className={s.taskField}>
          <span>完成质量</span>
          <strong>{task.completion_quality || '待补充'}</strong>
        </div>
      </div>

      {/* Conditional actions */}
      {allowedActions.length > 0 && (
        <div className={s.actions}>
          {allowedActions.map((to) => (
            <button key={to} type="button" onClick={() => beginAction(to)}>
              {actionLabel(task, to)}
            </button>
          ))}
        </div>
      )}
      {panelError && (
        <p className="error" role="alert">
          {panelError}
        </p>
      )}

      {actionTo && actionTo !== '已完成' && (
        <form
          className={s.actionForm}
          onSubmit={(event) => {
            event.preventDefault()
            confirmAction()
          }}
        >
          {reasonField && (
            <label>
              {REASON_LABELS[reasonField]}
              <textarea
                aria-label={REASON_LABELS[reasonField]}
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                placeholder={`填写${REASON_LABELS[reasonField]}（必填）`}
              />
            </label>
          )}
          {actionTo === '延期' && (
            <label>
              修订截止日期
              <input
                type="date"
                aria-label="修订截止日期"
                value={revisedDueDate}
                onChange={(event) => setRevisedDueDate(event.target.value)}
              />
            </label>
          )}
          <div className={s.actions}>
            <button type="submit">{CONFIRM_LABELS[actionTo]}</button>
            <button type="button" onClick={() => setActionTo(null)}>
              取消操作
            </button>
          </div>
        </form>
      )}

      {actionTo === '已完成' && (
        <form
          className={s.actionForm}
          onSubmit={(event) => {
            event.preventDefault()
            confirmAction()
          }}
        >
          <label>
            复盘结论
            <textarea
              aria-label="复盘结论"
              value={reviewConclusion}
              onChange={(event) => setReviewConclusion(event.target.value)}
              placeholder="回顾执行过程、产出与收获"
            />
          </label>
          <label>
            完成质量
            <select
              aria-label="完成质量"
              value={completionQuality}
              onChange={(event) => setCompletionQuality(event.target.value)}
            >
              <option value="">请选择</option>
              {COMPLETION_QUALITY_VALUES.map((q) => (
                <option key={q} value={q}>
                  {q}
                </option>
              ))}
            </select>
          </label>
          <label>
            下一步行动
            <input
              aria-label="下一步行动"
              maxLength={200}
              value={nextAction}
              onChange={(event) => setNextAction(event.target.value)}
              placeholder="接下来的具体行动（200 字内）"
            />
          </label>
          <div className={s.actions}>
            <button type="submit">确认完成</button>
            <button type="button" onClick={() => setActionTo(null)}>
              取消操作
            </button>
          </div>
        </form>
      )}

      {/* Progress logs */}
      <div className={s.logSection}>
        <h4>学习日志（{task.actual_hours} h，服务端聚合）</h4>
        <ul className={s.logList}>
          {logs.length === 0 && <li className="muted">暂无日志。</li>}
          {logs.map((log) => (
            <li
              key={log.id}
              className={`${s.logItem} ${log.invalidated_at ? s.logVoided : ''}`}
            >
              <span className={s.logDate}>{log.record_date}</span>
              <span className={s.logHours}>{log.actual_hours} h</span>
              <span className={s.logNote}>
                {log.note ?? ''}
                {log.invalidated_at && <em>（已作废）</em>}
                {log.correction_of_log_id && (
                  <em>（更正 #{log.correction_of_log_id}）</em>
                )}
              </span>
              {!log.invalidated_at && (
                <span className={s.logActions}>
                  {confirmVoidId === log.id ? (
                    <>
                      <button
                        type="button"
                        onClick={() => {
                          setConfirmVoidId(null)
                          onVoidLog(log)
                        }}
                      >
                        确认作废
                      </button>
                      <button
                        type="button"
                        onClick={() => setConfirmVoidId(null)}
                      >
                        取消
                      </button>
                    </>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setConfirmVoidId(log.id)}
                    >
                      作废
                    </button>
                  )}
                </span>
              )}
              {log.invalidated_at && (
                <button
                  type="button"
                  onClick={() => {
                    setLogDate(log.record_date)
                    setLogHours(String(log.actual_hours))
                    setLogNote(log.note ?? '')
                    setCorrectionOfLogId(log.id)
                  }}
                >
                  更正
                </button>
              )}
            </li>
          ))}
        </ul>
        {correctionOfLogId !== null && (
          <p className="muted">基于已作废日志 #{correctionOfLogId} 更正</p>
        )}
        <form
          className={s.actionForm}
          onSubmit={(event) => {
            event.preventDefault()
            submitLog()
          }}
        >
          <label>
            记录日期
            <input
              type="date"
              aria-label="记录日期"
              value={logDate}
              onChange={(event) => setLogDate(event.target.value)}
            />
          </label>
          <label>
            本次时长（小时）
            <input
              type="number"
              min={1}
              max={24}
              aria-label="本次时长（小时）"
              value={logHours}
              onChange={(event) => setLogHours(event.target.value)}
            />
          </label>
          <label>
            备注
            <input
              aria-label="备注"
              value={logNote}
              onChange={(event) => setLogNote(event.target.value)}
            />
          </label>
          <div className={s.actions}>
            <button type="submit">记录进展</button>
          </div>
        </form>
      </div>

      {/* Evidence versions */}
      <div className={s.logSection}>
        <h4>任务成果证明（版本链，历史只读）</h4>
        {evidences.length === 0 && <p className="muted">暂无任务成果证明。</p>}
        {evidences.map((ev) => {
          const review = reviewByVersion.get(ev.version_number)
          return (
            <div key={ev.id} className={s.logItem}>
              <span className={s.logDate}>v{ev.version_number}</span>
              <span className={s.logNote}>
                {ev.content?.slice(0, 80) ?? '—'}
                {ev.supersedes_evidence_id && (
                  <em>
                    （取代 v{evsVersion(evidences, ev.supersedes_evidence_id)}）
                  </em>
                )}
              </span>
              {evBadge(ev)}
              {ev.evidence_link && (
                <a
                  href={ev.evidence_link}
                  target="_blank"
                  rel="noreferrer"
                  style={{ fontSize: 'var(--text-xs)' }}
                >
                  链接
                </a>
              )}
              {review?.conclusion && (
                <span className={s.reviewFeedback}>
                  {review.conclusion}：{review.feedback}
                </span>
              )}
              {ev.status === '草稿' && (
                <span className={s.logActions}>
                  <button
                    type="button"
                    onClick={() => {
                      setEvidenceContent(ev.content ?? '')
                      setEvidenceDescription(ev.description ?? '')
                      setEvidenceLink(ev.evidence_link ?? '')
                      setNewVersionOf(null)
                      setCreatingDraft(true)
                    }}
                  >
                    编辑草稿
                  </button>
                  <button type="button" onClick={() => onSubmitEvidence(ev)}>
                    提交评审
                  </button>
                </span>
              )}
              {ev.status === '需补充' && (
                <span className={s.logActions}>
                  <button
                    type="button"
                    onClick={() => {
                      setEvidenceContent('')
                      setEvidenceDescription('')
                      setEvidenceLink('')
                      setNewVersionOf(ev)
                      setCreatingDraft(true)
                    }}
                  >
                    创建新版本
                  </button>
                </span>
              )}
            </div>
          )
        })}
        {taskIsClosed && (
          <p className="muted">
            任务已结束。如需继续提交任务成果证明，请创建新任务或调整计划。
          </p>
        )}
        {!taskIsClosed &&
          !draft &&
          needMore.length === 0 &&
          !hasPendingReview && (
            <div className={s.actions}>
              <button
                type="button"
                onClick={() => {
                  setEvidenceContent('')
                  setEvidenceDescription('')
                  setEvidenceLink('')
                  setNewVersionOf(null)
                  setCreatingDraft(true)
                }}
              >
                新建草稿
              </button>
            </div>
          )}
        {creatingDraft && (
          <form
            className={s.actionForm}
            onSubmit={(event) => {
              event.preventDefault()
              if (submitting) return
              setSubmitting(true)
              onSaveEvidence(
                draft && !newVersionOf ? draft : null,
                {
                  content: evidenceContent,
                  description: evidenceDescription,
                  link: evidenceLink,
                },
                newVersionOf,
              )
                .then((result) => {
                  // Only a confirmed save closes the form; conflicts and
                  // validation errors keep it open with the typed input.
                  if (result === 'saved') setCreatingDraft(false)
                })
                .finally(() => setSubmitting(false))
            }}
          >
            {newVersionOf && (
              <p className="muted">
                基于需补充版本 v{newVersionOf.version_number}{' '}
                创建新版本，旧版本保持只读。
              </p>
            )}
            <label>
              任务成果证明 内容
              <textarea
                aria-label="任务成果证明 内容"
                value={evidenceContent}
                onChange={(event) => setEvidenceContent(event.target.value)}
                placeholder="说明完成了什么、如何验证"
              />
            </label>
            <label>
              补充描述
              <input
                aria-label="补充描述"
                value={evidenceDescription}
                onChange={(event) => setEvidenceDescription(event.target.value)}
              />
            </label>
            <label>
              证据链接
              <input
                aria-label="证据链接"
                value={evidenceLink}
                onChange={(event) => setEvidenceLink(event.target.value)}
              />
            </label>
            <div className={s.actions}>
              <button disabled={submitting} type="submit">
                保存草稿
              </button>
              <button
                type="button"
                onClick={() => {
                  setCreatingDraft(false)
                  setNewVersionOf(null)
                }}
              >
                取消
              </button>
            </div>
          </form>
        )}
      </div>

      {/* Transition history */}
      {detail.history.length > 0 && (
        <div className={s.logSection}>
          <h4>任务流转历史</h4>
          <ul className={s.logList}>
            {detail.history.map((h) => (
              <li key={h.id} className={s.logItem}>
                <span className={s.logDate}>
                  {h.from_status} → {h.to_status}
                </span>
                <span className={s.logNote}>
                  {h.reason ?? '—'} · {formatDateTime(h.occurred_at)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}

function evsVersion(evidences: Evidence[], id: number): number {
  const target = evidences.find((e) => e.id === id)
  return target?.version_number ?? id
}

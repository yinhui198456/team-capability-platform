import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { newIdempotencyKey } from './assessment'
import s from './AnnualPlanTaskPage.module.css'
import { useYear } from './YearContext'
import {
  COMPLETION_QUALITY_VALUES,
  STATUS_REASON_FIELDS,
  TASK_TRANSITIONS,
  createEvidence,
  createProgressLog,
  decideRequirementChange,
  getAnnualPlan,
  getLearningTask,
  invalidateProgressLog,
  listEvidenceReviewsForTask,
  listChangeProposals,
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
  type ChangeProposal,
  type Evidence,
  type EvidenceReviewRecord,
  type LearningTask,
  type LearningTaskStatus,
  type PlanItem,
  type ProgressLog,
  type TransitionHistoryItem,
} from './planning'

// Issue #194: plan_month 'YYYY-MM' is the canonical month source (the
// filter/display key); legacy rows fall back to target_month.
function monthOf(item: PlanItem): number | null {
  if (typeof item.plan_month === 'string') {
    return Number(item.plan_month.slice(5, 7))
  }
  return item.plan_month ?? item.target_month
}
// Issue #194 P1 复审修正：未排期组（无 plan_month 的遗留项）的选中令牌，
// 与真实月份 1–12 区分——null 表示用户收起全部，undefined 表示数据未到达。
const UNSCHEDULED_MONTH = 0
const STATUS_LABELS: Record<string, string> = {
  未开始: '未开始',
  进行中: '进行中',
  已完成: '已完成',
  延期: '延期',
  暂停: '暂停',
  取消: '取消',
}
// Issue #194 P1 复审修正：原型 M03 V1 month-card-head 的简短状态摘要，
// 由组内计划项真实状态聚合（不虚构）。
function monthStatusSummary(monthItems: PlanItem[]): string {
  const counts: Record<string, number> = {}
  for (const item of monthItems) {
    const label = STATUS_LABELS[item.status] ?? item.status
    counts[label] = (counts[label] ?? 0) + 1
  }
  const order = ['已完成', '进行中', '延期', '暂停', '未开始', '取消']
  const parts = order
    .filter((label) => counts[label])
    .map((label) => `${label} ${counts[label]}`)
  return parts.length > 0 ? parts.join(' · ') : '未开始'
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

const TASK_DETAIL_TABS = ['logs', 'outputs', 'evidence'] as const
type TaskDetailTab = (typeof TASK_DETAIL_TABS)[number]
const TASK_DETAIL_TAB_LABELS: Record<TaskDetailTab, string> = {
  logs: '学习记录',
  outputs: '阶段产出',
  evidence: '提交成果',
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

// Exact M03 V1 source geometry from prototype-v1's Df/Hn/Bf/Bn icons.
function PrototypeSummaryIcon({
  kind,
}: {
  kind: 'document' | 'check' | 'refresh' | 'clock'
}) {
  const common = {
    className: s.summaryIcon,
    'data-testid': 'plan-summary-icon',
    'aria-hidden': true,
    focusable: 'false',
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 2,
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
  } as const

  if (kind === 'document') {
    return (
      <svg {...common}>
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
        <polyline points="14 2 14 8 20 8" />
        <line x1="16" y1="13" x2="8" y2="13" />
        <line x1="16" y1="17" x2="8" y2="17" />
        <polyline points="10 9 9 9 8 9" />
      </svg>
    )
  }
  if (kind === 'check') {
    return (
      <svg {...common}>
        <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
        <polyline points="22 4 12 14.01 9 11.01" />
      </svg>
    )
  }
  if (kind === 'refresh') {
    return (
      <svg {...common}>
        <polyline points="23 4 23 10 17 10" />
        <polyline points="1 20 1 14 7 14" />
        <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
      </svg>
    )
  }
  return (
    <svg {...common}>
      <circle cx="12" cy="12" r="10" />
      <polyline points="12 6 12 12 16 14" />
    </svg>
  )
}

// Exact M03 V1 source geometry from prototype-v1's ke, th and te icons.
function PrototypeArrowIcon() {
  return (
    <svg
      aria-hidden="true"
      className={s.actionIcon}
      data-testid="plan-continue-icon"
      fill="none"
      focusable="false"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={2}
      viewBox="0 0 24 24"
    >
      <line x1="5" y1="12" x2="19" y2="12" />
      <polyline points="12 5 19 12 12 19" />
    </svg>
  )
}

function PrototypeMonthChevron({ expanded }: { expanded: boolean }) {
  return (
    <svg
      aria-hidden="true"
      className={`${s.monthChevron} ${expanded ? s.monthChevronUp : ''}`}
      data-direction={expanded ? 'up' : 'down'}
      data-testid="month-card-toggle-icon"
      fill="none"
      focusable="false"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={2}
      viewBox="0 0 24 24"
    >
      <polyline points={expanded ? '6 9 12 15 18 9' : '9 18 15 12 9 6'} />
    </svg>
  )
}

export function AnnualPlanTaskPage({ taskId }: { taskId?: number }) {
  const year = useYear()
  const [plan, setPlan] = useState<AnnualPlan | null>(null)
  const [tasks, setTasks] = useState<Record<number, TaskDetail>>({})
  const [taskByItem, setTaskByItem] = useState<Record<number, LearningTask>>({})
  const [proposals, setProposals] = useState<ChangeProposal[]>([])
  const proposalScope = `${year}:${taskId ?? ''}`
  const [proposalState, setProposalState] = useState<
    'loading' | 'loaded' | 'error'
  >(taskId == null ? 'loaded' : 'loading')
  const [loadedProposalScope, setLoadedProposalScope] = useState(
    taskId == null ? proposalScope : '',
  )
  const [proposalReload, setProposalReload] = useState(0)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [loading, setLoading] = useState(true)
  // Issue #194 P1 复审修正：选定原型 M03 V1 默认仅展开一个月卡。
  // undefined = 数据未到达（首次默认尚未应用）；number/UNSCHEDULED_MONTH =
  // 展开该月卡；null = 用户主动收起全部。不得把 null 回退解释为全展开。
  const [selectedMonth, setSelectedMonth] = useState<number | null | undefined>(
    undefined,
  )
  const [conflictTask, setConflictTask] = useState<number | null>(null)
  const [detailTab, setDetailTab] = useState<TaskDetailTab>('logs')
  const taskTabRefs = useRef<Record<TaskDetailTab, HTMLButtonElement | null>>({
    logs: null,
    outputs: null,
    evidence: null,
  })

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

  function indexTasks(plan: AnnualPlan | null, taskList: LearningTask[]) {
    const itemIds = new Set((plan?.items ?? []).map((item) => item.id))
    setTaskByItem(
      Object.fromEntries(
        taskList
          .filter((task) => itemIds.has(task.plan_item_id))
          .map((task) => [task.plan_item_id, task]),
      ),
    )
  }

  async function reloadPlan() {
    const [p, taskList] = await Promise.all([
      getAnnualPlan(year),
      listLearningTasks(),
    ])
    setPlan(p)
    indexTasks(p, taskList)
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
        indexTasks(p, taskList)
        if (taskId != null) {
          const requested = taskList.find((task) => task.id === taskId)
          const itemIds = new Set((p?.items ?? []).map((item) => item.id))
          if (!requested || !itemIds.has(requested.plan_item_id)) {
            throw new Error('任务不属于当前年度计划')
          }
          const detail = await loadTaskDetail(taskId)
          if (cancelled) return
          setTasks({ [detail.task.plan_item_id]: detail })
        }
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
  }, [year, taskId])

  useEffect(() => {
    if (taskId == null) {
      setProposalState('loaded')
      setLoadedProposalScope(proposalScope)
      return
    }
    let cancelled = false
    setProposalState('loading')
    void listChangeProposals(year).then(
      (next) => {
        if (cancelled) return
        setProposals(next)
        setProposalState('loaded')
        setLoadedProposalScope(proposalScope)
      },
      () => {
        if (!cancelled) {
          setProposalState('error')
          setLoadedProposalScope(proposalScope)
        }
      },
    )
    return () => {
      cancelled = true
    }
  }, [year, taskId, proposalReload, proposalScope])

  const items = plan?.items ?? []
  // Issue #194 P1: 权威原型 M03 V1 按月份纵向分组（月份 marker + 月度卡片 +
  // 组内计划项）。只渲染仍有计划项的月份——空月份不伪造业务项；无月份的
  // 遗留项归入末尾无 marker 分组，不丢弃。
  const monthGroups = useMemo(() => {
    const groups: Array<{ month: number | null; monthItems: PlanItem[] }> = []
    for (const item of items) {
      const month = monthOf(item)
      const group = groups.find((entry) => entry.month === month)
      if (group) group.monthItems.push(item)
      else groups.push({ month, monthItems: [item] })
    }
    groups.sort((left, right) => (left.month ?? 13) - (right.month ?? 13))
    return groups
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plan?.items])
  // Issue #194 P1 复审修正：数据出现时首次默认展开按时间排序后的第一个非空
  // 月份；之后只由用户点击改变（点其它月只展开目标月，点当前月收起全部）。
  useEffect(() => {
    if (selectedMonth === undefined && monthGroups.length > 0) {
      setSelectedMonth(monthGroups[0].month ?? UNSCHEDULED_MONTH)
    }
  }, [monthGroups, selectedMonth])
  // 定版原型页头动作「继续本月任务」：展开当前自然月所在月卡；当前月无
  // 计划项时退回按时间排序的第一个非空月。
  function continueCurrentMonth() {
    const nowMonth = new Date().getMonth() + 1
    const target =
      monthGroups.find((group) => group.month === nowMonth) ?? monthGroups[0]
    if (target) setSelectedMonth(target.month ?? UNSCHEDULED_MONTH)
  }
  // 原型摘要四项：任务总数/已完成/进行中/逾期（真实计数，不伪造）。
  const completed = items.filter((i) => i.status === '已完成').length
  const active = items.filter((i) => i.status === '进行中').length
  const overdue = items.filter((i) => i.status === '延期').length

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

  async function handleRequirementDecision(
    proposalId: number,
    detailId: number,
    decision: 'adopt_new' | 'keep_original',
    currentTaskId: number,
  ) {
    try {
      await decideRequirementChange(proposalId, detailId, decision)
    } catch (reason) {
      setError(parseApiErrorDetail(reason).message)
      return
    }
    try {
      const [nextDetail, nextProposals] = await Promise.all([
        loadTaskDetail(currentTaskId),
        listChangeProposals(year),
        reloadPlan(),
      ])
      setTasks((previous) => ({
        ...previous,
        [nextDetail.task.plan_item_id]: nextDetail,
      }))
      setProposals(nextProposals)
      setProposalState('loaded')
      setLoadedProposalScope(proposalScope)
      setNotice('任务要求已确认。')
    } catch {
      setProposalState('error')
      setLoadedProposalScope(proposalScope)
      setError('任务要求已确认，但最新要求加载失败，请重新加载要求变化。')
    }
  }

  if (loading) return <p className="muted">加载中…</p>

  if (taskId != null) {
    const detail = Object.values(tasks)[0]
    const item = items.find(
      (candidate) => candidate.id === detail?.task.plan_item_id,
    )
    if (!detail || !item) return <p className="muted">暂无任务执行数据。</p>
    const pendingChanges = proposals.flatMap((proposal) =>
      proposal.details
        .filter(
          (candidate) =>
            candidate.l3_code === item.l3_code &&
            !candidate.requirement_decision,
        )
        .map((change) => ({ proposal, change })),
    )
    return (
      <section className="page annual-plan-page">
        <header className={`page-heading ${s.pageHeader}`}>
          <div>
            <span className={s.eyebrow}>学习任务</span>
            <h1>
              {item.l3_name
                ? `${item.l3_code} · ${item.l3_name}`
                : item.l3_code}
            </h1>
            <p className="muted">
              {detail.task.status} · {item.plan_month ?? '未排期'}
            </p>
          </div>
          <Link to={`/growth/tasks?year=${year}`}>返回学习任务</Link>
        </header>
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
        <section
          aria-labelledby="requirements-title"
          className={s.requirementChange}
          data-testid="task-requirement-change"
        >
          <h2 id="requirements-title">要求变化</h2>
          {loadedProposalScope !== proposalScope ||
          proposalState === 'loading' ? (
            <p className="muted" role="status">
              正在加载任务要求变化…
            </p>
          ) : proposalState === 'error' ? (
            <div>
              <p className="error">任务要求变化加载失败，请重试。</p>
              <button
                type="button"
                onClick={() => setProposalReload((value) => value + 1)}
              >
                重新加载要求变化
              </button>
            </div>
          ) : pendingChanges.length === 0 ? (
            <p className="muted">当前任务没有待确认的能力要求变化。</p>
          ) : (
            pendingChanges.map(({ proposal, change }) => (
              <div
                className={s.pendingRequirement}
                data-testid="pending-requirement"
                key={change.id}
              >
                <strong>能力要求已更新，等待你确认</strong>
                <p>原任务仍可继续；请在提交成果前确认采用方式。</p>
                <button
                  type="button"
                  onClick={() =>
                    void handleRequirementDecision(
                      proposal.id,
                      change.id,
                      'adopt_new',
                      detail.task.id,
                    )
                  }
                >
                  采用新要求
                </button>
                <button
                  type="button"
                  onClick={() =>
                    void handleRequirementDecision(
                      proposal.id,
                      change.id,
                      'keep_original',
                      detail.task.id,
                    )
                  }
                >
                  按原任务要求继续
                </button>
              </div>
            ))
          )}
        </section>
        <div className={s.taskDetailLayout} data-testid="task-detail-layout">
          <aside
            className={s.taskOverview}
            aria-labelledby="task-overview-title"
          >
            <h2 id="task-overview-title">任务概览</h2>
            <dl className={s.taskGrid}>
              <div className={s.taskField}>
                <dt>目标等级</dt>
                <dd>
                  {item.current_level} → {item.target_level}
                </dd>
              </div>
              <div className={s.taskField}>
                <dt>期望产出</dt>
                <dd>{item.expected_output ?? '—'}</dd>
              </div>
              <div className={s.taskField}>
                <dt>累计投入</dt>
                <dd>{detail.task.actual_hours} h</dd>
              </div>
              <div className={s.taskField}>
                <dt>成果材料</dt>
                <dd>
                  {detail.evidences.length
                    ? `${detail.evidences.length} 个版本`
                    : '尚未提交'}
                </dd>
              </div>
            </dl>
          </aside>
          <div className={s.taskWorkspace} data-testid="task-detail-workspace">
            <div
              className={s.taskTabs}
              role="tablist"
              aria-label="任务详情页签"
            >
              {TASK_DETAIL_TABS.map((value, index) => (
                <button
                  key={value}
                  type="button"
                  role="tab"
                  aria-selected={detailTab === value}
                  aria-controls={`task-panel-${value}`}
                  id={`task-tab-${value}`}
                  ref={(node) => {
                    taskTabRefs.current[value] = node
                  }}
                  tabIndex={detailTab === value ? 0 : -1}
                  onClick={() => setDetailTab(value)}
                  onKeyDown={(event) => {
                    const move =
                      event.key === 'ArrowRight'
                        ? 1
                        : event.key === 'ArrowLeft'
                          ? -1
                          : event.key === 'Home'
                            ? -index
                            : event.key === 'End'
                              ? TASK_DETAIL_TABS.length - index - 1
                              : 0
                    if (!move) return
                    event.preventDefault()
                    const next =
                      TASK_DETAIL_TABS[
                        (index + move + TASK_DETAIL_TABS.length) %
                          TASK_DETAIL_TABS.length
                      ]
                    setDetailTab(next)
                    taskTabRefs.current[next]?.focus()
                  }}
                >
                  {TASK_DETAIL_TAB_LABELS[value]}
                </button>
              ))}
            </div>
            <section
              role="tabpanel"
              id={`task-panel-${detailTab}`}
              aria-labelledby={`task-tab-${detailTab}`}
            >
              <TaskExecutionPanel
                item={item}
                year={year}
                detail={detail}
                section={detailTab}
                onTransition={(to, reason, date) =>
                  void handleTransition(detail.task, to, reason, date)
                }
                onComplete={(fields) =>
                  void handleComplete(detail.task, fields)
                }
                onCreateLog={(fields) =>
                  void handleCreateLog(detail.task.id, fields)
                }
                onVoidLog={(log) => void handleVoidLog(detail.task.id, log)}
                onSaveEvidence={(evidence, fields, superseded) =>
                  handleSaveEvidenceDraft(
                    detail.task.id,
                    evidence,
                    fields,
                    superseded,
                  )
                }
                onSaveDates={(fields) => handleSaveDates(item, fields)}
                onSubmitEvidence={(evidence) =>
                  void handleSubmitEvidence(detail.task.id, evidence)
                }
              />
            </section>
          </div>
        </div>
      </section>
    )
  }

  return (
    <section className="page annual-plan-page">
      <header className={`page-heading ${s.pageHeader}`}>
        <div className={s.headerActions}>
          {/* 定版原型 M03 V1 页头：标题 + 说明 */}
          <span className={s.eyebrow}>我的计划</span>
          <h1>月度计划时间轴</h1>
          <p className="muted">按月推进学习任务，持续提升能力。</p>
        </div>
        <div className={s.headerCta}>
          {/* 定版原型页头动作：继续本月任务（展开当前月卡） */}
          <button
            type="button"
            className="primary"
            onClick={continueCurrentMonth}
          >
            继续本月任务 <PrototypeArrowIcon />
          </button>
          {items.length === 0 && (
            <p className="muted">
              暂无计划项：请在评估页勾选提升项并显式生成所选学习任务。
            </p>
          )}
        </div>
      </header>
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

      {/* Summary cards — 定版原型 M03 V1：任务总数/已完成/进行中/逾期 */}
      <dl className={s.summary} data-testid="plan-summary">
        <div className={s.summaryCard}>
          <span
            aria-hidden="true"
            className={`${s.summaryIconWrap} ${s.summaryIconBlue}`}
            data-testid="plan-summary-icon-wrap"
            data-tone="blue"
          >
            <PrototypeSummaryIcon kind="document" />
          </span>
          <div className={s.summaryMetric}>
            <dt>任务总数</dt>
            <dd>{items.length}</dd>
          </div>
        </div>
        <div className={s.summaryCard}>
          <span
            aria-hidden="true"
            className={`${s.summaryIconWrap} ${s.summaryIconGreen}`}
            data-testid="plan-summary-icon-wrap"
            data-tone="green"
          >
            <PrototypeSummaryIcon kind="check" />
          </span>
          <div className={s.summaryMetric}>
            <dt>已完成</dt>
            <dd>{completed}</dd>
          </div>
        </div>
        <div className={s.summaryCard}>
          <span
            aria-hidden="true"
            className={`${s.summaryIconWrap} ${s.summaryIconBlue}`}
            data-testid="plan-summary-icon-wrap"
            data-tone="blue"
          >
            <PrototypeSummaryIcon kind="refresh" />
          </span>
          <div className={s.summaryMetric}>
            <dt>进行中</dt>
            <dd>{active}</dd>
          </div>
        </div>
        <div className={s.summaryCard}>
          <span
            aria-hidden="true"
            className={`${s.summaryIconWrap} ${s.summaryIconRed}`}
            data-testid="plan-summary-icon-wrap"
            data-tone="red"
          >
            <PrototypeSummaryIcon kind="clock" />
          </span>
          <div className={s.summaryMetric}>
            <dt>逾期</dt>
            <dd>{overdue}</dd>
          </div>
        </div>
      </dl>

      {/* Plan items — 权威原型 M03 V1 纵向月度时间轴分组：所有非空月份
          timeline-row 常驻（marker + 月卡头），selectedMonth 只控制哪一个
          月卡展开显示组内计划项；数据出现时默认展开按时间排序的第一个非空
          月份，点击其它月份只展开目标月，点击当前月份收起全部。
          Issue #194: 原型没有状态/优先级/能力域三筛选区，已移除。 */}
      <div className={s.monthTimeline} data-testid="month-timeline">
        {items.length === 0 && (
          <p className="muted">暂无计划项，请先生成年度计划。</p>
        )}
        {monthGroups.map(({ month, monthItems }) => {
          const token = month ?? UNSCHEDULED_MONTH
          const expanded = selectedMonth === token
          return (
            <article
              key={month ?? 'unplanned'}
              className={`${s.timelineRow} ${
                month == null ? s.timelineRowNoMarker : ''
              } ${expanded ? s.timelineRowOpen : ''}`}
            >
              {month != null && (
                <button
                  type="button"
                  className={s.monthMarker}
                  onClick={() =>
                    setSelectedMonth(selectedMonth === token ? null : token)
                  }
                  aria-pressed={selectedMonth === token}
                  aria-label={`${year} 年 ${month} 月，${monthItems.length} 项`}
                >
                  <b>{month} 月</b>
                  <small>
                    {year} 年 · {monthItems.length} 项
                  </small>
                  <i aria-hidden="true" className={s.timelineNode} />
                </button>
              )}
              <div className={s.monthCard}>
                <button
                  type="button"
                  className={s.monthCardHead}
                  onClick={() =>
                    setSelectedMonth(selectedMonth === token ? null : token)
                  }
                  aria-expanded={expanded}
                >
                  <b>
                    {month == null ? '未排期' : `${month} 月任务`}（
                    {monthItems.length} 项）
                  </b>
                  <span>{monthStatusSummary(monthItems)}</span>
                  <PrototypeMonthChevron expanded={expanded} />
                </button>
                {expanded &&
                  monthItems.map((item) => {
                    const st = item.status
                    const task = taskByItem[item.id]
                    const estimated = item.estimated_hours_parsed
                    const progress =
                      task &&
                      estimated?.is_valid &&
                      estimated.min_hours != null &&
                      estimated.min_hours > 0
                        ? Math.round(
                            (task.actual_hours / estimated.min_hours) * 100,
                          )
                        : null
                    // 任务说明或预期输出；两者皆缺时不渲染占位。
                    const output =
                      item.learning_task_content ?? item.expected_output
                    return (
                      <div
                        className={s.planItem}
                        key={item.id}
                        data-testid="plan-item"
                      >
                        {/* 定版原型 simple-row：编码/名称 · 说明 · 状态(+进度)
                            · 计划月份 · 进入任务。Issue #194 R5：外层行不再
                            以 role=button 暴露（避免与内层「进入任务」按钮
                            语义重复）；「进入任务」是唯一可访问入口并承担展开。
                            行身份只显示 L3 code + name，完整上下文见详情面板。 */}
                        <div className={s.planHeader} data-testid="plan-header">
                          <span className={s.taskCode}>
                            {item.l3_name
                              ? `${item.l3_code} · ${item.l3_name}`
                              : item.l3_code}
                          </span>
                          <div className={s.taskDesc}>
                            {output ? (
                              <p className="muted" data-testid="task-output">
                                {output}
                              </p>
                            ) : null}
                          </div>
                          <div className={s.taskStatus}>
                            <span className={`${s.status} ${statusClass(st)}`}>
                              {STATUS_LABELS[st] ?? st}
                            </span>
                            {progress != null && (
                              <span className={s.progressPct}>{progress}%</span>
                            )}
                          </div>
                          <span className={s.taskMonth}>
                            {item.plan_month ??
                              (item.target_month
                                ? `${item.target_month} 月`
                                : '—')}
                          </span>
                          {task ? (
                            <Link
                              to={`/growth/tasks/${task.id}?year=${year}`}
                              aria-label="进入任务"
                            >
                              进入任务
                            </Link>
                          ) : (
                            <span className="muted">暂无任务</span>
                          )}
                        </div>
                      </div>
                    )
                  })}
              </div>
            </article>
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
  section: TaskDetailTab
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
  section,
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
  const showLogs = section === 'logs'
  const showOutputs = section === 'outputs'
  const showEvidence = section === 'evidence'

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
      {showLogs && (
        <>
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
          <details className={s.taskMetadata}>
            <summary>扩展任务信息</summary>
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
          </details>
        </>
      )}

      {/* Evidence versions */}
      {(showOutputs || showEvidence) && (
        <div className={s.logSection}>
          <h4>{showOutputs ? '阶段产出' : '提交成果'}</h4>
          {evidences.length === 0 && (
            <p className="muted">暂无任务成果证明。</p>
          )}
          {evidences.map((ev) => {
            const review = reviewByVersion.get(ev.version_number)
            return (
              <div key={ev.id} className={s.logItem}>
                <span className={s.logDate}>v{ev.version_number}</span>
                <span className={s.logNote}>
                  {ev.content?.slice(0, 80) ?? '—'}
                  {ev.supersedes_evidence_id && (
                    <em>
                      （取代 v{evsVersion(evidences, ev.supersedes_evidence_id)}
                      ）
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
                    {showEvidence && (
                      <button
                        type="button"
                        onClick={() => onSubmitEvidence(ev)}
                      >
                        提交评审
                      </button>
                    )}
                  </span>
                )}
                {showOutputs && ev.status === '需补充' && (
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
          {showOutputs &&
            !taskIsClosed &&
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
                  onChange={(event) =>
                    setEvidenceDescription(event.target.value)
                  }
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
      )}

      {/* Transition history */}
      {showLogs && detail.history.length > 0 && (
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

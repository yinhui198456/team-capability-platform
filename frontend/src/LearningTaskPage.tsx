import { useEffect, useState } from 'react'

import { me, type User } from './access'
import {
  createEvidence,
  createLearningTask,
  createProgressLog,
  deleteProgressLog,
  getAnnualPlan,
  getMonthlyHours,
  listEvidences,
  listLearningTasks,
  listProgressLogs,
  submitEvidence,
  updateEvidence,
  updateLearningTask,
  type AnnualPlan,
  type Evidence,
  type LearningTask,
  type LearningTaskStatus,
  type PlanItem,
  type ProgressLog,
} from './planning'

const LEARNING_TASK_STATUSES: LearningTaskStatus[] = [
  '未开始',
  '进行中',
  '待 Evidence Review',
  '已完成',
  '延期',
  '暂停',
  '取消',
]

type LogFormState = {
  record_date: string
  actual_hours: string
  note: string
}

type EvidenceFormState = {
  evidence_id: number | null
  content: string
  evidence_link: string
}

function emptyLogForm(): LogFormState {
  return { record_date: '', actual_hours: '', note: '' }
}

function emptyEvidenceForm(): EvidenceFormState {
  return { evidence_id: null, content: '', evidence_link: '' }
}

function sumHours(logs: ProgressLog[]): number {
  return logs.reduce((sum, log) => sum + log.actual_hours, 0)
}

function formatDateTime(value: string | null): string {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString('zh-CN')
}

export function LearningTaskPage() {
  const [user, setUser] = useState<User | null>(null)
  const [plan, setPlan] = useState<AnnualPlan | null>(null)
  const [tasks, setTasks] = useState<LearningTask[]>([])
  const [taskLogs, setTaskLogs] = useState<Record<number, ProgressLog[]>>({})
  const [taskEvidences, setTaskEvidences] = useState<
    Record<number, Evidence[]>
  >({})
  const [monthlyHours, setMonthlyHours] = useState<
    { month: number; total_hours: number }[]
  >([])
  const [logForms, setLogForms] = useState<Record<number, LogFormState>>({})
  const [evidenceForms, setEvidenceForms] = useState<
    Record<number, EvidenceFormState>
  >({})
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)

  async function load() {
    setError('')
    try {
      const currentUser = await me()
      setUser(currentUser)

      const [planResult, taskList] = await Promise.all([
        getAnnualPlan(2026).catch(() => null),
        listLearningTasks().catch(() => []),
      ])
      setPlan(planResult)
      setTasks(taskList)

      const initialForms: Record<number, LogFormState> = {}
      const logsEntries = await Promise.all(
        taskList.map(async (task) => {
          initialForms[task.id] = emptyLogForm()
          const logs = await listProgressLogs(task.id).catch(() => [])
          return [task.id, logs] as [number, ProgressLog[]]
        }),
      )
      setLogForms(initialForms)
      setTaskLogs(Object.fromEntries(logsEntries))

      const evidenceEntries = await Promise.all(
        taskList.map(async (task) => {
          const evidences = await listEvidences(task.id).catch(() => [])
          return [task.id, evidences] as [number, Evidence[]]
        }),
      )
      setTaskEvidences(Object.fromEntries(evidenceEntries))

      const summary = await getMonthlyHours(2026).catch(() => [])
      setMonthlyHours(summary)
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载失败')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
  }, [])

  const taskByPlanItemId = new Map(
    tasks.map((task) => [task.plan_item_id, task]),
  )
  const planItems = plan?.items ?? []
  const itemsWithoutTask = planItems.filter(
    (item) => !taskByPlanItemId.has(item.id),
  )

  const canManage = user?.roles.includes('Member') ?? false

  async function handleCreate(item: PlanItem) {
    setError('')
    try {
      await createLearningTask(item.id)
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : '创建失败')
    }
  }

  async function handleUpdate(
    task: LearningTask,
    fields: {
      status?: LearningTaskStatus
      actual_start_date?: string | null
      actual_end_date?: string | null
      actual_hours?: number
      next_action?: string | null
    },
  ) {
    setError('')
    try {
      await updateLearningTask(task.id, fields)
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : '更新失败')
    }
  }

  function setLogForm(taskId: number, patch: Partial<LogFormState>) {
    setLogForms((prev) => ({
      ...prev,
      [taskId]: { ...(prev[taskId] ?? emptyLogForm()), ...patch },
    }))
  }

  async function handleAddLog(task: LearningTask) {
    setError('')
    const form = logForms[task.id] ?? emptyLogForm()
    const hours = Number(form.actual_hours)
    if (!form.record_date || Number.isNaN(hours) || hours < 0) {
      setError('请填写有效的日期和时长')
      return
    }
    try {
      await createProgressLog(task.id, form.record_date, hours, form.note)
      setLogForms((prev) => ({ ...prev, [task.id]: emptyLogForm() }))
      const logs = await listProgressLogs(task.id)
      setTaskLogs((prev) => ({ ...prev, [task.id]: logs }))
      const summary = await getMonthlyHours(2026)
      setMonthlyHours(summary)
    } catch (err) {
      setError(err instanceof Error ? err.message : '添加日志失败')
    }
  }

  async function handleDeleteLog(task: LearningTask, logId: number) {
    setError('')
    try {
      await deleteProgressLog(logId)
      const logs = await listProgressLogs(task.id)
      setTaskLogs((prev) => ({ ...prev, [task.id]: logs }))
      const summary = await getMonthlyHours(2026)
      setMonthlyHours(summary)
    } catch (err) {
      setError(err instanceof Error ? err.message : '删除日志失败')
    }
  }

  function setEvidenceForm(taskId: number, patch: Partial<EvidenceFormState>) {
    setEvidenceForms((prev) => ({
      ...prev,
      [taskId]: { ...(prev[taskId] ?? emptyEvidenceForm()), ...patch },
    }))
  }

  function startCreateEvidence(task: LearningTask) {
    setEvidenceForm(task.id, emptyEvidenceForm())
  }

  function startEditEvidence(task: LearningTask, evidence: Evidence) {
    setEvidenceForm(task.id, {
      evidence_id: evidence.id,
      content: evidence.content ?? '',
      evidence_link: evidence.evidence_link ?? '',
    })
  }

  function cancelEvidenceForm(taskId: number) {
    setEvidenceForms((prev) => {
      const next = { ...prev }
      delete next[taskId]
      return next
    })
  }

  async function handleSaveEvidence(task: LearningTask) {
    setError('')
    const form = evidenceForms[task.id] ?? emptyEvidenceForm()
    try {
      if (form.evidence_id == null) {
        await createEvidence(task.id, form.content, form.evidence_link)
      } else {
        await updateEvidence(form.evidence_id, {
          content: form.content,
          evidence_link: form.evidence_link,
        })
      }
      cancelEvidenceForm(task.id)
      const evidences = await listEvidences(task.id)
      setTaskEvidences((prev) => ({ ...prev, [task.id]: evidences }))
    } catch (err) {
      setError(err instanceof Error ? err.message : '保存 Evidence 失败')
    }
  }

  async function handleSubmitEvidence(task: LearningTask, evidence: Evidence) {
    setError('')
    try {
      await submitEvidence(evidence.id)
      const evidences = await listEvidences(task.id)
      setTaskEvidences((prev) => ({ ...prev, [task.id]: evidences }))
    } catch (err) {
      setError(err instanceof Error ? err.message : '提交 Evidence 失败')
    }
  }

  if (loading) return <p className="muted">加载中…</p>

  return (
    <section className="page">
      <h1>学习任务</h1>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}

      <h2>待创建学习任务的计划项</h2>
      {itemsWithoutTask.length === 0 && (
        <p className="muted">所有计划项均已创建学习任务。</p>
      )}
      <ul className="plan-item-list">
        {itemsWithoutTask.map((item) => (
          <li key={item.id} className="plan-item">
            <span className="plan-item-l3">{item.l3_code}</span>
            <span className="plan-item-levels">
              当前 {item.current_level} → 目标 {item.target_level}
            </span>
            <span className="plan-item-priority">优先级：{item.priority}</span>
            {canManage && (
              <button type="button" onClick={() => handleCreate(item)}>
                创建学习任务
              </button>
            )}
          </li>
        ))}
      </ul>

      <h2>我的学习任务</h2>
      {tasks.length === 0 && <p className="muted">暂无学习任务。</p>}
      <ul className="learning-task-list">
        {tasks.map((task) => (
          <li key={task.id} className="learning-task-item">
            <div className="learning-task-header">
              <span className="learning-task-l3">{task.l3_code}</span>
              <span className="learning-task-levels">
                当前 {task.plan_item_current_level} → 目标{' '}
                {task.plan_item_target_level}
              </span>
              <span className="learning-task-priority">
                优先级：{task.plan_item_priority}
              </span>
            </div>
            <div className="learning-task-fields">
              <label>
                状态
                <select
                  value={task.status}
                  onChange={(event) =>
                    handleUpdate(task, {
                      status: event.target.value as LearningTaskStatus,
                    })
                  }
                  disabled={!canManage}
                >
                  {LEARNING_TASK_STATUSES.map((status) => (
                    <option key={status} value={status}>
                      {status}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                实际开始日期
                <input
                  type="date"
                  value={task.actual_start_date ?? ''}
                  onChange={(event) =>
                    handleUpdate(task, {
                      actual_start_date: event.target.value || null,
                    })
                  }
                  disabled={!canManage}
                />
              </label>
              <label>
                实际完成日期
                <input
                  type="date"
                  value={task.actual_end_date ?? ''}
                  onChange={(event) =>
                    handleUpdate(task, {
                      actual_end_date: event.target.value || null,
                    })
                  }
                  disabled={!canManage}
                />
              </label>
              <label>
                实际耗时（小时）
                <input
                  type="number"
                  min={0}
                  value={task.actual_hours}
                  onChange={(event) =>
                    handleUpdate(task, {
                      actual_hours: Number(event.target.value),
                    })
                  }
                  disabled={!canManage}
                />
              </label>
              <label>
                下步动作
                <input
                  value={task.next_action ?? ''}
                  onChange={(event) =>
                    handleUpdate(task, { next_action: event.target.value })
                  }
                  disabled={!canManage}
                />
              </label>
            </div>

            <div className="progress-log-section">
              <h3>学习日志</h3>
              <p className="muted">
                总时长：{sumHours(taskLogs[task.id] ?? [])} 小时
              </p>
              <ul className="progress-log-list">
                {(taskLogs[task.id] ?? []).map((log) => (
                  <li key={log.id} className="progress-log-item">
                    <span className="progress-log-date">{log.record_date}</span>
                    <span className="progress-log-hours">
                      {log.actual_hours} 小时
                    </span>
                    {log.note && (
                      <span className="progress-log-note">{log.note}</span>
                    )}
                    {canManage && (
                      <button
                        type="button"
                        onClick={() => handleDeleteLog(task, log.id)}
                      >
                        删除
                      </button>
                    )}
                  </li>
                ))}
              </ul>
              {canManage && (
                <div className="progress-log-form">
                  <label>
                    日期
                    <input
                      type="date"
                      value={logForms[task.id]?.record_date ?? ''}
                      onChange={(event) =>
                        setLogForm(task.id, { record_date: event.target.value })
                      }
                    />
                  </label>
                  <label>
                    时长（小时）
                    <input
                      type="number"
                      min={0}
                      value={logForms[task.id]?.actual_hours ?? ''}
                      onChange={(event) =>
                        setLogForm(task.id, {
                          actual_hours: event.target.value,
                        })
                      }
                    />
                  </label>
                  <label>
                    备注
                    <input
                      value={logForms[task.id]?.note ?? ''}
                      onChange={(event) =>
                        setLogForm(task.id, { note: event.target.value })
                      }
                    />
                  </label>
                  <button type="button" onClick={() => handleAddLog(task)}>
                    添加日志
                  </button>
                </div>
              )}
            </div>

            <div className="evidence-section">
              <h3>Evidence</h3>
              <ul className="evidence-list">
                {(taskEvidences[task.id] ?? []).map((evidence) => (
                  <li key={evidence.id} className="evidence-item">
                    <div className="evidence-header">
                      <span className="evidence-version">
                        版本 {evidence.version_number}
                      </span>
                      <span className="evidence-status">{evidence.status}</span>
                      {evidence.submitted_at && (
                        <span className="evidence-submitted">
                          提交于 {formatDateTime(evidence.submitted_at)}
                        </span>
                      )}
                    </div>
                    <p className="evidence-content">{evidence.content}</p>
                    {evidence.evidence_link && (
                      <p className="evidence-link">
                        链接：
                        <a
                          href={evidence.evidence_link}
                          target="_blank"
                          rel="noreferrer"
                        >
                          {evidence.evidence_link}
                        </a>
                      </p>
                    )}
                    {canManage && evidence.status === '草稿' && (
                      <div className="evidence-actions">
                        <button
                          type="button"
                          onClick={() => startEditEvidence(task, evidence)}
                        >
                          编辑
                        </button>
                        <button
                          type="button"
                          onClick={() => handleSubmitEvidence(task, evidence)}
                        >
                          提交
                        </button>
                      </div>
                    )}
                  </li>
                ))}
              </ul>
              {canManage &&
                !(taskEvidences[task.id] ?? []).some(
                  (evidence) => evidence.status === '草稿',
                ) && (
                  <>
                    {evidenceForms[task.id] ? (
                      <div className="evidence-form">
                        <label>
                          提交内容
                          <input
                            value={evidenceForms[task.id]?.content ?? ''}
                            onChange={(event) =>
                              setEvidenceForm(task.id, {
                                content: event.target.value,
                              })
                            }
                          />
                        </label>
                        <label>
                          证据链接
                          <input
                            value={evidenceForms[task.id]?.evidence_link ?? ''}
                            onChange={(event) =>
                              setEvidenceForm(task.id, {
                                evidence_link: event.target.value,
                              })
                            }
                          />
                        </label>
                        <button
                          type="button"
                          onClick={() => handleSaveEvidence(task)}
                        >
                          保存
                        </button>
                        <button
                          type="button"
                          onClick={() => cancelEvidenceForm(task.id)}
                        >
                          取消
                        </button>
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={() => startCreateEvidence(task)}
                      >
                        新增版本
                      </button>
                    )}
                  </>
                )}
            </div>
          </li>
        ))}
      </ul>

      <h2>月度时长</h2>
      {monthlyHours.length === 0 && (
        <p className="muted">2026 年暂无学习时长记录。</p>
      )}
      <ul className="monthly-hours-list">
        {monthlyHours.map((item) => (
          <li key={item.month} className="monthly-hours-item">
            <span className="month">{item.month} 月</span>
            <span className="total-hours">{item.total_hours} 小时</span>
          </li>
        ))}
      </ul>
    </section>
  )
}

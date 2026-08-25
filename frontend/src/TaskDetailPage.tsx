import { useEffect, useRef, useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import {
  createEvidence,
  createProgressLog,
  decideTaskRequirement,
  getLearningTask,
  learningTaskMonth,
  learningTaskProgress,
  learningTaskStatusLabel,
  listEvidences,
  listProgressLogs,
  parseApiErrorDetail,
  submitEvidence,
  updateEvidence,
  type Evidence,
  type LearningTask,
  type ProgressLog,
} from './planning'
import { newIdempotencyKey } from './assessment'

type Tab = '学习记录' | '阶段产出' | '提交成果'
export function TaskDetailPage() {
  const { taskId } = useParams()
  const [params] = useSearchParams()
  const id = Number(taskId)
  const validTaskId = Number.isFinite(id) && Number.isInteger(id)
  const [task, setTask] = useState<LearningTask | null>(null)
  const [loadedTaskId, setLoadedTaskId] = useState<number | null>(null)
  const [logs, setLogs] = useState<ProgressLog[]>([])
  const [evidences, setEvidences] = useState<Evidence[]>([])
  const [tab, setTab] = useState<Tab>('学习记录')
  const [notice, setNotice] = useState('')
  const [error, setError] = useState('')
  const [content, setContent] = useState('')
  const [hours, setHours] = useState('')
  const [date, setDate] = useState('')
  const [output, setOutput] = useState('')
  const [link, setLink] = useState('')
  const logKey = useRef<string | null>(null)
  const loadSequence = useRef(0)
  const [savingLog, setSavingLog] = useState(false)
  async function load(preserveInput = false) {
    const sequence = ++loadSequence.current
    let next: LearningTask
    let nextLogs: ProgressLog[]
    let nextEvidence: Evidence[]
    try {
      ;[next, nextLogs, nextEvidence] = await Promise.all([
        getLearningTask(id),
        listProgressLogs(id),
        listEvidences(id),
      ])
    } catch (err) {
      if (sequence !== loadSequence.current) return
      throw err
    }
    if (sequence !== loadSequence.current) return
    setTask(next)
    setLoadedTaskId(id)
    setLogs(nextLogs)
    setEvidences(nextEvidence)
    const draft = nextEvidence.find((evidence) => evidence.status === '草稿')
    if (draft && !preserveInput) {
      setOutput(draft.content ?? '')
      setLink(draft.evidence_link ?? '')
    }
  }
  useEffect(() => {
    setTask(null)
    setLoadedTaskId(null)
    setLogs([])
    setEvidences([])
    setError('')
    if (validTaskId)
      void load().catch(() => {
        setLoadedTaskId(id)
        setError('任务加载失败，请重试。')
      })
    return () => {
      loadSequence.current += 1
    }
  }, [id, validTaskId])
  if (!validTaskId)
    return (
      <p className="error" role="alert">
        任务标识无效，请返回学习任务列表后重试。
      </p>
    )
  const currentTask = loadedTaskId === id ? task : null
  if (error && !currentTask)
    return (
      <p className="error" role="alert">
        {error}
      </p>
    )
  if (!currentTask) return <p className="muted">正在加载任务…</p>
  const loadedTask = currentTask
  const taskProgress = learningTaskProgress(currentTask)
  const canonicalPlan =
    currentTask.plan_item_plan_month?.match(/^(\d{4})-\d{2}$/)
  const planYear = canonicalPlan?.[1] ?? params.get('year') ?? ''
  const planMonth = learningTaskMonth(currentTask)
  const change = loadedTask.requirement_change
  const context = new URLSearchParams()
  ;['search', 'status'].forEach((key) => {
    const value = params.get(key)
    if (value) context.set(key, value)
  })
  context.set('year', planYear)
  if (planMonth != null) context.set('month', String(planMonth))
  context.set('l3_code', loadedTask.l3_code)
  context.set('plan_item_id', String(loadedTask.plan_item_id))
  context.set('task_id', String(loadedTask.id))
  async function choose(choice: 'adopt_new' | 'continue_current') {
    if (!change) return
    try {
      await decideTaskRequirement(
        loadedTask.id,
        change.proposal_detail_id,
        choice,
        change.decision?.revision ?? 0,
      )
      await load(true)
      setNotice('要求版本选择已保存。')
      setError('')
    } catch (err) {
      const mapped = parseApiErrorDetail(err)
      if (mapped.isConflict) await load(true).catch(() => undefined)
      setError(
        mapped.isConflict
          ? '要求选择已被其他会话更新，请确认当前状态。'
          : mapped.message,
      )
    }
  }
  async function saveLog() {
    if (savingLog) return
    logKey.current ??= newIdempotencyKey()
    setSavingLog(true)
    try {
      await createProgressLog(loadedTask.id, {
        record_date: date,
        actual_hours: Number(hours),
        note: content || undefined,
        idempotency_key: logKey.current,
      })
      logKey.current = null
      setContent('')
      setHours('')
      setDate('')
      await load()
      setNotice('学习记录已保存。')
      setError('')
    } catch (err) {
      setError(parseApiErrorDetail(err).message)
    } finally {
      setSavingLog(false)
    }
  }
  function latestEvidence() {
    return evidences.reduce<Evidence | null>(
      (latest, evidence) =>
        !latest || evidence.version_number > latest.version_number
          ? evidence
          : latest,
      null,
    )
  }
  async function saveOutput(): Promise<Evidence | null> {
    const latest = latestEvidence()
    if (latest?.status === '待 Review' || latest?.status === '通过') {
      setError(
        latest.status === '待 Review'
          ? '成果已提交评审，等待处理后再创建新版本。'
          : '成果已通过，无需再次提交。',
      )
      return null
    }
    try {
      const evidence =
        latest?.status === '草稿'
          ? await updateEvidence(
              latest.id,
              { content: output || null, evidence_link: link || null },
              latest.revision,
            )
          : await createEvidence(loadedTask.id, {
              content: output || null,
              evidence_link: link || null,
              supersedes_evidence_id:
                latest?.status === '需补充' ? latest.id : undefined,
            })
      await load(true)
      setNotice('阶段产出草稿已保存。')
      setError('')
      return evidence
    } catch (err) {
      const mapped = parseApiErrorDetail(err)
      if (mapped.isConflict) await load(true).catch(() => undefined)
      setError(mapped.message)
      return null
    }
  }
  async function submit() {
    if (change) {
      setError('请先确认任务要求版本；已填写成果说明不会清空。')
      return
    }
    try {
      const evidence = await saveOutput()
      if (!evidence) return
      await submitEvidence(evidence.id)
      await load(true)
      setNotice('成果已提交评审。')
      setError('')
    } catch (err) {
      setError(parseApiErrorDetail(err).message)
    }
  }
  return (
    <section className="page">
      <p>
        <Link to={`/growth/tasks?${context}`}>学习任务</Link> /{' '}
        {loadedTask.l3_code}
      </p>
      <header className="page-heading">
        <div>
          <p className="eyebrow">学习任务 / {loadedTask.l3_code}</p>
          <h1>{loadedTask.l3_name ?? loadedTask.l3_code}</h1>
          <p className="muted">
            计划月份：{planYear}年{String(planMonth ?? '').padStart(2, '0')}月 ·
            当前进度 {taskProgress == null ? '待计算' : `${taskProgress}%`}
          </p>
        </div>
        <span
          aria-label={`任务状态：${learningTaskStatusLabel(loadedTask.status)}`}
          className={`status-pill status-${loadedTask.status}`}
          role="status"
        >
          {learningTaskStatusLabel(loadedTask.status)}
        </span>
      </header>
      {change && (
        <section className="growth-requirement-change" role="status">
          <strong>能力要求已更新，等待你确认</strong>
          <p>原任务仍可继续；系统不会自动替换要求或丢失已记录内容。</p>
          <p>
            新要求：{change.proposed.expected_output ?? '—'}；验收要求：
            {change.proposed.notes ?? '—'}
          </p>
          <button onClick={() => void choose('adopt_new')}>采用新要求</button>
          <button onClick={() => void choose('continue_current')}>
            按原任务要求继续
          </button>
        </section>
      )}
      <div className="growth-task-detail-grid">
        <section
          aria-labelledby="growth-task-overview-heading"
          className="growth-task-overview"
        >
          <h2 id="growth-task-overview-heading">任务概览</h2>
          <p>
            当前生效要求：
            {loadedTask.effective_requirement?.expected_output ??
              loadedTask.plan_item_expected_output ??
              '—'}
          </p>
          <p>验收要求：{loadedTask.effective_requirement?.notes ?? '—'}</p>
          <p>
            累计投入：{loadedTask.actual_hours} 小时 · 成果材料：
            {evidences.map((evidence) => evidence.status).join('、') ||
              '尚未提交'}
          </p>
          {taskProgress == null ? (
            '进度待计算'
          ) : (
            <>
              <progress
                aria-label="任务真实进度"
                value={taskProgress}
                max="100"
              />{' '}
              {taskProgress}%
            </>
          )}
        </section>
        <section aria-label="任务执行" className="growth-task-work">
          <div className="growth-task-tabs">
            {(['学习记录', '阶段产出', '提交成果'] as Tab[]).map((value) => (
              <button
                key={value}
                type="button"
                aria-pressed={tab === value}
                onClick={() => setTab(value)}
              >
                {value}
              </button>
            ))}
          </div>
          {tab === '学习记录' && (
            <div>
              <label>
                本次学习内容
                <textarea
                  aria-label="本次学习内容"
                  value={content}
                  onChange={(event) => setContent(event.target.value)}
                />
              </label>
              <label>
                投入时长
                <input
                  aria-label="投入时长"
                  type="number"
                  value={hours}
                  onChange={(event) => setHours(event.target.value)}
                />
              </label>
              <label>
                记录日期
                <input
                  aria-label="记录日期"
                  type="date"
                  value={date}
                  onChange={(event) => setDate(event.target.value)}
                />
              </label>
              <button
                type="button"
                disabled={savingLog}
                onClick={() => void saveLog()}
              >
                保存学习记录
              </button>
              <ul>
                {logs.map((log) => (
                  <li key={log.id}>
                    {log.record_date} · {log.actual_hours} 小时 · {log.note}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {tab === '阶段产出' && (
            <div>
              <label>
                阶段产出说明
                <textarea
                  aria-label="阶段产出说明"
                  value={output}
                  onChange={(event) => setOutput(event.target.value)}
                />
              </label>
              <label>
                产出链接
                <input
                  aria-label="产出链接"
                  value={link}
                  onChange={(event) => setLink(event.target.value)}
                />
              </label>
              <button type="button" onClick={() => void saveOutput()}>
                保存阶段产出
              </button>
            </div>
          )}
          {tab === '提交成果' && (
            <div>
              <label>
                成果说明
                <textarea
                  aria-label="成果说明"
                  value={output}
                  onChange={(event) => setOutput(event.target.value)}
                />
              </label>
              <label>
                成果链接
                <input
                  aria-label="成果链接"
                  value={link}
                  onChange={(event) => setLink(event.target.value)}
                />
              </label>
              <button type="button" onClick={() => void submit()}>
                提交成果
              </button>
            </div>
          )}
        </section>
      </div>
      {notice && <p role="status">{notice}</p>}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </section>
  )
}

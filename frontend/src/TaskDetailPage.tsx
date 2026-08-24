import { useEffect, useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import {
  createEvidence,
  createProgressLog,
  decideTaskRequirement,
  getLearningTask,
  listEvidences,
  listProgressLogs,
  parseApiErrorDetail,
  submitEvidence,
  type Evidence,
  type LearningTask,
  type ProgressLog,
} from './planning'

type Tab = '学习记录' | '阶段产出' | '提交成果'
function progress(task: LearningTask) {
  if (task.status === '已完成') return 100
  const hours = Number(task.plan_item_estimated_hours)
  return hours > 0
    ? Math.min(100, Math.round((task.actual_hours / hours) * 100))
    : 0
}

export function TaskDetailPage() {
  const { taskId } = useParams()
  const [params] = useSearchParams()
  const id = Number(taskId)
  const [task, setTask] = useState<LearningTask | null>(null)
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
  async function load() {
    const [next, nextLogs, nextEvidence] = await Promise.all([
      getLearningTask(id),
      listProgressLogs(id),
      listEvidences(id),
    ])
    setTask(next)
    setLogs(nextLogs)
    setEvidences(nextEvidence)
  }
  useEffect(() => {
    if (Number.isInteger(id))
      void load().catch(() => setError('任务加载失败，请重试。'))
  }, [id])
  if (error && !task)
    return (
      <p className="error" role="alert">
        {error}
      </p>
    )
  if (!task) return <p className="muted">正在加载任务…</p>
  const loadedTask = task
  const change = loadedTask.requirement_change
  const context = new URLSearchParams(Object.fromEntries(params))
  context.set('year', params.get('year') ?? '')
  async function choose(choice: 'adopt_new' | 'continue_current') {
    if (!change) return
    try {
      await decideTaskRequirement(
        loadedTask.id,
        change.proposal_detail_id,
        choice,
        change.decision?.revision ?? 0,
      )
      await load()
      setNotice('要求版本选择已保存。')
      setError('')
    } catch (err) {
      setError(
        parseApiErrorDetail(err).isConflict
          ? '要求选择已被其他会话更新，请刷新后确认。'
          : parseApiErrorDetail(err).message,
      )
    }
  }
  async function saveLog() {
    try {
      await createProgressLog(loadedTask.id, {
        record_date: date,
        actual_hours: Number(hours),
        note: content || undefined,
      })
      setContent('')
      setHours('')
      setDate('')
      await load()
      setNotice('学习记录已保存。')
      setError('')
    } catch (err) {
      setError(parseApiErrorDetail(err).message)
    }
  }
  async function saveOutput() {
    try {
      await createEvidence(loadedTask.id, {
        content: output || null,
        evidence_link: link || null,
      })
      setOutput('')
      setLink('')
      await load()
      setNotice('阶段产出草稿已保存。')
      setError('')
    } catch (err) {
      setError(parseApiErrorDetail(err).message)
    }
  }
  async function submit() {
    const draft = evidences.find((evidence) => evidence.status === '草稿')
    if (change) {
      setError('请先确认任务要求版本；已填写成果说明不会清空。')
      return
    }
    try {
      const evidence =
        draft ??
        (await createEvidence(loadedTask.id, {
          content: output || null,
          evidence_link: link || null,
        }))
      await submitEvidence(evidence.id)
      await load()
      setNotice('成果已提交评审。')
      setError('')
    } catch (err) {
      setError(parseApiErrorDetail(err).message)
    }
  }
  return (
    <section className="page">
      <p>
        <Link to={`/growth/tasks?${context}`}>学习任务</Link> / {task.l3_code}
      </p>
      <header className="page-heading">
        <div>
          <p className="eyebrow">学习任务 / {task.l3_code}</p>
          <h1>{task.l3_name ?? task.l3_code}</h1>
          <p className="muted">
            计划月份：{params.get('year')}年
            {String(task.plan_item_target_month ?? '').padStart(2, '0')}月 ·
            当前进度 {progress(task)}% · {task.status}
          </p>
        </div>
      </header>
      {change && (
        <section className="plan-overview" role="status">
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
      <section className="plan-overview">
        <h2>任务概览</h2>
        <p>
          当前生效要求：
          {task.effective_requirement?.expected_output ??
            task.plan_item_expected_output ??
            '—'}
        </p>
        <p>验收要求：{task.effective_requirement?.notes ?? '—'}</p>
        <p>
          累计投入：{task.actual_hours} 小时 · 成果材料：
          {evidences.map((evidence) => evidence.status).join('、') ||
            '尚未提交'}
        </p>
        <progress aria-label="任务真实进度" value={progress(task)} max="100" />{' '}
        {progress(task)}%
      </section>
      <section className="plan-overview">
        <div>
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
            <button type="button" onClick={() => void saveLog()}>
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
      {notice && <p role="status">{notice}</p>}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </section>
  )
}

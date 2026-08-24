import { useEffect, useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import {
  decideTaskRequirement,
  getLearningTask,
  type LearningTask,
} from './planning'

export function TaskDetailPage() {
  const { taskId } = useParams()
  const [params] = useSearchParams()
  const [task, setTask] = useState<LearningTask | null>(null)
  const [error, setError] = useState('')
  const id = Number(taskId)
  useEffect(() => {
    if (Number.isInteger(id))
      getLearningTask(id)
        .then(setTask)
        .catch(() => setError('任务加载失败，请重试。'))
  }, [id])
  if (error)
    return (
      <p className="error" role="alert">
        {error}
      </p>
    )
  if (!task) return <p className="muted">正在加载任务…</p>
  const loadedTask = task
  const change = loadedTask.requirement_change
  async function decide(choice: 'adopt_new' | 'continue_current') {
    if (!change) return
    try {
      await decideTaskRequirement(
        loadedTask.id,
        change.proposal_detail_id,
        choice,
        change.decision?.revision ?? 0,
      )
      setTask(await getLearningTask(loadedTask.id))
    } catch {
      setError('要求选择已被其他会话更新，请确认后重试。')
    }
  }
  return (
    <section className="page">
      <p>
        <Link to={`/growth/tasks?year=${params.get('year') ?? ''}`}>
          学习任务
        </Link>{' '}
        / {task.l3_code}
      </p>
      <header className="page-heading">
        <div>
          <p className="eyebrow">学习任务 / {task.l3_code}</p>
          <h1>任务详情</h1>
          <h2>{task.l3_name ?? task.l3_code}</h2>
          <p className="muted">
            计划月份：{task.plan_item_target_month ?? '—'} 月 · {task.status}
          </p>
        </div>
      </header>
      <section className="plan-overview">
        <h2>任务概览</h2>
        <p>
          当前生效要求：
          {task.effective_requirement?.expected_output ??
            task.plan_item_expected_output ??
            '—'}
        </p>
        {change && (
          <div role="status">
            <strong>能力要求已更新，等待你确认</strong>
            <p>原任务仍可继续；系统不会自动替换要求或丢失已记录内容。</p>
            <button onClick={() => void decide('adopt_new')}>采用新要求</button>
            <button onClick={() => void decide('continue_current')}>
              按原任务要求继续
            </button>
          </div>
        )}
      </section>
      <section className="plan-overview">
        <h2>学习记录</h2>
        <p>日志与 Evidence 草稿可继续保存；提交成果前会核验要求版本选择。</p>
      </section>
    </section>
  )
}

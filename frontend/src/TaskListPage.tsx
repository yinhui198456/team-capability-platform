import { useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { listLearningTasks, type LearningTask } from './planning'
import { useYear } from './YearContext'

export function TaskListPage() {
  const year = useYear()
  const [params, setParams] = useSearchParams()
  const [tasks, setTasks] = useState<LearningTask[]>([])
  const [error, setError] = useState('')
  const search = params.get('search') ?? ''
  const status = params.get('status') ?? ''
  useEffect(() => {
    listLearningTasks(year)
      .then(setTasks)
      .catch(() => setError('学习任务加载失败，请重试。'))
  }, [year])
  const visible = tasks.filter(
    (task) =>
      (!status || task.status === status) &&
      (!search || `${task.l3_code} ${task.l3_name ?? ''}`.includes(search)),
  )
  function update(key: string, value: string) {
    const next = new URLSearchParams(params)
    next.set('year', String(year))
    if (value) next.set(key, value)
    else next.delete(key)
    setParams(next, { replace: true })
  }
  return (
    <section className="page">
      <header className="page-heading">
        <div>
          <p className="eyebrow">我的计划</p>
          <h1>学习任务</h1>
          <p className="muted">
            按状态、月份和能力项定位任务；复杂执行在任务详情中完成。
          </p>
        </div>
      </header>
      <label>
        搜索任务或能力项
        <input
          role="searchbox"
          aria-label="搜索任务或能力项"
          value={search}
          onChange={(event) => update('search', event.target.value)}
        />
      </label>
      <details>
        <summary>筛选</summary>
        <label>
          状态
          <select
            value={status}
            aria-label="任务状态筛选"
            onChange={(event) => update('status', event.target.value)}
          >
            <option value="">全部</option>
            <option>进行中</option>
            <option>未开始</option>
            <option>已完成</option>
            <option>延期</option>
          </select>
        </label>
      </details>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {visible.length === 0 && !error && (
        <p className="muted">当前条件下暂无学习任务。</p>
      )}
      {visible.map((task) => (
        <article className="plan-overview" key={task.id}>
          <small>
            #{task.id} · {task.plan_item_target_month ?? '未安排月份'} 月
          </small>
          <h2>
            {task.l3_code} · {task.l3_name ?? '学习任务'}
          </h2>
          <p>
            {task.plan_item_expected_output ?? '暂未填写期望产出'} ·{' '}
            {task.status}
          </p>
          <Link
            to={`/growth/tasks/${task.id}?${new URLSearchParams({ year: String(year), plan_item_id: String(task.plan_item_id), l3_code: task.l3_code, ...(search ? { search } : {}), ...(status ? { status } : {}) })}`}
          >
            进入任务
          </Link>
        </article>
      ))}
    </section>
  )
}

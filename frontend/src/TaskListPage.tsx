import { useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import {
  listLearningTasks,
  type LearningTask,
  type LearningTaskStatus,
} from './planning'
import { useYear } from './YearContext'

const segments: Array<LearningTaskStatus | ''> = [
  '',
  '进行中',
  '未开始',
  '已完成',
  '延期',
]
function taskProgress(task: LearningTask) {
  if (task.status === '已完成') return 100
  const planned = Number(task.plan_item_estimated_hours)
  return planned > 0
    ? Math.min(100, Math.round((task.actual_hours / planned) * 100))
    : 0
}

export function TaskListPage() {
  const year = useYear()
  const [params, setParams] = useSearchParams()
  const [tasks, setTasks] = useState<LearningTask[]>([])
  const [error, setError] = useState('')
  const search = params.get('search') ?? ''
  const status = params.get('status') ?? ''
  const month = params.get('month') ?? ''
  useEffect(() => {
    listLearningTasks(year)
      .then(setTasks)
      .catch(() => setError('学习任务加载失败，请重试。'))
  }, [year])
  function update(next: Record<string, string>) {
    const query = new URLSearchParams({
      year: String(year),
      ...Object.fromEntries(params),
      ...next,
    })
    Object.entries(next).forEach(([key, value]) => {
      if (!value) query.delete(key)
    })
    setParams(query, { replace: true })
  }
  const visible = tasks.filter(
    (task) =>
      (!month || String(task.plan_item_target_month) === month) &&
      (!status || task.status === status) &&
      (!search || `${task.l3_code} ${task.l3_name ?? ''}`.includes(search)),
  )
  const metric = (value: string) =>
    tasks
      .filter((task) => !month || String(task.plan_item_target_month) === month)
      .filter((task) => !value || task.status === value).length
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
      <dl className="plan-summary">
        <div>
          <dt>全部任务</dt>
          <dd>{metric('')}</dd>
        </div>
        <div>
          <dt>进行中</dt>
          <dd>{metric('进行中')}</dd>
        </div>
        <div>
          <dt>待确认</dt>
          <dd>{tasks.filter((task) => task.requirement_change).length}</dd>
        </div>
        <div>
          <dt>逾期</dt>
          <dd>{metric('延期')}</dd>
        </div>
      </dl>
      <div>
        {segments.map((value) => (
          <button
            key={value || 'all'}
            type="button"
            aria-pressed={status === value}
            onClick={() => update({ status: value })}
          >
            {value || '全部'} {metric(value)}
          </button>
        ))}
      </div>
      <label>
        搜索任务或能力项
        <input
          role="searchbox"
          aria-label="搜索任务或能力项"
          value={search}
          onChange={(event) => update({ search: event.target.value })}
        />
      </label>
      <details>
        <summary>筛选</summary>
        <label>
          计划月份
          <select
            aria-label="计划月份筛选"
            value={month}
            onChange={(event) => update({ month: event.target.value })}
          >
            <option value="">全部月份</option>
            {[
              ...new Set(
                tasks
                  .map((task) => task.plan_item_target_month)
                  .filter((value): value is number => value != null),
              ),
            ]
              .sort()
              .map((value) => (
                <option key={value} value={String(value)}>
                  {year}年{String(value).padStart(2, '0')}月
                </option>
              ))}
          </select>
        </label>
      </details>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {!error && !visible.length && (
        <p className="muted">当前条件下暂无学习任务。</p>
      )}
      {visible.map((task) => (
        <article className="plan-overview" key={task.id}>
          <small>
            {year}年{String(task.plan_item_target_month ?? '').padStart(2, '0')}
            月 · {task.l3_code}
          </small>
          <h2>{task.l3_name ?? task.l3_code}</h2>
          {task.requirement_change && <strong>能力要求已更新 · 待确认</strong>}
          <p>
            {task.plan_item_expected_output ?? '暂未填写期望产出'} ·{' '}
            {task.status}
          </p>
          <progress
            aria-label={`${task.l3_code} 进度`}
            value={taskProgress(task)}
            max="100"
          />{' '}
          {taskProgress(task)}%
          <Link
            to={`/growth/tasks/${task.id}?${new URLSearchParams({ year: String(year), month, search, status, l3_code: task.l3_code, plan_item_id: String(task.plan_item_id), task_id: String(task.id) })}`}
          >
            进入任务
          </Link>
        </article>
      ))}
    </section>
  )
}

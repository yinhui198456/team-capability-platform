import { useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { listLearningTasks, type LearningTask } from './planning'
import { useYear } from './YearContext'

function progress(task: LearningTask) {
  if (task.status === '已完成') return 100
  const hours = Number(task.plan_item_estimated_hours)
  return Number.isFinite(hours) && hours > 0
    ? Math.min(100, Math.round((task.actual_hours / hours) * 100))
    : 0
}

export function AnnualPlanTimelinePage() {
  const year = useYear()
  const [params, setParams] = useSearchParams()
  const [tasks, setTasks] = useState<LearningTask[]>([])
  const [error, setError] = useState('')
  const selected = Number(params.get('month')) || null
  useEffect(() => {
    listLearningTasks(year)
      .then(setTasks)
      .catch(() => setError('年度计划加载失败，请重试。'))
  }, [year])
  const groups = new Map<number, LearningTask[]>()
  tasks.forEach((task) => {
    const month = task.plan_item_target_month
    if (month) groups.set(month, [...(groups.get(month) ?? []), task])
  })
  const metrics = [
    ['任务总数', tasks.length],
    ['已完成', tasks.filter((task) => task.status === '已完成').length],
    ['进行中', tasks.filter((task) => task.status === '进行中').length],
    ['逾期', tasks.filter((task) => task.status === '延期').length],
  ]
  return (
    <section className="page">
      <header className="page-heading">
        <div>
          <p className="eyebrow">我的计划</p>
          <h1>月度计划时间轴</h1>
          <p className="muted">{year} 年 · 按月推进学习任务，持续提升能力。</p>
        </div>
      </header>
      <dl className="plan-summary">
        {metrics.map(([label, value]) => (
          <div key={String(label)}>
            <dt>{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {[...groups.entries()]
        .sort(([a], [b]) => a - b)
        .map(([month, monthTasks]) => {
          const open = selected === month
          const query = new URLSearchParams({
            year: String(year),
            month: String(month),
          })
          return (
            <article className="plan-overview" key={month}>
              <button
                type="button"
                onClick={() =>
                  setParams(
                    open
                      ? { year: String(year) }
                      : { year: String(year), month: String(month) },
                  )
                }
              >
                {year}年{String(month).padStart(2, '0')}月 · {monthTasks.length}{' '}
                个任务
              </button>
              <span className="muted">
                {monthTasks.filter((task) => task.status === '进行中').length
                  ? `进行中 ${monthTasks.filter((task) => task.status === '进行中').length} 个`
                  : '未开始'}
              </span>
              <Link to={`/growth/tasks?${query}`}>查看本月任务</Link>
              {open &&
                monthTasks.map((task) => (
                  <div key={task.id}>
                    <h2>
                      {task.l3_code} · {task.l3_name ?? task.l3_code}
                    </h2>
                    {task.requirement_change && (
                      <strong>要求已更新 · 待确认</strong>
                    )}
                    <p>
                      {task.status} ·{' '}
                      <progress
                        aria-label={`${task.l3_code} 进度`}
                        value={progress(task)}
                        max="100"
                      />{' '}
                      {progress(task)}%
                    </p>
                    <Link
                      to={`/growth/tasks/${task.id}?${new URLSearchParams({ year: String(year), month: String(month), l3_code: task.l3_code, plan_item_id: String(task.plan_item_id), task_id: String(task.id) })}`}
                    >
                      进入任务
                    </Link>
                  </div>
                ))}
            </article>
          )
        })}
    </section>
  )
}

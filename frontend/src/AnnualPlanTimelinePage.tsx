import { useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { FiCheckCircle, FiClock, FiFileText, FiRefreshCw } from 'react-icons/fi'
import {
  learningTaskMonth,
  learningTaskProgress,
  learningTaskStatusLabel,
  listLearningTasks,
  type LearningTask,
} from './planning'
import { useYear } from './YearContext'

export function AnnualPlanTimelinePage() {
  const year = useYear()
  const [params, setParams] = useSearchParams()
  const [tasks, setTasks] = useState<LearningTask[]>([])
  const [loadedYear, setLoadedYear] = useState<number | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const selected = Number(params.get('month')) || null
  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError('')
    setTasks([])
    setLoadedYear(null)
    listLearningTasks(year)
      .then((next) => {
        if (cancelled) return
        setTasks(next)
        setLoadedYear(year)
      })
      .catch(() => {
        if (!cancelled) {
          setError('年度计划加载失败，请重试。')
          setLoadedYear(year)
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [year])
  const yearTasks = loadedYear === year ? tasks : []
  const isLoading = loading || loadedYear !== year
  const taskListQuery = new URLSearchParams({ year: String(year) })
  if (selected) taskListQuery.set('month', String(selected))
  const status = params.get('status')
  if (status) taskListQuery.set('status', status)
  const groups = new Map<number, LearningTask[]>()
  yearTasks.forEach((task) => {
    const month = learningTaskMonth(task)
    if (month) groups.set(month, [...(groups.get(month) ?? []), task])
  })
  const metrics = [
    { label: '任务总数', value: yearTasks.length, Icon: FiFileText },
    {
      label: '已完成',
      value: yearTasks.filter((task) => task.status === '已完成').length,
      Icon: FiCheckCircle,
      tone: 'success',
    },
    {
      label: '进行中',
      value: yearTasks.filter((task) => task.status === '进行中').length,
      Icon: FiRefreshCw,
    },
    {
      label: '逾期',
      value: yearTasks.filter((task) => task.status === '延期').length,
      Icon: FiClock,
      tone: 'danger',
    },
  ]
  return (
    <section className="page">
      <header className="page-heading">
        <div>
          <p className="eyebrow">我的计划</p>
          <h1>月度计划时间轴</h1>
          <p className="muted">按月推进学习任务，持续提升能力。</p>
        </div>
        <Link className="primary-link" to={`/growth/tasks?${taskListQuery}`}>
          查看任务列表
        </Link>
      </header>
      {!isLoading && (
        <section
          aria-label="计划指标"
          className="annual-plan-summary metric-card-grid"
        >
          {metrics.map(({ label, value, Icon, tone }) => (
            <article
              className={`metric-card${tone ? ` metric-card-${tone}` : ''}`}
              key={label}
            >
              <span aria-hidden="true" className="metric-icon">
                <Icon className="metric-card-icon" />
              </span>
              <div>
                <span>{label}</span>
                <strong>{value}</strong>
              </div>
            </article>
          ))}
        </section>
      )}
      {!isLoading && error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {isLoading && <p className="muted">年度计划加载中…</p>}
      {!isLoading && !error && groups.size === 0 && (
        <p className="muted">本年度暂无学习任务。</p>
      )}
      {!isLoading && !error && (
        <section className="growth-timeline" aria-label="年度任务时间轴">
          {Array.from({ length: 12 }, (_, index) => index + 1).map((month) => {
            const monthTasks = groups.get(month) ?? []
            const open = selected === month
            const query = new URLSearchParams({
              year: String(year),
              month: String(month),
            })
            return (
              <div
                className={`growth-timeline-row${open ? ' is-open' : ''}`}
                key={month}
              >
                <button
                  aria-controls={`growth-month-${month}`}
                  aria-expanded={open}
                  aria-label={`${year}年${String(month).padStart(2, '0')}月`}
                  className="growth-month-marker"
                  type="button"
                  onClick={() =>
                    setParams(
                      open
                        ? { year: String(year) }
                        : { year: String(year), month: String(month) },
                    )
                  }
                >
                  <small>{year}年</small>
                  <strong>{String(month).padStart(2, '0')}月</strong>
                </button>
                <article
                  className="growth-month-card"
                  id={`growth-month-${month}`}
                >
                  <div className="growth-month-card-head">
                    <span>
                      {monthTasks.length
                        ? `${monthTasks.length} 个任务`
                        : '暂无安排'}
                    </span>
                    <Link to={`/growth/tasks?${query}`}>查看本月任务</Link>
                  </div>
                  {open &&
                    (monthTasks.length ? (
                      <div className="growth-month-task-list">
                        {monthTasks.map((task) => {
                          const progress = learningTaskProgress(task)
                          return (
                            <div
                              className="growth-month-task-row"
                              key={task.id}
                            >
                              <div>
                                <h2>
                                  {task.l3_code} ·{' '}
                                  {task.l3_name ?? task.l3_code}
                                </h2>
                                {task.requirement_change && (
                                  <strong>要求已更新 · 待确认</strong>
                                )}
                              </div>
                              <p>
                                {learningTaskStatusLabel(task.status)} ·{' '}
                                {progress == null ? (
                                  '进度待计算'
                                ) : (
                                  <>
                                    <progress
                                      aria-label={`${task.l3_code} 进度`}
                                      value={progress}
                                      max="100"
                                    />{' '}
                                    {progress}%
                                  </>
                                )}
                              </p>
                              <Link
                                to={`/growth/tasks/${task.id}?${new URLSearchParams({ year: String(year), month: String(month), l3_code: task.l3_code, plan_item_id: String(task.plan_item_id), task_id: String(task.id) })}`}
                              >
                                进入任务
                              </Link>
                            </div>
                          )
                        })}
                      </div>
                    ) : (
                      <p className="muted growth-month-empty">
                        本月暂无学习任务。
                      </p>
                    ))}
                </article>
              </div>
            )
          })}
        </section>
      )}
    </section>
  )
}

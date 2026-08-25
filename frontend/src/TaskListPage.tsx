import { useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { FiAlertCircle, FiClock, FiList, FiRefreshCw } from 'react-icons/fi'
import {
  listLearningTasks,
  learningTaskMonth,
  learningTaskProgress,
  learningTaskStatusLabel,
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
export function TaskListPage() {
  const year = useYear()
  const [params, setParams] = useSearchParams()
  const [tasks, setTasks] = useState<LearningTask[]>([])
  const [loadedYear, setLoadedYear] = useState<number | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const search = params.get('search') ?? ''
  const status = params.get('status') ?? ''
  const month = params.get('month') ?? ''
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
          setError('学习任务加载失败，请重试。')
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
  const visible = yearTasks.filter(
    (task) =>
      (!month || String(learningTaskMonth(task)) === month) &&
      (!status || task.status === status) &&
      (!search || `${task.l3_code} ${task.l3_name ?? ''}`.includes(search)),
  )
  const metric = (value: string) =>
    yearTasks
      .filter((task) => !month || String(learningTaskMonth(task)) === month)
      .filter((task) => !value || task.status === value).length
  return (
    <section className="page">
      <header className="page-heading">
        <div>
          <p className="eyebrow">我的计划</p>
          <h1>学习任务</h1>
          <p className="muted">
            按状态、月份和能力域定位任务；复杂执行都在任务详情中完成。
          </p>
        </div>
      </header>
      {!isLoading && (
        <section
          aria-label="计划指标"
          className="annual-plan-summary metric-card-grid"
        >
          {[
            { label: '全部任务', value: metric(''), Icon: FiList },
            { label: '进行中', value: metric('进行中'), Icon: FiRefreshCw },
            {
              label: '待确认',
              value: yearTasks.filter(
                (task) =>
                  (!month || String(learningTaskMonth(task)) === month) &&
                  task.requirement_change,
              ).length,
              Icon: FiAlertCircle,
              tone: 'warning',
            },
            {
              label: '逾期',
              value: metric('延期'),
              Icon: FiClock,
              tone: 'danger',
            },
          ].map(({ label, value, Icon, tone }) => (
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
      {!isLoading && (
        <form
          aria-label="任务筛选"
          className="growth-task-filters"
          onSubmit={(event) => event.preventDefault()}
        >
          <div
            aria-label="任务状态"
            className="growth-task-status"
            role="group"
          >
            {segments.map((value) => (
              <button
                key={value || 'all'}
                type="button"
                aria-pressed={status === value}
                onClick={() => update({ status: value })}
              >
                {value ? learningTaskStatusLabel(value) : '全部'}{' '}
                {metric(value)}
              </button>
            ))}
          </div>
          <label className="growth-task-search">
            搜索任务或能力项
            <input
              role="searchbox"
              aria-label="搜索任务或能力项"
              value={search}
              onChange={(event) => update({ search: event.target.value })}
            />
          </label>
          <details className="growth-task-filter-entry">
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
                    yearTasks
                      .map(learningTaskMonth)
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
        </form>
      )}
      {!isLoading && error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {isLoading && <p className="muted">学习任务加载中…</p>}
      {!isLoading && !error && !visible.length && (
        <p className="muted">当前条件下暂无学习任务。</p>
      )}
      {!isLoading && !error && visible.length > 0 && (
        <div className="growth-task-list">
          {visible.map((task) => {
            const progress = learningTaskProgress(task)
            return (
              <article
                className={`growth-task-card${task.requirement_change ? ' has-requirement-change' : ''}`}
                key={task.id}
              >
                <div className="growth-task-card-main">
                  <small>
                    {year}年
                    {String(learningTaskMonth(task) ?? '').padStart(2, '0')}月 ·{' '}
                    {task.l3_code}
                  </small>
                  <h2>{task.l3_name ?? task.l3_code}</h2>
                  {task.requirement_change && (
                    <strong>能力要求已更新 · 待确认</strong>
                  )}
                  <p>
                    {task.plan_item_expected_output ?? '暂未填写期望产出'} ·{' '}
                    {learningTaskStatusLabel(task.status)}
                  </p>
                  {progress == null ? (
                    <span>进度待计算</span>
                  ) : (
                    <p>
                      <progress
                        aria-label={`${task.l3_code} 进度`}
                        value={progress}
                        max="100"
                      />{' '}
                      {progress}%
                    </p>
                  )}
                </div>
                <div className="growth-task-card-actions">
                  <Link
                    to={`/growth/tasks/${task.id}?${new URLSearchParams({ year: String(year), month, search, status, l3_code: task.l3_code, plan_item_id: String(task.plan_item_id), task_id: String(task.id) })}`}
                  >
                    进入任务
                  </Link>
                </div>
              </article>
            )
          })}
        </div>
      )}
    </section>
  )
}

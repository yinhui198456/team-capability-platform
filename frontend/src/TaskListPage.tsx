import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  ClockCircleOutlined,
  ExclamationCircleOutlined,
  PlayCircleOutlined,
  UnorderedListOutlined,
} from '@ant-design/icons'
import {
  getAnnualPlan,
  listChangeProposals,
  listLearningTasks,
  type LearningTask,
  type PlanItem,
} from './planning'
import { useYear } from './YearContext'

type TaskRow = { task: LearningTask; item: PlanItem; pending: boolean }
type TaskFilter = '全部' | Exclude<LearningTask['status'], '延期'> | '逾期'

const statusOrder: Record<string, number> = { 进行中: 0, 未开始: 1 }
const statusFilters: TaskFilter[] = [
  '全部',
  '进行中',
  '未开始',
  '已完成',
  '逾期',
]

function sortTasks(rows: TaskRow[]): TaskRow[] {
  return [...rows].sort((left, right) => {
    const status =
      (statusOrder[left.task.status] ?? 2) -
      (statusOrder[right.task.status] ?? 2)
    if (status) return status
    const month = (left.item.plan_month ?? '9999-99').localeCompare(
      right.item.plan_month ?? '9999-99',
    )
    return month || left.item.id - right.item.id || left.task.id - right.task.id
  })
}

function progress(task: LearningTask, item: PlanItem): string | null {
  const estimated = item.estimated_hours_parsed
  return estimated?.is_valid &&
    estimated.min_hours != null &&
    estimated.min_hours > 0
    ? `${Math.round((task.actual_hours / estimated.min_hours) * 100)}%`
    : null
}

export function TaskListPage() {
  const year = useYear()
  const [rows, setRows] = useState<TaskRow[]>([])
  const [query, setQuery] = useState('')
  const [status, setStatus] = useState<TaskFilter>('全部')
  const [month, setMonth] = useState('')
  const [domain, setDomain] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true)
      setError('')
      try {
        const [plan, tasks, proposals] = await Promise.all([
          getAnnualPlan(year),
          listLearningTasks(),
          listChangeProposals(year),
        ])
        if (cancelled) return
        const items = new Map(
          (plan?.items ?? []).map((item) => [item.id, item]),
        )
        const pendingCodes = new Set(
          proposals.flatMap((proposal) =>
            proposal.details
              .filter((detail) => !detail.requirement_decision)
              .map((detail) => detail.l3_code),
          ),
        )
        setRows(
          sortTasks(
            tasks.flatMap((task) => {
              const item = items.get(task.plan_item_id)
              return item
                ? [{ task, item, pending: pendingCodes.has(item.l3_code) }]
                : []
            }),
          ),
        )
      } catch (reason) {
        if (!cancelled)
          setError(
            reason instanceof Error ? reason.message : '加载学习任务失败。',
          )
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [year])

  const filtered = useMemo(() => {
    const keyword = query.trim().toLowerCase()
    return rows.filter(({ task, item }) => {
      const text =
        `${task.l3_code} ${item.l3_name ?? ''} ${item.learning_task_content ?? ''}`.toLowerCase()
      return (
        (status === '全部' ||
          task.status === (status === '逾期' ? '延期' : status)) &&
        (!month || item.plan_month === month) &&
        (!domain || item.l1_code === domain) &&
        (!keyword || text.includes(keyword))
      )
    })
  }, [rows, query, status, month, domain])
  const months = [
    ...new Set(rows.map(({ item }) => item.plan_month).filter(Boolean)),
  ] as string[]
  const domains = [
    ...new Set(rows.map(({ item }) => item.l1_code).filter(Boolean)),
  ] as string[]
  const counts = {
    total: rows.length,
    active: rows.filter(({ task }) => task.status === '进行中').length,
    pending: rows.filter((row) => row.pending).length,
    overdue: rows.filter(({ task }) => task.status === '延期').length,
  }

  return (
    <section className="page">
      <header className="page-heading">
        <div>
          <span className="muted">我的计划</span>
          <h1>学习任务</h1>
          <p className="muted">按状态定位任务；具体执行在任务详情中完成。</p>
        </div>
        {rows[0] && (
          <Link
            className="primary"
            to={`/growth/tasks/${rows[0].task.id}?year=${year}`}
          >
            继续最近任务
          </Link>
        )}
      </header>
      {loading && (
        <p className="muted" role="status">
          加载中…
        </p>
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {!loading && !error && (
        <>
          <dl className="metric-grid task-summary" aria-label="任务概览">
            <div className="metric">
              <UnorderedListOutlined aria-hidden="true" />
              <dt>全部任务</dt>
              <dd>{counts.total}</dd>
            </div>
            <div className="metric">
              <PlayCircleOutlined aria-hidden="true" />
              <dt>进行中</dt>
              <dd>{counts.active}</dd>
            </div>
            <div className="metric pending">
              <ExclamationCircleOutlined aria-hidden="true" />
              <dt>待确认</dt>
              <dd>{counts.pending}</dd>
            </div>
            <div className="metric overdue">
              <ClockCircleOutlined aria-hidden="true" />
              <dt>逾期</dt>
              <dd>{counts.overdue}</dd>
            </div>
          </dl>
          <div className="task-toolbar" aria-label="任务筛选">
            <div className="seg-group" role="group" aria-label="按状态筛选">
              {statusFilters.map((value) => (
                <button
                  key={value}
                  type="button"
                  className={`seg ${status === value ? 'active' : ''}`}
                  aria-pressed={status === value}
                  onClick={() => setStatus(value)}
                >
                  {value}
                </button>
              ))}
            </div>
            <label className="task-search">
              <input
                aria-label="搜索任务"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="搜索任务或能力项"
              />
            </label>
            <label>
              月份
              <select
                aria-label="筛选月份"
                value={month}
                onChange={(event) => setMonth(event.target.value)}
              >
                <option value="">全部月份</option>
                {months.map((value) => (
                  <option key={value} value={value}>
                    {value}
                  </option>
                ))}
              </select>
            </label>
            <label>
              能力域
              <select
                aria-label="筛选能力域"
                value={domain}
                onChange={(event) => setDomain(event.target.value)}
              >
                <option value="">全部能力域</option>
                {domains.map((value) => (
                  <option key={value} value={value}>
                    {value}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className="task-list">
            {filtered.map(({ task, item, pending }) => (
              <article
                key={task.id}
                className={`task-card ${pending ? 'changed' : ''}`}
                data-testid={`task-card-${task.id}`}
              >
                <div className="task-card-main" data-testid="task-card-content">
                  <small className="muted">
                    {item.l3_code} · {item.plan_month ?? '未排期'}
                  </small>
                  <h2>{item.l3_name ?? item.l3_code}</h2>
                  {pending && (
                    <span className="muted">能力要求已更新 · 待确认</span>
                  )}
                  <p className="muted">
                    {item.learning_task_content ?? item.expected_output ?? '—'}
                  </p>
                  <span className="task-card-status">{task.status}</span>
                  {progress(task, item) && (
                    <span className="task-progress" data-testid="task-progress">
                      <progress
                        aria-label={`任务进度 ${progress(task, item)}`}
                        max="100"
                        value={Number.parseInt(progress(task, item)!, 10)}
                      />
                      {progress(task, item)}
                    </span>
                  )}
                </div>
                <div className="task-card-actions">
                  <Link
                    className="task-card-enter"
                    data-testid="task-card-enter"
                    to={`/growth/tasks/${task.id}?year=${year}`}
                  >
                    进入任务 <span aria-hidden="true">→</span>
                  </Link>
                </div>
              </article>
            ))}
            {filtered.length === 0 && (
              <p className="muted">暂无符合条件的学习任务。</p>
            )}
          </div>
        </>
      )}
    </section>
  )
}

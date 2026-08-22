import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  getAnnualPlan,
  listLearningTasks,
  type LearningTask,
  type PlanItem,
} from './planning'
import { useYear } from './YearContext'

type TaskRow = { task: LearningTask; item: PlanItem }

const statusOrder: Record<string, number> = {
  进行中: 0,
  未开始: 1,
}

function sortTasks(rows: TaskRow[]): TaskRow[] {
  return [...rows].sort((left, right) => {
    const status =
      (statusOrder[left.task.status] ?? 2) -
      (statusOrder[right.task.status] ?? 2)
    if (status) return status
    const month = (left.item.plan_month ?? '9999-99').localeCompare(
      right.item.plan_month ?? '9999-99',
    )
    if (month) return month
    return left.item.id - right.item.id || left.task.id - right.task.id
  })
}

export function TaskListPage() {
  const year = useYear()
  const [rows, setRows] = useState<TaskRow[]>([])
  const [query, setQuery] = useState('')
  const [month, setMonth] = useState('')
  const [domain, setDomain] = useState('')

  useEffect(() => {
    let cancelled = false
    Promise.all([getAnnualPlan(year), listLearningTasks()]).then(
      ([plan, tasks]) => {
        if (cancelled) return
        const items = new Map(
          (plan?.items ?? []).map((item) => [item.id, item]),
        )
        setRows(
          sortTasks(
            tasks.flatMap((task) => {
              const item = items.get(task.plan_item_id)
              return item ? [{ task, item }] : []
            }),
          ),
        )
      },
    )
    return () => {
      cancelled = true
    }
  }, [year])

  const filtered = useMemo(
    () =>
      rows.filter(({ task, item }) => {
        const text =
          `${task.l3_code} ${item.l3_name ?? ''} ${item.learning_task_content ?? ''}`.toLowerCase()
        return (
          (!query || text.includes(query.toLowerCase())) &&
          (!month || item.plan_month === month) &&
          (!domain || item.l1_code === domain)
        )
      }),
    [rows, query, month, domain],
  )
  const domains = [
    ...new Set(rows.map(({ item }) => item.l1_code).filter(Boolean)),
  ] as string[]
  const months = [
    ...new Set(rows.map(({ item }) => item.plan_month).filter(Boolean)),
  ] as string[]
  const counts = {
    total: rows.length,
    active: rows.filter(({ task }) => task.status === '进行中').length,
    completed: rows.filter(({ task }) => task.status === '已完成').length,
    overdue: rows.filter(({ task }) => task.status === '延期').length,
  }

  return (
    <section className="page">
      <header className="page-heading">
        <div>
          <span className="muted">我的计划</span>
          <h1>学习任务</h1>
          <p className="muted">聚焦当前任务，按计划持续推进。</p>
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
      <dl className="summary-grid" aria-label="任务概览">
        <div>
          <dt>任务总数</dt>
          <dd>{counts.total}</dd>
        </div>
        <div>
          <dt>进行中</dt>
          <dd>{counts.active}</dd>
        </div>
        <div>
          <dt>已完成</dt>
          <dd>{counts.completed}</dd>
        </div>
        <div>
          <dt>逾期</dt>
          <dd>{counts.overdue}</dd>
        </div>
      </dl>
      <div className="filters" aria-label="任务筛选">
        <input
          aria-label="搜索任务"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="搜索任务"
        />
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
      </div>
      <div className="card-list">
        {filtered.map(({ task, item }) => (
          <article key={task.id} className="card">
            <div>
              <strong>
                {item.l3_name
                  ? `${item.l3_code} · ${item.l3_name}`
                  : item.l3_code}
              </strong>
              <p className="muted">
                {item.learning_task_content ?? item.expected_output ?? '—'}
              </p>
              <span>
                {task.status} · {item.plan_month ?? '未排期'}
              </span>
            </div>
            <Link to={`/growth/tasks/${task.id}?year=${year}`}>进入任务</Link>
          </article>
        ))}
        {filtered.length === 0 && (
          <p className="muted">暂无符合条件的学习任务。</p>
        )}
      </div>
    </section>
  )
}

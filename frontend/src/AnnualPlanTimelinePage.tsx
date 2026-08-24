import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  getAnnualPlan,
  listLearningTasks,
  type AnnualPlan,
  type LearningTask,
} from './planning'
import { useYear } from './YearContext'

export function AnnualPlanTimelinePage() {
  const year = useYear()
  const [plan, setPlan] = useState<AnnualPlan | null>(null)
  const [tasks, setTasks] = useState<LearningTask[]>([])
  const [error, setError] = useState('')
  useEffect(() => {
    Promise.all([getAnnualPlan(year), listLearningTasks(year)])
      .then(([p, t]) => {
        setPlan(p)
        setTasks(t)
      })
      .catch(() => setError('年度计划加载失败，请重试。'))
  }, [year])
  if (error)
    return (
      <p className="error" role="alert">
        {error}
      </p>
    )
  if (!plan) return <p className="muted">正在加载年度计划…</p>
  const done = plan.items.filter((item) => item.status === '已完成').length
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
        <div>
          <dt>任务总数</dt>
          <dd>{plan.items.length}</dd>
        </div>
        <div>
          <dt>已完成</dt>
          <dd>{done}</dd>
        </div>
        <div>
          <dt>进行中</dt>
          <dd>
            {plan.items.filter((item) => item.status === '进行中').length}
          </dd>
        </div>
        <div>
          <dt>延期</dt>
          <dd>{plan.items.filter((item) => item.status === '延期').length}</dd>
        </div>
      </dl>
      <label>
        年度完成进度
        <progress
          aria-label="年度完成进度"
          value={done}
          max={Math.max(plan.items.length, 1)}
        />
      </label>
      {plan.items.map((item) => {
        const task = tasks.find((value) => value.plan_item_id === item.id)
        return (
          <article className="plan-overview" key={item.id}>
            <small>
              {item.plan_month ??
                `${year}-${String(item.target_month ?? 0).padStart(2, '0')}`}
            </small>
            <h2>
              {item.l3_code} · {item.l3_name ?? '学习任务'}
            </h2>
            <p>
              {item.expected_output ?? '暂未填写期望产出'} · {item.status}
            </p>
            {task ? (
              <Link
                to={`/growth/tasks/${task.id}?year=${year}&plan_item_id=${item.id}&l3_code=${item.l3_code}`}
              >
                进入任务
              </Link>
            ) : (
              <Link to={`/growth/tasks?year=${year}&l3_code=${item.l3_code}`}>
                查看任务
              </Link>
            )}
          </article>
        )
      })}
    </section>
  )
}

import { useEffect, useState } from 'react'

import { me, type User } from './access'
import {
  createLearningTask,
  getAnnualPlan,
  listLearningTasks,
  updateLearningTask,
  type AnnualPlan,
  type LearningTask,
  type LearningTaskStatus,
  type PlanItem,
} from './planning'

const LEARNING_TASK_STATUSES: LearningTaskStatus[] = [
  '未开始',
  '进行中',
  '待 Evidence Review',
  '已完成',
  '延期',
  '暂停',
  '取消',
]

export function LearningTaskPage() {
  const [user, setUser] = useState<User | null>(null)
  const [plan, setPlan] = useState<AnnualPlan | null>(null)
  const [tasks, setTasks] = useState<LearningTask[]>([])
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)

  async function load() {
    setError('')
    try {
      const currentUser = await me()
      setUser(currentUser)

      const [planResult, taskList] = await Promise.all([
        getAnnualPlan(2026).catch(() => null),
        listLearningTasks().catch(() => []),
      ])
      setPlan(planResult)
      setTasks(taskList)
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载失败')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
  }, [])

  const taskByPlanItemId = new Map(
    tasks.map((task) => [task.plan_item_id, task]),
  )
  const planItems = plan?.items ?? []
  const itemsWithoutTask = planItems.filter(
    (item) => !taskByPlanItemId.has(item.id),
  )

  const canManage = user?.roles.includes('Member') ?? false

  async function handleCreate(item: PlanItem) {
    setError('')
    try {
      await createLearningTask(item.id)
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : '创建失败')
    }
  }

  async function handleUpdate(
    task: LearningTask,
    fields: {
      status?: LearningTaskStatus
      actual_start_date?: string | null
      actual_end_date?: string | null
      actual_hours?: number
      next_action?: string | null
    },
  ) {
    setError('')
    try {
      await updateLearningTask(task.id, fields)
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : '更新失败')
    }
  }

  if (loading) return <p className="muted">加载中…</p>

  return (
    <section className="page">
      <h1>学习任务</h1>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}

      <h2>待创建学习任务的计划项</h2>
      {itemsWithoutTask.length === 0 && (
        <p className="muted">所有计划项均已创建学习任务。</p>
      )}
      <ul className="plan-item-list">
        {itemsWithoutTask.map((item) => (
          <li key={item.id} className="plan-item">
            <span className="plan-item-l3">{item.l3_code}</span>
            <span className="plan-item-levels">
              当前 {item.current_level} → 目标 {item.target_level}
            </span>
            <span className="plan-item-priority">优先级：{item.priority}</span>
            {canManage && (
              <button type="button" onClick={() => handleCreate(item)}>
                创建学习任务
              </button>
            )}
          </li>
        ))}
      </ul>

      <h2>我的学习任务</h2>
      {tasks.length === 0 && <p className="muted">暂无学习任务。</p>}
      <ul className="learning-task-list">
        {tasks.map((task) => (
          <li key={task.id} className="learning-task-item">
            <div className="learning-task-header">
              <span className="learning-task-l3">{task.l3_code}</span>
              <span className="learning-task-levels">
                当前 {task.plan_item_current_level} → 目标{' '}
                {task.plan_item_target_level}
              </span>
              <span className="learning-task-priority">
                优先级：{task.plan_item_priority}
              </span>
            </div>
            <div className="learning-task-fields">
              <label>
                状态
                <select
                  value={task.status}
                  onChange={(event) =>
                    handleUpdate(task, {
                      status: event.target.value as LearningTaskStatus,
                    })
                  }
                  disabled={!canManage}
                >
                  {LEARNING_TASK_STATUSES.map((status) => (
                    <option key={status} value={status}>
                      {status}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                实际开始日期
                <input
                  type="date"
                  value={task.actual_start_date ?? ''}
                  onChange={(event) =>
                    handleUpdate(task, {
                      actual_start_date: event.target.value || null,
                    })
                  }
                  disabled={!canManage}
                />
              </label>
              <label>
                实际完成日期
                <input
                  type="date"
                  value={task.actual_end_date ?? ''}
                  onChange={(event) =>
                    handleUpdate(task, {
                      actual_end_date: event.target.value || null,
                    })
                  }
                  disabled={!canManage}
                />
              </label>
              <label>
                实际耗时（小时）
                <input
                  type="number"
                  min={0}
                  value={task.actual_hours}
                  onChange={(event) =>
                    handleUpdate(task, {
                      actual_hours: Number(event.target.value),
                    })
                  }
                  disabled={!canManage}
                />
              </label>
              <label>
                下步动作
                <input
                  value={task.next_action ?? ''}
                  onChange={(event) =>
                    handleUpdate(task, { next_action: event.target.value })
                  }
                  disabled={!canManage}
                />
              </label>
            </div>
          </li>
        ))}
      </ul>
    </section>
  )
}

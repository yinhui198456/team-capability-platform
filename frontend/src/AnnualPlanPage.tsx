import { useEffect, useState } from 'react'

import { me, type User } from './access'
import { useYear } from './YearContext'
import { LearningTaskPage } from './LearningTaskPage'
import {
  generatePlanItems,
  getAnnualPlan,
  getAnnualPlanEligibility,
  getMonthlyHours,
  listLearningTasks,
  updatePlanItem,
  type AnnualPlan,
  type AnnualPlanEligibility,
  type LearningTask,
  type PlanItem,
  type PlanItemUpdate,
} from './planning'

const MONTHS = Array.from({ length: 12 }, (_, index) => index + 1)

function hours(value: string | null): number {
  const parsed = Number(value ?? 0)
  return Number.isFinite(parsed) ? parsed : 0
}

export function AnnualPlanPage() {
  const year = useYear()
  const [user, setUser] = useState<User | null>(null)
  const [plan, setPlan] = useState<AnnualPlan | null>(null)
  const [items, setItems] = useState<PlanItem[]>([])
  const [tasks, setTasks] = useState<LearningTask[]>([])
  const [monthlyHours, setMonthlyHours] = useState<
    { month: number; total_hours: number }[]
  >([])
  const [eligibility, setEligibility] = useState<AnnualPlanEligibility | null>(
    null,
  )
  const [selectedMonth, setSelectedMonth] = useState<number | null>(null)
  const [selectedItem, setSelectedItem] = useState<PlanItem | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [generating, setGenerating] = useState(false)

  async function load() {
    setError('')
    try {
      const currentUser = await me()
      setUser(currentUser)
      const [eligibilityResult, planResult, taskList, hoursResult] =
        await Promise.all([
          getAnnualPlanEligibility().catch(() => null),
          getAnnualPlan(year).catch(() => null),
          listLearningTasks().catch(() => []),
          getMonthlyHours(year).catch(() => []),
        ])
      setEligibility(eligibilityResult)
      setPlan(planResult)
      setItems(planResult?.items ?? [])
      setTasks(taskList)
      setMonthlyHours(hoursResult)
      setSelectedItem(
        (current) =>
          (planResult?.items ?? []).find((item) => item.id === current?.id) ??
          planResult?.items[0] ??
          null,
      )
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载失败')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
  }, [])

  const canGenerate =
    user?.roles.includes('Member') &&
    eligibility?.eligible === true &&
    items.length === 0
  const visibleItems = selectedMonth
    ? items.filter((item) => item.target_month === selectedMonth)
    : items
  const taskByPlanItem = new Map(tasks.map((task) => [task.plan_item_id, task]))
  const totalEstimatedHours = items.reduce(
    (sum, item) => sum + hours(item.estimated_hours),
    0,
  )
  const totalActualHours = monthlyHours.reduce(
    (sum, item) => sum + item.total_hours,
    0,
  )
  const completed = items.filter((item) => item.status === '已完成').length
  const progress =
    items.length === 0 ? 0 : Math.round((completed / items.length) * 100)
  const statusCounts = ['未开始', '进行中', '已完成', '延期', '暂停', '取消']

  async function handleGenerate() {
    setError('')
    setGenerating(true)
    try {
      await generatePlanItems()
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : '生成失败')
    } finally {
      setGenerating(false)
    }
  }

  async function handlePlanItemUpdate(fields: PlanItemUpdate): Promise<void> {
    if (!selectedItem) return
    setError('')
    try {
      await updatePlanItem(selectedItem.id, fields)
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : '更新计划项失败')
    }
  }

  if (loading) return <p className="muted">加载中…</p>

  return (
    <section className="page annual-plan-page">
      <header className="page-heading annual-plan-heading">
        <div>
          <p className="eyebrow">成长管理 / 年度闭环</p>
          <h1>年度成长计划</h1>
          <p className="muted">
            计划项与学习任务一一对应，Evidence Review 闭环后才可完成。
          </p>
        </div>
        <a className="primary-link" href="/growth/review/monthly">
          查看月度复盘
        </a>
      </header>
      {eligibility?.eligible === false && (
        <p className="warning" role="alert">
          年度计划生成受限：{eligibility.reason}
        </p>
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}

      <section aria-label="年度计划总览" className="annual-plan-summary">
        <div>
          <span>年度 / 周期</span>
          <strong>
            {plan
              ? `${plan.year} / ${plan.plan_cycle} 个月`
              : `${year} / 12 个月`}
          </strong>
        </div>
        <div>
          <span>总体进度</span>
          <strong>{progress}%</strong>
          <progress value={progress} max="100" />
        </div>
        <div>
          <span>预计时长</span>
          <strong>{totalEstimatedHours} 小时</strong>
        </div>
        <div>
          <span>实际时长</span>
          <strong>{totalActualHours} 小时</strong>
        </div>
      </section>

      {plan === null && (
        <p className="muted">
          尚无年度成长计划。存在成长目标且 Review 闭环后可生成计划项。
        </p>
      )}
      {plan !== null && (
        <p className="muted">
          计划状态：{plan.status} · {plan.start_date ?? '未设置开始日期'} 至{' '}
          {plan.end_date ?? '未设置结束日期'}
        </p>
      )}
      {canGenerate && (
        <button
          type="button"
          onClick={handleGenerate}
          disabled={generating}
          aria-busy={generating}
        >
          {generating ? '生成中…' : '生成计划项'}
        </button>
      )}

      <section className="annual-plan-layout">
        <div className="annual-plan-main">
          <section aria-label="月度时间轴" className="plan-timeline">
            <div className="card-heading">
              <h2>月度时间轴</h2>
              <p className="muted">选择月份筛选计划项</p>
            </div>
            <div className="month-timeline">
              {MONTHS.map((month) => {
                const count = items.filter(
                  (item) => item.target_month === month,
                ).length
                return (
                  <button
                    key={month}
                    type="button"
                    className={selectedMonth === month ? 'active' : ''}
                    onClick={() =>
                      setSelectedMonth(selectedMonth === month ? null : month)
                    }
                  >
                    {month} 月<span>{count}</span>
                  </button>
                )
              })}
            </div>
          </section>
          <section className="plan-overview">
            <div className="card-heading">
              <h2>计划项状态</h2>
              <p className="muted">
                {selectedMonth ? `当前筛选：${selectedMonth} 月` : '全部月份'}
              </p>
            </div>
            <dl className="plan-status-list">
              {statusCounts.map((status) => (
                <div key={status}>
                  <dt>{status}</dt>
                  <dd>
                    {items.filter((item) => item.status === status).length}
                  </dd>
                </div>
              ))}
            </dl>
            <h2>计划项列表</h2>
            {visibleItems.length === 0 && (
              <p className="muted">当前筛选下暂无计划项。</p>
            )}
            <ul className="plan-item-list">
              {visibleItems.map((item) => (
                <li key={item.id} className="plan-item">
                  <button
                    type="button"
                    className="plan-item-select"
                    onClick={() => setSelectedItem(item)}
                  >
                    <strong>{item.l3_code}</strong>
                    <span>
                      当前 {item.current_level} → 目标 {item.target_level} ·{' '}
                      {item.target_month ?? '未设置'} 月
                    </span>
                  </button>
                  <span className="status-pill">{item.status}</span>
                  <span>
                    优先级：{item.priority} · 预计{' '}
                    {item.estimated_hours ?? '未设置'} 小时
                  </span>
                </li>
              ))}
            </ul>
          </section>
        </div>
        <aside
          className="plan-item-workspace"
          aria-label="计划项详情与学习任务"
        >
          <h2>计划项详情</h2>
          {!selectedItem && <p className="muted">选择左侧计划项查看详情。</p>}
          {selectedItem && (
            <>
              <h3>{selectedItem.l3_code}</h3>
              <dl className="detail-list">
                <div>
                  <dt>学习任务 / 实操内容</dt>
                  <dd>{selectedItem.learning_task_content ?? '待补充'}</dd>
                </div>
                <div>
                  <dt>预期输出</dt>
                  <dd>{selectedItem.expected_output ?? '待补充'}</dd>
                </div>
                <div>
                  <dt>学习资源</dt>
                  <dd>{selectedItem.learning_material ?? '待补充'}</dd>
                </div>
                <div>
                  <dt>计划日期</dt>
                  <dd>
                    {selectedItem.plan_start_date ?? '未设置'} 至{' '}
                    {selectedItem.plan_end_date ?? '未设置'}
                  </dd>
                </div>
              </dl>
              {user?.roles.includes('Member') && (
                <section
                  aria-label="计划项执行管理"
                  className="plan-item-controls"
                >
                  <h3>执行管理</h3>
                  <div className="learning-task-fields">
                    <label>
                      计划开始日期
                      <input
                        type="date"
                        defaultValue={selectedItem.plan_start_date ?? ''}
                        onBlur={(event) =>
                          void handlePlanItemUpdate({
                            plan_start_date: event.target.value || null,
                          })
                        }
                      />
                    </label>
                    <label>
                      计划结束日期
                      <input
                        type="date"
                        defaultValue={selectedItem.plan_end_date ?? ''}
                        onBlur={(event) =>
                          void handlePlanItemUpdate({
                            plan_end_date: event.target.value || null,
                          })
                        }
                      />
                    </label>
                    <label>
                      目标月份
                      <select
                        defaultValue={selectedItem.target_month ?? ''}
                        onChange={(event) =>
                          void handlePlanItemUpdate({
                            target_month: event.target.value
                              ? Number(event.target.value)
                              : null,
                          })
                        }
                      >
                        <option value="">未设置</option>
                        {MONTHS.map((month) => (
                          <option key={month} value={month}>
                            {month} 月
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>
                  <div className="plan-item-actions">
                    {selectedItem.status !== '暂停' &&
                      selectedItem.status !== '取消' && (
                        <button
                          type="button"
                          onClick={() =>
                            void handlePlanItemUpdate({ status: '暂停' })
                          }
                        >
                          暂停
                        </button>
                      )}
                    {selectedItem.status === '暂停' && (
                      <button
                        type="button"
                        onClick={() =>
                          void handlePlanItemUpdate({ status: '进行中' })
                        }
                      >
                        恢复执行
                      </button>
                    )}
                    {selectedItem.status !== '已完成' &&
                      selectedItem.status !== '取消' && (
                        <button
                          type="button"
                          onClick={() =>
                            void handlePlanItemUpdate({ status: '取消' })
                          }
                        >
                          取消计划项
                        </button>
                      )}
                  </div>
                </section>
              )}
              <p className="muted">
                学习任务：
                {taskByPlanItem.get(selectedItem.id)?.status ?? '尚未创建'}
                。实际时长以学习执行日志聚合为准。
              </p>
              <LearningTaskPage embedded planItemId={selectedItem.id} />
            </>
          )}
        </aside>
      </section>
    </section>
  )
}

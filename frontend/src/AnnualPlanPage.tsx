import { useEffect, useState } from 'react'

import { me, type User } from './access'
import {
  generatePlanItems,
  getAnnualPlan,
  getAnnualPlanEligibility,
  type AnnualPlan,
  type AnnualPlanEligibility,
  type PlanItem,
} from './planning'

export function AnnualPlanPage() {
  const [user, setUser] = useState<User | null>(null)
  const [plan, setPlan] = useState<AnnualPlan | null>(null)
  const [items, setItems] = useState<PlanItem[]>([])
  const [eligibility, setEligibility] = useState<AnnualPlanEligibility | null>(
    null,
  )
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [generating, setGenerating] = useState(false)

  async function load() {
    setError('')
    try {
      const currentUser = await me()
      setUser(currentUser)

      const [eligibilityResult, planResult] = await Promise.all([
        getAnnualPlanEligibility().catch(() => null),
        getAnnualPlan(2026).catch(() => null),
      ])
      setEligibility(eligibilityResult)
      setPlan(planResult)
      setItems(planResult?.items ?? [])
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载失败')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    async function init() {
      await load()
    }
    init()
  }, [])

  const canGenerate =
    user?.roles.includes('Member') &&
    eligibility?.eligible === true &&
    items.length === 0

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

  if (loading) return <p className="muted">加载中…</p>

  return (
    <section className="page">
      <h1>年度成长计划</h1>
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

      {plan === null && (
        <p className="muted">尚无年度成长计划。存在成长目标时可生成计划项。</p>
      )}

      {plan !== null && (
        <div className="plan-summary">
          <p>
            年度：{plan.year} · 周期：{plan.plan_cycle} 个月 · 状态：
            {plan.status}
          </p>
        </div>
      )}

      {items.length === 0 && plan !== null && (
        <p className="muted">暂无计划项。</p>
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

      <h2>计划项</h2>
      {items.length === 0 && <p className="muted">暂无计划项。</p>}
      <ul className="plan-item-list">
        {items.map((item) => (
          <li key={item.id} className="plan-item">
            <span className="plan-item-l3">{item.l3_code}</span>
            <span className="plan-item-levels">
              当前 {item.current_level} → 目标 {item.target_level}
            </span>
            <span className="plan-item-priority">优先级：{item.priority}</span>
            <span className="plan-item-hours">
              预计耗时：{item.estimated_hours ?? '未设置'}
            </span>
            <span className="plan-item-month">
              目标月份：{item.target_month ?? '未设置'}
            </span>
            <span className="plan-item-status">状态：{item.status}</span>
          </li>
        ))}
      </ul>
    </section>
  )
}

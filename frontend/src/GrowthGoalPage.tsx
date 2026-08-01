import { useEffect, useState } from 'react'

import { me, type User } from './access'
import {
  createGrowthGoal,
  deleteGrowthGoal,
  getAnnualPlanEligibility,
  getEligibleGaps,
  listGrowthGoals,
  formatCapabilityPath,
  type EligibleGap,
  type GrowthGoal,
  type AnnualPlanEligibility,
} from './planning'

export function GrowthGoalPage() {
  const [user, setUser] = useState<User | null>(null)
  const [gaps, setGaps] = useState<EligibleGap[]>([])
  const [goals, setGoals] = useState<GrowthGoal[]>([])
  const [eligibility, setEligibility] = useState<AnnualPlanEligibility | null>(
    null,
  )
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    async function load() {
      try {
        const currentUser = await me()
        if (!cancelled) setUser(currentUser)

        const [eligibilityResult, eligibleGaps, currentGoals] =
          await Promise.all([
            getAnnualPlanEligibility().catch(() => null),
            getEligibleGaps().catch(() => []),
            listGrowthGoals().catch(() => []),
          ])
        if (!cancelled) {
          setEligibility(eligibilityResult)
          setGaps(eligibleGaps)
          setGoals(currentGoals)
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : '加载失败')
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => {
      cancelled = true
    }
  }, [])

  const goalL3Codes = new Set(goals.map((goal) => goal.l3_code))
  const availableGaps = gaps.filter(
    (gap) =>
      (gap.include_in_plan ?? gap.plan_candidate) &&
      !goalL3Codes.has(gap.l3_code),
  )
  const canCreate =
    user?.roles.includes('Member') && eligibility?.eligible === true

  async function handleCreate(gap: EligibleGap) {
    setError('')
    try {
      await createGrowthGoal(gap.id)
      const [freshGaps, freshGoals] = await Promise.all([
        getEligibleGaps(),
        listGrowthGoals(),
      ])
      setGaps(freshGaps)
      setGoals(freshGoals)
    } catch (err) {
      setError(err instanceof Error ? err.message : '创建失败')
    }
  }

  async function handleRemove(goalId: number) {
    setError('')
    try {
      await deleteGrowthGoal(goalId)
      const [freshGaps, freshGoals] = await Promise.all([
        getEligibleGaps(),
        listGrowthGoals(),
      ])
      setGaps(freshGaps)
      setGoals(freshGoals)
    } catch (err) {
      setError(err instanceof Error ? err.message : '删除失败')
    }
  }

  if (loading) return <p className="muted">加载中…</p>

  return (
    <section className="page">
      <header className="page-heading">
        <p className="eyebrow">成长管理 / 第 4 步</p>
        <h1>成长目标</h1>
        <p className="muted">
          从已完成 Buddy Review 的 Gap 中选择纳入年度成长计划的目标。上一步：
          <a href="/capability/gap">Gap 分析</a>
        </p>
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

      <h2>可纳入计划的 Gap</h2>
      {availableGaps.length === 0 && (
        <p className="muted">暂无可纳入的 Gap。</p>
      )}
      <ul className="gap-list">
        {availableGaps.map((gap) => (
          <li key={gap.id} className="gap-item">
            <span className="gap-l3">
              二级能力标准 → 三级达成路径：{formatCapabilityPath(gap)}
            </span>
            <span className="gap-levels">
              掌握度提升：当前 {gap.current_level} → 目标 {gap.target_level}
              （Gap {gap.gap_value}）
            </span>
            <span className="gap-priority">优先级：{gap.priority}</span>
            <button
              type="button"
              onClick={() => handleCreate(gap)}
              disabled={!canCreate}
            >
              创建成长目标
            </button>
          </li>
        ))}
      </ul>

      <h2>已创建的成长目标</h2>
      {goals.length === 0 && <p className="muted">暂无成长目标。</p>}
      <ul className="goal-list">
        {goals.map((goal) => (
          <li key={goal.id} className="goal-item">
            <span className="goal-l3">
              二级能力标准 → 三级达成路径：{formatCapabilityPath(goal)}
            </span>
            <span className="goal-level">目标掌握度：{goal.target_level}</span>
            <span className="goal-priority">优先级：{goal.priority}</span>
            <button
              type="button"
              onClick={() => handleRemove(goal.id)}
              disabled={!user?.roles.includes('Member')}
            >
              删除
            </button>
          </li>
        ))}
      </ul>
    </section>
  )
}

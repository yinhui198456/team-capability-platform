import { useEffect, useState } from 'react'

import { listAssessments } from './assessment'
import { me, type User } from './access'
import { Gap, listGaps, updateGap } from './gap'
import {
  AnnualPlanEligibility,
  annualPlanDryRun,
  getAnnualPlanEligibility,
} from './planning'

const PRIORITIES: Gap['priority'][] = ['高', '中', '低']

export function GapPage() {
  const [user, setUser] = useState<User | null>(null)
  const [gaps, setGaps] = useState<Gap[]>([])
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [eligibility, setEligibility] = useState<AnnualPlanEligibility | null>(
    null,
  )
  const [dryRunMessage, setDryRunMessage] = useState('')

  useEffect(() => {
    let cancelled = false
    async function load() {
      try {
        const currentUser = await me()
        if (!cancelled) setUser(currentUser)

        const roles = currentUser.roles
        if (
          roles.includes('Member') &&
          !roles.includes('Buddy') &&
          !roles.includes('Leader') &&
          !roles.includes('Admin')
        ) {
          const assessments = await listAssessments()
          const submitted = assessments
            .filter((a) => a.submitted_at !== null)
            .sort(
              (a, b) =>
                new Date(b.submitted_at!).getTime() -
                new Date(a.submitted_at!).getTime(),
            )
          if (submitted.length > 0) {
            const list = await listGaps(submitted[0].id)
            if (!cancelled) setGaps(list)
          }
        } else {
          const list = await listGaps()
          if (!cancelled) setGaps(list)
        }

        try {
          const eligibilityResult = await getAnnualPlanEligibility()
          if (!cancelled) setEligibility(eligibilityResult)
        } catch {
          // ponytail: eligibility failure must not hide gaps or break page.
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

  async function handleChange(
    gap: Gap,
    patch: Partial<Pick<Gap, 'priority' | 'plan_candidate'>>,
  ) {
    if (!user?.roles.includes('Member')) return

    const updated = { ...gap, ...patch }
    setGaps((prev) => prev.map((g) => (g.id === gap.id ? updated : g)))

    try {
      await updateGap(gap.id, {
        priority: updated.priority,
        plan_candidate: updated.plan_candidate,
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : '更新失败')
      setGaps((prev) => prev.map((g) => (g.id === gap.id ? gap : g)))
    }
  }

  const canEdit = user?.roles.includes('Member') ?? false
  const highPriorityCount = gaps.filter((gap) => gap.priority === '高').length
  const candidateCount = gaps.filter((gap) => gap.plan_candidate).length
  const totalGap = gaps.reduce((sum, gap) => sum + gap.gap_value, 0)
  const averageGap = gaps.length === 0 ? 0 : totalGap / gaps.length

  async function handleDryRun() {
    setDryRunMessage('')
    setError('')
    try {
      await annualPlanDryRun()
      setDryRunMessage('可生成年度计划')
    } catch (err) {
      setDryRunMessage(err instanceof Error ? err.message : '模拟生成失败')
    }
  }

  if (loading) return <p className="muted">加载中…</p>

  return (
    <section className="page gap-analysis-page">
      <header className="page-heading gap-heading">
        <div>
          <p className="eyebrow">能力管理 / 自评差距</p>
          <h1>Gap 分析</h1>
          <p className="muted">以已提交的年度自评为基线，确认优先级与计划候选项。</p>
        </div>
        <button type="button" onClick={handleDryRun}>
          模拟生成年度计划
        </button>
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
      {dryRunMessage && (
        <p className="info" role="status">
          {dryRunMessage}
        </p>
      )}
      <section className="gap-analysis-layout">
        <section aria-label="Gap 概览" className="gap-overview">
          <div className="card-heading"><h2>能力差距明细</h2><p className="muted">候选不等于正式计划；仍需完成 Buddy Review。</p></div>
          {gaps.length === 0 && <p className="muted">暂无 Gap 记录。</p>}
          <ul className="gap-list">
            {gaps.map((gap) => (
              <li key={gap.id} className="gap-item">
                <span className="gap-l3">{gap.l3_code}</span>
                <span className="gap-levels">当前 {gap.current_level} → 目标 {gap.target_level}（Gap {gap.gap_value}）</span>
                <label className="gap-priority">优先级<select value={gap.priority} onChange={(event) => handleChange(gap, { priority: event.target.value as Gap['priority'] })} disabled={!canEdit}>{PRIORITIES.map((p) => <option key={p} value={p}>{p}</option>)}</select></label>
                <label className="checkbox gap-candidate"><input type="checkbox" checked={gap.plan_candidate} onChange={(event) => handleChange(gap, { plan_candidate: event.target.checked })} disabled={!canEdit} />纳入计划候选</label>
              </li>
            ))}
          </ul>
        </section>
        <aside className="gap-sidebar" aria-label="Gap 统计与计划门禁">
          <h2>Gap 统计</h2>
          <dl className="gap-stats">
            <div><dt>能力项</dt><dd>{gaps.length}</dd></div>
            <div><dt>平均 Gap</dt><dd>{averageGap.toFixed(1)}</dd></div>
            <div><dt>高优先级</dt><dd>{highPriorityCount}</dd></div>
            <div><dt>计划候选</dt><dd>{candidateCount}</dd></div>
          </dl>
          <section className="gap-gate-summary">
            <h3>计划门禁</h3>
            <p>{eligibility?.eligible ? 'Review 已闭环，可生成年度计划。' : eligibility?.reason ?? '正在读取年度计划资格。'}</p>
          </section>
        </aside>
      </section>
    </section>
  )
}

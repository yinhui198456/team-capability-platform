import { useEffect, useState } from 'react'

import { me } from './access'
import {
  getCapabilityProfile,
  type CapabilityProfile,
  type CapabilityProfilePlanItem,
} from './planning'

function PlanItemDetail({ item }: { item: CapabilityProfilePlanItem }) {
  const task = item.learning_task
  return (
    <article className="plan-item">
      <h4>
        {item.l3_code} · 当前 {item.current_level} → 目标 {item.target_level}
      </h4>
      <p>优先级：{item.priority}</p>
      <p>预计耗时：{item.estimated_hours ?? '未设置'}</p>
      <p>状态：{item.status}</p>
      {task ? (
        <section
          className="learning-task task-detail"
          aria-label={`学习任务详情：${item.l3_code}`}
        >
          <h5>学习任务</h5>
          <p>状态：{task.status}</p>
          <p>实际耗时：{task.actual_hours ?? 0} 小时</p>
          {task.progress_logs.length > 0 && (
            <div>
              <h6>学习日志</h6>
              <ul>
                {task.progress_logs.map((log) => (
                  <li key={log.id}>
                    {log.record_date} · {log.actual_hours} 小时
                    {log.note ? ` · ${log.note}` : ''}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {task.evidences.length > 0 && (
            <section
              className="evidence-versions"
              aria-label={`Evidence 版本：${item.l3_code}`}
            >
              <h6>Evidence</h6>
              <ul>
                {task.evidences.map((evidence) => (
                  <li key={evidence.id}>
                    版本 {evidence.version_number} · {evidence.status}
                    {evidence.review?.conclusion
                      ? ` · Review: ${evidence.review.conclusion}`
                      : ''}
                  </li>
                ))}
              </ul>
            </section>
          )}
        </section>
      ) : (
        <p className="muted">暂无学习任务。</p>
      )}
    </article>
  )
}

export function ProfilePage() {
  const [profile, setProfile] = useState<CapabilityProfile | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function load() {
      setError('')
      try {
        await me()
        const profileResult = await getCapabilityProfile(2026).catch(() => null)
        setProfile(profileResult)
      } catch (err) {
        setError(err instanceof Error ? err.message : '加载失败')
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [])

  if (loading) return <p className="muted">加载中…</p>

  return (
    <section className="page">
      <h1>成长档案</h1>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}

      {!profile && <p className="muted">暂无成长档案数据。</p>}

      {profile && (
        <div className="profile-summary">
          <p>
            成员：{profile.member.full_name}（{profile.member.username}）·
            年度：
            {profile.year} · 档案状态：{profile.status}
          </p>
        </div>
      )}

      {profile && profile.assessments.length > 0 && (
        <div className="profile-section">
          <h2>评估历史</h2>
          <ul>
            {profile.assessments.map((assessment) => (
              <li key={assessment.id}>
                版本 {assessment.version} · {assessment.assessment_type} ·{' '}
                {assessment.status}
                {assessment.submitted_at
                  ? ` · 提交于 ${assessment.submitted_at}`
                  : ''}
                {assessment.reviews.length > 0 && (
                  <span>
                    {' '}
                    · Review 结论：
                    {assessment.reviews[assessment.reviews.length - 1]
                      .conclusion ?? '待复核'}
                  </span>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {profile && profile.annual_plan && (
        <div className="profile-section">
          <h2>年度成长计划</h2>
          <p>
            年度：{profile.annual_plan.year} · 周期：
            {profile.annual_plan.plan_cycle} 个月 · 状态：
            {profile.annual_plan.status}
          </p>
          {profile.annual_plan.items.length === 0 && (
            <p className="muted">暂无计划项。</p>
          )}
          {profile.annual_plan.items.map((item) => (
            <PlanItemDetail key={item.id} item={item} />
          ))}
        </div>
      )}

      {profile && profile.annual_plan === null && (
        <div className="profile-section">
          <h2>年度成长计划</h2>
          <p className="muted">暂无年度成长计划。</p>
        </div>
      )}

      {profile && (
        <div className="profile-section">
          <h2>年度统计</h2>
          <p>总学习时长：{profile.statistics.total_learning_hours} 小时</p>
          <div>
            Evidence 统计：
            {Object.keys(profile.statistics.evidence_count_by_status).length ===
            0 ? (
              <span className="muted">无 Evidence</span>
            ) : (
              <ul>
                {Object.entries(
                  profile.statistics.evidence_count_by_status,
                ).map(([status, count]) => (
                  <li key={status}>
                    {status}：{count}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </section>
  )
}

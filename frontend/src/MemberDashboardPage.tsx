import { useEffect, useState } from 'react'

import { me } from './access'
import { getMemberDashboard, type MemberDashboard } from './planning'

const domainNames: Record<string, string> = {
  P01: '专业领域一',
  P02: '专业领域二',
  P03: '专业领域三',
  C01: '通用能力一',
  C02: '通用能力二',
  C03: '通用能力三',
}

function Radar({ data }: { data: MemberDashboard['domain_radar'] }) {
  return (
    <ul className="radar-list" aria-label="六大领域能力雷达">
      {data.map((domain) => (
        <li key={domain.domain_code}>
          <span>{domainNames[domain.domain_code] ?? domain.domain_code}</span>
          <span className="radar-track" aria-hidden="true">
            <span style={{ width: `${Math.min(domain.score, 5) * 20}%` }} />
          </span>
          <strong>{domain.score}</strong>
        </li>
      ))}
    </ul>
  )
}

export function MemberDashboardPage() {
  const [dashboard, setDashboard] = useState<MemberDashboard | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    async function load() {
      try {
        await me()
        setDashboard(await getMemberDashboard(2026))
      } catch (err) {
        setError(err instanceof Error ? err.message : '加载失败')
      }
    }
    load()
  }, [])

  return (
    <section className="page dashboard-page">
      <header className="page-heading">
        <div>
          <p className="eyebrow">Member 工作台 · {dashboard?.year ?? 2026}</p>
          <h1>我的成长总览</h1>
          <p className="muted">
            将自评、Gap、年度计划与 Evidence 进展放在同一工作区。
          </p>
        </div>
        <a className="primary-link" href="/capability/assessment">
          进入能力自评
        </a>
      </header>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {!dashboard && !error && <p className="muted">正在加载成长数据…</p>}
      {dashboard && (
        <>
          <div className="metric-grid" aria-label="年度成长摘要">
            <article>
              <span>累计学习时长</span>
              <strong>{dashboard.summary.total_learning_hours} 小时</strong>
            </article>
            <article>
              <span>已完成任务</span>
              <strong>{dashboard.summary.completed_task_count}</strong>
            </article>
            <article>
              <span>待补充 Evidence</span>
              <strong>{dashboard.summary.pending_evidence_count}</strong>
            </article>
          </div>
          <div className="dashboard-grid">
            <article className="dashboard-card">
              <h2>能力雷达</h2>
              <Radar data={dashboard.domain_radar} />
              <a href="/capability/gap">查看 Gap 分析</a>
            </article>
            <article className="dashboard-card">
              <h2>优先 Gap</h2>
              {dashboard.gaps.length === 0 ? (
                <p className="muted">暂无可纳入年度计划的 Gap。</p>
              ) : (
                <ul className="compact-list">
                  {dashboard.gaps.slice(0, 5).map((gap) => (
                    <li key={gap.id}>
                      <strong>{gap.l3_code}</strong>
                      <span>
                        当前 {gap.current_level} → 目标 {gap.target_level} ·{' '}
                        {gap.priority}优先级
                      </span>
                    </li>
                  ))}
                </ul>
              )}
              <a href="/growth/annual-plan">查看年度计划</a>
            </article>
          </div>
          <article className="dashboard-card">
            <div className="card-heading">
              <h2>当前学习任务</h2>
              <a href="/growth/tasks">进入任务与 Evidence</a>
            </div>
            {dashboard.current_tasks.length === 0 ? (
              <p className="muted">暂无进行中的学习任务。</p>
            ) : (
              <ul className="compact-list">
                {dashboard.current_tasks.map((task) => (
                  <li key={task.id}>
                    <strong>{task.l3_code}</strong>
                    <span>
                      {task.status} · 已投入 {task.actual_hours} 小时 · 目标等级{' '}
                      {task.plan_item_target_level}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </article>
        </>
      )}
    </section>
  )
}

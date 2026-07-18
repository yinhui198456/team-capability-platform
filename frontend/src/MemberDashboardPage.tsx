import { useEffect, useState } from 'react'

import { me } from './access'
import { getMemberDashboard, type MemberDashboard } from './planning'

const domainNames: Record<string, string> = {
  P01: 'Data Infra',
  P02: 'AI Infra / Agent',
  P03: 'Coding',
  C01: '基本办公',
  C02: '沟通协作',
  C03: '学习创新',
}

const domainColors: Record<string, string> = {
  P01: '#175cd3',
  P02: '#0e9384',
  P03: '#f79009',
  C01: '#7a5af8',
  C02: '#ec4899',
  C03: '#17b26a',
}

const radarCenter = 112
const radarRadius = 72

function radarPoint(index: number, score: number) {
  const angle = -Math.PI / 2 + (index * Math.PI * 2) / 6
  const radius = (Math.max(0, Math.min(score, 5)) / 5) * radarRadius
  return [
    radarCenter + Math.cos(angle) * radius,
    radarCenter + Math.sin(angle) * radius,
  ]
}

function pointsFor(scores: number[]) {
  return scores
    .map((score, index) => radarPoint(index, score).join(','))
    .join(' ')
}

function DomainBadge({ code }: { code: string }) {
  const color = domainColors[code] ?? '#475467'
  return (
    <span
      className="domain-badge"
      style={{ '--domain-color': color } as React.CSSProperties}
    >
      <span className="domain-dot" style={{ background: color }} />
      {code} {domainNames[code] ?? code}
    </span>
  )
}

function formatHours(
  value: number | string | null | undefined,
): React.ReactNode {
  if (value === null || value === undefined || value === '') return '—'
  const num = typeof value === 'string' ? Number(value) : value
  if (Number.isNaN(num)) return '—'
  return (
    <span className="hours-value">
      <span className="hours-number">{num}</span>
      <span className="hours-unit"> h</span>
    </span>
  )
}

function TodoItem({
  icon,
  label,
  value,
  tone,
}: {
  icon: React.ReactNode
  label: string
  value: number
  tone?: 'default' | 'danger'
}) {
  return (
    <div className={`todo-item todo-item-${tone ?? 'default'}`}>
      <span className="todo-icon" aria-hidden="true">
        {icon}
      </span>
      <strong className="todo-value">{value}</strong>
      <span className="todo-label">{label}</span>
    </div>
  )
}

function Radar({
  data,
  gaps,
}: {
  data: MemberDashboard['domain_radar']
  gaps: MemberDashboard['gaps']
}) {
  const targetScores = data.map((domain) => {
    const domainGaps = gaps.filter((gap) =>
      gap.l3_code.startsWith(domain.domain_code),
    )
    if (domainGaps.length === 0) return domain.score
    return Math.min(
      5,
      domainGaps.reduce((sum, gap) => sum + gap.target_level, 0) /
        domainGaps.length,
    )
  })

  return (
    <figure className="dashboard-radar" aria-label="六大领域能力雷达">
      <svg viewBox="0 0 224 224" role="img" aria-label="当前与目标能力雷达">
        {[1, 2, 3, 4, 5].map((level) => (
          <polygon
            className="radar-grid"
            key={level}
            points={pointsFor(data.map(() => level))}
          />
        ))}
        {data.map((domain, index) => {
          const [x, y] = radarPoint(index, 5.9)
          const color = domainColors[domain.domain_code] ?? '#475467'
          return (
            <text
              className="radar-label"
              key={domain.domain_code}
              x={x}
              y={y}
              fill={color}
            >
              {domain.domain_code}
            </text>
          )
        })}
        <polygon className="radar-target" points={pointsFor(targetScores)} />
        <polygon
          className="radar-current"
          points={pointsFor(data.map((domain) => domain.score))}
        />
      </svg>
      <figcaption>
        <span>实线：当前掌握度</span>
        <span>虚线：目标掌握度</span>
      </figcaption>
    </figure>
  )
}

export function MemberDashboardPage() {
  const [dashboard, setDashboard] = useState<MemberDashboard | null>(null)
  const [error, setError] = useState('')
  const [selectedDomain, setSelectedDomain] = useState('全部')

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

  const filteredGaps =
    dashboard?.gaps.filter(
      (gap) =>
        selectedDomain === '全部' || gap.l3_code.startsWith(selectedDomain),
    ) ?? []
  const completed = dashboard?.plan_progress.已完成 ?? 0
  const total = dashboard?.plan_progress.total ?? 0
  const completionRate = total === 0 ? 0 : Math.round((completed / total) * 100)
  const overdueTasks =
    dashboard?.current_tasks.filter((task) => task.status === '延期').length ??
    0

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
          <div className="dashboard-overview">
            <article className="dashboard-card plan-progress-card">
              <h2>年度计划进度</h2>
              <div className="plan-progress-content">
                <div
                  aria-label={`年度计划完成率 ${completionRate}%`}
                  className="progress-ring"
                  style={
                    {
                      '--progress': `${completionRate * 3.6}deg`,
                    } as React.CSSProperties
                  }
                >
                  <strong>{completionRate}%</strong>
                  <span>整体进度</span>
                </div>
                <dl className="plan-status-list">
                  <div>
                    <dt>计划项</dt>
                    <dd>{total}</dd>
                  </div>
                  <div>
                    <dt>已完成</dt>
                    <dd className="status-complete">
                      {dashboard.plan_progress.已完成}
                    </dd>
                  </div>
                  <div>
                    <dt>进行中</dt>
                    <dd>{dashboard.plan_progress.进行中}</dd>
                  </div>
                  <div>
                    <dt>未开始</dt>
                    <dd>{dashboard.plan_progress.未开始}</dd>
                  </div>
                  <div>
                    <dt>延期</dt>
                    <dd className="status-overdue">
                      {dashboard.plan_progress.延期}
                    </dd>
                  </div>
                </dl>
              </div>
              <a href="/growth/annual-plan">查看年度计划</a>
            </article>
            <article className="dashboard-card learning-hours-card">
              <h2>学习时长</h2>
              <div className="metric-grid" aria-label="学习时长摘要">
                <div>
                  <span>全年累计时长</span>
                  <strong>
                    {formatHours(dashboard.summary.annual_actual_hours)}
                  </strong>
                </div>
                <div>
                  <span>全年计划时长</span>
                  <strong>
                    {formatHours(dashboard.summary.annual_planned_hours)}
                  </strong>
                </div>
                <div>
                  <span>当月累计时长</span>
                  <strong>
                    {formatHours(dashboard.summary.current_month_actual_hours)}
                  </strong>
                </div>
                <div>
                  <span>当月计划时长</span>
                  <strong>
                    {formatHours(dashboard.summary.current_month_planned_hours)}
                  </strong>
                </div>
              </div>
              <a href="/growth/review/monthly">查看月度复盘</a>
            </article>
            <article className="dashboard-card todo-card">
              <h2>待办事项</h2>
              <div className="todo-grid">
                <TodoItem
                  icon={
                    <svg
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                    >
                      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                      <polyline points="14 2 14 8 20 8" />
                      <line x1="12" y1="18" x2="12" y2="18" />
                      <line x1="9" y1="15" x2="15" y2="15" />
                    </svg>
                  }
                  label="待提交 Evidence"
                  value={dashboard.summary.pending_evidence_count}
                />
                <TodoItem
                  icon={
                    <svg
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                    >
                      <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
                      <circle cx="9" cy="7" r="4" />
                      <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
                      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
                    </svg>
                  }
                  label="待 Buddy 复核"
                  value={dashboard.plan_progress['待 Evidence Review']}
                />
                <TodoItem
                  icon={
                    <svg
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                    >
                      <circle cx="12" cy="12" r="10" />
                      <polyline points="12 6 12 12 16 14" />
                    </svg>
                  }
                  label="计划到期"
                  value={dashboard.plan_progress.延期}
                  tone="danger"
                />
                <TodoItem
                  icon={
                    <svg
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                    >
                      <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
                      <line x1="12" y1="9" x2="12" y2="13" />
                      <line x1="12" y1="17" x2="12.01" y2="17" />
                    </svg>
                  }
                  label="学习任务延期"
                  value={overdueTasks}
                  tone="danger"
                />
              </div>
            </article>
          </div>
          <section className="dashboard-card ability-analysis">
            <div className="card-heading">
              <h2>能力分析</h2>
              <span className="muted">选择能力域查看对应 Gap</span>
            </div>
            <div className="domain-filter" aria-label="能力域筛选">
              {[
                '全部',
                ...dashboard.domain_radar.map((domain) => domain.domain_code),
              ].map((domain) => (
                <button
                  aria-pressed={selectedDomain === domain}
                  className={selectedDomain === domain ? 'active' : ''}
                  key={domain}
                  onClick={() => setSelectedDomain(domain)}
                  type="button"
                >
                  {domain === '全部'
                    ? domain
                    : `${domain} ${domainNames[domain]}`}
                </button>
              ))}
            </div>
            <div className="dashboard-grid ability-analysis-grid">
              <article>
                <h3>个人能力雷达图</h3>
                <Radar data={dashboard.domain_radar} gaps={dashboard.gaps} />
              </article>
              <article>
                <h3>Gap 概览</h3>
                {filteredGaps.length === 0 ? (
                  <p className="muted">当前范围暂无 Gap。</p>
                ) : (
                  <table className="analytics-table gap-table">
                    <thead>
                      <tr>
                        <th>能力域 / L3</th>
                        <th>当前</th>
                        <th>目标</th>
                        <th>Gap</th>
                        <th>优先级</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredGaps.slice(0, 6).map((gap) => {
                        const domainCode = gap.l3_code.slice(0, 3)
                        return (
                          <tr key={gap.id}>
                            <td>
                              <DomainBadge code={domainCode} />
                              <span className="gap-l3-name">
                                {gap.l3_name ?? gap.l3_code}
                              </span>
                            </td>
                            <td>{gap.current_level}</td>
                            <td>{gap.target_level}</td>
                            <td className="gap-value">{gap.gap_value}</td>
                            <td>{gap.priority}</td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                )}
                <a href="/capability/gap">查看 Gap 分析</a>
              </article>
            </div>
          </section>
          <article className="dashboard-card current-tasks-card">
            <div className="card-heading">
              <h2>当前学习任务</h2>
              <a href="/growth/tasks">进入任务与 Evidence</a>
            </div>
            {dashboard.current_tasks.length === 0 ? (
              <p className="muted">暂无进行中的学习任务。</p>
            ) : (
              <table className="analytics-table task-table">
                <thead>
                  <tr>
                    <th>任务名称</th>
                    <th>所属能力域 / L3</th>
                    <th>计划月份</th>
                    <th>预计时长</th>
                    <th>实际时长</th>
                    <th>进度</th>
                    <th>状态</th>
                  </tr>
                </thead>
                <tbody>
                  {dashboard.current_tasks.map((task) => {
                    const estimated = Number(
                      task.plan_item_estimated_hours ?? 0,
                    )
                    const progress =
                      estimated > 0
                        ? Math.round((task.actual_hours / estimated) * 100)
                        : 0
                    const domainCode = task.l3_code.slice(0, 3)
                    const taskName =
                      task.plan_item_learning_task_content?.trim() ||
                      task.l3_name ||
                      task.l3_code
                    return (
                      <tr key={task.id}>
                        <td className="task-name-cell">{taskName}</td>
                        <td>
                          <DomainBadge code={domainCode} />
                          <span className="task-l3-name">
                            {task.l3_name ?? task.l3_code}
                          </span>
                        </td>
                        <td>
                          {task.plan_item_target_month
                            ? `${task.plan_item_target_month} 月`
                            : '未排期'}
                        </td>
                        <td>{formatHours(task.plan_item_estimated_hours)}</td>
                        <td>{formatHours(task.actual_hours)}</td>
                        <td>
                          <progress max={100} value={Math.min(progress, 100)} />{' '}
                          {progress}%
                        </td>
                        <td>
                          <span
                            className={`status-pill status-${task.status.replace(/ /g, '-')}`}
                          >
                            {task.status}
                          </span>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            )}
          </article>
        </>
      )}
    </section>
  )
}

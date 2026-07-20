import { useEffect, useState } from 'react'

import { useYear } from './YearContext'
import { getMemberDashboard, type MemberDashboard } from './planning'
import { mockMemberDashboard, isMockEnabled } from './__fixtures__/memberDashboard'
import styles from './MemberDashboardPage.module.css'

const domainColors: Record<string, string> = {
  P01: 'var(--domain-P01)',
  P02: 'var(--domain-P02)',
  P03: 'var(--domain-P03)',
  C01: 'var(--domain-C01)',
  C02: 'var(--domain-C02)',
  C03: 'var(--domain-C03)',
}

function domainLabel(code: string): string {
  const labels: Record<string, string> = {
    P01: '数据基础设施',
    P02: 'AI Infra / Agent',
    P03: '工程编码',
    C01: '基本办公能力',
    C02: '沟通协作',
    C03: '学习创新',
  }
  return labels[code] ?? code
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
  const color = domainColors[code] ?? 'var(--color-gray-600)'
  return (
    <span className={styles.domainBadge}>
      <span className={styles.domainDot} style={{ background: color }} />
      {code} {domainLabel(code)}
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

function TodoItem({ label, value, tone }: { label: string; value: number; tone?: 'default' | 'danger' }) {
  const cls = tone === 'danger' ? `${styles.todoItem} ${styles.todoDanger}` : styles.todoItem
  return (
    <div className={cls}>
      <strong className={styles.todoValue}>{value}</strong>
      <span className={styles.todoLabel}>{label}</span>
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
  const year = useYear()
  const [dashboard, setDashboard] = useState<MemberDashboard | null>(null)
  const [error, setError] = useState('')
  const [selectedDomain, setSelectedDomain] = useState('全部')

  useEffect(() => {
    async function load() {
      try {
        if (isMockEnabled()) {
          setDashboard(mockMemberDashboard)
        } else {
          setDashboard(await getMemberDashboard(year))
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : '加载失败')
      }
    }
    load()
  }, [year])

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
    <section className="page">
      <header className="page-heading">
        <div>
          <p className="eyebrow">Member 工作台 · {dashboard?.year ?? year}</p>
          <h1>我的成长总览</h1>
          <p className="muted">将自评、Gap、年度计划与 Evidence 进展放在同一工作区。</p>
        </div>
        <a className="primary-link" href="/capability/assessment">进入能力自评</a>
      </header>
      {error && <p className="error" role="alert">{error}</p>}
      {!dashboard && !error && <p className="muted">正在加载成长数据…</p>}
      {dashboard && (<>
        <div className={styles.overview}>
          <article className={`card ${styles.progressCard}`}>
            <h2>年度计划进度</h2>
            <div className={styles.progressBody}>
              <div className={styles.ring} style={{ '--progress': `${completionRate * 3.6}deg` } as React.CSSProperties}>
                <strong className={styles.ringValue}>{completionRate}%</strong>
                <span className={styles.ringLabel}>整体进度</span>
              </div>
              <dl className={styles.statusList}>
                <div className={styles.statusItem}><dt>计划项</dt><dd>{total}</dd></div>
                <div className={styles.statusItem}><dt>已完成</dt><dd className="status-complete">{dashboard.plan_progress.已完成}</dd></div>
                <div className={styles.statusItem}><dt>进行中</dt><dd>{dashboard.plan_progress.进行中}</dd></div>
                <div className={styles.statusItem}><dt>未开始</dt><dd>{dashboard.plan_progress.未开始}</dd></div>
                <div className={styles.statusItem}><dt>延期</dt><dd className={styles.overdue}>{dashboard.plan_progress.延期}</dd></div>
              </dl>
            </div>
            <a href="/growth/annual-plan">查看年度计划</a>
          </article>
          <article className={`card ${styles.hoursCard}`} data-testid="learning-hours-card">
            <h2>学习时长</h2>
            <div className={styles.metricGrid}>
              <div className={styles.metric}><span>全年累计时长</span><strong>{formatHours(dashboard.summary.annual_actual_hours)}</strong></div>
              <div className={styles.metric}><span>全年计划时长</span><strong>{formatHours(dashboard.summary.annual_planned_hours)}</strong></div>
              <div className={styles.metric}><span>当月累计时长</span><strong>{formatHours(dashboard.summary.current_month_actual_hours)}</strong></div>
              <div className={styles.metric}><span>当月计划时长</span><strong>{formatHours(dashboard.summary.current_month_planned_hours)}</strong></div>
            </div>
            <a href="/growth/review/monthly">查看月度复盘</a>
          </article>
          <article className={`card ${styles.todoCard}`} data-testid="todo-card">
            <h2>待办事项</h2>
            <div className={styles.todoGrid}>
              <TodoItem label="待提交 Evidence" value={dashboard.summary.pending_evidence_count} />
              <TodoItem label="待 Buddy 复核" value={dashboard.plan_progress['待 Evidence Review']} />
              <TodoItem label="计划到期" value={dashboard.plan_progress.延期} tone="danger" />
              <TodoItem label="学习任务延期" value={overdueTasks} tone="danger" />
            </div>
          </article>
        </div>
        <section className={`card ${styles.abilitySection}`}>
          <div className={styles.abilityHead}>
            <h2>能力分析</h2>
            <span className="muted">选择能力域查看对应 Gap</span>
          </div>
          <div className={styles.domainFilter} data-testid="domain-filter">
            {['全部', ...dashboard.domain_radar.map(d => d.domain_code)].map(domain => (
              <button aria-pressed={selectedDomain === domain} className={selectedDomain === domain ? 'active' : ''} key={domain} onClick={() => setSelectedDomain(domain)} type="button">
                {domain === '全部' ? domain : `${domain} ${domainLabel(domain)}`}
              </button>
            ))}
          </div>
          <div className={styles.abilityGrid}>
            <article><h3>个人能力雷达图</h3><Radar data={dashboard.domain_radar} gaps={dashboard.gaps} /></article>
            <article>
              <h3>Gap 概览</h3>
              {filteredGaps.length === 0 ? <p className="muted">当前范围暂无 Gap。</p> : (
                <table className={styles.gapTable}>
                  <thead><tr><th>能力域 / L3</th><th>当前</th><th>目标</th><th>Gap</th><th>优先级</th></tr></thead>
                  <tbody>
                    {filteredGaps.slice(0, 8).map(gap => {
                      const dc = gap.l3_code.slice(0, 3)
                      return (<tr key={gap.id}>
                        <td><DomainBadge code={dc} /><span className={styles.l3Name}>{gap.l3_name ?? gap.l3_code}</span></td>
                        <td>{gap.current_level}</td><td>{gap.target_level}</td>
                        <td className={styles.gapValue}>{gap.gap_value}</td><td>{gap.priority}</td>
                      </tr>)
                    })}
                  </tbody>
                </table>
              )}
              <a href="/capability/assessment">查看 Gap 分析</a>
            </article>
          </div>
        </section>
        <article className={`card ${styles.tasksSection}`}>
          <div className={styles.tasksHead}>
            <h2>当前学习任务</h2>
            <a href="/growth/annual-plan">进入任务与 Evidence</a>
          </div>
          {dashboard.current_tasks.length === 0 ? <p className="muted">暂无进行中的学习任务。</p> : (
            <table data-testid="current-tasks-table">
              <thead><tr><th>任务名称</th><th>所属能力域 / L3</th><th>计划月份</th><th>预计时长</th><th>实际时长</th><th>进度</th><th>状态</th></tr></thead>
              <tbody>
                {dashboard.current_tasks.map(task => {
                  const est = Number(task.plan_item_estimated_hours ?? 0)
                  const prog = est > 0 ? Math.round((task.actual_hours / est) * 100) : 0
                  const dc = task.l3_code.slice(0, 3)
                  const name = task.plan_item_learning_task_content?.trim() || task.l3_name || task.l3_code
                  const statusClass = task.status === '已完成' ? styles.statusComplete : task.status === '延期' ? styles.statusOverdue : task.status === '进行中' ? styles.statusInProgress : ''
                  return (<tr key={task.id}>
                    <td><span className={styles.taskName}>{name}</span></td>
                    <td><DomainBadge code={dc} /><span className={styles.l3Name}>{task.l3_name ?? task.l3_code}</span></td>
                    <td>{task.plan_item_target_month ? `${task.plan_item_target_month} 月` : '未排期'}</td>
                    <td>{formatHours(task.plan_item_estimated_hours)}</td>
                    <td>{formatHours(task.actual_hours)}</td>
                    <td><progress max={100} value={Math.min(prog, 100)} /> {prog}%</td>
                    <td><span className={`${styles.statusPill} ${statusClass}`}>{task.status}</span></td>
                  </tr>)
                })}
              </tbody>
            </table>
          )}
        </article>
      </>)}
    </section>
  )
}

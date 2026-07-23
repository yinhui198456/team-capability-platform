import { useEffect, useMemo, useRef, useState } from 'react'

import { useMe } from './catalog'
import { useYear } from './YearContext'
import { getTeamAnalytics, type TeamAnalytics } from './planning'

const domainLabels: Record<string, string> = {
  P01: 'Data Infra',
  P02: 'AI Infra / Agent',
  P03: 'Coding',
  C01: '基本办公',
  C02: '沟通协作',
  C03: '学习创新',
}

const domains = Object.keys(domainLabels)

function percent(value: number) {
  return `${Math.round(value * 100)}%`
}

function heatColor(value: number | null) {
  if (value === null) return '#f2f4f7'
  if (value >= 80) return '#d1fadf'
  if (value >= 60) return '#fef0c7'
  return '#fecdca'
}

function TrendLegend() {
  return (
    <ul className="trend-legend" aria-label="趋势图例">
      <li>
        <span className="legend-swatch bar planned" />
        当月计划
      </li>
      <li>
        <span className="legend-swatch bar actual" />
        当月实际
      </li>
      <li>
        <span className="legend-swatch line planned" />
        累计计划
      </li>
      <li>
        <span className="legend-swatch line actual" />
        累计实际
      </li>
    </ul>
  )
}

function TrendTable({
  trends,
  hours,
}: {
  trends: TeamAnalytics['monthly_trends']
  hours: boolean
}) {
  const maxValue = Math.max(
    1,
    ...trends.flatMap((trend) =>
      hours
        ? [trend.planned_hours, trend.actual_hours]
        : [trend.planned_count, trend.actual_count],
    ),
  )
  const cumulativeActual = (trend: TeamAnalytics['monthly_trends'][number]) =>
    hours ? trend.cumulative_actual_hours : trend.cumulative_actual_rate * 100
  const cumulativePlan = (trend: TeamAnalytics['monthly_trends'][number]) =>
    hours ? trend.cumulative_planned_hours : trend.cumulative_planned_rate * 100
  const maxCumulative = Math.max(
    1,
    ...trends.flatMap((trend) => [
      cumulativeActual(trend),
      cumulativePlan(trend),
    ]),
  )
  const points = (
    value: (trend: TeamAnalytics['monthly_trends'][number]) => number,
  ) =>
    trends
      .map(
        (trend, index) =>
          `${(index / Math.max(1, trends.length - 1)) * 100},${100 - (value(trend) / maxCumulative) * 90}`,
      )
      .join(' ')
  return (
    <>
      <TrendLegend />
      <figure
        className="trend-chart"
        aria-label={hours ? '学习时长组合图' : '计划完成组合图'}
      >
        <div className="trend-bars">
          {trends.map((trend) => (
            <div key={trend.month}>
              <i
                style={{
                  height: `${((hours ? trend.planned_hours : trend.planned_count) / maxValue) * 100}%`,
                }}
              />
              <i
                className="actual"
                style={{
                  height: `${((hours ? trend.actual_hours : trend.actual_count) / maxValue) * 100}%`,
                }}
              />
              <span>{trend.month}</span>
            </div>
          ))}
        </div>
        <svg
          viewBox="0 0 100 100"
          preserveAspectRatio="none"
          aria-hidden="true"
        >
          <polyline points={points(cumulativePlan)} />
          <polyline className="actual" points={points(cumulativeActual)} />
        </svg>
      </figure>
      <table className="analytics-table">
        <thead>
          <tr>
            <th>月份</th>
            <th>{hours ? '当月计划时长' : '当月计划'}</th>
            <th>{hours ? '当月实际时长' : '当月实际'}</th>
            <th>{hours ? '累计计划时长' : '累计计划'}</th>
            <th>{hours ? '累计实际时长' : '累计实际'}</th>
          </tr>
        </thead>
        <tbody>
          {trends.map((trend) => (
            <tr key={trend.month}>
              <td>{trend.month}月</td>
              <td>
                {hours ? `${trend.planned_hours} h` : trend.planned_count}
              </td>
              <td>{hours ? `${trend.actual_hours} h` : trend.actual_count}</td>
              <td>
                {hours
                  ? `${trend.cumulative_planned_hours} h`
                  : percent(trend.cumulative_planned_rate)}
              </td>
              <td>
                {hours
                  ? `${trend.cumulative_actual_hours} h`
                  : percent(trend.cumulative_actual_rate)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  )
}

export function TeamAnalyticsPage() {
  const year = useYear()
  const { user, isLeader } = useMe()
  const [memberId, setMemberId] = useState('')
  const [domainCode, setDomainCode] = useState('')
  const [analytics, setAnalytics] = useState<TeamAnalytics | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [drawerItem, setDrawerItem] = useState<
    TeamAnalytics['overdue_items'][number] | null
  >(null)
  const lastFocusedRow = useRef<HTMLTableRowElement | null>(null)
  const closeButtonRef = useRef<HTMLButtonElement | null>(null)

  useEffect(() => {
    if (!isLeader) return
    setLoading(true)
    setError('')
    getTeamAnalytics({
      year,
      ...(memberId ? { member_id: Number(memberId) } : {}),
      ...(domainCode ? { domain_code: domainCode } : {}),
    })
      .then(
        (result) => setAnalytics(result),
        (reason) =>
          setError(reason instanceof Error ? reason.message : '加载失败'),
      )
      .finally(() => setLoading(false))
  }, [year, memberId, domainCode, isLeader])

  useEffect(() => {
    if (!drawerItem) return
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        setDrawerItem(null)
      }
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [drawerItem])

  useEffect(() => {
    if (drawerItem) {
      closeButtonRef.current?.focus()
    } else if (lastFocusedRow.current) {
      lastFocusedRow.current.focus()
    }
  }, [drawerItem])

  const members = useMemo(() => {
    const seen = new Map<number, string>()
    analytics?.member_attainment.forEach((item) => {
      seen.set(item.member_id, item.full_name)
    })
    return [...seen]
  }, [analytics])

  function openDrawer(
    item: TeamAnalytics['overdue_items'][number],
    row: HTMLTableRowElement,
  ) {
    lastFocusedRow.current = row
    setDrawerItem(item)
  }

  if (!user)
    return (
      <section className="page">
        <p className="muted">正在加载用户信息…</p>
      </section>
    )
  if (!isLeader) {
    return (
      <section className="page">
        <p className="muted">无权限，仅 Leader 可查看团队能力分析。</p>
      </section>
    )
  }

  return (
    <section className="page dashboard-page">
      <header className="page-heading">
        <div>
          <p className="eyebrow">团队运营 · 团队</p>
          <h1>团队能力分析</h1>
          <p className="muted">实际能力、计划执行与学习投入的只读团队视图。</p>
        </div>
      </header>
      <div className="analytics-filters" aria-label="团队能力分析筛选">
        <label>
          成员
          <select
            aria-label="成员"
            value={memberId}
            onChange={(event) => setMemberId(event.target.value)}
          >
            <option value="">全部</option>
            {members.map(([id, name]) => (
              <option key={id} value={id}>
                {name}
              </option>
            ))}
          </select>
        </label>
        <label>
          能力域
          <select
            aria-label="能力域"
            value={domainCode}
            onChange={(event) => setDomainCode(event.target.value)}
          >
            <option value="">全部</option>
            {domains.map((code) => (
              <option key={code} value={code}>
                {code} · {domainLabels[code]}
              </option>
            ))}
          </select>
        </label>
      </div>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {loading && !analytics && <p className="muted">正在加载团队数据…</p>}
      {analytics && (
        <>
          <div className="metric-grid" aria-label="团队关键指标">
            <article>
              <span>计划完成率</span>
              <strong>{percent(analytics.kpis.plan_completion_rate)}</strong>
              <small>
                {analytics.kpis.plan_completed_count} /{' '}
                {analytics.kpis.plan_total_count} 项
              </small>
            </article>
            <article>
              <span>Evidence 通过率</span>
              <strong>{percent(analytics.kpis.evidence_pass_rate)}</strong>
              <small>
                {analytics.kpis.evidence_passed_count} /{' '}
                {analytics.kpis.evidence_total_count} 项
              </small>
            </article>
            <article>
              <span>延期计划项</span>
              <strong>{analytics.kpis.overdue_plan_item_count}</strong>
              <small>待跟进</small>
            </article>
          </div>
          <div className="dashboard-grid">
            <article className="dashboard-card">
              <h2>能力实际 vs 计划</h2>
              <table className="analytics-table">
                <thead>
                  <tr>
                    <th>能力域</th>
                    <th>实际</th>
                    <th>计划值</th>
                  </tr>
                </thead>
                <tbody>
                  {analytics.domain_averages.map((item) => (
                    <tr key={item.domain_code}>
                      <td>
                        {item.domain_code} · {domainLabels[item.domain_code]}
                      </td>
                      <td>
                        <progress
                          aria-label={`${item.domain_code}实际`}
                          max={5}
                          value={item.actual}
                        />{' '}
                        {item.actual}
                      </td>
                      <td>
                        <progress
                          aria-label={`${item.domain_code}计划值`}
                          max={5}
                          value={item.target}
                        />{' '}
                        {item.target}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </article>
            <article className="dashboard-card">
              <h2>成员能力达成率</h2>
              <table className="analytics-table">
                <thead>
                  <tr>
                    <th>成员</th>
                    {analytics.domain_averages.map((item) => (
                      <th key={item.domain_code}>{item.domain_code}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {members.map(([id, name]) => (
                    <tr key={id}>
                      <td>{name}</td>
                      {analytics.domain_averages.map((domain) => {
                        const item = analytics.member_attainment.find(
                          (entry) =>
                            entry.member_id === id &&
                            entry.domain_code === domain.domain_code,
                        )
                        return (
                          <td
                            key={domain.domain_code}
                            style={{
                              background: heatColor(item?.attainment ?? null),
                            }}
                          >
                            {item?.attainment === null || !item
                              ? '—'
                              : `${Math.round(item.attainment)}%`}
                          </td>
                        )
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </article>
          </div>
          <div className="dashboard-grid">
            <article className="dashboard-card">
              <h2>计划完成趋势</h2>
              <TrendTable trends={analytics.monthly_trends} hours={false} />
            </article>
            <article className="dashboard-card">
              <h2>学习时长趋势</h2>
              <TrendTable trends={analytics.monthly_trends} hours />
            </article>
          </div>
          <article className="dashboard-card">
            <h2>延期计划项明细</h2>
            {analytics.overdue_items.length === 0 ? (
              <p className="muted">暂无延期计划项。</p>
            ) : (
              <table className="analytics-table">
                <thead>
                  <tr>
                    <th>成员</th>
                    <th>L3 能力项</th>
                    <th>计划截止日期</th>
                    <th>延期天数</th>
                    <th>状态</th>
                  </tr>
                </thead>
                <tbody>
                  {analytics.overdue_items.map((item) => (
                    <tr
                      className="clickable"
                      key={`${item.member_id}-${item.l3_code}`}
                      onClick={(event) => openDrawer(item, event.currentTarget)}
                      role="button"
                      tabIndex={0}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault()
                          openDrawer(item, e.currentTarget)
                        }
                      }}
                    >
                      <td>{item.full_name}</td>
                      <td>
                        {item.l3_code}
                        {item.l3_name ? ` · ${item.l3_name}` : ''}
                      </td>
                      <td>{item.due_date}</td>
                      <td>{item.overdue_days}</td>
                      <td>{item.status}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </article>
          {drawerItem && (
            <aside
              aria-label="延期计划项详情"
              className="detail-drawer"
              role="dialog"
            >
              <div
                className="detail-drawer-mask"
                onClick={() => setDrawerItem(null)}
              />
              <div className="detail-drawer-panel" role="document">
                <div className="card-heading">
                  <h2>延期计划项详情</h2>
                  <span className="readonly-badge">只读</span>
                  <button
                    ref={closeButtonRef}
                    aria-label="关闭详情"
                    onClick={() => setDrawerItem(null)}
                    type="button"
                  >
                    ✕
                  </button>
                </div>
                <dl>
                  <dt>成员</dt>
                  <dd>{drawerItem.full_name}</dd>
                  <dt>能力项</dt>
                  <dd>
                    {drawerItem.l3_code}
                    {drawerItem.l3_name ? ` · ${drawerItem.l3_name}` : ''}
                  </dd>
                  <dt>计划开始日期</dt>
                  <dd>{drawerItem.plan_start_date}</dd>
                  <dt>计划结束日期</dt>
                  <dd>{drawerItem.plan_end_date}</dd>
                  <dt>延期天数</dt>
                  <dd>{drawerItem.overdue_days} 天</dd>
                  <dt>当前状态</dt>
                  <dd>{drawerItem.status}</dd>
                  <dt>延期原因</dt>
                  <dd>
                    计划项未在截止日期前完成，当前状态为「{drawerItem.status}
                    」。
                  </dd>
                  <dt>下一步行动</dt>
                  <dd>
                    建议与 {drawerItem.full_name}{' '}
                    一对一沟通，了解阻塞原因并商定新的计划完成时间。如计划已不再适用，可取消并重新规划。
                  </dd>
                </dl>
              </div>
            </aside>
          )}
        </>
      )}
    </section>
  )
}

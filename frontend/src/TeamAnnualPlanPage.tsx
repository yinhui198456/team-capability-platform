import { useEffect, useState, type FormEvent } from 'react'

import {
  enabledDomains,
  useCatalog,
  useMe,
  type CapabilityModel,
} from './catalog'
import {
  archiveTeamAnnualPlan,
  formatCapabilityPath,
  getTeamAnnualPlan,
  getTeamAnnualPlanItems,
  listChangeProposals,
  publishTeamAnnualPlan,
  updateTeamAnnualPlan,
  type ChangeProposal,
  type TeamAnnualCapabilityPlan,
  type TeamAnnualPlanItem,
  type TeamAnnualPlanItemList,
  type TeamAnnualPlanItemSummary,
  type TeamAnnualPlanMember,
  type TeamAnnualPlanSave,
} from './planning'
import {
  formatEstimatedHours,
  formatEstimatedHoursSummary,
} from './estimatedHours'

const PAGE_SIZE_OPTIONS = [10, 20, 50]

const SORT_OPTIONS: { value: string; label: string }[] = [
  { value: 'plan_month', label: '计划月份' },
  { value: 'priority', label: '优先级' },
  { value: 'status', label: '状态' },
  { value: 'l3_code', label: '三级路径编码' },
  { value: 'member_id', label: '成员' },
]

function priorityClass(priority: string) {
  if (priority === '高') return 'priority-high'
  if (priority === '中') return 'priority-medium'
  return 'priority-low'
}

function statusClass(status: string) {
  if (status === '已完成') return 'status-completed'
  if (status === '进行中') return 'status-in-progress'
  if (status === '延期') return 'status-delayed'
  if (status === '暂停') return 'status-paused'
  if (status === '取消') return 'status-cancelled'
  return 'status-not-started'
}

export function TeamAnnualPlanPage() {
  const currentYear = new Date().getFullYear()
  const [year, setYear] = useState(currentYear)
  const { user, isLeader, isAdmin, isBuddy, isMember } = useMe()
  const { data: model } = useCatalog<CapabilityModel>('/api/capability-model')
  const domains = enabledDomains(model)

  const canView = isMember || isBuddy || isLeader || isAdmin

  const [plan, setPlan] = useState<TeamAnnualCapabilityPlan | null>(null)
  const [focusDomains, setFocusDomains] = useState<Set<string>>(new Set())
  const [resourceArrangement, setResourceArrangement] = useState('')
  const [description, setDescription] = useState('')
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [archiving, setArchiving] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [proposals, setProposals] = useState<ChangeProposal[]>([])
  const [sourceLoading, setSourceLoading] = useState(false)

  // #64 Phase 2: read-only formal PlanItem list for all authorized roles.
  const [items, setItems] = useState<TeamAnnualPlanItem[]>([])
  const [itemsMeta, setItemsMeta] = useState<
    TeamAnnualPlanItemList['meta'] | null
  >(null)
  const [itemsPagination, setItemsPagination] = useState<
    TeamAnnualPlanItemList['pagination'] | null
  >(null)
  const [itemsSummary, setItemsSummary] =
    useState<TeamAnnualPlanItemSummary | null>(null)
  const [itemsMembers, setItemsMembers] = useState<TeamAnnualPlanMember[]>([])
  const [itemsLoading, setItemsLoading] = useState(false)
  const [itemsError, setItemsError] = useState('')

  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(20)
  const [sortBy, setSortBy] = useState('plan_month')
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('asc')

  const [filterDomain, setFilterDomain] = useState('')
  const [filterPriority, setFilterPriority] = useState('')
  const [filterStatus, setFilterStatus] = useState('')
  const [filterQuarter, setFilterQuarter] = useState('')
  const [filterMonth, setFilterMonth] = useState('')
  const [filterMemberId, setFilterMemberId] = useState('')
  const [filterQ, setFilterQ] = useState('')

  async function load() {
    if (!isLeader) return
    setLoading(true)
    setError('')
    try {
      const result = await getTeamAnnualPlan(year)
      setPlan(result)
      setFocusDomains(new Set(result?.focus_domains ?? []))
      setResourceArrangement(result?.resource_arrangement ?? '')
      setDescription(result?.description ?? '')
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载失败')
      setPlan(null)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [year, isLeader])

  useEffect(() => {
    if (!isLeader) return
    let cancelled = false
    async function loadSources() {
      setSourceLoading(true)
      try {
        const proposalList = await listChangeProposals(year)
        if (!cancelled) setProposals(proposalList)
      } catch {
        // non-fatal: the proposals section stays empty
      }
      if (!cancelled) setSourceLoading(false)
    }
    loadSources()
    return () => {
      cancelled = true
    }
  }, [year, isLeader])

  useEffect(() => {
    if (!canView) return
    let cancelled = false
    setItemsLoading(true)
    setItemsError('')
    getTeamAnnualPlanItems({
      year,
      page,
      page_size: pageSize,
      sort_by: sortBy,
      sort_order: sortOrder,
      ...(filterDomain ? { domain_code: filterDomain } : {}),
      ...(filterPriority ? { priority: filterPriority } : {}),
      ...(filterStatus ? { status: filterStatus } : {}),
      ...(filterQuarter ? { quarter: filterQuarter } : {}),
      ...(filterMonth ? { month: Number(filterMonth) } : {}),
      ...(filterMemberId ? { member_id: Number(filterMemberId) } : {}),
      ...(filterQ ? { q: filterQ } : {}),
    })
      .then((result) => {
        if (cancelled) return
        setItems(result.items)
        setItemsMeta(result.meta)
        setItemsPagination(result.pagination)
        setItemsSummary(result.summary)
        setItemsMembers(result.members ?? [])
      })
      .catch((reason) => {
        if (cancelled) return
        setItemsError(reason instanceof Error ? reason.message : '加载失败')
      })
      .finally(() => {
        if (!cancelled) setItemsLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [
    year,
    page,
    pageSize,
    sortBy,
    sortOrder,
    filterDomain,
    filterPriority,
    filterStatus,
    filterQuarter,
    filterMonth,
    filterMemberId,
    filterQ,
    canView,
  ])

  const membersInScope =
    itemsMembers.length > 0
      ? itemsMembers
      : Array.from(
          new Map(items.map((item) => [item.member_id, item.full_name])),
        ).map(([id, full_name]) => ({ member_id: id, username: '', full_name }))

  function toggleDomain(code: string) {
    if (!isLeader || plan?.status === '已归档') return
    const next = new Set(focusDomains)
    if (next.has(code)) next.delete(code)
    else next.add(code)
    setFocusDomains(next)
  }

  async function save(
    action: (body: TeamAnnualPlanSave) => Promise<TeamAnnualCapabilityPlan>,
    label: string,
  ) {
    setSaving(true)
    setError('')
    setSuccess('')
    try {
      const body: TeamAnnualPlanSave = {
        year,
        focus_domain_codes: Array.from(focusDomains),
        resource_arrangement: resourceArrangement,
        description,
      }
      const result = await action(body)
      setPlan(result)
      setFocusDomains(new Set(result.focus_domains))
      setResourceArrangement(result.resource_arrangement ?? '')
      setDescription(result.description ?? '')
      setSuccess(`${label}成功`)
    } catch (err) {
      setError(err instanceof Error ? err.message : `${label}失败`)
    } finally {
      setSaving(false)
    }
  }

  async function handlePublish(event: FormEvent) {
    event.preventDefault()
    await save(publishTeamAnnualPlan, '发布')
  }

  async function handleUpdate(event: FormEvent) {
    event.preventDefault()
    await save(updateTeamAnnualPlan, '更新')
  }

  async function handleArchive() {
    setArchiving(true)
    setError('')
    setSuccess('')
    try {
      await archiveTeamAnnualPlan(year)
      setSuccess('归档成功')
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : '归档失败')
    } finally {
      setArchiving(false)
    }
  }

  const readOnly = !isLeader || plan?.status === '已归档'
  const canManage = isLeader && plan?.status !== '已归档'

  return (
    <section className="page">
      <header className="page-heading">
        <div>
          <p className="eyebrow">团队运营 · 团队</p>
          <h1>团队年度能力规划</h1>
        </div>
        {isLeader && (
          <button
            type="button"
            onClick={load}
            disabled={loading}
            aria-busy={loading}
          >
            {loading ? '刷新中…' : '刷新'}
          </button>
        )}
      </header>

      {!user && <p className="muted">正在加载用户信息…</p>}
      {user && !canView && (
        <p className="muted">
          无权限，需要 Member、Buddy、Leader 或 Admin 角色。
        </p>
      )}

      {isLeader && error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {isLeader && success && (
        <p className="warning" role="status">
          {success}
        </p>
      )}
      {itemsError && (
        <p className="error" role="alert">
          {itemsError}
        </p>
      )}

      {canView && (
        <section className="plan-overview" aria-label="团队年度计划正式项列表">
          <h2>团队年度计划正式项</h2>
          {itemsMeta && (
            <p className="muted">
              数据范围：{itemsMeta.scope} · 统计时间：
              {itemsMeta.as_of
                ? new Date(itemsMeta.as_of).toLocaleString('zh-CN')
                : '-'}
            </p>
          )}

          <div className="analytics-filters" aria-label="年度计划项筛选与排序">
            <label>
              年度
              <input
                type="number"
                aria-label="年度计划项年度"
                value={year}
                onChange={(event) => {
                  const value = parseInt(event.target.value, 10)
                  if (!Number.isNaN(value)) {
                    setYear(value)
                    setPage(1)
                  }
                }}
              />
            </label>

            <label>
              能力域
              <select
                aria-label="能力域筛选"
                value={filterDomain}
                onChange={(event) => {
                  setFilterDomain(event.target.value)
                  setPage(1)
                }}
              >
                <option value="">全部</option>
                {domains.map((domain) => (
                  <option key={domain.code} value={domain.code}>
                    {domain.code} · {domain.name}
                  </option>
                ))}
              </select>
            </label>

            <label>
              优先级
              <select
                aria-label="优先级筛选"
                value={filterPriority}
                onChange={(event) => {
                  setFilterPriority(event.target.value)
                  setPage(1)
                }}
              >
                <option value="">全部</option>
                <option value="高">高</option>
                <option value="中">中</option>
                <option value="低">低</option>
              </select>
            </label>

            <label>
              状态
              <select
                aria-label="状态筛选"
                value={filterStatus}
                onChange={(event) => {
                  setFilterStatus(event.target.value)
                  setPage(1)
                }}
              >
                <option value="">全部</option>
                <option value="未开始">未开始</option>
                <option value="进行中">进行中</option>
                <option value="已完成">已完成</option>
                <option value="延期">延期</option>
                <option value="暂停">暂停</option>
                <option value="取消">取消</option>
              </select>
            </label>

            <label>
              季度
              <select
                aria-label="季度筛选"
                value={filterQuarter}
                onChange={(event) => {
                  setFilterQuarter(event.target.value)
                  setPage(1)
                }}
              >
                <option value="">全部</option>
                <option value="Q1">Q1</option>
                <option value="Q2">Q2</option>
                <option value="Q3">Q3</option>
                <option value="Q4">Q4</option>
              </select>
            </label>

            <label>
              月份
              <select
                aria-label="月份筛选"
                value={filterMonth}
                onChange={(event) => {
                  setFilterMonth(event.target.value)
                  setPage(1)
                }}
              >
                <option value="">全部</option>
                {Array.from({ length: 12 }, (_, index) => index + 1).map(
                  (month) => (
                    <option key={month} value={month}>
                      {month}月
                    </option>
                  ),
                )}
              </select>
            </label>

            <label>
              成员
              <select
                aria-label="成员筛选"
                value={filterMemberId}
                onChange={(event) => {
                  setFilterMemberId(event.target.value)
                  setPage(1)
                }}
              >
                <option value="">全部</option>
                {membersInScope.map((member) => (
                  <option key={member.member_id} value={member.member_id}>
                    {member.full_name}
                  </option>
                ))}
              </select>
            </label>

            <label>
              搜索
              <input
                type="search"
                aria-label="搜索计划项"
                placeholder="路径、能力项或成员"
                value={filterQ}
                onChange={(event) => {
                  setFilterQ(event.target.value)
                  setPage(1)
                }}
              />
            </label>

            <label>
              排序
              <select
                aria-label="排序字段"
                value={sortBy}
                onChange={(event) => {
                  setSortBy(event.target.value)
                  setPage(1)
                }}
              >
                {SORT_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>

            <label>
              顺序
              <select
                aria-label="排序顺序"
                value={sortOrder}
                onChange={(event) => {
                  setSortOrder(event.target.value as 'asc' | 'desc')
                  setPage(1)
                }}
              >
                <option value="asc">升序</option>
                <option value="desc">降序</option>
              </select>
            </label>

            <label>
              每页
              <select
                aria-label="每页条数"
                value={pageSize}
                onChange={(event) => {
                  setPageSize(Number(event.target.value))
                  setPage(1)
                }}
              >
                {PAGE_SIZE_OPTIONS.map((size) => (
                  <option key={size} value={size}>
                    {size}
                  </option>
                ))}
              </select>
            </label>
          </div>

          {itemsSummary && (
            <div className="analytics-kpis" aria-label="年度计划项汇总">
              <div className="kpi-card">
                <span className="kpi-value">{itemsSummary.total_count}</span>
                <span className="kpi-label">计划项数</span>
              </div>
              <div className="kpi-card">
                <span className="kpi-value">
                  {(() => {
                    const value = formatEstimatedHoursSummary({
                      min_hours: itemsSummary.planned_hours_min,
                      max_hours: itemsSummary.planned_hours_max,
                      has_values: itemsSummary.has_values,
                      has_unparsed: itemsSummary.has_unparsed,
                    })
                    return itemsSummary.has_unparsed
                      ? `${value}（部分文本未计入）`
                      : value
                  })()}
                </span>
                <span className="kpi-label">预计时长</span>
              </div>
              <div className="kpi-card">
                <span className="kpi-value">{itemsSummary.actual_hours}</span>
                <span className="kpi-label">实际时长</span>
              </div>
              <div className="kpi-card">
                <span className="kpi-value">
                  {itemsSummary.status_breakdown.已完成}/
                  {itemsSummary.status_breakdown.total}
                </span>
                <span className="kpi-label">已完成/总数</span>
              </div>
            </div>
          )}

          {itemsLoading && items.length === 0 && (
            <p className="muted">正在加载年度计划项…</p>
          )}

          {!itemsLoading && items.length === 0 && (
            <p className="muted">当前筛选条件下无正式年度计划项。</p>
          )}

          {items.length > 0 && (
            <>
              <table className="analytics-table">
                <thead>
                  <tr>
                    <th>成员</th>
                    <th>能力路径</th>
                    <th>优先级</th>
                    <th>月份</th>
                    <th>季度</th>
                    <th>状态</th>
                    <th>当前 → 目标</th>
                    <th>预计时长</th>
                    <th>实际时长</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((item) => (
                    <tr key={item.id}>
                      <td>{item.full_name}</td>
                      <td>{formatCapabilityPath(item)}</td>
                      <td>
                        <span className={priorityClass(item.priority)}>
                          {item.priority}
                        </span>
                      </td>
                      <td>{item.plan_month ? `${item.plan_month}月` : '-'}</td>
                      <td>{item.plan_quarter ?? '-'}</td>
                      <td>
                        <span className={statusClass(item.status)}>
                          {item.status}
                        </span>
                      </td>
                      <td>
                        {item.current_level} → {item.target_level}
                      </td>
                      <td>
                        {formatEstimatedHours(
                          item.estimated_hours,
                          item.estimated_hours_parsed,
                        )}
                      </td>
                      <td>{item.actual_hours ?? 0}</td>
                    </tr>
                  ))}
                </tbody>
              </table>

              <div
                className="form-actions"
                aria-label="分页"
                style={{ justifyContent: 'center', marginTop: '1rem' }}
              >
                <button
                  type="button"
                  onClick={() =>
                    setPage((previous) => Math.max(1, previous - 1))
                  }
                  disabled={page <= 1 || itemsLoading}
                >
                  上一页
                </button>
                <span className="muted">
                  第 {page} / {itemsPagination?.total_pages ?? 1} 页，共{' '}
                  {itemsPagination?.total_count ?? 0} 条
                </span>
                <button
                  type="button"
                  onClick={() =>
                    setPage((previous) =>
                      previous < (itemsPagination?.total_pages ?? 1)
                        ? previous + 1
                        : previous,
                    )
                  }
                  disabled={
                    page >= (itemsPagination?.total_pages ?? 1) || itemsLoading
                  }
                >
                  下一页
                </button>
              </div>
            </>
          )}
        </section>
      )}

      {isLeader && (
        <form className="plan-overview" onSubmit={handlePublish}>
          <h2>团队年度能力规划管理</h2>

          <label>
            年度
            <input
              type="number"
              value={year}
              onChange={(event) => {
                const value = parseInt(event.target.value, 10)
                if (!Number.isNaN(value)) setYear(value)
              }}
              readOnly={readOnly}
            />
          </label>

          <fieldset className="link-set">
            <legend>重点能力域</legend>
            {domains.map((domain) => (
              <label className="checkbox" key={domain.code}>
                <input
                  type="checkbox"
                  checked={focusDomains.has(domain.code)}
                  onChange={() => toggleDomain(domain.code)}
                  readOnly={readOnly}
                />
                {domain.code} · {domain.name}
              </label>
            ))}
            {domains.length === 0 && <p className="muted">暂无可用能力域。</p>}
          </fieldset>

          <label>
            资源安排
            <input
              value={resourceArrangement}
              onChange={(event) => setResourceArrangement(event.target.value)}
              readOnly={readOnly}
            />
          </label>

          <label>
            说明
            <input
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              readOnly={readOnly}
            />
          </label>

          {plan && (
            <div className="plan-summary">
              <p>
                规划编码：{plan.code} · 年度：{plan.year} · 状态：{plan.status}
              </p>
              <p>
                重点能力域：
                {plan.focus_domains.length
                  ? plan.focus_domains.join('、')
                  : '未设置'}
              </p>
            </div>
          )}
          {!plan && !loading && (
            <p className="muted">当前年度尚未发布团队能力规划。</p>
          )}

          {canManage && (
            <div className="form-actions">
              {!plan ? (
                <button type="submit" disabled={saving} aria-busy={saving}>
                  {saving ? '发布中…' : '发布'}
                </button>
              ) : (
                <>
                  <button
                    type="button"
                    onClick={handleUpdate}
                    disabled={saving}
                    aria-busy={saving}
                  >
                    {saving ? '保存中…' : '更新'}
                  </button>
                  <button
                    type="button"
                    className="archive-button"
                    onClick={handleArchive}
                    disabled={archiving}
                    aria-busy={archiving}
                  >
                    {archiving ? '归档中…' : '归档'}
                  </button>
                </>
              )}
            </div>
          )}
        </form>
      )}

      {isLeader && (
        <section
          className="plan-overview"
          aria-label="成员年度计划变更提案（只读）"
        >
          <h2>成员年度计划变更提案（只读）</h2>
          {sourceLoading && <p className="muted">加载中…</p>}
          {!sourceLoading && proposals.length === 0 && (
            <p className="muted">当前年度暂无待处理变更提案。</p>
          )}
          {proposals.map((proposal) => (
            <div key={proposal.id} className="plan-summary">
              <p>
                <strong>
                  {proposal.summary.target_is_legacy ? '历史计划' : '正式计划'}{' '}
                  变更提案 #{proposal.id}
                </strong>
                · 来源评估 #{proposal.source_assessment_id}（版本{' '}
                {proposal.summary.source_assessment_version}，revision{' '}
                {proposal.summary.source_assessment_revision}）· 目标计划 #
                {proposal.target_annual_growth_plan_id} · 状态 {proposal.status}
              </p>
              <p className="muted">
                提案项 {proposal.summary.items_count} 项：仅只读展示，应用流程
                未开放。
              </p>
            </div>
          ))}
        </section>
      )}
    </section>
  )
}

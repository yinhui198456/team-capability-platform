import { useEffect, useMemo, useRef, useState } from 'react'

import {
  getAssessmentHistory,
  newIdempotencyKey,
  type AssessmentDetail,
  type AssessmentReview,
} from './assessment'
import {
  getAssessmentReviewSummary,
  getBuddyReviewWorkspace,
  listPendingReviews,
  submitReview,
  type BuddyReviewWorkspace,
  type PendingReview,
} from './assessmentReview'
import { useMe } from './catalog'
import {
  isMockEnabled,
  mockAssessmentDetails,
  mockAssessmentHistories,
  mockAssessmentReviewSummary,
  mockAssessmentReviews,
  mockAssignedMembers,
} from './__fixtures__/buddyReviewMock'
import { useYear } from './YearContext'
import type { ApiError } from './shared/api'

type QueueFilter = '全部待处理' | '自评复核'

type QueueItem = {
  key: string
  kind: 'assessment'
  review: PendingReview
  memberId: number
}

type HistoryItem = {
  id: number
  status: string
  conclusion: string | null
  feedback: string | null
  reviewed_at: string | null
}

type ReviewFilter =
  | '全部'
  | '当前职级必备且有Gap'
  | '目标职级进阶且有Gap'
  | '已纳入计划'
  | '暂缓'
  | '个人调整'
  | '数据异常'

function formatDateTime(value: string | null | undefined) {
  if (!value) return '未记录'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString('zh-CN')
}

function feedbackRequired(conclusion: string): boolean {
  return conclusion === '建议调整'
}

function matchesFilter(
  detail: AssessmentDetail,
  filter: ReviewFilter,
): boolean {
  const gap = (detail.gap_value ?? 0) > 0
  switch (filter) {
    case '全部':
      return true
    case '当前职级必备且有Gap':
      return detail.scope_type === 'current_required' && gap
    case '目标职级进阶且有Gap':
      return detail.scope_type === 'target_progressive' && gap
    case '已纳入计划':
      return detail.include_in_plan === true
    case '暂缓':
      return detail.member_priority === '暂缓'
    case '个人调整':
      return detail.target_adjusted === true
    case '数据异常':
      return detail.data_issue === true
  }
}

function workspaceFromMocks(
  review: PendingReview,
  details: AssessmentDetail[],
): BuddyReviewWorkspace {
  const assessed = details.filter((d) => d.current_level != null).length
  const gaps = details.filter((d) => (d.gap_value ?? 0) > 0)
  const inPlan = details.filter((d) => d.include_in_plan === true)
  const byQuarter = { Q1: 0, Q2: 0, Q3: 0, Q4: 0 }
  inPlan.forEach((d) => {
    if (d.plan_quarter) byQuarter[d.plan_quarter] += 1
  })
  const currentRequired = details.filter(
    (d) => d.scope_type === 'current_required',
  ).length
  return {
    assessment_id: review.assessment_id,
    member_id: review.member_id,
    year: review.year,
    version: review.version,
    assessment_status: review.assessment_status,
    revision: 0,
    member_current_level_snapshot: null,
    member_target_level_snapshot: null,
    standard_version: { id: null, label: null },
    summary: {
      total: details.length,
      current_required: currentRequired,
      target_progressive: details.length - currentRequired,
      assessed,
      gap_items: gaps.length,
      high: details.filter((d) => d.member_priority === '高').length,
      medium: details.filter((d) => d.member_priority === '中').length,
      low: details.filter((d) => d.member_priority === '低').length,
      hold: details.filter((d) => d.member_priority === '暂缓').length,
      in_plan: inPlan.length,
      by_quarter: byQuarter,
      adjustments: details.filter((d) => d.target_adjusted === true).length,
      data_issues: 0,
      existing_formal_plan: false,
      will_create_proposal: false,
      target_is_legacy: null,
    },
    details,
  }
}

export function BuddyReviewCenter() {
  const { user } = useMe()
  const year = useYear()
  const [assessmentReviews, setAssessmentReviews] = useState<PendingReview[]>(
    [],
  )
  const [summary, setSummary] = useState({
    assessmentPending: 0,
    completedThisYear: 0,
  })
  const [memberId, setMemberId] = useState<number | null>(null)
  const [queueFilter, setQueueFilter] = useState<QueueFilter>('全部待处理')
  const [selectedKey, setSelectedKey] = useState<string | null>(null)
  const [workspace, setWorkspace] = useState<BuddyReviewWorkspace | null>(null)
  const [reviewFilter, setReviewFilter] = useState<ReviewFilter>('全部')
  const [search, setSearch] = useState('')
  const [history, setHistory] = useState<HistoryItem[]>([])
  const [conclusion, setConclusion] = useState<'认可' | '建议调整' | ''>('')
  const [feedback, setFeedback] = useState('')
  const [message, setMessage] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  // Idempotency (P1-5): the key is bound to the exact payload fingerprint.
  // An unchanged retry (network loss) reuses the key so the server replays the
  // first response instead of writing twice; any change to conclusion or
  // feedback is a NEW operation with a NEW key; a revision 409 keeps the input,
  // refreshes the workspace revision and starts a new key.
  const idemRef = useRef<{ key: string; fingerprint: string } | null>(null)

  const members = useMemo(() => {
    if (isMockEnabled()) return mockAssignedMembers
    return (user?.assigned_members ?? []) as {
      id: number
      username: string
      full_name: string
    }[]
  }, [user])

  const queueItems = useMemo<QueueItem[]>(() => {
    const assignedIds = new Set(members.map((member) => member.id))
    return assessmentReviews
      .map((review) => ({
        key: `assessment-${review.id}`,
        kind: 'assessment' as const,
        review,
        memberId: review.member_id,
      }))
      .filter((item) => assignedIds.has(item.memberId))
  }, [assessmentReviews, members])

  const memberName = (id: number) =>
    members.find((member) => member.id === id)?.full_name ?? `成员 ${id}`

  const filteredQueue = queueItems.filter((item) => {
    if (memberId !== null && item.memberId !== memberId) return false
    return (
      queueFilter === '全部待处理' ||
      (queueFilter === '自评复核' && item.kind === 'assessment')
    )
  })

  const selected =
    filteredQueue.find((item) => item.key === selectedKey) ??
    filteredQueue[0] ??
    null

  useEffect(() => {
    if (isMockEnabled()) {
      setAssessmentReviews(mockAssessmentReviews)
      setSummary({
        assessmentPending: mockAssessmentReviewSummary.pending_count,
        completedThisYear: mockAssessmentReviewSummary.completed_count,
      })
      return
    }

    let active = true
    async function load() {
      try {
        const [assessments, assessmentSummary] = await Promise.all([
          listPendingReviews(),
          getAssessmentReviewSummary(year),
        ])
        if (!active) return
        setAssessmentReviews(assessments)
        setSummary({
          assessmentPending: assessmentSummary.pending_count,
          completedThisYear: assessmentSummary.completed_count,
        })
      } catch (err) {
        if (active) setError(err instanceof Error ? err.message : '加载失败')
      }
    }
    load()
    return () => {
      active = false
    }
  }, [year])

  useEffect(() => {
    // ponytail: clear immediately on switch so old item's data never bleeds through.
    // message/error are NOT cleared here: a successful submit clears the
    // selection, which would otherwise wipe the success message before the UI
    // can show it.
    setWorkspace(null)
    setHistory([])
    setReviewFilter('全部')
    setSearch('')
    setConclusion('')
    setFeedback('')
    idemRef.current = null

    if (!selected) return

    if (isMockEnabled()) {
      const details = mockAssessmentDetails[selected.review.assessment_id] ?? []
      setWorkspace(
        workspaceFromMocks(
          selected.review,
          details.map((detail, index) => ({
            ...detail,
            id: index + 1,
            l1_code: undefined,
            l1_name: undefined,
            l2_code: undefined,
            l2_name: undefined,
            recommended_start_level: undefined,
            plan_candidate: false,
            evidence_note: detail.evidence_note ?? null,
          })) as AssessmentDetail[],
        ),
      )
      setHistory(mockAssessmentHistories[selected.review.assessment_id] ?? [])
      return
    }

    let active = true
    async function loadWorkspace() {
      try {
        const [ws, reviews] = await Promise.all([
          getBuddyReviewWorkspace(selected.review.assessment_id),
          getAssessmentHistory(selected.review.assessment_id),
        ])
        if (!active) return
        setWorkspace(ws)
        setHistory(
          reviews.filter(
            (review: AssessmentReview) => review.status === '已闭环',
          ),
        )
      } catch (err) {
        if (active) {
          setWorkspace(null)
          setHistory([])
          setError(err instanceof Error ? err.message : '加载复核工作区失败')
        }
      }
    }
    loadWorkspace()
    return () => {
      active = false
    }
  }, [selected])

  function selectQueue(filter: QueueFilter) {
    setQueueFilter(filter)
    setSelectedKey(null)
    setConclusion('')
    setFeedback('')
    idemRef.current = null
  }

  function selectItem(key: string) {
    setSelectedKey(key)
    setConclusion('')
    setFeedback('')
    setMessage('')
    setError('')
    idemRef.current = null
  }

  function selectMember(id: number | null) {
    setMemberId(id)
    setSelectedKey(null)
    setConclusion('')
    setFeedback('')
    idemRef.current = null
  }

  // P1-5: re-fetch the workspace of the currently selected item after a
  // revision 409, so the next submit carries the fresh expected_revision.
  // Local inputs are untouched — only the frozen workspace facts refresh.
  async function refreshWorkspace(item: QueueItem) {
    try {
      if (item.kind === 'assessment') {
        const ws = await getBuddyReviewWorkspace(item.review.assessment_id)
        setWorkspace(ws)
      }
    } catch {
      // keep inputs; the 409 notice already explains the situation
    }
  }

  const filteredDetails = useMemo(() => {
    if (!workspace) return []
    const query = search.trim().toLowerCase()
    return workspace.details.filter((detail) => {
      if (!matchesFilter(detail, reviewFilter)) return false
      if (!query) return true
      return (
        detail.l3_code.toLowerCase().includes(query) ||
        (detail.l3_name ?? '').toLowerCase().includes(query)
      )
    })
  }, [workspace, reviewFilter, search])

  const groupedDetails = useMemo(() => {
    const groups = new Map<string, AssessmentDetail[]>()
    for (const detail of filteredDetails) {
      const key = `${detail.l1_code ?? '未映射'}|${detail.l2_code ?? '未映射'}`
      if (!groups.has(key)) groups.set(key, [])
      groups.get(key)!.push(detail)
    }
    return [...groups.entries()].sort((a, b) => a[0].localeCompare(b[0]))
  }, [filteredDetails])

  async function submitFeedback() {
    if (!selected || !conclusion) return
    if (feedbackRequired(conclusion) && !feedback.trim()) {
      setError('建议调整必须填写反馈。')
      return
    }
    setError('')
    setMessage('')
    setSubmitting(true)
    try {
      const value = conclusion as '认可' | '建议调整'
      // P1-5: the key travels with its payload fingerprint.  The same
      // payload retry reuses the key; a changed payload (or a cleared key
      // after a revision 409) gets a fresh key.
      const fingerprint = `${value}|${feedback || ''}`
      let idem = idemRef.current
      if (!idem || idem.fingerprint !== fingerprint) {
        // crypto.randomUUID is undefined on plain-http LAN origins; the
        // shared helper falls back to getRandomValues for those deploys.
        idem = { key: newIdempotencyKey(), fingerprint }
        idemRef.current = idem
      }
      const result = await submitReview(
        selected.review.assessment_id,
        selected.review.id,
        {
          conclusion: value,
          feedback: feedback || undefined,
          expected_revision: workspace?.revision ?? 0,
        },
        idem.key,
      )
      setAssessmentReviews((items) =>
        items.filter((item) => item.id !== selected.review.id),
      )
      setSummary((prev) => ({
        ...prev,
        assessmentPending: Math.max(0, prev.assessmentPending - 1),
        completedThisYear: prev.completedThisYear + 1,
      }))
      idemRef.current = null
      if (result.idempotent_replayed) {
        setMessage('已提交（幂等重放，未重复写入）。')
      } else if (value === '认可') {
        setMessage(
          result.proposal?.created
            ? '已认可；已生成变更提案（只读），正式计划保持不变。'
            : `已认可并归档；年度计划已生成（${result.plan?.items_created ?? 0} 项 / ${result.plan?.tasks_created ?? 0} 个任务）。`,
        )
      } else {
        setMessage('已建议调整，等待成员修改。')
      }
      setSelectedKey(null)
      setConclusion('')
      setFeedback('')
    } catch (err) {
      const apiErr = err as ApiError
      if (
        apiErr.status === 409 &&
        apiErr.detail !== null &&
        typeof apiErr.detail === 'object' &&
        'code' in apiErr.detail &&
        apiErr.detail.code === 'revision_conflict'
      ) {
        // P1-5: the workspace revision is stale.  Keep all local inputs,
        // refresh the workspace (fresh expected_revision) and invalidate the
        // key: the next submit is a new operation with a new key.
        idemRef.current = null
        void refreshWorkspace(selected)
        setError('复核版本已更新，请确认后重新提交。')
      } else {
        // Keep the idempotency key and all local inputs so a retry of the
        // same action replays server-side instead of double-writing.
        setError(err instanceof Error ? err.message : '提交反馈失败')
      }
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <section className="page dashboard-page buddy-review-center">
      <header className="page-heading">
        <div>
          <p className="eyebrow">Buddy 工作台</p>
          <h1>Buddy 复核中心</h1>
          <p className="muted">
            按负责成员查看待办，在同一工作区提供辅导性复核与反馈。
          </p>
        </div>
      </header>
      {message && (
        <p className="success" role="status">
          {message}
        </p>
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}

      <div className="metric-grid buddy-summary" aria-label="Buddy 待办摘要">
        <button type="button" onClick={() => selectQueue('自评复核')}>
          <span>待复核自评</span>
          <strong>{summary.assessmentPending}</strong>
        </button>
        <button type="button" onClick={() => selectQueue('全部待处理')}>
          <span>本年度已完成复核</span>
          <strong>{summary.completedThisYear}</strong>
        </button>
      </div>

      <div className="buddy-review-layout">
        <aside className="dashboard-card buddy-member-list">
          <h2>辅导成员</h2>
          <button
            className={memberId === null ? 'active' : ''}
            onClick={() => selectMember(null)}
            type="button"
          >
            全部成员
          </button>
          {members.map((member) => {
            const count = queueItems.filter(
              (item) => item.memberId === member.id,
            ).length
            return (
              <button
                className={memberId === member.id ? 'active' : ''}
                key={member.id}
                onClick={() => selectMember(member.id)}
                type="button"
              >
                <strong>{member.full_name}</strong>
                <span className="member-count">{count} 项</span>
              </button>
            )
          })}
        </aside>

        <article className="dashboard-card buddy-queue">
          <div className="card-heading">
            <h2>复核队列</h2>
          </div>
          <div className="queue-tabs" role="tablist" aria-label="复核队列类型">
            {(['全部待处理', '自评复核'] as QueueFilter[]).map((filter) => (
              <button
                aria-selected={queueFilter === filter}
                className={queueFilter === filter ? 'active' : ''}
                key={filter}
                onClick={() => selectQueue(filter)}
                role="tab"
                type="button"
              >
                {filter}
              </button>
            ))}
          </div>
          {filteredQueue.length === 0 ? (
            <p className="muted">当前范围暂无待处理项。</p>
          ) : (
            <table className="analytics-table buddy-queue-table">
              <thead>
                <tr>
                  <th>成员</th>
                  <th>类型</th>
                  <th>二级能力标准 / 三级达成路径</th>
                  <th>提交时间</th>
                  <th>状态</th>
                </tr>
              </thead>
              <tbody>
                {filteredQueue.map((item) => (
                  <tr
                    className={selected?.key === item.key ? 'selected' : ''}
                    key={item.key}
                  >
                    <td>
                      <button
                        onClick={() => selectItem(item.key)}
                        type="button"
                      >
                        {memberName(item.memberId)}
                      </button>
                    </td>
                    <td>自评复核</td>
                    <td>{item.review.year} 年度自评</td>
                    <td>{formatDateTime(item.review.submitted_at)}</td>
                    <td>{item.review.status}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </article>

        <article className="dashboard-card buddy-workspace">
          <h2>复核工作区</h2>
          {!selected ? (
            <p className="muted">选择一项待复核内容后查看依据和历史反馈。</p>
          ) : !workspace ? (
            <p className="muted">正在加载自评复核工作区…</p>
          ) : (
            <>
              <p>
                <strong>{memberName(selected.memberId)}</strong> ·{' '}
                {selected.review.year} 年度自评 ·{' '}
                {workspace.member_current_level_snapshot ?? '—'} →{' '}
                {workspace.member_target_level_snapshot ?? '—'}
                {workspace.standard_version.label
                  ? ` · ${workspace.standard_version.label}`
                  : ''}
              </p>

              <div className="review-summary-grid" aria-label="自评复核汇总">
                <span>适用 {workspace.summary.total}</span>
                <span>必备 {workspace.summary.current_required}</span>
                <span>进阶 {workspace.summary.target_progressive}</span>
                <span>已评估 {workspace.summary.assessed}</span>
                <span>Gap {workspace.summary.gap_items}</span>
                <span>
                  优先级 高{workspace.summary.high} / 中
                  {workspace.summary.medium} / 低{workspace.summary.low} / 暂缓
                  {workspace.summary.hold}
                </span>
                <span>纳入计划 {workspace.summary.in_plan}</span>
                <span>
                  Q1 {workspace.summary.by_quarter.Q1} · Q2{' '}
                  {workspace.summary.by_quarter.Q2} · Q3{' '}
                  {workspace.summary.by_quarter.Q3} · Q4{' '}
                  {workspace.summary.by_quarter.Q4}
                </span>
                <span>个人调整 {workspace.summary.adjustments}</span>
                <span>数据异常 {workspace.summary.data_issues}</span>
              </div>

              <div className="review-notices" role="status" aria-live="polite">
                {workspace.summary.existing_formal_plan ? (
                  workspace.summary.will_create_proposal ? (
                    <p>
                      该 Member 年度已有正式计划
                      {workspace.summary.target_is_legacy
                        ? '（来源为历史计划）'
                        : ''}
                      ；本次认可只生成只读变更提案，不修改正式计划。
                    </p>
                  ) : (
                    <p>该年度计划已由本次评估生成，认可将复用已有计划。</p>
                  )
                ) : (
                  <p>
                    首次认可将原子生成正式年度计划（零选中项也生成计划壳）。
                  </p>
                )}
              </div>

              <div className="review-toolbar">
                <input
                  aria-label="搜索能力项"
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="搜索 L3 编码 / 名称"
                  type="search"
                  value={search}
                />
                <select
                  aria-label="筛选"
                  onChange={(event) =>
                    setReviewFilter(event.target.value as ReviewFilter)
                  }
                  value={reviewFilter}
                >
                  {(
                    [
                      '全部',
                      '当前职级必备且有Gap',
                      '目标职级进阶且有Gap',
                      '已纳入计划',
                      '暂缓',
                      '个人调整',
                      '数据异常',
                    ] as ReviewFilter[]
                  ).map((filter) => (
                    <option key={filter} value={filter}>
                      {filter}
                    </option>
                  ))}
                </select>
              </div>

              {groupedDetails.length === 0 ? (
                <p className="muted">当前筛选范围暂无能力项。</p>
              ) : (
                <div className="review-detail-groups">
                  {groupedDetails.map(([key, details]) => {
                    const [l1, l2] = key.split('|')
                    return (
                      <section key={key}>
                        <h4>
                          {l1 !== '未映射' ? `${l1} / ` : ''}
                          {l2 !== '未映射' ? l2 : '未映射历史项'}
                        </h4>
                        <table
                          className="analytics-table review-detail-table"
                          data-testid="buddy-detail-table-scroll"
                        >
                          <thead>
                            <tr>
                              <th>能力项</th>
                              <th>类型</th>
                              <th>当前</th>
                              <th>标准目标</th>
                              <th>生效目标</th>
                              <th>Gap</th>
                              <th>优先级</th>
                              <th>纳入计划</th>
                              <th>计划时间</th>
                              <th>个人调整</th>
                              <th>数据</th>
                            </tr>
                          </thead>
                          <tbody>
                            {details.map((detail) => (
                              <tr
                                className={
                                  detail.data_issue ? 'row-data-issue' : ''
                                }
                                key={detail.l3_code}
                              >
                                <td>
                                  <strong>
                                    {detail.l3_name ?? detail.l3_code}
                                  </strong>
                                  <span className="muted">
                                    {' '}
                                    {detail.l3_code}
                                  </span>
                                </td>
                                <td>
                                  {detail.scope_type === 'current_required'
                                    ? '必备'
                                    : detail.scope_type === 'target_progressive'
                                      ? '进阶'
                                      : '—'}
                                </td>
                                <td>{detail.current_level ?? '—'}</td>
                                <td>
                                  {detail.standard_target_applicable === false
                                    ? '不适用'
                                    : (detail.standard_target_level ?? '—')}
                                </td>
                                <td>{detail.target_level ?? '—'}</td>
                                <td>{detail.gap_value ?? '—'}</td>
                                <td>{detail.member_priority ?? '—'}</td>
                                <td>
                                  {detail.include_in_plan === true
                                    ? '是'
                                    : detail.include_in_plan === false
                                      ? '否'
                                      : '未选择'}
                                </td>
                                <td>
                                  {detail.plan_month
                                    ? `${detail.plan_month}`
                                    : '—'}
                                </td>
                                <td>
                                  {detail.target_adjusted ? (
                                    <span className="adjustment-badge">
                                      {detail.standard_target_level ?? '—'} →{' '}
                                      {detail.adjusted_target_level ?? '—'}
                                      {detail.target_adjustment_reason
                                        ? `（${detail.target_adjustment_reason}）`
                                        : ''}
                                    </span>
                                  ) : (
                                    <span className="muted">无</span>
                                  )}
                                </td>
                                <td>
                                  {detail.data_issue ? (
                                    <span className="data-issue-badge">
                                      异常
                                    </span>
                                  ) : (
                                    <span className="muted">—</span>
                                  )}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </section>
                    )
                  })}
                </div>
              )}

              <fieldset>
                <legend>复核结论</legend>
                {(['认可', '建议调整'] as const).map((value) => (
                  <label className="radio" key={value}>
                    <input
                      checked={conclusion === value}
                      name="conclusion"
                      onChange={() => setConclusion(value)}
                      type="radio"
                      value={value}
                    />
                    {value}
                  </label>
                ))}
              </fieldset>
              <label>
                反馈
                <textarea
                  onChange={(event) => setFeedback(event.target.value)}
                  placeholder="请输入复核反馈"
                  value={feedback}
                />
              </label>
              {feedbackRequired(conclusion || '') && (
                <p className="muted">建议调整必须填写反馈。</p>
              )}
              <div className="actions">
                <button
                  disabled={!conclusion || submitting}
                  onClick={submitFeedback}
                  type="button"
                >
                  提交复核反馈
                </button>
              </div>
              <h3>反馈历史（只读）</h3>
              {history.length === 0 ? (
                <p className="muted">暂无已闭环的反馈记录。</p>
              ) : (
                <ul className="compact-list">
                  {history.map((item) => (
                    <li key={item.id}>
                      <strong>{item.conclusion ?? item.status}</strong>
                      <span>
                        {item.feedback || '未填写反馈'} ·{' '}
                        {formatDateTime(item.reviewed_at)}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
        </article>
      </div>
    </section>
  )
}

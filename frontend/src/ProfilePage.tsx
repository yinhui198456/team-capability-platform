import { useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'

import { useMe } from './catalog'
import { useYear } from './YearContext'
import {
  getCapabilityProfile,
  getCapabilityProfileForMember,
  getSelectableMembersForProfile,
  formatL3Name,
  type CapabilityProfile,
  type CapabilityProfilePlanItem,
  type SelectableMember,
} from './planning'
import styles from './ProfilePage.module.css'

function formatDate(value: string | null | undefined): string | null {
  if (!value) return null
  const prefix = value.slice(0, 10)
  return /^\d{4}-\d{2}-\d{2}$/.test(prefix) ? prefix : value
}

function statusBadgeClass(status: string): string {
  switch (status) {
    case '已完成':
    case '已归档':
    case '通过':
    case '认可':
      return styles.badgeSuccess
    case '进行中':
    case '执行中':
    case '待 Review':
      return styles.badgePrimary
    case '需补充':
    case '建议调整':
    case '延期':
      return styles.badgeWarning
    case '驳回':
      return styles.badgeDanger
    default:
      return styles.badgeNeutral
  }
}

function scopeLabel(roles: string[]) {
  if (roles.includes('Admin')) return '全量'
  if (roles.includes('Leader')) return '团队'
  if (roles.includes('Buddy')) return '负责成员'
  if (roles.includes('Member')) return '本人'
  return '公共目录'
}

function Badge({ children }: { children: React.ReactNode }) {
  return (
    <span
      className={`${styles.badge} ${statusBadgeClass(String(children))}`}
      aria-label={`状态：${children}`}
    >
      {children}
    </span>
  )
}

function KpiCard({
  label,
  value,
  unit,
  hint,
}: {
  label: string
  value: React.ReactNode
  unit?: string
  hint?: string
}) {
  return (
    <article className={styles.kpiCard} aria-label={label}>
      <div className={styles.kpiLabel}>{label}</div>
      <div className={styles.kpiValue}>
        <span className={styles.kpiNumber}>{value}</span>
        {unit && <span className={styles.kpiUnit}>{unit}</span>}
      </div>
      {hint && <p className={styles.kpiHint}>{hint}</p>}
    </article>
  )
}

function PlanItemCard({ item }: { item: CapabilityProfilePlanItem }) {
  const estimated = item.estimated_hours
    ? `${item.estimated_hours} 小时`
    : '未设置'
  return (
    <article className={styles.planItem} aria-label={`计划项：${item.l3_code}`}>
      <div className={styles.planItemHeader}>
        <div>
          <div className={styles.planItemName}>
            {formatL3Name(item.l3_name, item.l3_code)}
          </div>
        </div>
        <Badge>{item.status}</Badge>
      </div>
      <div className={styles.planItemDetails}>
        <span className={styles.taskMetaItem}>
          L{item.current_level} → L{item.target_level}
        </span>
        <Badge>{item.priority}</Badge>
        <span className={styles.taskMetaItem}>预计 {estimated}</span>
      </div>
    </article>
  )
}

function AssessmentHistory({ profile }: { profile: CapabilityProfile }) {
  const assessments = profile.assessments
  return (
    <section className={styles.card} aria-label="评估历史">
      <h2 className={styles.cardTitle}>评估历史</h2>
      {assessments.length === 0 ? (
        <p className={styles.emptyState}>暂无评估记录</p>
      ) : (
        <div className={styles.assessmentList}>
          {assessments.map((assessment) => {
            const latestReview =
              assessment.reviews[assessment.reviews.length - 1]
            return (
              <article
                key={assessment.id}
                className={styles.assessmentItem}
                aria-label={`评估版本 ${assessment.version}`}
              >
                <div className={styles.assessmentHeader}>
                  <div>
                    <strong>版本 {assessment.version}</strong>{' '}
                    <span className={styles.assessmentDate}>
                      {assessment.assessment_type}
                    </span>
                  </div>
                  <Badge>{assessment.status}</Badge>
                </div>
                <div className={styles.assessmentDate}>
                  {assessment.submitted_at && (
                    <>提交于 {formatDate(assessment.submitted_at)}</>
                  )}
                  {assessment.archived_at && (
                    <> · 归档于 {formatDate(assessment.archived_at)}</>
                  )}
                </div>
                {latestReview && (
                  <div style={{ marginTop: 8 }}>
                    <span className={styles.statLabel}>Review 结论：</span>
                    <Badge>{latestReview.conclusion ?? '待复核'}</Badge>
                  </div>
                )}
              </article>
            )
          })}
        </div>
      )}
    </section>
  )
}

function AnnualStatistics({ profile }: { profile: CapabilityProfile }) {
  const completed = useMemo(() => {
    if (!profile.annual_plan) return 0
    return profile.annual_plan.items.filter((i) => i.status === '已完成').length
  }, [profile])
  const total = profile.annual_plan?.items.length ?? 0
  const evidenceStats = Object.entries(
    profile.statistics.evidence_count_by_status,
  )

  return (
    <section className={styles.card} aria-label="年度统计">
      <h2 className={styles.cardTitle}>年度统计</h2>
      <div className={styles.statList}>
        <div className={styles.statRow}>
          <span className={styles.statLabel}>计划学习时长</span>
          <span className={styles.statValue}>
            {profile.statistics.total_planned_hours} 小时
          </span>
        </div>
        <div className={styles.statRow}>
          <span className={styles.statLabel}>实际学习时长</span>
          <span className={styles.statValue}>
            {profile.statistics.total_learning_hours} 小时
          </span>
        </div>
        <div className={styles.statRow}>
          <span className={styles.statLabel}>计划项完成率</span>
          <span className={styles.statValue}>
            {completed} / {total}
          </span>
        </div>
        <div className={styles.statRow}>
          <span className={styles.statLabel}>Evidence 统计</span>
          <span className={styles.statValue}>
            {evidenceStats.length === 0
              ? '无 Evidence'
              : evidenceStats
                  .map(([status, count]) => `${status} ${count}`)
                  .join(' · ')}
          </span>
        </div>
      </div>
    </section>
  )
}

function LearningTaskTimeline({ profile }: { profile: CapabilityProfile }) {
  const tasks = useMemo(() => {
    if (!profile.annual_plan) return []
    return profile.annual_plan.items.filter(
      (item) => item.learning_task !== null,
    )
  }, [profile])

  return (
    <section className={styles.card} aria-label="学习任务与学习日志">
      <h2 className={styles.cardTitle}>学习任务与学习日志</h2>
      {tasks.length === 0 ? (
        <p className={styles.emptyState}>暂无学习任务与学习记录</p>
      ) : (
        <div className={styles.taskList}>
          {tasks.map((item) => {
            const task = item.learning_task!
            const estimated = item.estimated_hours
              ? `${item.estimated_hours} 小时`
              : '未设置'
            const actual = `${task.actual_hours ?? 0} 小时`
            return (
              <article
                key={item.id}
                className={styles.taskItem}
                aria-label={`学习任务：${item.l3_code}`}
              >
                <div className={styles.taskItemHeader}>
                  <div>
                    <div className={styles.taskTitle}>
                      {formatL3Name(item.l3_name ?? task.l3_name, item.l3_code)}
                    </div>
                  </div>
                  <Badge>{task.status}</Badge>
                </div>
                <div className={styles.taskMeta}>
                  <Badge>{item.priority}</Badge>
                  <span className={styles.taskMetaItem}>预计 {estimated}</span>
                  <span className={styles.taskMetaItem}>实际 {actual}</span>
                </div>

                {task.progress_logs.length === 0 ? (
                  <p className={styles.emptyState}>暂无学习日志</p>
                ) : (
                  <div className={styles.logList}>
                    <div className={styles.statLabel}>学习日志</div>
                    {task.progress_logs.map((log) => (
                      <div key={log.id} className={styles.logItem}>
                        {log.record_date} · {log.actual_hours} 小时
                        {log.note ? ` · ${log.note}` : ''}
                      </div>
                    ))}
                  </div>
                )}

                {task.evidences.length === 0 ? (
                  <p className={styles.emptyState}>暂无 Evidence</p>
                ) : (
                  <div className={styles.evidenceList}>
                    <div className={styles.statLabel}>Evidence 审核结果</div>
                    {task.evidences.map((evidence) => (
                      <article
                        key={evidence.id}
                        className={styles.evidenceItem}
                        aria-label={`Evidence 版本 ${evidence.version_number}：${item.l3_code}`}
                      >
                        <div className={styles.evidenceHeader}>
                          <strong>版本 {evidence.version_number}</strong>
                          <Badge>{evidence.status}</Badge>
                        </div>
                        <p className={styles.evidenceConclusion}>
                          {evidence.review?.conclusion
                            ? `Review 结论：${evidence.review.conclusion}`
                            : '待 Review'}
                        </p>
                      </article>
                    ))}
                  </div>
                )}
              </article>
            )
          })}
        </div>
      )}
    </section>
  )
}

export function ProfilePage() {
  const year = useYear()
  const { user } = useMe()
  const roles = user?.roles ?? []
  const [searchParams, setSearchParams] = useSearchParams()
  const initialMemberIdRef = useRef<number | null>(null)

  if (initialMemberIdRef.current === null) {
    const raw = searchParams.get('member_id')
    initialMemberIdRef.current =
      raw && /^\d+$/.test(raw) ? parseInt(raw, 10) : null
  }

  const canSelectMember = useMemo(
    () => roles.some((r) => ['Buddy', 'Leader', 'Admin'].includes(r)),
    [roles],
  )

  const [profile, setProfile] = useState<CapabilityProfile | null>(null)
  const [selectableMembers, setSelectableMembers] = useState<
    SelectableMember[]
  >([])
  const [currentMemberId, setCurrentMemberId] = useState<number | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!user) return
    if (!canSelectMember) {
      setSelectableMembers([])
      setCurrentMemberId(null)
      return
    }

    let active = true
    setLoading(true)
    getSelectableMembersForProfile(year)
      .then((data) => {
        if (!active) return
        setSelectableMembers(data.members)
        const initial = initialMemberIdRef.current
        const selected =
          initial && data.members.some((m) => m.id === initial)
            ? initial
            : (data.members[0]?.id ?? null)
        setCurrentMemberId(selected)
      })
      .catch((err) => {
        if (!active) return
        setError(err instanceof Error ? err.message : '加载成员列表失败')
        setSelectableMembers([])
      })
      .finally(() => {
        if (active) setLoading(false)
      })

    return () => {
      active = false
    }
  }, [user, canSelectMember, year])

  useEffect(() => {
    if (!user) return
    if (canSelectMember && currentMemberId === null) return

    let active = true
    setLoading(true)
    setError('')
    const promise =
      canSelectMember && currentMemberId !== null
        ? getCapabilityProfileForMember(currentMemberId, year)
        : getCapabilityProfile(year)

    promise
      .then((data) => {
        if (!active) return
        setProfile(data)
      })
      .catch((err) => {
        if (!active) return
        setProfile(null)
        setError(err instanceof Error ? err.message : '加载成长档案失败')
      })
      .finally(() => {
        if (active) setLoading(false)
      })

    return () => {
      active = false
    }
  }, [user, canSelectMember, currentMemberId, year])

  function handleSelectMember(memberId: number) {
    setCurrentMemberId(memberId)
    const next = new URLSearchParams(searchParams)
    next.set('member_id', String(memberId))
    setSearchParams(next, { replace: true })
  }

  const kpi = useMemo(() => {
    const completed =
      profile?.annual_plan?.items.filter((i) => i.status === '已完成').length ??
      0
    const total = profile?.annual_plan?.items.length ?? 0
    const archived = profile?.statistics.evidence_count_by_status['已归档'] ?? 0
    const latestAssessment = profile?.assessments[0]
    const latestReview =
      latestAssessment?.reviews[latestAssessment.reviews.length - 1]
    const assessmentDisplay =
      latestReview?.conclusion ?? latestAssessment?.status ?? '暂无评估'
    return { completed, total, archived, assessmentDisplay }
  }, [profile])

  if (loading) return <p className="muted">加载中…</p>

  return (
    <section className={`page ${styles.profilePage}`}>
      <header className={styles.pageHeader}>
        <div className={styles.titleGroup}>
          <h1 className={styles.pageTitle}>成长档案</h1>
          {profile && (
            <p className={styles.pageSubtitle}>
              成员：{profile.member.full_name}（{profile.member.username}）
              {profile.member.current_level != null && (
                <>
                  {' '}
                  · 职级：{profile.member.current_level}
                  {profile.member.target_level != null
                    ? ` → ${profile.member.target_level}`
                    : ''}
                </>
              )}{' '}
              · 年度：{profile.year} · 数据范围：{scopeLabel(roles)}
            </p>
          )}
        </div>
        {canSelectMember && (
          <div className={styles.memberSelector}>
            <label htmlFor="profile-member-selector">查看成员</label>
            <select
              id="profile-member-selector"
              aria-label="查看成员"
              value={currentMemberId ?? ''}
              onChange={(e) => handleSelectMember(parseInt(e.target.value, 10))}
              disabled={selectableMembers.length <= 1}
            >
              {selectableMembers.map((member) => (
                <option key={member.id} value={member.id}>
                  {member.full_name}（{member.username}）
                </option>
              ))}
            </select>
          </div>
        )}
      </header>

      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}

      {canSelectMember && selectableMembers.length === 0 && !error && (
        <p className="muted">没有可查看的成员。</p>
      )}

      {!profile && !error && <p className="muted">暂无成长档案数据。</p>}

      {profile && (
        <>
          <section
            className={styles.kpiGrid}
            role="region"
            aria-label="年度成长闭环摘要"
          >
            <KpiCard
              label="已完成计划项"
              value={`${kpi.completed} / ${kpi.total}`}
              hint="已完成 / 总数"
            />
            <KpiCard
              label="实际学习时长"
              value={profile.statistics.total_learning_hours}
              unit="小时"
            />
            <KpiCard
              label="已归档 Evidence"
              value={kpi.archived}
              unit="个"
              hint="仅通过 Review 的 Evidence"
            />
            <KpiCard
              label="能力评估"
              value={kpi.assessmentDisplay}
              hint={profile.assessments[0] ? '最近评估状态 / Review 结论' : ''}
            />
          </section>

          <div className={styles.twoColumn}>
            <section className={styles.card} aria-label="年度成长计划">
              <h2 className={styles.cardTitle}>年度成长计划</h2>
              {profile.annual_plan ? (
                <>
                  <div className={styles.planMeta}>
                    <div className={styles.planMetaItem}>
                      状态：<strong>{profile.annual_plan.status}</strong>
                    </div>
                    <div className={styles.planMetaItem}>
                      周期：
                      <strong>{profile.annual_plan.plan_cycle} 个月</strong>
                    </div>
                    <div className={styles.planMetaItem}>
                      计划时长：
                      <strong>
                        {profile.statistics.total_planned_hours} 小时
                      </strong>
                    </div>
                    <div className={styles.planMetaItem}>
                      完成进度：
                      <strong>
                        {kpi.completed} / {kpi.total}
                      </strong>
                    </div>
                  </div>
                  {profile.annual_plan.items.length === 0 ? (
                    <p className={styles.emptyState}>暂无计划项</p>
                  ) : (
                    <div className={styles.planItemList}>
                      {profile.annual_plan.items.map((item) => (
                        <PlanItemCard key={item.id} item={item} />
                      ))}
                    </div>
                  )}
                </>
              ) : (
                <p className={styles.emptyState}>暂无年度成长计划</p>
              )}
            </section>

            <aside className={styles.sideColumn}>
              <AssessmentHistory profile={profile} />
              <div style={{ marginTop: 20 }}>
                <AnnualStatistics profile={profile} />
              </div>
            </aside>
          </div>

          <LearningTaskTimeline profile={profile} />
        </>
      )}
    </section>
  )
}

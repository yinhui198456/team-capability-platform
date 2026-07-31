import { useEffect, useState } from 'react'

import {
  Assessment,
  AssessmentDetail,
  ScopeSummary,
  getAssessment,
  listAssessments,
} from './assessment'

export function AssessmentHistoryPage() {
  const [assessments, setAssessments] = useState<Assessment[]>([])
  const [expanded, setExpanded] = useState<Set<number>>(new Set())
  const [detailsMap, setDetailsMap] = useState<
    Record<number, AssessmentDetail[]>
  >({})
  const [scopeSummaryMap, setScopeSummaryMap] = useState<
    Record<number, ScopeSummary | null | undefined>
  >({})
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false
    async function load() {
      try {
        const list = await listAssessments()
        if (!cancelled) setAssessments(list)
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : '加载失败')
        }
      }
    }
    load()
    return () => {
      cancelled = true
    }
  }, [])

  async function toggle(id: number) {
    if (expanded.has(id)) {
      setExpanded((prev) => {
        const next = new Set(prev)
        next.delete(id)
        return next
      })
      return
    }
    if (!(id in detailsMap)) {
      try {
        const full = await getAssessment(id)
        setDetailsMap((prev) => ({ ...prev, [id]: full.details ?? [] }))
        setScopeSummaryMap((prev) => ({
          ...prev,
          [id]: full.scope_summary,
        }))
      } catch (err) {
        setError(err instanceof Error ? err.message : '加载详情失败')
        return
      }
    }
    setExpanded((prev) => new Set(prev).add(id))
  }

  return (
    <section className="page">
      <h1>评估历史</h1>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {assessments.length === 0 && <p className="muted">暂无评估记录。</p>}
      <ul className="assessment-list">
        {assessments.map((assessment) => (
          <li key={assessment.id}>
            <button
              className="assessment-summary"
              onClick={() => toggle(assessment.id)}
              aria-expanded={expanded.has(assessment.id)}
            >
              {assessment.year} · 版本 {assessment.version} ·{' '}
              {assessment.status}
              {assessment.submitted_at
                ? ` · 提交于 ${new Date(assessment.submitted_at).toLocaleString()}`
                : ''}
            </button>
            <p
              className="muted"
              data-testid={`history-snapshot-${assessment.id}`}
            >
              {assessment.member_current_level_snapshot &&
              assessment.member_target_level_snapshot
                ? `当前 ${assessment.member_current_level_snapshot} → 年度目标 ${assessment.member_target_level_snapshot}`
                : '历史快照缺失'}
              {assessment.standard_version_label
                ? ` · ${assessment.standard_version_label}`
                : ''}
              {assessment.assessment_scope_version
                ? ` · ${assessment.assessment_scope_version}`
                : ''}
            </p>
            {expanded.has(assessment.id) && (
              <div className="assessment-details">
                {(() => {
                  const summary = scopeSummaryMap[assessment.id]
                  if (summary === undefined) return null
                  if (summary === null) {
                    return (
                      <p
                        className="muted"
                        data-testid={`history-classification-${assessment.id}`}
                      >
                        历史未分类
                      </p>
                    )
                  }
                  return (
                    <p
                      className="muted"
                      data-testid={`history-classification-${assessment.id}`}
                    >
                      适用{' '}
                      <strong data-testid={`history-total-${assessment.id}`}>
                        {summary.total}
                      </strong>{' '}
                      · 必备{' '}
                      <strong data-testid={`history-required-${assessment.id}`}>
                        {summary.current_required}
                      </strong>{' '}
                      · 进阶{' '}
                      <strong
                        data-testid={`history-progressive-${assessment.id}`}
                      >
                        {summary.target_progressive}
                      </strong>
                    </p>
                  )
                })()}
                {(detailsMap[assessment.id] ?? []).length === 0 && (
                  <p className="muted">没有详情。</p>
                )}
                <ul>
                  {(detailsMap[assessment.id] ?? []).map((detail) => (
                    <li key={detail.l3_code}>
                      {detail.scope_type
                        ? detail.scope_type === 'current_required'
                          ? '当前职级必备'
                          : '目标职级进阶'
                        : '历史未分类'}
                      ：
                      {detail.l2_code && detail.l2_name
                        ? `${detail.l2_code} · ${detail.l2_name} → `
                        : ''}
                      {detail.l3_code}
                      {detail.l3_name ? ` · ${detail.l3_name}` : ''}
                      ：当前掌握度 {detail.current_level} → 目标掌握度{' '}
                      {detail.target_level}（Gap {detail.gap_value}）
                      {detail.standard_job_level_snapshot
                        ? ` · ${detail.standard_job_level_snapshot} 标准`
                        : ''}
                      {detail.include_in_plan === true
                        ? ' · 已纳入计划'
                        : detail.plan_candidate
                          ? ' · 计划候选(旧)'
                          : ''}
                      {detail.member_priority
                        ? ` · ${detail.member_priority}`
                        : ''}
                      {detail.plan_quarter && detail.plan_month
                        ? ` · ${detail.plan_quarter} ${detail.plan_month}月`
                        : ''}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </li>
        ))}
      </ul>
    </section>
  )
}

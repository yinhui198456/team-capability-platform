import { useEffect, useState } from 'react'

import {
  Assessment,
  AssessmentDetail,
  getAssessment,
  listAssessments,
} from './assessment'

export function AssessmentHistoryPage() {
  const [assessments, setAssessments] = useState<Assessment[]>([])
  const [expanded, setExpanded] = useState<Set<number>>(new Set())
  const [detailsMap, setDetailsMap] = useState<
    Record<number, AssessmentDetail[]>
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
            {expanded.has(assessment.id) && (
              <div className="assessment-details">
                {(detailsMap[assessment.id] ?? []).length === 0 && (
                  <p className="muted">没有详情。</p>
                )}
                <ul>
                  {(detailsMap[assessment.id] ?? []).map((detail) => (
                    <li key={detail.l3_code}>
                      当前模型映射上下文：
                      {detail.l2_code && detail.l2_name
                        ? `${detail.l2_code} · ${detail.l2_name} → `
                        : ''}
                      {detail.l3_code}
                      {detail.l3_name ? ` · ${detail.l3_name}` : ''}
                      ：当前掌握度 {detail.current_level} → 目标掌握度{' '}
                      {detail.target_level}（Gap {detail.gap_value}）
                      {detail.plan_candidate ? ' · 计划候选' : ''}
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

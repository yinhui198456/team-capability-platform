import { useEffect, useState } from 'react'

import {
  Assessment,
  AssessmentDetail,
  createAssessment,
  getAssessment,
  listAssessments,
  saveDraft,
  submitAssessment,
} from './assessment'

const LEVELS = [1, 2, 3, 4, 5]

const DOMAIN_LABELS: Record<string, string> = {
  P01: '数据基础设施',
  P02: 'AI Infra / Agent',
  P03: '工程编码',
  C01: '基本办公能力',
  C02: '沟通协作',
  C03: '学习创新',
}

function domainLabel(code: string): string {
  const prefix = code.split('.')[0]
  return DOMAIN_LABELS[prefix] ? `${prefix} · ${DOMAIN_LABELS[prefix]}` : code
}

export function AssessmentGapPage() {
  const [assessment, setAssessment] = useState<Assessment | null>(null)
  const [details, setDetails] = useState<AssessmentDetail[]>([])
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    async function init() {
      try {
        const list = await listAssessments()
        const draft = list.find(
          (a) => a.status === '草稿' || a.status === '建议调整',
        )
        if (draft) {
          const full = await getAssessment(draft.id)
          if (!cancelled) {
            setAssessment(full)
            setDetails(full.details ?? [])
          }
        }
      } catch (err) {
        if (!cancelled)
          setError(err instanceof Error ? err.message : '加载失败')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    init()
    return () => {
      cancelled = true
    }
  }, [])

  async function handleCreate() {
    setError('')
    try {
      const { id } = await createAssessment(new Date().getFullYear())
      const full = await getAssessment(id)
      setAssessment(full)
      setDetails(full.details ?? [])
    } catch (err) {
      setError(err instanceof Error ? err.message : '创建失败')
    }
  }

  async function handleSave() {
    if (!assessment) return
    setError('')
    setMessage('')
    try {
      await saveDraft(assessment.id, details)
      setMessage('草稿已保存')
    } catch (err) {
      setError(err instanceof Error ? err.message : '保存失败')
    }
  }

  async function handleSubmit() {
    if (!assessment) return
    setError('')
    setMessage('')
    try {
      await submitAssessment(assessment.id)
      const full = await getAssessment(assessment.id)
      setAssessment(full)
      setDetails(full.details ?? [])
      setMessage('已提交，Gap 即时生成。等待 Buddy 复核。')
    } catch (err) {
      setError(err instanceof Error ? err.message : '提交失败')
    }
  }

  function updateDetail(index: number, patch: Partial<AssessmentDetail>) {
    setDetails((prev) =>
      prev.map((item, i) => (i === index ? { ...item, ...patch } : item)),
    )
  }

  if (loading) return <p className="muted">加载中…</p>

  if (!assessment) {
    return (
      <section className="page">
        <h1>能力自评与 Gap 分析</h1>
        <p>当前年度暂无草稿。</p>
        <button onClick={handleCreate}>创建年度自评草稿</button>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
      </section>
    )
  }

  const isEditable =
    assessment.status === '草稿' || assessment.status === '建议调整'
  const filledCount = details.filter(
    (d) =>
      d.current_level > 1 ||
      d.target_level > 1 ||
      (d.evidence_note ?? '').trim(),
  ).length
  const reviewLabel =
    assessment.status === '已复核' || assessment.status === '已归档'
      ? '认可闭环'
      : assessment.status === '建议调整'
        ? '建议调整'
        : assessment.status === '待复核'
          ? '待 Buddy 复核'
          : '尚未提交'
  const canPlan =
    assessment.status === '已复核' || assessment.status === '已归档'

  // Group by L1 domain
  const grouped = new Map<string, AssessmentDetail[]>()
  for (const d of details) {
    const key = d.l1_code ?? d.l3_code.split('.')[0]
    if (!grouped.has(key)) grouped.set(key, [])
    grouped.get(key)!.push(d)
  }

  const gs = assessment.gap_summary

  return (
    <section className="page assessment-gap-page">
      {/* --- Header --- */}
      <header className="page-heading assessment-heading">
        <div>
          <p className="eyebrow">能力管理 / ① 能力自评</p>
          <h1>能力自评与 Gap 分析</h1>
          <p className="muted">
            {assessment.year} 年度 · 版本 {assessment.version} ·{' '}
            {assessment.status}
          </p>
        </div>
        <div className="assessment-actions">
          {isEditable && <button onClick={handleSave}>保存草稿</button>}
          {isEditable && (
            <button className="primary-action" onClick={handleSubmit}>
              提交自评
            </button>
          )}
          <a href="/capability/assessment/history">查看评估历史</a>
        </div>
      </header>

      {/* --- Summary --- */}
      <section className="assessment-summary" aria-label="评估摘要">
        <div>
          <span>评估进度</span>
          <strong>
            {filledCount} / {details.length} 项
          </strong>
        </div>
        <div>
          <span>最新 Review</span>
          <strong>{reviewLabel}</strong>
        </div>
        <div>
          <span>计划门禁</span>
          <strong>
            {canPlan ? '可纳入年度计划' : 'Review 闭环前不可正式纳入计划'}
          </strong>
        </div>
      </section>

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

      {/* --- Main layout: tables + gap sidebar --- */}
      <div className="assessment-gap-layout">
        {/* --- Domain tables --- */}
        <div className="assessment-tables">
          {[...grouped.entries()].map(([l1Code, groupItems]) => {
            const domainFilled = groupItems.filter(
              (d) =>
                d.current_level > 1 ||
                d.target_level > 1 ||
                (d.evidence_note ?? '').trim(),
            ).length
            return (
              <details className="domain-group" key={l1Code} open>
                <summary className="domain-summary">
                  <span className="domain-label">{domainLabel(l1Code)}</span>
                  <span className="domain-progress">
                    {domainFilled} / {groupItems.length} 项
                  </span>
                </summary>
                <table className="analytics-table assessment-table">
                  <thead>
                    <tr>
                      <th>L3 能力项</th>
                      <th>建议起始</th>
                      <th>当前</th>
                      <th>目标</th>
                      <th>Gap</th>
                      <th>优先级</th>
                      <th>自评依据</th>
                      <th>计划候选</th>
                    </tr>
                  </thead>
                  <tbody>
                    {groupItems.map((detail, gi) => {
                      const globalIdx = details.indexOf(detail)
                      const gap = Math.max(
                        detail.target_level - detail.current_level,
                        0,
                      )
                      const priority = gap >= 3 ? '高' : gap > 0 ? '中' : '低'
                      return (
                        <tr key={detail.id ?? gi}>
                          <td>
                            <strong>{detail.l3_code}</strong>
                            {detail.l3_name && (
                              <div
                                className="muted"
                                style={{ fontSize: '0.85em' }}
                              >
                                {detail.l3_name}
                              </div>
                            )}
                          </td>
                          <td className="muted">
                            {detail.recommended_start_level ?? '—'}
                          </td>
                          <td>
                            <select
                              aria-label="当前掌握度"
                              value={detail.current_level}
                              onChange={(e) =>
                                updateDetail(globalIdx, {
                                  current_level: Number(e.target.value),
                                })
                              }
                              disabled={!isEditable}
                            >
                              {LEVELS.map((l) => (
                                <option key={l} value={l}>
                                  {l}
                                </option>
                              ))}
                            </select>
                          </td>
                          <td>
                            <select
                              aria-label="目标掌握度"
                              value={detail.target_level}
                              onChange={(e) =>
                                updateDetail(globalIdx, {
                                  target_level: Number(e.target.value),
                                })
                              }
                              disabled={!isEditable}
                            >
                              {LEVELS.map((l) => (
                                <option key={l} value={l}>
                                  {l}
                                </option>
                              ))}
                            </select>
                          </td>
                          <td>
                            <span className={gap > 0 ? 'gap-value' : ''}>
                              {gap}
                            </span>
                          </td>
                          <td>{priority}</td>
                          <td>
                            <textarea
                              aria-label="自评依据"
                              value={detail.evidence_note ?? ''}
                              onChange={(e) =>
                                updateDetail(globalIdx, {
                                  evidence_note: e.target.value,
                                })
                              }
                              disabled={!isEditable}
                            />
                          </td>
                          <td>
                            <label className="checkbox">
                              <input
                                type="checkbox"
                                checked={detail.plan_candidate ?? false}
                                onChange={(e) =>
                                  updateDetail(globalIdx, {
                                    plan_candidate: e.target.checked,
                                  })
                                }
                                disabled={!isEditable}
                              />{' '}
                              纳入
                            </label>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </details>
            )
          })}
        </div>

        {/* --- Gap sidebar --- */}
        {gs && (
          <aside className="gap-sidebar">
            <h2>Gap 分析</h2>
            <dl className="gap-stats">
              <div>
                <dt>Gap 总数</dt>
                <dd>{gs.total_gaps}</dd>
              </div>
              <div>
                <dt>平均 Gap</dt>
                <dd>{gs.avg_gap}</dd>
              </div>
            </dl>
            <h3>按优先级分布</h3>
            <ul className="gap-priority-list">
              <li className="high">
                <span>高</span>
                <strong>{gs.high_priority}</strong>
              </li>
              <li className="medium">
                <span>中</span>
                <strong>{gs.medium_priority}</strong>
              </li>
              <li className="low">
                <span>低</span>
                <strong>{gs.low_priority}</strong>
              </li>
            </ul>
            {!canPlan && (
              <p className="warning" style={{ marginTop: '1rem' }}>
                Review 认可闭环后才可正式纳入年度计划。
              </p>
            )}
            {canPlan && (
              <a className="primary-link" href="/growth/goals">
                前往成长目标，纳入年度计划
              </a>
            )}
          </aside>
        )}
      </div>

      {/* Submitted but no gaps yet (assessment has no details with gap>0) */}
      {assessment.status !== '草稿' && !gs && (
        <section aria-label="Gap 入口" className="gap-handoff">
          <p className="muted">提交自评后立即生成 Gap。</p>
        </section>
      )}
    </section>
  )
}

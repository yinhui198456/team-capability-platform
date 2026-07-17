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

export function AssessmentPage() {
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
        const draft = list.find((a) => a.status === '草稿')
        if (draft) {
          const full = await getAssessment(draft.id)
          if (!cancelled) {
            setAssessment(full)
            setDetails(full.details ?? [])
          }
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : '加载失败')
        }
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
      setMessage('已提交，等待 Buddy 复核')
    } catch (err) {
      setError(err instanceof Error ? err.message : '提交失败')
    }
  }

  function updateDetail(index: number, patch: Partial<AssessmentDetail>) {
    setDetails((prev) =>
      prev.map((item, i) => (i === index ? { ...item, ...patch } : item)),
    )
  }

  function addDetail() {
    setDetails((prev) => [
      ...prev,
      {
        l3_code: '',
        current_level: 1,
        target_level: 1,
        evidence_note: '',
        plan_candidate: false,
      },
    ])
  }

  function removeDetail(index: number) {
    setDetails((prev) => prev.filter((_, i) => i !== index))
  }

  if (loading) return <p className="muted">加载中…</p>

  if (!assessment) {
    return (
      <section className="page">
        <h1>能力自评</h1>
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
  const filledCount = details.filter((detail) => detail.l3_code.trim()).length
  const reviewLabel =
    assessment.status === '已认可'
      ? '认可闭环'
      : assessment.status === '建议调整'
        ? '建议调整'
        : assessment.status === '待复核'
          ? '待 Buddy 复核'
          : '尚未提交'

  function domainLabel(l3Code: string) {
    const code = l3Code.split('-')[0]
    const labels: Record<string, string> = {
      P01: '数据基础设施',
      P02: 'AI Infra / Agent',
      P03: '工程编码',
      C01: '基本办公',
      C02: '沟通协作',
      C03: '学习创新',
    }
    return labels[code] ? `${code} · ${labels[code]}` : l3Code || '未选择能力项'
  }

  return (
    <section className="page assessment-workbench">
      <header className="page-heading assessment-heading">
        <div>
          <p className="eyebrow">能力管理 / 年度自评</p>
          <h1>能力自评</h1>
          <p className="muted">
            {assessment.year} 年度 · 版本 {assessment.version} · {assessment.status}
          </p>
        </div>
        <div className="assessment-actions">
          {isEditable && <button onClick={handleSave}>保存草稿</button>}
          {isEditable && <button className="primary-action" onClick={handleSubmit}>提交自评</button>}
          <a href="/capability/assessment/history">查看评估历史</a>
        </div>
      </header>
      <section className="assessment-summary" aria-label="评估头部摘要">
        <div><span>评估进度</span><strong>{filledCount} / {details.length || 0} 项</strong></div>
        <div><span>最新 Review</span><strong>{reviewLabel}</strong></div>
        <div><span>计划门禁</span><strong>{assessment.status === '已认可' ? '可纳入年度计划' : 'Review 闭环前不可正式纳入计划'}</strong></div>
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
      <section className="assessment-table-card">
        <div className="card-heading"><h2>能力项</h2><p className="muted">按 L3 填写当前/目标掌握度与自评依据。</p></div>
        <table className="analytics-table assessment-table" aria-label="L3 自评表">
          <thead><tr><th>能力域 / L3</th><th>当前</th><th>目标</th><th>Gap</th><th>优先级</th><th>自评依据</th><th>计划候选</th><th>状态</th>{isEditable && <th>操作</th>}</tr></thead>
          <tbody>{details.map((detail, index) => {
            const gap = Math.max(detail.target_level - detail.current_level, 0)
            const priority = gap >= 3 ? '高' : gap > 0 ? '中' : '低'
            return <tr key={index}>
              <td><strong>{domainLabel(detail.l3_code)}</strong><input aria-label="L3 编码" value={detail.l3_code} onChange={(event) => updateDetail(index, { l3_code: event.target.value })} disabled={!isEditable} /></td>
              <td><select aria-label="当前掌握度" value={detail.current_level} onChange={(event) => updateDetail(index, { current_level: Number(event.target.value) })} disabled={!isEditable}>{[1, 2, 3, 4, 5].map((level) => <option key={level} value={level}>{level}</option>)}</select></td>
              <td><select aria-label="目标掌握度" value={detail.target_level} onChange={(event) => updateDetail(index, { target_level: Number(event.target.value) })} disabled={!isEditable}>{[1, 2, 3, 4, 5].map((level) => <option key={level} value={level}>{level}</option>)}</select></td>
              <td><span className={gap > 0 ? 'gap-value' : ''}>{gap}</span></td>
              <td>{priority}</td>
              <td><textarea aria-label="自评依据" value={detail.evidence_note ?? ''} onChange={(event) => updateDetail(index, { evidence_note: event.target.value })} disabled={!isEditable} /></td>
              <td><label className="checkbox"><input type="checkbox" checked={detail.plan_candidate ?? false} onChange={(event) => updateDetail(index, { plan_candidate: event.target.checked })} disabled={!isEditable} />纳入计划候选</label></td>
              <td>{assessment.status}</td>
              {isEditable && <td><button onClick={() => removeDetail(index)}>删除</button></td>}
            </tr>
          })}</tbody>
        </table>
      </section>
      {isEditable && (
        <>
          <button onClick={addDetail}>添加 L3</button>
        </>
      )}
      <section aria-label="Gap 分析入口" className="gap-handoff">
        <p className="muted">提交自评后立即生成 Gap；Review 认可闭环后，才可正式纳入年度计划。</p>
        <a className="primary-link" href="/capability/gap">
          查看 Gap 分析
        </a>
      </section>
    </section>
  )
}

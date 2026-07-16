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

  const isDraft = assessment.status === '草稿'

  return (
    <section className="page">
      <h1>能力自评</h1>
      <p className="muted">
        {assessment.year} · 版本 {assessment.version} · {assessment.status}
      </p>
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
      {details.map((detail, index) => (
        <article key={index} className="draft-item">
          <label>
            L3 编码
            <input
              value={detail.l3_code}
              onChange={(event) =>
                updateDetail(index, { l3_code: event.target.value })
              }
              disabled={!isDraft}
            />
          </label>
          <label>
            当前掌握度
            <select
              value={detail.current_level}
              onChange={(event) =>
                updateDetail(index, {
                  current_level: Number(event.target.value),
                })
              }
              disabled={!isDraft}
            >
              {[1, 2, 3, 4, 5].map((level) => (
                <option key={level} value={level}>
                  {level}
                </option>
              ))}
            </select>
          </label>
          <label>
            目标掌握度
            <select
              value={detail.target_level}
              onChange={(event) =>
                updateDetail(index, {
                  target_level: Number(event.target.value),
                })
              }
              disabled={!isDraft}
            >
              {[1, 2, 3, 4, 5].map((level) => (
                <option key={level} value={level}>
                  {level}
                </option>
              ))}
            </select>
          </label>
          <label>
            自评依据
            <textarea
              value={detail.evidence_note ?? ''}
              onChange={(event) =>
                updateDetail(index, { evidence_note: event.target.value })
              }
              disabled={!isDraft}
            />
          </label>
          <label className="checkbox">
            <input
              type="checkbox"
              checked={detail.plan_candidate ?? false}
              onChange={(event) =>
                updateDetail(index, { plan_candidate: event.target.checked })
              }
              disabled={!isDraft}
            />
            纳入计划候选
          </label>
          {isDraft && <button onClick={() => removeDetail(index)}>删除</button>}
        </article>
      ))}
      {isDraft && (
        <>
          <button onClick={addDetail}>添加 L3</button>
          <div className="actions">
            <button onClick={handleSave}>保存草稿</button>
            <button onClick={handleSubmit}>提交</button>
          </div>
        </>
      )}
    </section>
  )
}

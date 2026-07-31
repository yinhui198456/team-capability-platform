import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import s from './AssessmentGapPage.module.css'
import { useYear } from './YearContext'
import {
  type Assessment,
  type AssessmentDetail,
  type AssessmentL2Group,
  type DraftTargetRepairPreview,
  type ScopePreview,
  createAssessment,
  batchFillL2,
  fetchScopePreview,
  getAssessment,
  getDraftTargetRepairPreview,
  listAssessments,
  saveDraft,
  repairDraftTargetSnapshots,
  selectL2Requirement,
  submitAssessment,
} from './assessment'
import { type ApiError } from './shared/api'
import {
  mockAssessment,
  mockAssessmentSubmitted,
  isMockEnabled,
} from './__fixtures__/assessmentMock'

const LEVELS = [1, 2, 3, 4, 5]
const DOMAINS: Record<string, string> = {
  P01: '数据基础设施',
  P02: 'AI Infra / Agent',
  P03: '工程编码',
  C01: '基本办公能力',
  C02: '沟通协作',
  C03: '学习创新',
}

function l1Of(detail: AssessmentDetail) {
  return detail.l1_code ?? '未映射'
}

function l2Of(detail: AssessmentDetail) {
  return detail.l2_code ?? detail.l3_code
}

function defaultL2(details: AssessmentDetail[], domain: string) {
  const groups = new Map<string, AssessmentDetail[]>()
  for (const detail of details.filter((item) => l1Of(item) === domain)) {
    const code = l2Of(detail)
    groups.set(code, [...(groups.get(code) ?? []), detail])
  }
  return [...groups.entries()].sort(
    (left, right) => right[1].length - left[1].length,
  )[0]?.[0]
}

function defaultDomain(details: AssessmentDetail[]) {
  const counts = new Map<string, number>()
  for (const detail of details.filter(isApplicableDetail)) {
    const domain = l1Of(detail)
    counts.set(domain, (counts.get(domain) ?? 0) + 1)
  }
  return (
    [...counts.entries()].sort((left, right) => right[1] - left[1])[0]?.[0] ??
    'P01'
  )
}

function domainLabel(code: string) {
  return DOMAINS[code] ? `${code} · ${DOMAINS[code]}` : code
}

function effectiveTarget(detail: AssessmentDetail): number | null {
  if (!isApplicableDetail(detail)) return null
  return detail.target_adjusted
    ? (detail.adjusted_target_level ?? null)
    : (detail.standard_target_level ?? detail.target_level ?? null)
}

function isFilled(detail: AssessmentDetail) {
  return (
    isApplicableDetail(detail) &&
    !detail.target_compatibility_error &&
    !unfilledReason(detail)
  )
}

function isApplicableDetail(detail: AssessmentDetail) {
  return detail.standard_target_applicable !== false
}

function normalizeEvidence(value: unknown) {
  return typeof value === 'string' ? value.trim() : ''
}

function isValidLevel(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isInteger(value) &&
    value >= 1 &&
    value <= 5
  )
}

function isEvidenceValid(detail: AssessmentDetail) {
  const current = detail.current_level
  if (current == null) return true
  const evidence = normalizeEvidence(detail.evidence_note)
  if (
    detail.inherited_current_level != null &&
    current > detail.inherited_current_level
  ) {
    return (
      evidence.length > 0 &&
      evidence !== normalizeEvidence(detail.inherited_evidence_note)
    )
  }
  return current < 3 || evidence.length > 0
}

function adjustmentReason(detail: AssessmentDetail) {
  if (!detail.target_adjusted) {
    return detail.adjusted_target_level != null ||
      normalizeEvidence(detail.target_adjustment_reason)
      ? '需取消个人调整'
      : ''
  }
  if (!isValidLevel(detail.adjusted_target_level)) return '需填写调整目标'
  if (!normalizeEvidence(detail.target_adjustment_reason)) {
    return '需填写调整原因'
  }
  return ''
}

function isInheritedUpdate(detail: AssessmentDetail) {
  if (detail.inherited_from_assessment_id == null) return false
  const changed =
    detail.current_level !== detail.inherited_current_level ||
    normalizeEvidence(detail.evidence_note) !==
      normalizeEvidence(detail.inherited_evidence_note)
  if (!changed) return false
  return (
    detail.current_level == null ||
    detail.inherited_current_level == null ||
    detail.current_level <= detail.inherited_current_level ||
    isEvidenceValid(detail)
  )
}

function canBatchFill(detail: AssessmentDetail) {
  return (
    detail.current_level == null &&
    detail.standard_target_applicable !== false &&
    !detail.target_compatibility_error &&
    detail.inherited_current_level == null &&
    !detail.current_level_explicitly_cleared
  )
}

function unfilledReason(detail: AssessmentDetail) {
  if (!isApplicableDetail(detail)) return ''
  const adjustment = adjustmentReason(detail)
  if (adjustment) return adjustment
  if (detail.current_level == null || effectiveTarget(detail) == null) {
    return '需评估等级'
  }
  if (!isEvidenceValid(detail)) {
    if (
      detail.inherited_current_level != null &&
      detail.current_level > detail.inherited_current_level
    ) {
      return '需更新依据'
    }
    if (detail.current_level >= 3) return '需自评依据'
  }
  return ''
}

function progressDetails(details: AssessmentDetail[]) {
  return details.filter(isApplicableDetail)
}

function isStructuredAssessmentError(value: unknown): value is {
  code: string
  l3_code: string
  reason: string
  message: string
} {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { code?: unknown }).code === 'string' &&
    typeof (value as { l3_code?: unknown }).l3_code === 'string' &&
    typeof (value as { reason?: unknown }).reason === 'string' &&
    typeof (value as { message?: unknown }).message === 'string'
  )
}

function levelSelect(
  value: number | null,
  onChange: (value: number | null) => void,
  disabled: boolean,
  ariaLabel: string,
) {
  return (
    <select
      value={value ?? ''}
      onChange={(event) =>
        onChange(event.target.value ? Number(event.target.value) : null)
      }
      disabled={disabled}
      aria-label={ariaLabel}
      title="等级 1–2 可不填依据；等级 3–5 提交时必须填写依据"
    >
      <option value="">请选择</option>
      {LEVELS.map((level) => (
        <option key={level} value={level}>
          {level}
        </option>
      ))}
    </select>
  )
}

function priority(gap: number) {
  return gap >= 3 ? '高' : gap > 0 ? '中' : '低'
}

export function AssessmentGapPage() {
  const year = useYear()
  const [assessment, setAssessment] = useState<Assessment | null>(null)
  const [details, setDetails] = useState<AssessmentDetail[]>([])
  const [activeDomain, setActiveDomain] = useState('')
  const [statusFilter, setStatusFilter] = useState('全部')
  const [search, setSearch] = useState('')
  const [expandedL2, setExpandedL2] = useState<Set<string>>(new Set())
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [dirtyIds, setDirtyIds] = useState<Set<number>>(new Set())
  const [editingId, setEditingId] = useState<number | null>(null)
  const [editingText, setEditingText] = useState('')
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [batchConfirm, setBatchConfirm] = useState<{
    l2Code: string
    level: 1 | 2
  } | null>(null)
  const [selectedRequirement, setSelectedRequirement] = useState<
    Record<string, 'P4' | 'P5' | 'P6' | 'P7' | 'P8'>
  >({})
  const searchInputRef = useRef<HTMLInputElement | null>(null)
  const [searchActiveIndex, setSearchActiveIndex] = useState(-1)
  const [repairPreview, setRepairPreview] =
    useState<DraftTargetRepairPreview | null>(null)
  const [repairLoading, setRepairLoading] = useState(false)
  const [repairExecuting, setRepairExecuting] = useState(false)
  const [scopePreview, setScopePreview] = useState<ScopePreview | null>(null)
  const [previewLoading, setPreviewLoading] = useState(false)
  const [createIdempotencyKey, setCreateIdempotencyKey] = useState<
    string | null
  >(null)
  const [createBusy, setCreateBusy] = useState(false)
  const [scopeChanged, setScopeChanged] = useState<{
    member_current_level: string
    member_target_level: string
    standard_version: { id: number; label: string }
    summary: ScopePreview['summary']
    empty_scope: boolean
    scope_token: string
  } | null>(null)
  const [scopeFilter, setScopeFilter] = useState<
    '全部' | 'current_required' | 'target_progressive'
  >('全部')

  function loadAssessment(value: Assessment) {
    setAssessment(value)
    setDetails(value.details ?? [])
    const firstDomain =
      value.l2_groups?.[0]?.l1_code ?? defaultDomain(value.details ?? [])
    setActiveDomain((current) => current || firstDomain)
    const firstL2 =
      value.l2_groups?.find((group) => group.l1_code === firstDomain)
        ?.l2_code ?? defaultL2(value.details ?? [], firstDomain)
    if (firstL2) setExpandedL2(new Set([firstL2]))
  }

  useEffect(() => {
    let cancelled = false
    async function init() {
      try {
        if (isMockEnabled()) {
          if (!cancelled) loadAssessment(mockAssessment)
        } else {
          const list = await listAssessments()
          const draft = list.find(
            (item) => item.status === '草稿' || item.status === '建议调整',
          )
          if (draft) {
            const full = await getAssessment(draft.id)
            if (!cancelled) loadAssessment(full)
          }
        }
      } catch (err: unknown) {
        if (!cancelled)
          setError(err instanceof Error ? err.message : '加载失败')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    void init()
    return () => {
      cancelled = true
    }
  }, [])

  async function handlePreview() {
    setError('')
    setPreviewLoading(true)
    setScopeChanged(null)
    try {
      const preview = await fetchScopePreview(year)
      if (preview.open_draft_id) {
        loadAssessment(await getAssessment(preview.open_draft_id))
        return
      }
      setScopePreview(preview)
      setCreateIdempotencyKey(crypto.randomUUID())
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : '预览失败')
    } finally {
      setPreviewLoading(false)
    }
  }

  async function handleCreate(tokenOverride?: string) {
    if (isMockEnabled()) {
      loadAssessment(mockAssessment)
      return
    }
    const token = tokenOverride ?? scopePreview?.scope_token
    if (!token) return
    setError('')
    setCreateBusy(true)
    try {
      const created = await createAssessment(
        year,
        token,
        '年度',
        createIdempotencyKey ?? undefined,
      )
      setScopePreview(null)
      setScopeChanged(null)
      setCreateIdempotencyKey(null)
      loadAssessment(await getAssessment(created.id))
    } catch (err: unknown) {
      const apiErr = err as ApiError
      const detail = apiErr.detail as
        | {
            code?: string
            summary?: ScopePreview
            issues?: Array<{ assessment_id?: number }>
          }
        | undefined
      if (detail?.code === 'assessment_scope_changed' && detail.summary) {
        setScopeChanged(detail.summary)
        setError('评估范围已变化，请根据最新范围重新确认。')
        setCreateIdempotencyKey(crypto.randomUUID())
      } else if (detail?.code === 'open_draft_exists') {
        const draftId = detail.issues?.[0]?.assessment_id
        if (draftId) {
          setScopePreview(null)
          setCreateIdempotencyKey(null)
          loadAssessment(await getAssessment(draftId))
          return
        }
        setError(apiErr.message)
      } else {
        setError(apiErr.message || '创建失败')
      }
    } finally {
      setCreateBusy(false)
    }
  }

  function updateDetail(index: number, patch: Partial<AssessmentDetail>) {
    const detail = details[index]
    setDetails((current) =>
      current.map((item, itemIndex) =>
        itemIndex === index ? { ...item, ...patch } : item,
      ),
    )
    if (detail?.id != null) {
      setDirtyIds((current) => new Set(current).add(detail.id!))
    }
  }

  async function handleSave() {
    if (!assessment) return
    const changed = details.filter(
      (detail) => detail.id != null && dirtyIds.has(detail.id),
    )
    if (!changed.length) return
    setError('')
    setMessage('')
    try {
      if (isMockEnabled()) {
        setMessage('草稿已保存')
        setDirtyIds(new Set())
        return
      }
      const result = await saveDraft(
        assessment.id,
        changed,
        assessment.revision ?? 1,
      )
      setAssessment((current) =>
        current
          ? {
              ...current,
              revision: result.revision ?? current.revision,
              gap_summary: result.gap_summary ?? current.gap_summary,
            }
          : current,
      )
      setDirtyIds(new Set())
      const autoCancelled = result.auto_cancelled_plan_candidates ?? []
      if (autoCancelled.length) {
        setDetails((current) =>
          current.map((detail) =>
            autoCancelled.includes(detail.l3_code)
              ? { ...detail, plan_candidate: false }
              : detail,
          ),
        )
      }
      setMessage(
        autoCancelled.length
          ? `草稿已保存，已自动取消 ${autoCancelled.join('、')} 的计划候选`
          : '草稿已保存',
      )
    } catch (err: unknown) {
      const status = (err as { status?: number }).status
      setError(
        status === 409
          ? '数据已被其他操作更新，已保留本地输入；请重新加载后再保存。'
          : err instanceof Error
            ? err.message
            : '保存失败',
      )
    }
  }

  async function handleBatchFill(l2Code: string, currentLevel: 1 | 2) {
    if (!assessment) return
    setError('')
    setMessage('')
    try {
      const result = await batchFillL2(
        assessment.id,
        l2Code,
        currentLevel,
        assessment.revision ?? 1,
      )
      setDetails((current) =>
        current.map((detail) =>
          result.updated_l3_codes.includes(detail.l3_code)
            ? { ...detail, current_level: currentLevel }
            : detail,
        ),
      )
      setAssessment((current) =>
        current
          ? {
              ...current,
              revision: result.revision ?? current.revision,
              gap_summary: result.gap_summary ?? current.gap_summary,
            }
          : current,
      )
      const autoCancelled = result.auto_cancelled_plan_candidates ?? []
      if (autoCancelled.length) {
        setDetails((current) =>
          current.map((detail) =>
            autoCancelled.includes(detail.l3_code)
              ? { ...detail, plan_candidate: false }
              : detail,
          ),
        )
      }
      setBatchConfirm(null)
      setMessage(
        `已将本 L2 真正空值批量设为 ${currentLevel}；已有值、沿用值和显式清空项保持不变。`,
      )
    } catch (err: unknown) {
      const status = (err as { status?: number }).status
      setError(
        status === 409
          ? '数据已被其他操作更新，请重新加载后再保存。'
          : err instanceof Error
            ? err.message
            : '批量填写失败',
      )
    }
  }

  async function handleSubmit() {
    if (!assessment) return
    setError('')
    setMessage('')
    try {
      if (isMockEnabled()) {
        setAssessment({ ...mockAssessmentSubmitted, details })
        setMessage('已提交，Gap 即时生成。等待 Buddy 复核。')
        return
      }
      let revision = assessment.revision ?? 1
      const changed = details.filter(
        (detail) => detail.id != null && dirtyIds.has(detail.id),
      )
      if (changed.length) {
        const saved = await saveDraft(assessment.id, changed, revision)
        revision = saved.revision ?? revision + 1
        const autoCancelled = saved.auto_cancelled_plan_candidates ?? []
        setDetails((current) =>
          current.map((detail) =>
            autoCancelled.includes(detail.l3_code)
              ? { ...detail, plan_candidate: false }
              : detail,
          ),
        )
        setAssessment((current) =>
          current
            ? {
                ...current,
                revision,
                gap_summary: saved.gap_summary ?? current.gap_summary,
              }
            : current,
        )
        setDirtyIds(new Set())
      }
      const result = await submitAssessment(assessment.id, revision)
      loadAssessment(await getAssessment(assessment.id))
      setMessage(
        (result.auto_cancelled_plan_candidates ?? []).length
          ? `已提交，已自动取消 ${(result.auto_cancelled_plan_candidates ?? []).join('、')} 的计划候选。`
          : '已提交，Gap 即时生成。等待 Buddy 复核。',
      )
    } catch (err: unknown) {
      const status = (err as { status?: number }).status
      const detail = (err as { detail?: unknown }).detail
      setError(
        status === 409
          ? '提交冲突：数据已被其他操作更新，请重新加载后再提交。'
          : isStructuredAssessmentError(detail)
            ? (() => {
                const target = details.find(
                  (item) => item.l3_code === detail.l3_code,
                )
                if (target) locateDetail(target)
                return detail.message
              })()
            : err instanceof Error
              ? err.message
              : '提交失败',
      )
    }
  }

  async function handleRepairPreview() {
    if (!assessment || repairLoading) return
    setError('')
    setMessage('')
    setRepairLoading(true)
    try {
      setRepairPreview(await getDraftTargetRepairPreview(assessment.id))
    } catch (err: unknown) {
      setError(
        err instanceof Error ? err.message : '无法读取修复影响，请稍后重试。',
      )
    } finally {
      setRepairLoading(false)
    }
  }

  async function handleRepairConfirm() {
    if (!assessment || !repairPreview || repairExecuting) return
    setError('')
    setMessage('')
    setRepairExecuting(true)
    try {
      const result = await repairDraftTargetSnapshots(
        assessment.id,
        repairPreview.revision,
      )
      loadAssessment(await getAssessment(assessment.id))
      setRepairPreview(null)
      setDirtyIds(new Set())
      setMessage(
        result.result === 'noop'
          ? '草稿目标快照已是最新状态。'
          : '草稿目标快照已修复，已重新加载评估。',
      )
    } catch (err: unknown) {
      const status = (err as { status?: number }).status
      const detail = (err as { detail?: { message?: unknown } }).detail
      setError(
        status === 409
          ? '草稿已被更新，请重新加载后查看修复影响。'
          : typeof detail?.message === 'string'
            ? detail.message
            : err instanceof Error
              ? err.message
              : '修复失败，请重试。',
      )
    } finally {
      setRepairExecuting(false)
    }
  }

  function locateDetail(detail: AssessmentDetail) {
    setActiveDomain(l1Of(detail))
    setExpandedL2((current) => new Set(current).add(l2Of(detail)))
    setSearch('')
    setSearchActiveIndex(-1)
    searchInputRef.current?.focus()
    setTimeout(() => {
      const row = document.getElementById(
        `row-${detail.id}`,
      ) as HTMLElement | null
      row?.scrollIntoView({ behavior: 'smooth', block: 'center' })
      row?.focus()
    }, 50)
  }

  function locateNextUnfilled() {
    const detail = progressDetails(details).find((item) => !isFilled(item))
    if (detail) locateDetail(detail)
  }

  function setEvidence(index: number, value: string) {
    updateDetail(index, { evidence_note: value })
    setEditingId(null)
  }

  const hasCompatibilityError = details.some((detail) =>
    Boolean(detail.target_compatibility_error),
  )
  const editable =
    !hasCompatibilityError &&
    (assessment?.status === '草稿' || assessment?.status === '建议调整')
  const assessedDetails = useMemo(() => progressDetails(details), [details])
  const filled = useMemo(
    () => assessedDetails.filter(isFilled).length,
    [assessedDetails],
  )
  const unfilled = assessedDetails.length - filled
  const domains = useMemo(
    () =>
      [
        ...new Set([
          ...details.map(l1Of),
          ...(assessment?.l2_groups ?? []).map((group) => group.l1_code),
        ]),
      ].filter((code): code is string => typeof code === 'string'),
    [assessment, details],
  )
  const filtered = useMemo(() => {
    let list = details.filter((detail) => l1Of(detail) === activeDomain)
    if (scopeFilter !== '全部') {
      if (assessment?.assessment_scope_version) {
        list = list.filter((detail) => detail.scope_type === scopeFilter)
      } else {
        // Legacy details have no scope classification — never fabricate it.
        list = []
      }
    }
    if (statusFilter === '未完成')
      list = list.filter(
        (detail) => isApplicableDetail(detail) && !isFilled(detail),
      )
    if (statusFilter === '有Gap') {
      list = list.filter(
        (detail) =>
          detail.current_level != null &&
          effectiveTarget(detail) != null &&
          effectiveTarget(detail)! > detail.current_level,
      )
    }
    if (statusFilter === '计划候选')
      list = list.filter((detail) => detail.plan_candidate)
    return list
  }, [details, activeDomain, statusFilter, scopeFilter, assessment])
  const searchResults = useMemo(() => {
    const query = search.trim().toLowerCase()
    if (!query) return []
    return details
      .filter(
        (detail) =>
          detail.l3_code.toLowerCase().includes(query) ||
          (detail.l3_name ?? '').toLowerCase().includes(query),
      )
      .slice(0, 10)
  }, [details, search])
  const l2Groups = useMemo(() => {
    const groups = new Map<
      string,
      AssessmentL2Group & { l1_code: string; l2_code: string }
    >()
    for (const group of assessment?.l2_groups ?? []) {
      if (group.l1_code === activeDomain && group.l2_code) {
        groups.set(group.l2_code, {
          ...group,
          l1_code: group.l1_code,
          l2_code: group.l2_code,
          details: [],
        })
      }
    }
    for (const detail of filtered) {
      const code = l2Of(detail)
      const existing = groups.get(code)
      if (existing) {
        existing.details.push(detail)
        existing.l3_count = Math.max(existing.l3_count, existing.details.length)
      } else {
        groups.set(code, {
          l1_code: l1Of(detail),
          l1_name: detail.l1_name ?? null,
          l2_code: code,
          l2_name: detail.l2_name ?? null,
          l3_count: 1,
          is_empty: false,
          details: [detail],
        })
      }
    }
    return [...groups.values()].sort((left, right) => {
      const leftOpen = expandedL2.has(left.l2_code) ? 0 : 1
      const rightOpen = expandedL2.has(right.l2_code) ? 0 : 1
      return leftOpen - rightOpen
    })
  }, [activeDomain, assessment, expandedL2, filtered])
  const summary = assessment?.gap_summary

  if (loading) return <p className="muted">加载中…</p>
  if (!assessment) {
    const preview = scopeChanged ?? scopePreview
    return (
      <section className="page">
        <h1>能力自评与 Gap 分析</h1>
        <p>当前年度暂无草稿。</p>
        {!preview && (
          <button
            type="button"
            onClick={() => void handlePreview()}
            disabled={previewLoading}
          >
            {previewLoading ? '计算范围中…' : '预览评估范围'}
          </button>
        )}
        {preview && (
          <section aria-label="评估范围预览" data-testid="scope-preview">
            <p>
              当前 {preview.member_current_level} → 年度目标{' '}
              {preview.member_target_level} · {preview.standard_version.label}
            </p>
            <p>
              适用 <strong>{preview.summary.total}</strong> · 必备{' '}
              <strong>{preview.summary.current_required}</strong> · 进阶{' '}
              <strong>{preview.summary.target_progressive}</strong>
            </p>
            {preview.empty_scope ? (
              <p className="error" role="alert">
                当前职级与目标职级下没有可评估的能力项，无法创建评估。
              </p>
            ) : (
              <button
                type="button"
                onClick={() => void handleCreate(preview.scope_token)}
                disabled={createBusy}
              >
                {createBusy
                  ? '创建中…'
                  : scopeChanged
                    ? '按最新范围重新确认创建'
                    : '确认创建年度自评草稿'}
              </button>
            )}
          </section>
        )}
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
      </section>
    )
  }

  return (
    <section className={`page assessment-page ${s['assessment-page']}`}>
      <div className={s.contentArea} data-testid="assessment-content-area">
        <header
          className={`page-heading assessment-header ${s['assessment-header']}`}
        >
          <div>
            <p className="eyebrow">能力成长 / 能力自评与 Gap</p>
            <h1>能力自评与 Gap 分析</h1>
            <p className="muted" data-testid="scope-header">
              {assessment.year} 年度 · 版本 {assessment.version} ·{' '}
              {assessment.status}
              {assessment.assessment_scope_version
                ? ` · 当前 ${assessment.member_current_level_snapshot} → 年度目标 ${assessment.member_target_level_snapshot}`
                : ''}
              {assessment.standard_version_label
                ? ` · ${assessment.standard_version_label}`
                : ''}
              {assessment.scope_summary
                ? ` · 适用 ${assessment.scope_summary.total} · 必备 ${assessment.scope_summary.current_required} · 进阶 ${assessment.scope_summary.target_progressive}`
                : ''}
            </p>
          </div>
          <div className="assessment-actions">
            <button type="button" onClick={() => setDrawerOpen(true)}>
              查看 Gap 摘要
            </button>
            <a href="/capability/assessment/history">查看评估历史</a>
          </div>
        </header>

        <section
          className={`assessment-summary compact-summary ${s['compact-summary']}`}
          aria-label="评估摘要"
        >
          <span>
            进度{' '}
            <strong>
              {filled}/{assessedDetails.length}
            </strong>
          </span>
          <span>
            未完成 <strong>{unfilled}</strong>
          </span>
          <span>
            Review{' '}
            <strong>
              {assessment.status === '已复核' || assessment.status === '已归档'
                ? '认可闭环'
                : assessment.status}
            </strong>
          </span>
          <span>
            Gap <strong>{summary?.total_gaps ?? 0}</strong>
          </span>
        </section>
        {hasCompatibilityError && assessment && (
          <section
            className={s.repairBlocker}
            aria-label="草稿目标快照需要兼容修复"
            role="alert"
          >
            <strong>草稿目标快照需要兼容修复</strong>
            <p>
              此草稿暂不能保存或提交。请先查看修复影响；修复会在整份草稿可安全处理时一次完成。
            </p>
            <button
              type="button"
              onClick={() => void handleRepairPreview()}
              disabled={repairLoading || repairExecuting}
            >
              {repairLoading ? '读取中…' : '查看修复影响'}
            </button>
            {repairPreview && (
              <div
                className={s.repairPreview}
                data-testid="draft-repair-preview"
              >
                <p>
                  将重建 {repairPreview.summary.rebuild_count} 条明细，保留{' '}
                  {repairPreview.summary.preserve_count} 条明细。
                </p>
                {repairPreview.summary.unrepairable_count > 0 ? (
                  <>
                    <p>存在无法安全修复的明细，本次不会写入任何数据。</p>
                    <ul>
                      {repairPreview.unrepairable_details.map((detail) => (
                        <li key={detail.l3_code}>
                          {detail.l3_code}：{detail.reason ?? '无法修复'}
                        </li>
                      ))}
                    </ul>
                  </>
                ) : repairPreview.summary.actionable_count > 0 ? (
                  <button
                    type="button"
                    onClick={() => void handleRepairConfirm()}
                    disabled={repairExecuting}
                  >
                    {repairExecuting ? '修复中…' : '确认修复草稿'}
                  </button>
                ) : (
                  <p>草稿目标快照已是最新状态。</p>
                )}
              </div>
            )}
          </section>
        )}
        {error && <p className="error global-assessment-error">{error}</p>}
        {message && <p className="success">{message}</p>}

        <div className={s.navigationRow}>
          <nav className={s.l1Nav} aria-label="一级能力域导航">
            {domains.map((domain) => {
              const domainItems = details.filter(
                (detail) => l1Of(detail) === domain,
              )
              return (
                <button
                  type="button"
                  key={domain}
                  className={domain === activeDomain ? s.activeNav : ''}
                  aria-pressed={domain === activeDomain}
                  onClick={() => {
                    setActiveDomain(domain)
                    setSearch('')
                    const first = defaultL2(details, domain)
                    if (first) setExpandedL2(new Set([first]))
                  }}
                >
                  {domainLabel(domain)}{' '}
                  <small>
                    {
                      domainItems.filter(isApplicableDetail).filter(isFilled)
                        .length
                    }
                    /{domainItems.filter(isApplicableDetail).length}
                  </small>
                </button>
              )
            })}
          </nav>
          <div className={s.toolbar}>
            <select
              aria-label="范围筛选"
              data-testid="scope-filter"
              value={scopeFilter}
              onChange={(e) =>
                setScopeFilter(
                  e.target.value as
                    '全部' | 'current_required' | 'target_progressive',
                )
              }
            >
              <option value="全部">全部适用</option>
              <option value="current_required">当前职级必备</option>
              <option value="target_progressive">目标职级进阶</option>
            </select>
            <select
              aria-label="状态筛选"
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
            >
              <option value="全部">当前域全部</option>
              <option value="未完成">未完成</option>
              <option value="有Gap">有 Gap</option>
              <option value="计划候选">计划候选</option>
            </select>
            <input
              ref={searchInputRef}
              className={s.searchBox}
              aria-label="搜索全部能力项"
              placeholder="搜索全部 L3"
              value={search}
              onChange={(event) => {
                setSearch(event.target.value)
                setSearchActiveIndex(event.target.value.trim() ? 0 : -1)
              }}
              role="combobox"
              aria-expanded={searchResults.length > 0}
              aria-controls="assessment-search-results"
              aria-activedescendant={
                searchActiveIndex >= 0
                  ? `search-result-${searchResults[searchActiveIndex]?.id}`
                  : undefined
              }
              onKeyDown={(event) => {
                if (event.key === 'Escape') {
                  event.preventDefault()
                  setSearch('')
                  setSearchActiveIndex(-1)
                  searchInputRef.current?.focus()
                  return
                }
                if (!searchResults.length) return
                if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
                  event.preventDefault()
                  setSearchActiveIndex((current) => {
                    const base = current < 0 ? 0 : current
                    return event.key === 'ArrowDown'
                      ? (base + 1) % searchResults.length
                      : (base - 1 + searchResults.length) % searchResults.length
                  })
                } else if (event.key === 'Enter' && searchActiveIndex >= 0) {
                  event.preventDefault()
                  locateDetail(searchResults[searchActiveIndex])
                }
              }}
            />
            <button
              type="button"
              className={s.locateBtn}
              onClick={locateNextUnfilled}
            >
              定位未完成
            </button>
            {searchResults.length > 0 && (
              <div
                className={s.searchResults}
                id="assessment-search-results"
                role="listbox"
                aria-label="搜索结果"
              >
                {searchResults.map((detail, resultIndex) => (
                  <button
                    type="button"
                    key={detail.id}
                    id={`search-result-${detail.id}`}
                    role="option"
                    aria-selected={searchActiveIndex === resultIndex}
                    tabIndex={-1}
                    onMouseEnter={() => setSearchActiveIndex(resultIndex)}
                    onClick={() => locateDetail(detail)}
                  >
                    {detail.l3_name ?? detail.l3_code} ·{' '}
                    {domainLabel(l1Of(detail))} /{' '}
                    {detail.l2_name ?? l2Of(detail)}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className={s.mainArea} data-testid="assessment-main-area">
          {scopeFilter !== '全部' && !assessment.assessment_scope_version && (
            <p className="muted" data-testid="legacy-scope-hint">
              历史评估未按范围分类，必备/进阶筛选不可用。
            </p>
          )}
          <div className={s.tableArea}>
            {l2Groups.map((group) => {
              const l2Code = group.l2_code
              const items = group.details
              const open = expandedL2.has(l2Code)
              const suggestedRequirement = group.requirements
                ? selectL2Requirement(
                    group.requirements,
                    assessment.member_current_level,
                    assessment.member_target_level,
                  )
                : null
              const requirementLevel =
                selectedRequirement[l2Code] ?? suggestedRequirement?.level
              const requirementText =
                requirementLevel && group.requirements
                  ? group.requirements[requirementLevel]
                  : null
              return (
                <div className={s.domainGroup} key={l2Code}>
                  <div className={s.domainHeader}>
                    <button
                      type="button"
                      aria-expanded={open}
                      onClick={() =>
                        setExpandedL2((current) => {
                          const next = new Set(current)
                          if (next.has(l2Code)) next.delete(l2Code)
                          else next.add(l2Code)
                          return next
                        })
                      }
                    >
                      <span>
                        {open ? '▾' : '▸'} {l2Code} · {group.l2_name ?? l2Code}
                      </span>
                    </button>
                    <span className={s.groupActions}>
                      <small>二级能力标准 · {group.l3_count} 条达成路径</small>
                      <small>
                        {
                          items.filter(isApplicableDetail).filter(isFilled)
                            .length
                        }
                        /{items.filter(isApplicableDetail).length}
                      </small>
                      {editable &&
                        items.some(canBatchFill) &&
                        [1, 2].map((level) => {
                          const typedLevel = level as 1 | 2
                          const confirming =
                            batchConfirm?.l2Code === l2Code &&
                            batchConfirm?.level === typedLevel
                          return confirming ? (
                            <button
                              key={level}
                              type="button"
                              onClick={(event) => {
                                event.stopPropagation()
                                void handleBatchFill(l2Code, typedLevel)
                              }}
                            >
                              确认填 {level}
                            </button>
                          ) : (
                            <button
                              key={level}
                              type="button"
                              onClick={(event) => {
                                event.stopPropagation()
                                setBatchConfirm({
                                  l2Code,
                                  level: typedLevel,
                                })
                              }}
                            >
                              批量填 {level}
                            </button>
                          )
                        })}
                    </span>
                  </div>
                  {open && (
                    <>
                      <section aria-label={l2Code + ' 职级要求'}>
                        <strong>职级要求 P4–P8</strong>
                        {group.requirements ? (
                          <>
                            <div className={s.groupActions}>
                              {(['P4', 'P5', 'P6', 'P7', 'P8'] as const).map(
                                (level) => (
                                  <button
                                    aria-pressed={requirementLevel === level}
                                    key={level}
                                    onClick={() =>
                                      setSelectedRequirement((current) => ({
                                        ...current,
                                        [l2Code]: level,
                                      }))
                                    }
                                    type="button"
                                  >
                                    {level}
                                  </button>
                                ),
                              )}
                            </div>
                            <p className="muted">
                              {requirementText?.trim()
                                ? (suggestedRequirement?.label ?? '职级') +
                                  ' ' +
                                  requirementLevel +
                                  '：' +
                                  requirementText
                                : '职级要求暂不可用'}
                            </p>
                          </>
                        ) : (
                          <p className="muted">职级要求暂不可用</p>
                        )}
                      </section>
                      <h3>三级达成路径 / 学习实践项</h3>
                      {group.is_empty ? (
                        <p className="muted">
                          暂无三级达成路径，当前无可评估项
                        </p>
                      ) : (
                        <table
                          className={s.table}
                          data-testid="assessment-table"
                        >
                          <thead>
                            <tr>
                              <th>三级达成路径 / 学习实践项</th>
                              <th>当前掌握度</th>
                              <th>标准目标</th>
                              <th>个人调整</th>
                              <th>最终目标</th>
                              <th>Gap</th>
                              <th>优先级</th>
                              <th>计划候选</th>
                              <th>依据</th>
                              <th title="L3 建议起始阶段，不是岗位职级要求">
                                建议起始阶段
                              </th>
                            </tr>
                          </thead>
                          <tbody>
                            {items.map((detail) => {
                              const index = details.indexOf(detail)
                              const target = effectiveTarget(detail)
                              const gap =
                                detail.current_level != null && target != null
                                  ? Math.max(target - detail.current_level, 0)
                                  : null
                              const reason = unfilledReason(detail)
                              const applicable = isApplicableDetail(detail)
                              const adjustable =
                                applicable &&
                                detail.standard_target_level != null &&
                                !detail.target_compatibility_error
                              const inherited =
                                detail.inherited_from_assessment_id != null
                              const updated =
                                inherited && isInheritedUpdate(detail)
                              return (
                                <Fragment key={detail.id}>
                                  <tr
                                    id={`row-${detail.id}`}
                                    tabIndex={-1}
                                    className={
                                      gap && gap > 0 ? s.rowGap : undefined
                                    }
                                  >
                                    <td>
                                      <strong>
                                        {detail.l3_name ?? detail.l3_code}
                                      </strong>
                                      <small className={s.l3name}>
                                        {detail.l3_code}
                                      </small>
                                      {!isFilled(detail) && reason && (
                                        <span className={s.reasonTag}>
                                          {reason}
                                        </span>
                                      )}
                                      {inherited && (
                                        <span className={s.inheritanceTag}>
                                          {updated
                                            ? '本次已更新'
                                            : '沿用上次评估'}
                                        </span>
                                      )}
                                    </td>
                                    <td>
                                      {levelSelect(
                                        detail.current_level,
                                        (value) =>
                                          updateDetail(index, {
                                            current_level: value,
                                          }),
                                        !editable || !applicable,
                                        `当前等级 ${detail.l3_code}`,
                                      )}
                                    </td>
                                    <td title="标准目标等级 1–5">
                                      {applicable ? (
                                        <>
                                          标准{' '}
                                          {detail.standard_target_level ??
                                            detail.target_level ??
                                            '—'}
                                          {detail.target_snapshot_source ===
                                            'legacy_preserved' && (
                                            <small className={s.snapshotTag}>
                                              历史保留
                                            </small>
                                          )}
                                        </>
                                      ) : (
                                        '不适用'
                                      )}
                                    </td>
                                    <td>
                                      <label className="checkbox">
                                        <input
                                          type="checkbox"
                                          aria-label={`申请调整 ${detail.l3_code}`}
                                          checked={
                                            detail.target_adjusted ?? false
                                          }
                                          disabled={!editable || !adjustable}
                                          onChange={(event) =>
                                            updateDetail(index, {
                                              target_adjusted:
                                                event.target.checked,
                                              adjusted_target_level: event
                                                .target.checked
                                                ? (detail.adjusted_target_level ??
                                                  detail.standard_target_level ??
                                                  null)
                                                : null,
                                              target_adjustment_reason: event
                                                .target.checked
                                                ? (detail.target_adjustment_reason ??
                                                  '')
                                                : null,
                                            })
                                          }
                                        />
                                        调整
                                      </label>
                                      {detail.target_adjusted && adjustable && (
                                        <div className={s.adjustmentEditor}>
                                          {levelSelect(
                                            detail.adjusted_target_level ??
                                              null,
                                            (value) =>
                                              updateDetail(index, {
                                                adjusted_target_level: value,
                                              }),
                                            !editable,
                                            `调整目标 ${detail.l3_code}`,
                                          )}
                                          <input
                                            aria-label={`调整原因 ${detail.l3_code}`}
                                            value={
                                              detail.target_adjustment_reason ??
                                              ''
                                            }
                                            placeholder="填写调整原因"
                                            onChange={(event) =>
                                              updateDetail(index, {
                                                target_adjustment_reason:
                                                  event.target.value,
                                              })
                                            }
                                            disabled={!editable}
                                          />
                                        </div>
                                      )}
                                    </td>
                                    <td>{target ?? '—'}</td>
                                    <td className={s.gapCell}>{gap ?? '—'}</td>
                                    <td>
                                      {gap == null ? '未评估' : priority(gap)}
                                    </td>
                                    <td>
                                      <input
                                        type="checkbox"
                                        aria-label={`计划候选 ${detail.l3_code}`}
                                        checked={detail.plan_candidate ?? false}
                                        disabled={
                                          !editable ||
                                          !applicable ||
                                          detail.current_level == null ||
                                          target == null ||
                                          (gap != null && gap <= 0) ||
                                          Boolean(reason)
                                        }
                                        onChange={(event) =>
                                          updateDetail(index, {
                                            plan_candidate:
                                              event.target.checked,
                                          })
                                        }
                                      />
                                    </td>
                                    <td>
                                      <button
                                        type="button"
                                        className={s.inlineBtn}
                                        onClick={() => {
                                          setEditingId(detail.id ?? null)
                                          setEditingText(
                                            detail.evidence_note ?? '',
                                          )
                                        }}
                                        disabled={!editable}
                                      >
                                        {detail.evidence_note?.trim()
                                          ? '编辑'
                                          : '填写'}
                                      </button>
                                    </td>
                                    <td>
                                      {detail.recommended_start_level ?? '—'}
                                    </td>
                                  </tr>
                                  {editingId === detail.id && editable && (
                                    <tr className={s.evidenceRow}>
                                      <td colSpan={10}>
                                        <textarea
                                          autoFocus
                                          value={editingText}
                                          onChange={(event) =>
                                            setEditingText(event.target.value)
                                          }
                                          placeholder="自评依据…"
                                        />
                                        <button
                                          type="button"
                                          onClick={() =>
                                            setEvidence(index, editingText)
                                          }
                                        >
                                          确认依据
                                        </button>
                                        <button
                                          type="button"
                                          onClick={() => setEditingId(null)}
                                        >
                                          取消
                                        </button>
                                      </td>
                                    </tr>
                                  )}
                                </Fragment>
                              )
                            })}
                          </tbody>
                        </table>
                      )}
                    </>
                  )}
                </div>
              )
            })}
          </div>
        </div>

        {drawerOpen && summary && (
          <aside
            className={s.gapDrawer}
            data-testid="gap-drawer"
            aria-label="Gap 摘要"
          >
            <button type="button" onClick={() => setDrawerOpen(false)}>
              关闭
            </button>
            <h2>本次评估整体 Gap</h2>
            <p>Gap 总数：{summary.total_gaps}</p>
            <p>平均 Gap：{summary.avg_gap}</p>
            <p>
              高 / 中 / 低：{summary.high_priority} / {summary.medium_priority}{' '}
              / {summary.low_priority}
            </p>
          </aside>
        )}

        {editable && (
          <footer className={s.stickyActions}>
            {unfilled > 0 && <span>还有 {unfilled} 项未完成</span>}
            <button type="button" onClick={handleSave}>
              保存草稿
            </button>
            <button
              type="button"
              className="primary"
              onClick={handleSubmit}
              disabled={unfilled > 0}
            >
              提交自评
            </button>
          </footer>
        )}
      </div>
    </section>
  )
}

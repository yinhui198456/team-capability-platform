import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import s from './AssessmentGapPage.module.css'
import { useYear } from './YearContext'
import {
  type Assessment,
  type AssessmentDetail,
  type AssessmentL2Group,
  type DraftDetailInput,
  type DraftTargetRepairPreview,
  type ScopePreview,
  createAssessment,
  batchFillL2,
  fetchScopePreview,
  getAssessment,
  getDraftTargetRepairPreview,
  listAssessments,
  newIdempotencyKey,
  repairDraftTargetSnapshots,
  saveDraft,
  generatePlanItems,
  selectL2Requirement,
} from './assessment'
import { type ApiError } from './shared/api'
import {
  mockAssessment,
  mockAssessmentSubmitted,
  isMockEnabled,
} from './__fixtures__/assessmentMock'

// Issue #194 P1: 计划草稿字段（保存提升计划草稿动作），其余字段归评级动作。
const PLAN_FIELDS = new Set([
  'member_priority',
  'include_in_plan',
  'plan_quarter',
  'plan_month',
])

const LEVELS = [0, 1, 2, 3, 4, 5]
const LEVEL_LABELS: Record<number, string> = {
  0: '未接触/无可验证输出',
  1: '入门',
  2: '基础',
  3: '熟练',
  4: '精通',
  5: '专家',
}
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
    value >= 0 &&
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
  // #61: evidence is no longer a submit gate — historical evidence stays
  // readable/writable but never blocks submission.
  return ''
}

function progressDetails(details: AssessmentDetail[]) {
  return details.filter(isApplicableDetail)
}

function isStructuredAssessmentError(value: unknown): value is {
  code: string
  l3_code: string
  l3_node_id?: number
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

function computeGap(detail: AssessmentDetail): number | null {
  const current = detail.current_level
  const target = effectiveTarget(detail)
  if (current != null && target != null) {
    return Math.max(target - current, 0)
  }
  return null
}

type Filter =
  | '全部'
  | '未评估'
  | '有Gap'
  | '当前职级必备'
  | '目标职级进阶'
  | '已纳入计划'
  | '暂缓'

export function AssessmentGapPage() {
  const year = useYear()
  const [assessment, setAssessment] = useState<Assessment | null>(null)
  const [details, setDetails] = useState<AssessmentDetail[]>([])
  const [activeDomain, setActiveDomain] = useState('')
  const [filter, setFilter] = useState<Filter>('全部')
  const [search, setSearch] = useState('')
  const [expandedL2, setExpandedL2] = useState<Set<string>>(new Set())
  const [drawerOpen, setDrawerOpen] = useState(false)
  // Issue #194 P1: 保存评级与维护计划草稿是两个独立动作。按字段拆分脏行
  // —— 评级/调整/依据 与 计划字段（优先级/纳入/月份）互不夹带。
  const [ratingDirtyIds, setRatingDirtyIds] = useState<Set<number>>(new Set())
  const [planDirtyIds, setPlanDirtyIds] = useState<Set<number>>(new Set())
  const [editingId, setEditingId] = useState<number | null>(null)
  const [editingText, setEditingText] = useState('')
  const [adjustmentId, setAdjustmentId] = useState<number | null>(null)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [batchConfirm, setBatchConfirm] = useState<{
    l2Code: string
    level: 0 | 1 | 2
  } | null>(null)
  const [selectedRequirement, setSelectedRequirement] = useState<
    Record<string, 'P4' | 'P5' | 'P6' | 'P7' | 'P8'>
  >({})
  const searchInputRef = useRef<HTMLInputElement | null>(null)
  // Issue #194 P1-4: 生成所选学习任务的 Idempotency-Key 按 payload 指纹复用，
  // 指纹变化（选中项/版本变更）或 409 后换新 key（镜像 BuddyReviewCenter 模式）。
  const genIdemRef = useRef<{ key: string; fingerprint: string } | null>(null)
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
      setCreateIdempotencyKey(newIdempotencyKey())
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
        setCreateIdempotencyKey(newIdempotencyKey())
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
    setDetails((current) =>
      current.map((item, itemIndex) =>
        itemIndex === index ? { ...item, ...patch } : item,
      ),
    )
    const detail = details[index]
    if (detail?.id != null) {
      // Issue #194 P1: 按字段归入对应动作的脏集合，两动作互不夹带。
      const hasPlanField = Object.keys(patch).some((key) =>
        PLAN_FIELDS.has(key),
      )
      const hasRatingField = Object.keys(patch).some(
        (key) => !PLAN_FIELDS.has(key),
      )
      if (hasPlanField) {
        setPlanDirtyIds((current) => new Set(current).add(detail.id!))
      }
      if (hasRatingField) {
        setRatingDirtyIds((current) => new Set(current).add(detail.id!))
      }
    }
  }

  /** Issue #194 P1: 只取某动作的字段构造稀疏 PATCH 行——评级/调整/依据
    或 计划（优先级/纳入/月份），绝不夹带另一动作的字段。 */
  function buildDraftRows(
    rows: AssessmentDetail[],
    kind: 'rating' | 'plan',
  ): DraftDetailInput[] {
    return rows.map((detail) => {
      const base = {
        l3_node_id: detail.l3_node_id,
        l3_code: detail.l3_code,
      }
      if (kind === 'rating') {
        return {
          ...base,
          current_level: detail.current_level,
          target_adjusted: detail.target_adjusted ?? false,
          adjusted_target_level: detail.adjusted_target_level ?? null,
          target_adjustment_reason: detail.target_adjustment_reason ?? null,
          evidence_note: detail.evidence_note ?? null,
        }
      }
      return {
        ...base,
        member_priority: detail.member_priority ?? null,
        include_in_plan: detail.include_in_plan,
        plan_month: detail.plan_month ?? null,
      }
    })
  }

  /** 应用服务端 auto_cleared 裁决：清空相应行的计划字段，并把该行从
    计划脏集合移除（本地未保存计划变更已被服务端否决）。 */
  function applyAutoCleared(
    cleared: Array<{ l3_node_id: number; fields: string[] }>,
  ) {
    if (!cleared.length) return
    const clearedIds = new Set<number>()
    for (const item of cleared) {
      const row = details.find((d) => d.l3_node_id === item.l3_node_id)
      if (row?.id != null) clearedIds.add(row.id)
    }
    for (const item of cleared) {
      setDetails((current) =>
        current.map((detail) => {
          if (detail.l3_node_id === item.l3_node_id) {
            const patch: Partial<AssessmentDetail> = {}
            for (const f of item.fields) {
              if (f === 'member_priority') patch.member_priority = null
              if (f === 'include_in_plan') patch.include_in_plan = null
              if (f === 'plan_quarter') patch.plan_quarter = null
              if (f === 'plan_month') patch.plan_month = null
            }
            return { ...detail, ...patch }
          }
          return detail
        }),
      )
    }
    if (clearedIds.size) {
      setPlanDirtyIds((current) => {
        const next = new Set(current)
        clearedIds.forEach((id) => next.delete(id))
        return next
      })
    }
  }

  async function handleSave() {
    if (!assessment) return
    // Issue #194 P1: 保存能力评级只提交评级/调整/依据字段（稀疏 PATCH），
    // 不清掉待保存的计划变更（planDirtyIds 保留）。
    const changed = details.filter(
      (detail) => detail.id != null && ratingDirtyIds.has(detail.id),
    )
    if (!changed.length) return
    setError('')
    setMessage('')
    try {
      if (isMockEnabled()) {
        setMessage('草稿已保存')
        setRatingDirtyIds(new Set())
        return
      }
      const result = await saveDraft(
        assessment.id,
        buildDraftRows(changed, 'rating'),
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
      setRatingDirtyIds(new Set())
      applyAutoCleared(result.auto_cleared ?? [])
      setMessage('草稿已保存')
    } catch (err: unknown) {
      const status = (err as { status?: number }).status
      const detail = (err as { detail?: unknown }).detail
      setError(
        status === 409
          ? '数据已被其他操作更新，已保留本地输入；请重新加载后再保存。'
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
              : '保存失败',
      )
    }
  }

  async function handleSavePlan() {
    if (!assessment) return
    // Issue #194 P1: 保存提升计划草稿只提交计划字段
    // （member_priority/include_in_plan/plan_month），不夹带未保存评级。
    const changed = details.filter(
      (detail) => detail.id != null && planDirtyIds.has(detail.id),
    )
    if (!changed.length) return
    setError('')
    setMessage('')
    try {
      if (isMockEnabled()) {
        setMessage('提升计划草稿已保存')
        setPlanDirtyIds(new Set())
        return
      }
      const result = await saveDraft(
        assessment.id,
        buildDraftRows(changed, 'plan'),
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
      setPlanDirtyIds(new Set())
      applyAutoCleared(result.auto_cleared ?? [])
      setMessage('提升计划草稿已保存')
    } catch (err: unknown) {
      const status = (err as { status?: number }).status
      const detail = (err as { detail?: unknown }).detail
      setError(
        status === 409
          ? '数据已被其他操作更新，已保留本地输入；请重新加载后再保存。'
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
              : '保存提升计划草稿失败',
      )
    }
  }

  async function handleBatchFill(l2Code: string, currentLevel: 0 | 1 | 2) {
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
              ? { ...detail, include_in_plan: false }
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

  async function handleGeneratePlan() {
    if (!assessment) return
    setError('')
    setMessage('')
    try {
      if (isMockEnabled()) {
        setAssessment({ ...mockAssessmentSubmitted, details })
        setMessage('已生成所选学习任务（演示）。')
        return
      }
      const selected = details.filter((d) => d.include_in_plan === true)
      if (selected.length === 0) {
        setError('请先勾选「是」将提升项加入计划草稿，再生成所选学习任务。')
        return
      }
      // Issue #187 合同第 6 条：缺计划月份 → 整批不提交，保留输入，逐项中文提示。
      const missingMonth = selected.filter((d) => !d.plan_month)
      if (missingMonth.length > 0) {
        setError(
          `以下项计划月份待补（请选择 YYYY-MM）：${missingMonth
            .map((d) => d.l3_code)
            .join('、')}`,
        )
        const target = missingMonth[0]
        const index = details.findIndex((d) => d.l3_code === target.l3_code)
        if (index >= 0) locateDetail(target)
        return
      }
      let revision = assessment.revision ?? 1
      // Issue #194 P1: 生成前如需落计划草稿，只提交计划字段（稀疏 PATCH），
      // 不夹带未保存评级；未保存评级仍保留在本地（ratingDirtyIds 不清）。
      const changed = details.filter(
        (detail) => detail.id != null && planDirtyIds.has(detail.id),
      )
      if (changed.length) {
        const saved = await saveDraft(
          assessment.id,
          buildDraftRows(changed, 'plan'),
          revision,
        )
        revision = saved.revision ?? revision + 1
        applyAutoCleared(saved.auto_cleared ?? [])
        setAssessment((current) =>
          current
            ? {
                ...current,
                revision,
                gap_summary: saved.gap_summary ?? current.gap_summary,
              }
            : current,
        )
        setPlanDirtyIds(new Set())
      }
      const fingerprint = `${[...selected.map((d) => d.l3_code)].sort().join('|')}|${revision}`
      if (
        !genIdemRef.current ||
        genIdemRef.current.fingerprint !== fingerprint
      ) {
        genIdemRef.current = { key: newIdempotencyKey(), fingerprint }
      }
      const result = await generatePlanItems(
        assessment.id,
        selected.map((d) => d.l3_code),
        revision,
        genIdemRef.current.key,
      )
      loadAssessment(await getAssessment(assessment.id))

      const created = result.created ?? []
      const existing = result.existing ?? []
      const total = created.length + existing.length
      setMessage(
        total === 0
          ? '所选提升项均已生成过学习任务。'
          : `✅ 已生成 ${created.length} 个学习任务${existing.length > 0 ? `（${existing.length} 个已存在）` : ''}\n💡 前往「成长计划与任务」查看`,
      )
    } catch (err: unknown) {
      const status = (err as { status?: number }).status
      const detail = (err as { detail?: unknown }).detail
      setError(
        status === 409
          ? (() => {
              genIdemRef.current = null // 409 → 下次换新 key（P1-4）
              return '生成冲突：数据已被其他操作更新，本地输入已保留；请重新加载后再生成。'
            })()
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
              : '生成失败',
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
      setRatingDirtyIds(new Set())
      setPlanDirtyIds(new Set())
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
      row?.scrollIntoView?.({ behavior: 'smooth', block: 'center' })
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
  const summary = assessment?.gap_summary

  // --- stats ---
  const stats = useMemo(() => {
    const applicable = assessedDetails
    const unassessed = applicable.filter((d) => d.current_level == null).length
    const totalGap = applicable.filter((d) => {
      const g = computeGap(d)
      return g != null && g > 0
    }).length
    const required = applicable.filter(
      (d) => d.scope_type === 'current_required',
    ).length
    const progressive = applicable.filter(
      (d) => d.scope_type === 'target_progressive',
    ).length
    const inPlan = applicable.filter((d) => d.include_in_plan === true).length
    const onHold = applicable.filter((d) => d.member_priority === '暂缓').length
    const byQ = { Q1: 0, Q2: 0, Q3: 0, Q4: 0 }
    for (const d of applicable) {
      if (d.plan_quarter && d.plan_quarter in byQ) {
        byQ[d.plan_quarter as keyof typeof byQ] += 1
      }
    }
    return {
      unassessed,
      totalGap,
      required,
      progressive,
      inPlan,
      onHold,
      byQ,
    }
  }, [assessedDetails])

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
        list = []
      }
    }
    // New filters
    if (filter === '未评估') {
      list = list.filter(
        (d) => isApplicableDetail(d) && d.current_level == null,
      )
    }
    if (filter === '有Gap') {
      list = list.filter((d) => {
        const g = computeGap(d)
        return g != null && g > 0
      })
    }
    if (filter === '当前职级必备') {
      list = list.filter((d) => d.scope_type === 'current_required')
    }
    if (filter === '目标职级进阶') {
      list = list.filter((d) => d.scope_type === 'target_progressive')
    }
    if (filter === '已纳入计划') {
      list = list.filter((d) => d.include_in_plan === true)
    }
    if (filter === '暂缓') {
      list = list.filter((d) => d.member_priority === '暂缓')
    }
    return list
  }, [details, activeDomain, filter, scopeFilter, assessment])

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

  // --- sticky bar counts ---
  const stickyStats = useMemo(() => {
    const hasGap = assessedDetails.filter((d) => {
      const g = computeGap(d)
      return g != null && g > 0
    })
    const inPlanNoPriority = hasGap.filter(
      (d) =>
        d.include_in_plan === true &&
        d.member_priority !== '暂缓' &&
        !d.member_priority,
    ).length
    const undecided = hasGap.filter((d) => d.include_in_plan == null).length
    // Issue #194: 待补计划月份 — 已加入计划但未填 YYYY-MM（生成前必须补齐）。
    const inPlanNoMonth = hasGap.filter(
      (d) => d.include_in_plan === true && !d.plan_month,
    ).length
    return { inPlanNoPriority, undecided, inPlanNoMonth }
  }, [assessedDetails])

  const filters: Filter[] = [
    '全部',
    '未评估',
    '有Gap',
    '当前职级必备',
    '目标职级进阶',
    '已纳入计划',
    '暂缓',
  ]

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

        {/* Top stats bar */}
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
            未评估 <strong>{stats.unassessed}</strong>
          </span>
          <span>
            Gap <strong>{stats.totalGap}</strong>
          </span>
          <span>
            已纳入计划 <strong>{stats.inPlan}</strong>
          </span>
          <span>
            暂缓 <strong>{stats.onHold}</strong>
          </span>
          <span>
            Q1:<strong>{stats.byQ.Q1}</strong> Q2:
            <strong>{stats.byQ.Q2}</strong> Q3:<strong>{stats.byQ.Q3}</strong>{' '}
            Q4:<strong>{stats.byQ.Q4}</strong>
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
              data-testid="status-filter"
              value={filter}
              onChange={(e) => setFilter(e.target.value as Filter)}
            >
              {filters.map((f) => (
                <option key={f} value={f}>
                  {f}
                </option>
              ))}
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
                        [0, 1, 2].map((level) => {
                          const typedLevel = level as 0 | 1 | 2
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
                              <th>能力项</th>
                              <th>当前掌握度</th>
                              <th>目标掌握度</th>
                              <th>Gap</th>
                              <th>优先级</th>
                              <th>纳入计划</th>
                              <th>计划时间</th>
                            </tr>
                          </thead>
                          <tbody>
                            {items.map((detail) => {
                              const index = details.indexOf(detail)
                              const target = effectiveTarget(detail)
                              const gap = computeGap(detail)
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
                              const hasGap = gap != null && gap > 0
                              // Conditional enable for priority + plan checkboxes
                              const canPlan =
                                hasGap && detail.member_priority !== '暂缓'
                              const showPlanTime =
                                detail.include_in_plan === true
                              return (
                                <Fragment key={detail.id}>
                                  <tr
                                    id={`row-${detail.id}`}
                                    tabIndex={-1}
                                    className={
                                      gap && gap > 0 ? s.rowGap : undefined
                                    }
                                  >
                                    {/* Column 1: 能力项 */}
                                    <td>
                                      <strong>
                                        {detail.l3_name ?? detail.l3_code}
                                      </strong>
                                      <small className={s.l3name}>
                                        {detail.l3_code}
                                      </small>
                                      {detail.scope_type && (
                                        <small className={s.scopeTag}>
                                          {detail.scope_type ===
                                          'current_required'
                                            ? '当前职级必备'
                                            : '目标职级进阶'}
                                        </small>
                                      )}
                                      {detail.standard_job_level_snapshot && (
                                        <small className={s.levelSnapshot}>
                                          {detail.standard_job_level_snapshot}{' '}
                                          标准
                                        </small>
                                      )}
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
                                    {/* Column 2: 当前掌握度 */}
                                    <td>
                                      <select
                                        value={detail.current_level ?? ''}
                                        onChange={(event) =>
                                          updateDetail(index, {
                                            current_level: event.target.value
                                              ? Number(event.target.value)
                                              : null,
                                          })
                                        }
                                        disabled={!editable || !applicable}
                                        aria-label={`当前等级 ${detail.l3_code}`}
                                        title={
                                          LEVEL_LABELS[
                                            detail.current_level ?? -1
                                          ] ?? ''
                                        }
                                      >
                                        <option value="">请选择</option>
                                        {LEVELS.map((level) => (
                                          <option key={level} value={level}>
                                            {level} · {LEVEL_LABELS[level]}
                                          </option>
                                        ))}
                                      </select>
                                    </td>
                                    {/* Column 3: 目标掌握度 */}
                                    <td>
                                      {applicable ? (
                                        <div>
                                          <span>
                                            {target ?? '—'}
                                            {detail.standard_job_level_snapshot
                                              ? ` · ${detail.standard_job_level_snapshot} 标准`
                                              : ''}
                                          </span>
                                          {detail.target_adjusted && (
                                            <span className={s.adjustedBadge}>
                                              [已调整]
                                            </span>
                                          )}
                                          {adjustable && editable && (
                                            <button
                                              type="button"
                                              className={s.adjustBtn}
                                              onClick={() =>
                                                setAdjustmentId(
                                                  adjustmentId === detail.id
                                                    ? null
                                                    : (detail.id ?? null),
                                                )
                                              }
                                            >
                                              调整▸
                                            </button>
                                          )}
                                          {detail.target_snapshot_source ===
                                            'legacy_preserved' && (
                                            <small className={s.snapshotTag}>
                                              历史保留
                                            </small>
                                          )}
                                          {/* Inline adjustment editor */}
                                          {adjustmentId === detail.id &&
                                            editable && (
                                              <div
                                                className={s.adjustmentEditor}
                                              >
                                                <label className="checkbox">
                                                  <input
                                                    type="checkbox"
                                                    aria-label={`启用个人调整 ${detail.l3_code}`}
                                                    checked={
                                                      detail.target_adjusted ??
                                                      false
                                                    }
                                                    onChange={(event) =>
                                                      updateDetail(index, {
                                                        target_adjusted:
                                                          event.target.checked,
                                                        adjusted_target_level:
                                                          event.target.checked
                                                            ? (detail.adjusted_target_level ??
                                                              detail.standard_target_level ??
                                                              null)
                                                            : null,
                                                        target_adjustment_reason:
                                                          event.target.checked
                                                            ? (detail.target_adjustment_reason ??
                                                              '')
                                                            : null,
                                                      })
                                                    }
                                                  />
                                                  启用调整
                                                </label>
                                                {detail.target_adjusted && (
                                                  <>
                                                    <select
                                                      value={
                                                        detail.adjusted_target_level ??
                                                        ''
                                                      }
                                                      onChange={(event) =>
                                                        updateDetail(index, {
                                                          adjusted_target_level:
                                                            event.target.value
                                                              ? Number(
                                                                  event.target
                                                                    .value,
                                                                )
                                                              : null,
                                                        })
                                                      }
                                                      aria-label={`调整目标 ${detail.l3_code}`}
                                                    >
                                                      <option value="">
                                                        选择
                                                      </option>
                                                      {LEVELS.filter(
                                                        (l) => l >= 1,
                                                      ).map((level) => (
                                                        <option
                                                          key={level}
                                                          value={level}
                                                        >
                                                          {level}
                                                        </option>
                                                      ))}
                                                    </select>
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
                                                    />
                                                  </>
                                                )}
                                              </div>
                                            )}
                                        </div>
                                      ) : (
                                        '不适用'
                                      )}
                                    </td>
                                    {/* Column 4: Gap */}
                                    <td className={s.gapCell}>{gap ?? '—'}</td>
                                    {/* Column 5: 优先级 */}
                                    <td>
                                      <select
                                        value={detail.member_priority ?? ''}
                                        onChange={(e) => {
                                          const val =
                                            (e.target.value as
                                              '高' | '中' | '低' | '暂缓') ||
                                            null
                                          if (val === '暂缓') {
                                            updateDetail(index, {
                                              member_priority: '暂缓',
                                              include_in_plan: false,
                                              plan_quarter: null,
                                              plan_month: null,
                                            })
                                          } else {
                                            updateDetail(index, {
                                              member_priority: val,
                                            })
                                          }
                                        }}
                                        disabled={!editable || !hasGap}
                                        aria-label={`优先级 ${detail.l3_code}`}
                                      >
                                        <option value="">—</option>
                                        <option value="高">高</option>
                                        <option value="中">中</option>
                                        <option value="低">低</option>
                                        <option value="暂缓">暂缓</option>
                                      </select>
                                    </td>
                                    {/* Column 6: 纳入年度计划 */}
                                    <td>
                                      <select
                                        value={
                                          detail.include_in_plan === true
                                            ? 'yes'
                                            : detail.include_in_plan === false
                                              ? 'no'
                                              : ''
                                        }
                                        onChange={(e) => {
                                          const val = e.target.value
                                          updateDetail(index, {
                                            include_in_plan:
                                              val === 'yes'
                                                ? true
                                                : val === 'no'
                                                  ? false
                                                  : null,
                                            plan_quarter:
                                              val === 'yes'
                                                ? (detail.plan_quarter ?? null)
                                                : null,
                                            plan_month:
                                              val === 'yes'
                                                ? (detail.plan_month ?? null)
                                                : null,
                                          })
                                        }}
                                        disabled={!editable || !canPlan}
                                        aria-label={`纳入计划 ${detail.l3_code}`}
                                      >
                                        <option value="">未选择</option>
                                        <option value="yes">是</option>
                                        <option value="no">否</option>
                                      </select>
                                    </td>
                                    {/* Column 7: 计划时间 — 单一 YYYY-MM（Issue #194/187 合同第 4 条） */}
                                    <td>
                                      {showPlanTime ? (
                                        <div className={s.planTime}>
                                          <input
                                            type="month"
                                            value={detail.plan_month ?? ''}
                                            onChange={(event) =>
                                              updateDetail(index, {
                                                plan_month:
                                                  event.target.value || null,
                                              })
                                            }
                                            disabled={!editable}
                                            aria-label={`计划月份 ${detail.l3_code}`}
                                          />
                                          {!detail.plan_month && editable && (
                                            <small
                                              className={s.pendingMonth}
                                              data-testid={`pending-month-${detail.l3_code}`}
                                            >
                                              待补计划月份
                                            </small>
                                          )}
                                        </div>
                                      ) : detail.include_in_plan === false ? (
                                        <span className="muted">否</span>
                                      ) : (
                                        '—'
                                      )}
                                    </td>
                                  </tr>
                                  {editingId === detail.id && editable && (
                                    <tr className={s.evidenceRow}>
                                      <td colSpan={7}>
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

        {/* Gap summary drawer */}
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
              高 / 中 / 低 / 暂缓：{summary.high_priority} /{' '}
              {summary.medium_priority} / {summary.low_priority} /{' '}
              {summary.on_hold ?? 0}
            </p>
            {summary.by_quarter && (
              <p>
                纳入计划 · Q1:{summary.by_quarter.Q1} Q2:{summary.by_quarter.Q2}{' '}
                Q3:{summary.by_quarter.Q3} Q4:{summary.by_quarter.Q4}
              </p>
            )}
            <p>纳入计划：{summary.in_plan ?? 0}</p>
          </aside>
        )}

        {/* Sticky action bar */}
        {editable && (
          <footer className={s.stickyActions}>
            {unfilled > 0 && <span>还有 {unfilled} 项未完成</span>}
            {stickyStats.inPlanNoPriority > 0 && (
              <span>{stickyStats.inPlanNoPriority} 项纳入计划但未填优先级</span>
            )}
            {stickyStats.inPlanNoMonth > 0 && (
              <span>{stickyStats.inPlanNoMonth} 项待补计划月份</span>
            )}
            {stickyStats.undecided > 0 && (
              <span>{stickyStats.undecided} 项未决定计划</span>
            )}
            <button type="button" onClick={handleSave}>
              保存能力评级
            </button>
            <button type="button" onClick={handleSavePlan}>
              保存提升计划草稿
            </button>
            <button
              type="button"
              className="primary"
              onClick={handleGeneratePlan}
            >
              生成所选学习任务
            </button>
          </footer>
        )}
      </div>
    </section>
  )
}

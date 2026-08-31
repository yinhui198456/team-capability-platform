import { useEffect, useMemo, useRef, useState } from 'react'
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
  fetchScopePreview,
  getAssessment,
  getDraftTargetRepairPreview,
  listAssessments,
  newIdempotencyKey,
  repairDraftTargetSnapshots,
  saveDraft,
  generatePlanItems,
} from './assessment'
import { type ApiError } from './shared/api'
import { getAnnualPlan } from './planning'
import {
  mockAssessment,
  mockAssessmentSubmitted,
  isMockEnabled,
} from './__fixtures__/assessmentMock'

// Issue #194 P1: 计划草稿字段（随行内变更自动保存），其余字段归评级动作。
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

function openMonthPicker(input: HTMLInputElement | null) {
  if (!input || input.disabled) return
  input?.focus()
  try {
    input?.showPicker?.()
  } catch {
    // Unsupported or blocked native picker: keep focus.
  }
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

function unfilledReason(detail: AssessmentDetail) {
  if (!isApplicableDetail(detail)) return ''
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
  field?: string
  reason: string
  message: string
} {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { code?: unknown }).code === 'string' &&
    typeof (value as { l3_code?: unknown }).l3_code === 'string' &&
    ((value as { field?: unknown }).field === undefined ||
      typeof (value as { field?: unknown }).field === 'string') &&
    typeof (value as { reason?: unknown }).reason === 'string' &&
    typeof (value as { message?: unknown }).message === 'string'
  )
}

function structuredPlanField(value: {
  field?: string
  reason: string
}): 'priority' | 'month' | null {
  if (value.field === 'member_priority') return 'priority'
  if (value.field === 'plan_month') return 'month'
  if (value.reason === 'pending_member_priority') return 'priority'
  if (
    [
      'pending_plan_month',
      'invalid_plan_month',
      'plan_month_year_mismatch',
      'invalid_month_format',
    ].includes(value.reason)
  )
    return 'month'
  return null
}

function computeGap(detail: AssessmentDetail): number | null {
  const current = detail.current_level
  const target = effectiveTarget(detail)
  if (current != null && target != null) {
    return Math.max(target - current, 0)
  }
  return null
}

export function AssessmentGapPage() {
  const year = useYear()
  const [assessment, setAssessment] = useState<Assessment | null>(null)
  const [details, setDetails] = useState<AssessmentDetail[]>([])
  const [activeDomain, setActiveDomain] = useState('')
  // Issue #194: 定版原型工具条只有域切换 + 搜索——范围/状态两个额外筛选层
  // 不在原型中，已移除；搜索承担跨能力域定位。
  const [search, setSearch] = useState('')
  const [expandedL2, setExpandedL2] = useState<Set<string>>(new Set())
  // Issue #194 P1: 保存评级与维护计划草稿是两个独立动作。评级/调整/依据
  // 走 ratingDirtyIds；计划字段（优先级/纳入/月份）随行内变更自动保存。
  // M02 V1: 计划草稿无全局保存按钮——变更入队后由泵串行提交（任务载荷为
  // 变更时刻的行快照），revision 用 ref 跨请求推进，避免并发 PATCH 冲突。
  const ratingDirtyIdsRef = useRef<Set<number>>(new Set())
  const ratingChangeVersionsRef = useRef<Map<number, number>>(new Map())
  const [ratingSaveState, setRatingSaveState] = useState<
    '评级已保存' | '评级未保存' | '评级保存中' | '评级保存失败'
  >('评级已保存')
  const [generationSummary, setGenerationSummary] = useState<{
    created: number
    existing: number
    planTotal: number | null
  } | null>(null)
  const [generationBusy, setGenerationBusy] = useState(false)
  const planQueueRef = useRef<DraftDetailInput[]>([])
  const planPumpingRef = useRef(false)
  const planFlushPromiseRef = useRef<Promise<void> | null>(null)
  const mutationTailRef = useRef<Promise<void>>(Promise.resolve())
  const revisionRef = useRef<number>(1)
  const detailsRef = useRef<AssessmentDetail[]>([])
  const [editingId, setEditingId] = useState<number | null>(null)
  const [editingText, setEditingText] = useState('')
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [planSaveError, setPlanSaveError] = useState('')
  const [planSaveState, setPlanSaveState] = useState<
    '保存中' | '已保存' | '保存失败'
  >('已保存')
  const [planFieldErrors, setPlanFieldErrors] = useState<
    Record<string, { priority?: string; month?: string }>
  >({})
  const [loading, setLoading] = useState(true)
  const searchInputRef = useRef<HTMLInputElement | null>(null)
  // Issue #194 P1-4: 生成所选学习任务的 Idempotency-Key 按 payload 指纹复用，
  // 指纹变化（选中项/版本变更）或 409 后换新 key，避免重放不同请求。
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

  function loadAssessment(value: Assessment) {
    setAssessment(value)
    setDetails(value.details ?? [])
    // M02 V1: 重新加载即视为新的草稿会话——同步镜像、自动保存队列与
    // revision 全部重置，避免旧会话任务泄漏进新草稿。
    detailsRef.current = value.details ?? []
    planQueueRef.current = []
    revisionRef.current = value.revision ?? 1
    ratingDirtyIdsRef.current = new Set()
    ratingChangeVersionsRef.current = new Map()
    setRatingSaveState('评级已保存')
    setGenerationSummary(null)
    setPlanSaveError('')
    setPlanSaveState('已保存')
    setPlanFieldErrors({})
    const firstDomain =
      value.l2_groups?.[0]?.l1_code ?? defaultDomain(value.details ?? [])
    const firstL2 =
      value.l2_groups?.find((group) => group.l1_code === firstDomain)
        ?.l2_code ?? defaultL2(value.details ?? [], firstDomain)
    const initiallyExpanded = new Set<string>()
    let visibleItemCount = 0
    for (const group of value.l2_groups ?? []) {
      if (group.l1_code !== firstDomain || !group.l2_code || group.is_empty)
        continue
      initiallyExpanded.add(group.l2_code)
      visibleItemCount += (value.details ?? []).filter(
        (detail) =>
          l1Of(detail) === firstDomain && l2Of(detail) === group.l2_code,
      ).length
      if (visibleItemCount >= 6) break
    }
    if (firstL2 && initiallyExpanded.size === 0) initiallyExpanded.add(firstL2)
    if (initiallyExpanded.size) setExpandedL2(initiallyExpanded)
  }

  // detailsRef 的同步镜像：updateDetail 在变更时刻立即写入（保证行快照
  // 包含同批次内的先前变更），本 effect 兜底捕获其余 setDetails 站点。
  useEffect(() => {
    detailsRef.current = details
  }, [details])

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setAssessment(null)
    setDetails([])
    setActiveDomain('')
    setExpandedL2(new Set())
    async function init() {
      try {
        if (isMockEnabled()) {
          if (!cancelled) loadAssessment(mockAssessment)
        } else {
          const list = await listAssessments()
          const draft = list.find(
            (item) =>
              item.year === year &&
              (item.status === '草稿' || item.status === '建议调整'),
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
  }, [year])

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
    const next = detailsRef.current.map((item, itemIndex) =>
      itemIndex === index ? { ...item, ...patch } : item,
    )
    detailsRef.current = next
    setDetails(next)
    const detail = next[index]
    if (detail?.id != null) {
      // Issue #194 M02 V1: 评级字段归脏集合（保存能力评级显式提交），
      // 计划字段入队自动保存——两动作互不夹带，串行泵逐条提交。
      const hasPlanField = Object.keys(patch).some((key) =>
        PLAN_FIELDS.has(key),
      )
      const hasRatingField = Object.keys(patch).some(
        (key) => !PLAN_FIELDS.has(key),
      )
      if (hasRatingField) {
        const dirty = new Set(ratingDirtyIdsRef.current).add(detail.id)
        ratingDirtyIdsRef.current = dirty
        ratingChangeVersionsRef.current.set(
          detail.id,
          (ratingChangeVersionsRef.current.get(detail.id) ?? 0) + 1,
        )
        setRatingSaveState('评级未保存')
      }
      if (hasPlanField) {
        const task = buildDraftRows([next[index]], 'plan')[0]
        // 同行旧任务被更新快照替换：在途旧载荷不会覆盖新输入，失败重试
        // 直接提交最新状态（含先前变更）。
        planQueueRef.current = planQueueRef.current.filter(
          (queued) => queued.l3_code !== task.l3_code,
        )
        planQueueRef.current.push(task)
        void pumpPlanSaves()
      }
    }
  }

  /** Issue #194 P1: 只取某动作的字段构造稀疏 PATCH 行——评级/依据
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

  function enqueueMutation<T>(mutation: () => Promise<T>) {
    const run = mutationTailRef.current.then(mutation, mutation)
    mutationTailRef.current = run.then(
      () => undefined,
      () => undefined,
    )
    return run
  }

  /** Issue #194 M02 V1: 计划草稿自动保存泵 — 串行提交队列中的计划行快照。
    失败时队列保留（本地输入不丢）并给出中文可操作提示；下次计划变更或
    生成前自动重试。revision 用 ref 跨请求推进，避免并发 PATCH 冲突。 */
  async function pumpPlanSaves(): Promise<void> {
    if (isMockEnabled()) {
      planQueueRef.current = []
      setPlanSaveError('')
      setPlanSaveState('已保存')
      return
    }
    if (planPumpingRef.current) {
      await planFlushPromiseRef.current
      return
    }
    if (!assessment || planQueueRef.current.length === 0) return
    planPumpingRef.current = true
    setPlanSaveError('')
    setPlanSaveState('保存中')
    const flush = enqueueMutation(async () => {
      try {
        // 微任务沉降：让同一同步块内紧随的其它计划变更先完成
        // 去重替换队首，首个请求总是携带最新快照。
        await Promise.resolve()
        while (planQueueRef.current.length > 0) {
          const task = planQueueRef.current[0]
          try {
            const result = await saveDraft(
              assessment.id,
              [task],
              revisionRef.current,
            )
            revisionRef.current = result.revision ?? revisionRef.current + 1
            // 仅当队首仍是本次保存的任务时才出队：保存在途期间若该行被
            // 再次变更（队首被替换为更新的快照），保留它让下一轮提交最新。
            if (planQueueRef.current[0] === task) {
              planQueueRef.current.shift()
            }
            if (planQueueRef.current.length === 0) {
              setPlanSaveError('')
              setPlanSaveState('已保存')
            }
            applyAutoCleared(result.auto_cleared ?? [])
            setAssessment((current) =>
              current
                ? {
                    ...current,
                    revision: result.revision ?? current.revision,
                    gap_summary: result.gap_summary ?? current.gap_summary,
                  }
                : current,
            )
          } catch (err: unknown) {
            setPlanSaveState('保存失败')
            const status = (err as { status?: number }).status
            const detail = (err as { detail?: unknown }).detail
            setPlanSaveError(
              status === 409
                ? '数据已被其他操作更新，已保留本地输入；请重新加载后再保存。'
                : isStructuredAssessmentError(detail)
                  ? (() => {
                      const target = detailsRef.current.find(
                        (item) => item.l3_code === detail.l3_code,
                      )
                      const field = structuredPlanField(detail)
                      if (target && field) {
                        setPlanFieldErrors((current) => ({
                          ...current,
                          [target.l3_code]: {
                            ...current[target.l3_code],
                            [field]: detail.message,
                          },
                        }))
                        locatePlanField(target, field)
                      } else if (target) locateDetail(target)
                      return detail.message
                    })()
                  : err instanceof Error
                    ? err.message
                    : '计划草稿自动保存失败，本地输入已保留；请重试。',
            )
            break // 队列保留，下次计划变更或生成前重试
          }
        }
      } finally {
        planPumpingRef.current = false
      }
    })
    planFlushPromiseRef.current = flush
    await flush
  }

  /** Issue #194 M02 V1: 单动作加入/移出提升项；加入保留已有月份，
    移出清空计划月份与季度。变更随行内自动保存落库。 */
  function clearPlanFieldError(l3Code: string, field: 'priority' | 'month') {
    setPlanFieldErrors((current) => {
      if (!current[l3Code]?.[field]) return current
      const next = { ...current, [l3Code]: { ...current[l3Code] } }
      delete next[l3Code][field]
      if (!next[l3Code].priority && !next[l3Code].month) delete next[l3Code]
      return next
    })
  }

  function toggleIncludePlan(index: number, include: boolean) {
    const detail = detailsRef.current[index]
    updateDetail(index, {
      member_priority:
        include && detail?.member_priority === '暂缓'
          ? null
          : (detail?.member_priority ?? null),
      include_in_plan: include,
      plan_quarter: include ? (detail?.plan_quarter ?? null) : null,
      plan_month: include ? (detail?.plan_month ?? null) : null,
    })
    if (!include && detail) {
      setPlanFieldErrors((current) => {
        const next = { ...current }
        delete next[detail.l3_code]
        return next
      })
    }
  }

  /** 应用服务端 auto_cleared 裁决：清空相应行的计划字段，并把该行从
    自动保存队列移除（本地未保存计划变更已被服务端否决）。 */
  function applyAutoCleared(
    cleared: Array<{ l3_node_id: number; fields: string[] }>,
  ) {
    if (!cleared.length) return
    const clearedCodes = new Set<string>()
    for (const item of cleared) {
      const row = detailsRef.current.find(
        (d) => d.l3_node_id === item.l3_node_id,
      )
      if (row) clearedCodes.add(row.l3_code)
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
    if (clearedCodes.size) {
      planQueueRef.current = planQueueRef.current.filter(
        (task) => !clearedCodes.has(task.l3_code),
      )
    }
  }

  async function handleSave() {
    if (!assessment) return
    const changed = details.filter(
      (detail) => detail.id != null && ratingDirtyIdsRef.current.has(detail.id),
    )
    if (!changed.length) return
    const savedVersions = new Map(
      changed.map((detail) => [
        detail.id!,
        ratingChangeVersionsRef.current.get(detail.id!) ?? 0,
      ]),
    )
    // 评级与计划泵共用 mutation tail；先清空已排队计划，再把评级接在同一
    // revision 链尾端。评级只提交评级/调整/依据字段（稀疏 PATCH）。
    await pumpPlanSaves()
    setError('')
    setMessage('')
    setRatingSaveState('评级保存中')
    try {
      if (isMockEnabled()) {
        setMessage('能力评级已保存')
        ratingDirtyIdsRef.current = new Set()
        setRatingSaveState('评级已保存')
        return
      }
      const result = await enqueueMutation(() =>
        saveDraft(
          assessment.id,
          buildDraftRows(changed, 'rating'),
          revisionRef.current,
        ),
      )
      revisionRef.current = result.revision ?? revisionRef.current + 1
      setAssessment((current) =>
        current
          ? {
              ...current,
              revision: result.revision ?? current.revision,
              gap_summary: result.gap_summary ?? current.gap_summary,
            }
          : current,
      )
      const remaining = new Set(ratingDirtyIdsRef.current)
      for (const [id, version] of savedVersions) {
        if (ratingChangeVersionsRef.current.get(id) === version) {
          remaining.delete(id)
        }
      }
      ratingDirtyIdsRef.current = remaining
      applyAutoCleared(result.auto_cleared ?? [])
      setMessage('能力评级已保存')
      setRatingSaveState(remaining.size ? '评级未保存' : '评级已保存')
    } catch (err: unknown) {
      setRatingSaveState('评级保存失败')
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

  async function handleGeneratePlan() {
    if (!assessment || generationBusy) return
    setError('')
    setMessage('')
    setGenerationSummary(null)
    try {
      const selected = details.filter((d) => d.include_in_plan === true)
      if (selected.length === 0) {
        setPlanFieldErrors({})
        setError('请先加入提升项到计划草稿，再生成所选学习任务。')
        return
      }
      const nextFieldErrors = Object.fromEntries(
        selected.flatMap((detail) => {
          const fields = {
            ...(!['高', '中', '低'].includes(detail.member_priority ?? '') && {
              priority: '请选择优先级',
            }),
            ...(!detail.plan_month && { month: '请选择计划月份' }),
          }
          return Object.keys(fields).length ? [[detail.l3_code, fields]] : []
        }),
      ) as Record<string, { priority?: string; month?: string }>
      setPlanFieldErrors(nextFieldErrors)
      const firstPriority = selected.find(
        (detail) => nextFieldErrors[detail.l3_code]?.priority,
      )
      const firstMonth = selected.find(
        (detail) => nextFieldErrors[detail.l3_code]?.month,
      )
      const firstInvalid = firstPriority ?? firstMonth
      if (firstInvalid) {
        const field = firstPriority ? 'priority' : 'month'
        setError('请补全所选提升项的优先级和计划月份，当前未生成任何任务。')
        locatePlanField(firstInvalid, field)
        return
      }
      if (isMockEnabled()) {
        setAssessment({ ...mockAssessmentSubmitted, details })
        setMessage('已生成所选学习任务（演示）。')
        return
      }
      setGenerationBusy(true)
      // M02 V1: 生成前先等待在途计划自动保存完成（同一 revision 序列）——
      // 失败（队列非空）则中止本次生成并保留队列，由用户重试；避免
      // 部分写入、revision 冲突与生成读旧值。未保存评级仍保留在本地。
      await pumpPlanSaves()
      if (planQueueRef.current.length > 0) return
      const revision = revisionRef.current
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
      genIdemRef.current = null
      // Issue #194 P1-1: 生成成功不重载 Assessment 草稿（生成不改草稿
      // 字段/revision；M03/M04 导航自行读取正式结果）——重载会用服务端
      // 旧值覆盖本地未保存评级，违背输入保留。本地计划选择与月份保留。
      const created = result.created ?? []
      const existing = result.existing ?? []
      const annualPlan = await getAnnualPlan(year).catch(() => null)
      setGenerationSummary({
        created: created.length,
        existing: existing.length,
        planTotal: annualPlan?.items.length ?? null,
      })
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
                const field = structuredPlanField(detail)
                if (target && field) {
                  setPlanFieldErrors((current) => ({
                    ...current,
                    [target.l3_code]: {
                      ...current[target.l3_code],
                      [field]: detail.message,
                    },
                  }))
                  locatePlanField(target, field)
                } else if (target) locateDetail(target)
                return detail.message
              })()
            : err instanceof Error
              ? err.message
              : '生成失败',
      )
    } finally {
      setGenerationBusy(false)
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
      // loadAssessment 已重置自动保存队列与 revision。
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
      row?.scrollIntoView?.({
        behavior: window.matchMedia?.('(prefers-reduced-motion: reduce)')
          .matches
          ? 'instant'
          : 'smooth',
        block: 'center',
      })
      row?.focus()
    }, 50)
  }

  function locatePlanField(
    detail: AssessmentDetail,
    field: 'priority' | 'month',
  ) {
    setActiveDomain(l1Of(detail))
    setExpandedL2((current) => new Set(current).add(l2Of(detail)))
    setSearch('')
    setSearchActiveIndex(-1)
    setTimeout(() => {
      const input = document.getElementById(
        field === 'priority'
          ? `priority-${detail.id}`
          : `plan-month-${detail.id}`,
      ) as HTMLElement | null
      input?.scrollIntoView?.({
        behavior: window.matchMedia?.('(prefers-reduced-motion: reduce)')
          .matches
          ? 'instant'
          : 'smooth',
        block: 'center',
      })
      input?.focus()
    }, 50)
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
  // --- stats（原型摘要仅用存在差距/已加入计划；真实计数） ---
  const stats = useMemo(() => {
    const applicable = assessedDetails
    const totalGap = applicable.filter((d) => {
      const g = computeGap(d)
      return g != null && g > 0
    }).length
    const inPlan = applicable.filter((d) => d.include_in_plan === true).length
    return { totalGap, inPlan }
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

  // Issue #194: 额外筛选层（范围/状态）已按定版原型移除——域内明细全量展示。
  const filtered = useMemo(
    () =>
      activeDomain
        ? details.filter((detail) => l1Of(detail) === activeDomain)
        : details,
    [details, activeDomain],
  )

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
      if ((!activeDomain || group.l1_code === activeDomain) && group.l2_code) {
        groups.set(group.l2_code, {
          ...group,
          l1_code: group.l1_code ?? '未映射',
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
  // Issue #194: 原型底部仅一条计划草稿状态（已选 N 项 + 月份是否完整）。
  const stickyStats = useMemo(() => {
    const inPlan = assessedDetails.filter(
      (d) => d.include_in_plan === true,
    ).length
    const inPlanIncomplete = assessedDetails.filter(
      (detail) =>
        detail.include_in_plan === true &&
        (!['高', '中', '低'].includes(detail.member_priority ?? '') ||
          !detail.plan_month),
    ).length
    return { inPlan, inPlanIncomplete }
  }, [assessedDetails])

  if (loading || (assessment !== null && assessment.year !== year))
    return <p className="muted">加载中…</p>
  if (!assessment) {
    const preview = scopeChanged ?? scopePreview
    return (
      <section className="page">
        <h1>能力评级与提升计划</h1>
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
            <span className={s.eyebrow}>能力成长</span>
            <h1>能力评级与提升计划</h1>
            {/* 定版原型 M02 V1 页头说明 */}
            <p className="muted">
              逐项保存评级；选择存在差距的提升项，补充计划月份后再显式生成任务。
            </p>
          </div>
          <div className="assessment-actions">
            <span
              className={`${s.autoSaveBadge} ${
                planSaveState === '已保存'
                  ? s.autoSaveBadgeSaved
                  : planSaveState === '保存失败'
                    ? s.autoSaveBadgeFailed
                    : s.autoSaveBadgeSaving
              }`}
              role="status"
              aria-label="计划草稿保存状态"
            >
              计划草稿{planSaveState}
            </span>
          </div>
        </header>

        {/* Top stats bar — Issue #194: 只保留定版原型语义的五项指标
            （能力域/三级能力项/已评级/存在差距/已加入计划），真实计数。 */}
        <section
          className={`assessment-summary compact-summary ${s['compact-summary']}`}
          aria-label="评估摘要"
        >
          <span>
            能力域 <strong>{domains.length}</strong>
          </span>
          <span>
            三级能力项 <strong>{assessedDetails.length}</strong>
          </span>
          <span>
            已评级 <strong>{filled}</strong>
          </span>
          <span>
            存在差距 <strong>{stats.totalGap}</strong>
          </span>
          <span>
            已加入计划 <strong>{stats.inPlan}</strong>
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
        {(error || planSaveError) && (
          <p className="error global-assessment-error" role="alert">
            {error || planSaveError}
          </p>
        )}
        {message && (
          <p className="success" role="status">
            {message}
          </p>
        )}
        {generationSummary && (
          <section
            className={s.generationSummary}
            aria-label="生成结果摘要"
            role="status"
          >
            <span>当前草稿已选 {stickyStats.inPlan} 项</span>
            <span>本次新建 {generationSummary.created} 项</span>
            <span>已有任务 {generationSummary.existing} 项</span>
            <span>
              计划总计{' '}
              {generationSummary.planTotal === null
                ? '读取失败'
                : `${generationSummary.planTotal} 项`}
            </span>
          </section>
        )}

        <div
          className={s.navigationRow}
          data-testid="assessment-navigation-toolbar"
        >
          <nav className={s.l1Nav} aria-label="一级能力域导航">
            <button
              type="button"
              className={!activeDomain ? s.activeNav : ''}
              aria-pressed={!activeDomain}
              onClick={() => {
                setActiveDomain('')
                setSearch('')
              }}
            >
              全部能力域
            </button>
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
            {/* Issue #194: 定版原型工具条仅域切换 + 搜索（范围/状态筛选层已移除） */}
            <input
              ref={searchInputRef}
              className={s.searchBox}
              aria-label="搜索全部能力项"
              placeholder="搜索能力项"
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
          <div className={s.tableArea}>
            {l2Groups.map((group) => {
              const l2Code = group.l2_code
              const items = group.details
              const open = expandedL2.has(l2Code)
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
                      <small>
                        {
                          items.filter(isApplicableDetail).filter(isFilled)
                            .length
                        }
                        /{items.filter(isApplicableDetail).length}
                      </small>
                    </span>
                  </div>
                  {open && (
                    <>
                      {group.is_empty ? (
                        <p className="muted">当前无可评估项</p>
                      ) : (
                        <div className={s.table} data-testid="assessment-table">
                          {/* Issue #194 P1: 权威原型 M02 V1 四区能力项行
                            （能力项 / 当前评级 / 目标与差距 / 提升计划），
                            窄宽单列重排，不用横向滚动表格替代。 */}
                          <div className={s.abilityHead}>
                            <span>能力项</span>
                            <span>当前评级</span>
                            <span>目标与差距</span>
                            <span>提升计划</span>
                          </div>
                          {items.map((detail) => {
                            const index = details.indexOf(detail)
                            const target = effectiveTarget(detail)
                            const gap = computeGap(detail)
                            const reason = unfilledReason(detail)
                            const applicable = isApplicableDetail(detail)
                            const inherited =
                              detail.inherited_from_assessment_id != null
                            const updated =
                              inherited && isInheritedUpdate(detail)
                            const hasGap = gap != null && gap > 0
                            const canPlan = hasGap
                            const showPlanTime =
                              applicable && detail.include_in_plan === true
                            const fieldErrors =
                              planFieldErrors[detail.l3_code] ?? {}
                            const priorityErrorId = `priority-error-${detail.id}`
                            const monthErrorId = `plan-month-error-${detail.id}`
                            const validPriority = ['高', '中', '低'].includes(
                              detail.member_priority ?? '',
                            )
                            const priorityError =
                              fieldErrors.priority ??
                              (validPriority ? '' : '请选择优先级')
                            const monthError =
                              fieldErrors.month ??
                              (detail.plan_month ? '' : '请选择计划月份')
                            const planReady = !priorityError && !monthError
                            return (
                              <div
                                key={detail.id}
                                id={`row-${detail.id}`}
                                tabIndex={-1}
                                className={`${s.abilityRow} ${
                                  detail.include_in_plan === true
                                    ? s.rowGap
                                    : ''
                                }`}
                              >
                                {/* Zone 1: 能力项 */}
                                <div>
                                  <strong>
                                    {detail.l3_name ?? detail.l3_code}
                                  </strong>
                                  <small
                                    className={s.l3name}
                                    title={
                                      inherited
                                        ? updated
                                          ? '本次已更新'
                                          : '沿用上次评估'
                                        : undefined
                                    }
                                  >
                                    {detail.l3_code}
                                  </small>
                                  {!isFilled(detail) && reason && (
                                    <span className={s.reasonTag}>
                                      {reason}
                                    </span>
                                  )}
                                </div>
                                {/* Zone 2: 当前评级 — 原型逐档评级按钮；
                                    点击已激活档位清空（回到未评估）。 */}
                                <div
                                  className={s.rating}
                                  aria-label={`当前等级 ${detail.l3_code}`}
                                >
                                  {LEVELS.map((level) => {
                                    const active =
                                      detail.current_level === level
                                    return (
                                      <button
                                        key={level}
                                        type="button"
                                        className={
                                          active ? s.ratingActive : undefined
                                        }
                                        aria-pressed={active}
                                        disabled={!editable || !applicable}
                                        onClick={() =>
                                          updateDetail(index, {
                                            current_level: active
                                              ? null
                                              : level,
                                          })
                                        }
                                      >
                                        {level}
                                        <small> · {LEVEL_LABELS[level]}</small>
                                      </button>
                                    )
                                  })}
                                </div>
                                {/* Zone 3: 目标与差距（含原 Gap 列） */}
                                <div className={s.targetCell}>
                                  {applicable ? (
                                    <>
                                      <span className={s.targetLine}>
                                        目标 {target ?? '—'} ·{' '}
                                        {target == null
                                          ? '未设置'
                                          : (LEVEL_LABELS[target] ??
                                            '未知等级')}
                                      </span>
                                      {detail.target_adjusted && (
                                        <span className={s.adjustedBadge}>
                                          [历史调整]
                                        </span>
                                      )}
                                      {detail.target_snapshot_source ===
                                        'legacy_preserved' && (
                                        <small className={s.snapshotTag}>
                                          历史保留
                                        </small>
                                      )}
                                      <div className={s.gapCell}>
                                        Gap {gap ?? '—'}
                                      </div>
                                    </>
                                  ) : (
                                    '不适用'
                                  )}
                                </div>
                                {/* Zone 4: 提升计划（加入/移出）；优先级与月份仅在
                                    已加入后的计划草稿中出现，避免挤占默认能力行。 */}
                                <div className={s.planZone}>
                                  {/* M02 V1 单动作加入/移出 */}
                                  {!applicable ? null : gap === 0 ? (
                                    <span className="muted">无需提升</span>
                                  ) : detail.include_in_plan === true ? (
                                    <span className={s.planJoinedStatus}>
                                      已加入计划
                                    </span>
                                  ) : (
                                    <button
                                      type="button"
                                      onClick={() =>
                                        toggleIncludePlan(index, true)
                                      }
                                      disabled={!editable || !canPlan}
                                      aria-label={`加入提升计划 ${detail.l3_code}`}
                                    >
                                      加入提升计划
                                    </button>
                                  )}
                                </div>
                                {showPlanTime && (
                                  <div
                                    className={s.planEditor}
                                    data-testid={`plan-editor-${detail.l3_code}`}
                                    role="group"
                                    aria-label={`${detail.l3_code} 提升计划设置`}
                                  >
                                    <div className={s.planIdentity}>
                                      <span>提升计划设置</span>
                                      <strong>
                                        {detail.l3_name ?? detail.l3_code}
                                      </strong>
                                      <small>
                                        {detail.l3_code} · Gap {gap ?? '—'}
                                      </small>
                                    </div>
                                    <div className={s.planControl}>
                                      <label htmlFor={`priority-${detail.id}`}>
                                        优先级 *
                                      </label>
                                      <select
                                        id={`priority-${detail.id}`}
                                        value={detail.member_priority ?? ''}
                                        onChange={(event) => {
                                          updateDetail(index, {
                                            member_priority:
                                              (event.target.value as
                                                '高' | '中' | '低') || null,
                                          })
                                          if (event.target.value)
                                            clearPlanFieldError(
                                              detail.l3_code,
                                              'priority',
                                            )
                                        }}
                                        disabled={!editable || !hasGap}
                                        aria-label={`优先级 ${detail.l3_code}`}
                                        aria-invalid={
                                          priorityError ? true : undefined
                                        }
                                        aria-describedby={
                                          priorityError
                                            ? priorityErrorId
                                            : undefined
                                        }
                                      >
                                        <option value="">—</option>
                                        <option value="高">高</option>
                                        <option value="中">中</option>
                                        <option value="低">低</option>
                                      </select>
                                      {priorityError && (
                                        <small
                                          className={s.fieldError}
                                          id={priorityErrorId}
                                        >
                                          {priorityError}
                                        </small>
                                      )}
                                    </div>
                                    <div className={s.planControl}>
                                      <label
                                        htmlFor={`plan-month-${detail.id}`}
                                      >
                                        计划月份 *
                                      </label>
                                      <div
                                        className={`${s.monthControl} ${!editable ? s.monthControlDisabled : ''} ${monthError ? s.fieldInvalid : ''}`}
                                        data-testid={`plan-month-control-${detail.l3_code}`}
                                        aria-disabled={!editable}
                                        onClick={() =>
                                          openMonthPicker(
                                            document.getElementById(
                                              `plan-month-${detail.id}`,
                                            ) as HTMLInputElement | null,
                                          )
                                        }
                                      >
                                        <span>
                                          {detail.plan_month ?? '选择 YYYY-MM'}
                                        </span>
                                        <input
                                          id={`plan-month-${detail.id}`}
                                          type="month"
                                          value={detail.plan_month ?? ''}
                                          onClick={(event) => {
                                            event.stopPropagation()
                                            openMonthPicker(event.currentTarget)
                                          }}
                                          onChange={(event) => {
                                            updateDetail(index, {
                                              plan_month:
                                                event.target.value || null,
                                            })
                                            if (event.target.value)
                                              clearPlanFieldError(
                                                detail.l3_code,
                                                'month',
                                              )
                                          }}
                                          disabled={!editable}
                                          aria-label={`计划月份 ${detail.l3_code}`}
                                          aria-invalid={
                                            monthError ? true : undefined
                                          }
                                          aria-describedby={
                                            monthError
                                              ? monthErrorId
                                              : undefined
                                          }
                                        />
                                      </div>
                                      {monthError ? (
                                        <small
                                          className={s.fieldError}
                                          id={monthErrorId}
                                        >
                                          {monthError}
                                        </small>
                                      ) : (
                                        <small className={s.fieldHint}>
                                          {detail.plan_month
                                            ? 'YYYY-MM'
                                            : '请选择计划月份'}
                                        </small>
                                      )}
                                    </div>
                                    <div className={s.planState}>
                                      <span>草稿状态</span>
                                      <strong
                                        className={
                                          planSaveState === '保存失败'
                                            ? s.planStateFailed
                                            : planSaveState === '已保存' &&
                                                planReady
                                              ? s.planStateSaved
                                              : s.planStatePending
                                        }
                                      >
                                        {planSaveState === '保存失败'
                                          ? '保存失败'
                                          : planSaveState === '保存中'
                                            ? '保存中'
                                            : planReady
                                              ? '已保存'
                                              : '待补字段'}
                                      </strong>
                                    </div>
                                    <div className={s.planRemove}>
                                      <span>操作</span>
                                      <button
                                        type="button"
                                        onClick={() =>
                                          toggleIncludePlan(index, false)
                                        }
                                        disabled={!editable}
                                        aria-label={`移出提升计划 ${detail.l3_code}`}
                                      >
                                        移出计划
                                      </button>
                                    </div>
                                  </div>
                                )}
                                {editingId === detail.id && editable && (
                                  <div className={s.evidenceRow}>
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
                                  </div>
                                )}
                              </div>
                            )
                          })}
                        </div>
                      )}
                    </>
                  )}
                </div>
              )
            })}
          </div>
        </div>

        {/* #201 方案 1：评级保存与显式生成同置，生成是唯一主操作。 */}
        {editable && (
          <footer className={s.stickyActions} aria-label="能力评级与计划操作">
            <div className={s.actionSummary}>
              <strong>计划草稿：已选 {stickyStats.inPlan} 项</strong>
              <span
                className={
                  stickyStats.inPlanIncomplete > 0
                    ? s.draftIncomplete
                    : s.draftComplete
                }
              >
                {stickyStats.inPlanIncomplete > 0
                  ? '仍有字段待补'
                  : '计划字段已完整'}
              </span>
            </div>
            <div className={s.actionButtons}>
              <div className={s.ratingSaveControl}>
                <span
                  className={s.ratingSaveStatus}
                  role="status"
                  aria-label="评级保存状态"
                >
                  {ratingSaveState}
                </span>
                <button
                  type="button"
                  onClick={handleSave}
                  disabled={ratingSaveState === '评级保存中'}
                >
                  保存能力评级
                </button>
              </div>
              <button
                type="button"
                className="primary"
                onClick={handleGeneratePlan}
                disabled={generationBusy}
              >
                {generationBusy ? '生成中…' : '生成所选学习任务'}
              </button>
            </div>
          </footer>
        )}
      </div>
    </section>
  )
}

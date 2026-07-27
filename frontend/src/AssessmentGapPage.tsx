import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import s from './AssessmentGapPage.module.css'
import { useYear } from './YearContext'
import {
  type Assessment,
  type AssessmentDetail,
  createAssessment,
  batchFillL2,
  getAssessment,
  listAssessments,
  saveDraft,
  submitAssessment,
} from './assessment'
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
  return detail.l1_code ?? detail.l3_code.split('.')[0]
}

function l2Of(detail: AssessmentDetail) {
  return detail.l2_code ?? detail.l3_code.split('.').slice(0, 2).join('.')
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
  for (const detail of details) {
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
  if (detail.standard_target_applicable === false) return null
  return detail.target_adjusted
    ? (detail.adjusted_target_level ?? null)
    : (detail.standard_target_level ?? detail.target_level ?? null)
}

function isFilled(detail: AssessmentDetail) {
  return !unfilledReason(detail)
}

function unfilledReason(detail: AssessmentDetail) {
  if (detail.target_compatibility_error) return '需兼容修复'
  if (detail.standard_target_applicable === false) return ''
  if (detail.current_level == null || effectiveTarget(detail) == null) {
    return '需评估等级'
  }
  if (detail.current_level >= 3 && !detail.evidence_note?.trim()) {
    return '需自评依据'
  }
  if (
    detail.inherited_current_level != null &&
    detail.current_level > detail.inherited_current_level &&
    detail.evidence_note?.trim() === detail.inherited_evidence_note?.trim()
  ) {
    return '需更新依据'
  }
  return ''
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
  const searchInputRef = useRef<HTMLInputElement | null>(null)
  const [searchActiveIndex, setSearchActiveIndex] = useState(-1)

  function loadAssessment(value: Assessment) {
    setAssessment(value)
    setDetails(value.details ?? [])
    const firstDomain = defaultDomain(value.details ?? [])
    setActiveDomain((current) => current || firstDomain)
    const firstL2 = defaultL2(value.details ?? [], firstDomain)
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

  async function handleCreate() {
    setError('')
    try {
      if (isMockEnabled()) {
        loadAssessment(mockAssessment)
        return
      }
      const created = await createAssessment(year)
      loadAssessment(await getAssessment(created.id))
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : '创建失败')
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
          ? { ...current, revision: result.revision ?? current.revision }
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
          ? { ...current, revision: result.revision ?? current.revision }
          : current,
      )
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
          current ? { ...current, revision } : current,
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
      setError(
        status === 409
          ? '提交冲突：数据已被其他操作更新，请重新加载后再提交。'
          : err instanceof Error
            ? err.message
            : '提交失败',
      )
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
    const detail = details.find((item) => !isFilled(item))
    if (detail) locateDetail(detail)
  }

  function setEvidence(index: number, value: string) {
    updateDetail(index, { evidence_note: value })
    setEditingId(null)
  }

  const editable =
    assessment?.status === '草稿' || assessment?.status === '建议调整'
  const filled = useMemo(() => details.filter(isFilled).length, [details])
  const unfilled = details.length - filled
  const domains = useMemo(
    () => [...new Set(details.map(l1Of))].filter(Boolean),
    [details],
  )
  const filtered = useMemo(() => {
    let list = details.filter((detail) => l1Of(detail) === activeDomain)
    if (statusFilter === '未完成')
      list = list.filter((detail) => !isFilled(detail))
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
  }, [details, activeDomain, statusFilter])
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
    const groups = new Map<string, AssessmentDetail[]>()
    for (const detail of filtered) {
      const key = l2Of(detail)
      groups.set(key, [...(groups.get(key) ?? []), detail])
    }
    return [...groups.entries()].sort(([left], [right]) => {
      const leftOpen = expandedL2.has(left) ? 0 : 1
      const rightOpen = expandedL2.has(right) ? 0 : 1
      return leftOpen - rightOpen
    })
  }, [filtered, expandedL2])
  const summary = assessment?.gap_summary

  if (loading) return <p className="muted">加载中…</p>
  if (!assessment) {
    return (
      <section className="page">
        <h1>能力自评与 Gap 分析</h1>
        <p>当前年度暂无草稿。</p>
        <button onClick={handleCreate}>创建年度自评草稿</button>
        {error && <p className="error">{error}</p>}
      </section>
    )
  }

  return (
    <section className={`page assessment-page ${s['assessment-page']}`}>
      <header
        className={`page-heading assessment-header ${s['assessment-header']}`}
      >
        <div>
          <p className="eyebrow">能力成长 / 能力自评与 Gap</p>
          <h1>能力自评与 Gap 分析</h1>
          <p className="muted">
            {assessment.year} 年度 · 版本 {assessment.version} ·{' '}
            {assessment.status}
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
            {filled}/{details.length}
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
                  {domainItems.filter(isFilled).length}/{domainItems.length}
                </small>
              </button>
            )
          })}
        </nav>
        <div className={s.toolbar}>
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
                  {domainLabel(l1Of(detail))} / {detail.l2_name ?? l2Of(detail)}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className={s.mainArea} data-testid="assessment-main-area">
        <div className={s.tableArea}>
          {l2Groups.map(([l2Code, items]) => {
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
                      {open ? '▾' : '▸'} {items[0].l2_name ?? l2Code}
                    </span>
                  </button>
                  <span className={s.groupActions}>
                    <small>
                      {items.filter(isFilled).length}/{items.length}
                    </small>
                    {editable &&
                      items.some((item) => item.current_level == null) &&
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
                  <table className={s.table} data-testid="assessment-table">
                    <thead>
                      <tr>
                        <th>L3 能力项</th>
                        <th>当前</th>
                        <th>标准目标</th>
                        <th>个人调整</th>
                        <th>最终目标</th>
                        <th>Gap</th>
                        <th>优先级</th>
                        <th>计划候选</th>
                        <th>依据</th>
                        <th title="P4–P8 为能力项建议起始职级">建议起始</th>
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
                        const applicable =
                          detail.standard_target_applicable !== false
                        const adjustable =
                          applicable &&
                          detail.standard_target_level != null &&
                          !detail.target_compatibility_error
                        const inherited =
                          detail.inherited_from_assessment_id != null
                        const updated =
                          inherited &&
                          (detail.current_level !==
                            detail.inherited_current_level ||
                            detail.evidence_note?.trim() !==
                              detail.inherited_evidence_note?.trim())
                        return (
                          <Fragment key={detail.id}>
                            <tr
                              id={`row-${detail.id}`}
                              tabIndex={-1}
                              className={gap && gap > 0 ? s.rowGap : undefined}
                            >
                              <td>
                                <strong>
                                  {detail.l3_name ?? detail.l3_code}
                                </strong>
                                <small className={s.l3name}>
                                  {detail.l3_code}
                                </small>
                                {!isFilled(detail) && reason && (
                                  <span className={s.reasonTag}>{reason}</span>
                                )}
                                {inherited && (
                                  <span className={s.inheritanceTag}>
                                    {updated ? '本次已更新' : '沿用上次评估'}
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
                                    checked={detail.target_adjusted ?? false}
                                    disabled={!editable || !adjustable}
                                    onChange={(event) =>
                                      updateDetail(index, {
                                        target_adjusted: event.target.checked,
                                        adjusted_target_level: event.target
                                          .checked
                                          ? (detail.adjusted_target_level ??
                                            detail.standard_target_level ??
                                            null)
                                          : null,
                                        target_adjustment_reason: event.target
                                          .checked
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
                                      detail.adjusted_target_level ?? null,
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
                                        detail.target_adjustment_reason ?? ''
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
                              <td>{gap == null ? '未评估' : priority(gap)}</td>
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
                                      plan_candidate: event.target.checked,
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
                                    setEditingText(detail.evidence_note ?? '')
                                  }}
                                  disabled={!editable}
                                >
                                  {detail.evidence_note?.trim()
                                    ? '编辑'
                                    : '填写'}
                                </button>
                              </td>
                              <td>{detail.recommended_start_level ?? '—'}</td>
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
            高 / 中 / 低：{summary.high_priority} / {summary.medium_priority} /{' '}
            {summary.low_priority}
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
    </section>
  )
}

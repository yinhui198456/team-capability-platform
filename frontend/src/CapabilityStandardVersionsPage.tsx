import { useMemo, useState } from 'react'

import styles from './CapabilityStandardVersionsPage.module.css'

import {
  abandonStandardDraft,
  copyStandardPreviousLevel,
  createStandardDraft,
  enabledDomains,
  publishStandardVersion,
  previewStandardPublish,
  reconcileStandardCatalog,
  updateStandardMatrix,
  useCatalog,
  useMe,
  validateStandardVersion,
  type CapabilityModel,
  type JobLevel,
  type StandardMatrix,
  type StandardMatrixItem,
  type StandardVersion,
} from './catalog'
import { type ApiError } from './shared/api'

const LEVELS: JobLevel[] = ['P4', 'P5', 'P6', 'P7', 'P8']

function messageFor(error: unknown) {
  return error instanceof Error ? error.message : '操作失败，请重试。'
}

function structuredIssues(
  error: unknown,
): Array<{ l3_node_id?: number; l3_code?: string | null; job_level?: string | null; message: string }> {
  if (!(error instanceof Error)) return []
  const api = error as ApiError
  if (!api.detail || typeof api.detail !== 'object') return []
  const detail = api.detail as Record<string, unknown>
  return Array.isArray(detail.issues) ? (detail.issues as []) : []
}

export function CapabilityStandardVersionsPage() {
  const { isLeader, loading } = useMe()
  const { data: model } = useCatalog<CapabilityModel>('/api/capability-model')
  const { data: versions, refresh: refreshVersions } = useCatalog<
    StandardVersion[]
  >(model?.id ? `/api/capability-standard-versions?model_id=${model.id}` : null)
  const draft = versions?.find((version) => version.status === '草稿')
  const { data: matrix, refresh: refreshMatrix } = useCatalog<StandardMatrix>(
    draft ? `/api/capability-standard-versions/${draft.id}` : null,
  )
  const { data: drift, refresh: refreshDrift } = useCatalog<{
    has_drift: boolean
    added_enabled_l3: Array<{ l3_node_id: number; l3_code: string; l3_name: string }>
    disabled_l3: Array<{ l3_node_id: number; l3_code: string }>
    renamed_or_moved_l3: Array<{ l3_node_id: number }>
  }>(
    draft
      ? `/api/capability-standard-versions/${draft.id}/catalog-drift`
      : null,
  )
  const [summary, setSummary] = useState('')
  const [activeDomain, setActiveDomain] = useState('')
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [issues, setIssues] = useState<
    Array<{
      l3_node_id?: number
      l3_code?: string | null
      job_level?: string | null
      message: string
    }>
  >([])
  const [copyFrom, setCopyFrom] = useState<JobLevel>('P7')
  const [copyTo, setCopyTo] = useState<JobLevel>('P8')

  const domains = useMemo(() => enabledDomains(model), [model])
  const domain =
    domains.find((item) => item.code === activeDomain) ?? domains[0]
  const itemsByCode = useMemo(() => {
    const value = new Map<string, StandardMatrixItem[]>()
    for (const item of matrix?.items ?? []) {
      const entries = value.get(item.l3_code) ?? []
      entries.push(item)
      value.set(item.l3_code, entries)
    }
    return value
  }, [matrix])
  // Find L3 code → node_id from model for constructing matrix items
  const l3IdByCode = useMemo(() => {
    const value = new Map<string, number>()
    for (const dom of domains) {
      for (const l2 of dom.children) {
        for (const l3 of l2.children) {
          if (l3.id !== undefined) value.set(l3.code, l3.id)
        }
      }
    }
    return value
  }, [domains])

  if (loading) return <p className="muted">正在加载…</p>
  if (!isLeader) return <p className="error">仅 Leader 可维护能力标准版本。</p>

  async function createDraft() {
    if (!model?.id) return
    setBusy(true)
    setError('')
    try {
      await createStandardDraft(model.id, summary)
      setSummary('')
      refreshVersions()
    } catch (reason) {
      setError(messageFor(reason))
    } finally {
      setBusy(false)
    }
  }

  async function updateCell(
    item: StandardMatrixItem | { l3_node_id: number; l3_code: string; job_level: JobLevel },
    applicable: boolean,
    targetLevel: number | null,
  ) {
    if (!matrix?.version.revision) return
    setBusy(true)
    setError('')
    setIssues([])
    try {
      await updateStandardMatrix(matrix.version.id, matrix.version.revision, {
        l3_node_id: item.l3_node_id,
        l3_code: item.l3_code,
        job_level: item.job_level,
        applicable,
        target_level: targetLevel,
      })
      refreshMatrix()
      refreshVersions()
      refreshDrift()
    } catch (reason) {
      const apiErr = reason as ApiError
      if (apiErr.status === 409) {
        setError('草稿已被其他操作修改，正在重新加载最新版本…')
        refreshMatrix()
        refreshVersions()
      } else if (apiErr.status === 422) {
        setError('数据校验失败，请检查并修正。')
        setIssues(structuredIssues(reason))
      } else {
        setError(messageFor(reason))
      }
    } finally {
      setBusy(false)
    }
  }

  async function reconcile() {
    if (!matrix?.version.revision) return
    setBusy(true)
    setError('')
    try {
      await reconcileStandardCatalog(matrix.version.id, matrix.version.revision)
      refreshMatrix()
      refreshVersions()
      refreshDrift()
    } catch (reason) {
      setError(messageFor(reason))
    } finally {
      setBusy(false)
    }
  }

  async function inspectDraft(preview: boolean) {
    if (!matrix) return
    setBusy(true)
    setError('')
    setIssues([])
    try {
      const result = preview
        ? await previewStandardPublish(matrix.version.id)
        : await validateStandardVersion(matrix.version.id)
      const validation = 'validation' in result ? result.validation : result
      setIssues(validation.issues)
      if (!validation.valid) setError('草稿存在需要修复的矩阵项。')
    } catch (reason) {
      setError(messageFor(reason))
      setIssues(structuredIssues(reason))
    } finally {
      setBusy(false)
    }
  }

  async function copyPrevious() {
    if (!matrix?.version.revision) return
    const activeL2s = domain?.children ?? []
    const nodeIds = activeL2s.flatMap((l2) =>
      l2.children
        .map((l3) => {
          const nodeId = l3.id ?? l3IdByCode.get(l3.code)
          return nodeId
        })
        .filter((nodeId): nodeId is number => nodeId !== undefined),
    )
    if (!nodeIds.length) return
    setBusy(true)
    setError('')
    try {
      await copyStandardPreviousLevel(
        matrix.version.id,
        matrix.version.revision,
        copyFrom,
        copyTo,
        nodeIds,
      )
      refreshMatrix()
      refreshVersions()
    } catch (reason) {
      setError(messageFor(reason))
    } finally {
      setBusy(false)
    }
  }

  async function abandon() {
    if (!matrix?.version.revision || !window.confirm('确认放弃当前草稿？'))
      return
    setBusy(true)
    setError('')
    try {
      await abandonStandardDraft(matrix.version.id, matrix.version.revision)
      refreshVersions()
      refreshMatrix()
      refreshDrift()
      setIssues([])
    } catch (reason) {
      setError(messageFor(reason))
    } finally {
      setBusy(false)
    }
  }

  async function publish() {
    if (
      !matrix?.version.revision ||
      !window.confirm('确认发布此能力标准版本？')
    )
      return
    setBusy(true)
    setError('')
    try {
      await publishStandardVersion(matrix.version.id, matrix.version.revision)
      setIssues([])
      refreshVersions()
      refreshMatrix()
      refreshDrift()
    } catch (reason) {
      setError(messageFor(reason))
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className={`page ${styles.page}`}>
      <header className="page-header">
        <div>
          <p className="eyebrow">Leader only</p>
          <h1>能力标准版本</h1>
          <p className="muted">
            每个三级达成路径按 P4–P8 维护掌握度目标；建议起始职级仅作展示。
          </p>
        </div>
      </header>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {!draft ? (
        <section className={styles.panel}>
          <h2>当前已发布版本</h2>
          <p>
            {versions?.find((version) => version.status === '已发布')?.label ??
              '未找到已发布版本'}
          </p>
          <label>
            变更说明
            <input
              value={summary}
              onChange={(event) => setSummary(event.target.value)}
            />
          </label>
          <button
            type="button"
            onClick={createDraft}
            disabled={busy || !model?.id}
          >
            创建草稿
          </button>
        </section>
      ) : (
        <>
          <section className={styles.panel}>
            <h2>{draft.label}（草稿）</h2>
            <p>
              修订号：{matrix?.version.revision ?? draft.revision}
              。仅当前能力域及展开的 L2 挂载编辑控件。
            </p>
            {drift?.has_drift && (
              <p className="warning">
                目录发生漂移：新增 {drift.added_enabled_l3.length}，禁用{' '}
                {drift.disabled_l3.length}，改名或换父级{' '}
                {drift.renamed_or_moved_l3.length}。发布前必须协调。
              </p>
            )}
            <button
              type="button"
              onClick={() => inspectDraft(false)}
              disabled={busy}
            >
              检查草稿
            </button>{' '}
            <button
              type="button"
              onClick={() => inspectDraft(true)}
              disabled={busy}
            >
              预览发布
            </button>{' '}
            <button type="button" onClick={abandon} disabled={busy}>
              放弃草稿
            </button>{' '}
            <button
              type="button"
              onClick={reconcile}
              disabled={busy || !drift?.has_drift}
            >
              协调目录
            </button>{' '}
            <button
              type="button"
              onClick={publish}
              disabled={busy || Boolean(drift?.has_drift)}
            >
              检查并发布
            </button>
          </section>
          <section className={styles.panel}>
            <h3>复制上一职级</h3>
            <label>
              来源职级
              <select
                value={copyFrom}
                onChange={(event) => setCopyFrom(event.target.value as JobLevel)}
              >
                {LEVELS.slice(0, -1).map((level) => (
                  <option key={level} value={level}>
                    {level}
                  </option>
                ))}
              </select>
            </label>{' '}
            <label>
              目标职级
              <select
                value={copyTo}
                onChange={(event) => setCopyTo(event.target.value as JobLevel)}
              >
                {LEVELS.filter(
                  (level) =>
                    level ===
                    LEVELS[LEVELS.indexOf(copyFrom as JobLevel) + 1],
                ).map((level) => (
                  <option key={level} value={level}>
                    {level}
                  </option>
                ))}
              </select>
            </label>{' '}
            <button type="button" onClick={copyPrevious} disabled={busy}>
              复制 {copyFrom} → {copyTo}（当前域）
            </button>
          </section>
          <div
            className={styles.segmentedNav}
            role="tablist"
            aria-label="能力域"
          >
            {domains.map((item) => (
              <button
                key={item.code}
                type="button"
                role="tab"
                aria-selected={(domain?.code ?? '') === item.code}
                onClick={() => setActiveDomain(item.code)}
              >
                {item.code} · {item.name}
              </button>
            ))}
          </div>
          {domain?.children.map((l2) => {
            const open = expanded.has(l2.code)
            return (
              <section className={styles.panel} key={l2.code}>
                <button
                  type="button"
                  className={styles.sectionToggle}
                  aria-expanded={open}
                  onClick={() =>
                    setExpanded((current) => {
                      const next = new Set(current)
                      if (next.has(l2.code)) next.delete(l2.code)
                      else next.add(l2.code)
                      return next
                    })
                  }
                >
                  {l2.code} · {l2.name}（{l2.children.length} 条达成路径）
                </button>
                {open && (
                  <div
                    className={styles.matrix}
                    data-testid={`standard-l2-${l2.code}`}
                  >
                    {l2.children.map((l3) => {
                      const nodeId = l3.id ?? l3IdByCode.get(l3.code)
                      return (
                        <div className={styles.matrixRow} key={l3.code}>
                          <strong>
                            {l3.code} · {l3.name}
                          </strong>
                          {LEVELS.map((level) => {
                            const item = itemsByCode
                              .get(l3.code)
                              ?.find((cell) => cell.job_level === level)
                            if (!item) {
                              // New enabled L3 — show editable "pending config"
                              if (!nodeId)
                                return (
                                  <span key={level}>{level} 缺失</span>
                                )
                              return (
                                <label key={level}>
                                  {level}
                                  <select
                                    disabled={busy}
                                    defaultValue="pending"
                                    onChange={(event) => {
                                      const value = event.target.value
                                      if (value === 'pending') return
                                      updateCell(
                                        {
                                          l3_node_id: nodeId,
                                          l3_code: l3.code,
                                          job_level: level,
                                        },
                                        value !== 'na',
                                        value === 'na'
                                          ? null
                                          : Number(value),
                                      )
                                    }}
                                  >
                                    <option value="pending" disabled>
                                      待配置
                                    </option>
                                    <option value="na">不适用</option>
                                    {[1, 2, 3, 4, 5].map((target) => (
                                      <option key={target} value={target}>
                                        {target}
                                      </option>
                                    ))}
                                  </select>
                                </label>
                              )
                            }
                            return (
                              <label key={level}>
                                {level}
                                <select
                                  disabled={busy}
                                  value={
                                    item.applicable
                                      ? String(item.target_level)
                                      : 'na'
                                  }
                                  onChange={(event) =>
                                    updateCell(
                                      item,
                                      event.target.value !== 'na',
                                      event.target.value === 'na'
                                        ? null
                                        : Number(event.target.value),
                                    )
                                  }
                                >
                                  <option value="na">不适用</option>
                                  {[1, 2, 3, 4, 5].map((target) => (
                                    <option key={target} value={target}>
                                      {target}
                                    </option>
                                  ))}
                                </select>
                              </label>
                            )
                          })}
                        </div>
                      )
                    })}
                  </div>
                )}
              </section>
            )
          })}
          {issues.length > 0 && (
            <section className={styles.panel}>
              <h3>矩阵问题</h3>
              <ul className={styles.issues} aria-label="矩阵检查问题">
                {issues.map((issue, index) => (
                  <li key={`${issue.l3_code ?? issue.l3_node_id}-${issue.job_level}-${index}`}>
                    {[
                      issue.l3_code,
                      issue.job_level,
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                    {issue.l3_code || issue.job_level || issue.l3_node_id
                      ? '：'
                      : ''}
                    {issue.message}
                  </li>
                ))}
              </ul>
            </section>
          )}
        </>
      )}
    </section>
  )
}

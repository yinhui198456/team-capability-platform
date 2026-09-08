import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react'
import { useLocation, useNavigate } from 'react-router-dom'

import styles from './CapabilityModelPage.module.css'

import {
  archiveLearningResource,
  createLearningResource,
  enabledDomains,
  updateCapabilityNode,
  updateLearningResource,
  useCatalog,
  useMe,
  type Domain,
  type L2Node,
  type L3Node,
  type CapabilityModel,
  type Resource,
  type ResourceDetail,
  type PublishedStandardMatrix,
} from './catalog'

type EditableNode = {
  code: string
  nodeType: 'L1' | 'L2' | 'L3'
  name: string
  enabled?: boolean
  overview?: string | null
  p4_description?: string | null
  p5_description?: string | null
  p6_description?: string | null
  p7_description?: string | null
  p8_description?: string | null
  recommended_start_level?: string | null
  materials_text?: string
  expected_output?: string | null
  estimated_hours?: string | null
  output_type?: string | null
  notes?: string | null
  resource_codes?: string[]
  parentContext?: string
}

const START_LEVELS = [
  'P4',
  'P5',
  'P6',
  'P7',
  'P8',
  'P4–P5',
  'P5–P6',
  'P6–P7',
  'P7–P8',
  'P6–P8',
  'P5–P8',
]
const OUTPUT_TYPES = [
  '文档 / 演示',
  '实操',
  '方案设计',
  '问题处理',
  '经验沉淀',
  '方法论沉淀',
  '架构图+说明',
  '实操+说明',
  '实操+方案',
  '实操+分析',
  '实操+设计',
  '实操+验证',
  'Demo+交付物',
  'POC 验证报告',
]

function sameValues(left: Iterable<string>, right: Iterable<string>) {
  const leftSet = new Set(left)
  const rightSet = new Set(right)
  return (
    leftSet.size === rightSet.size &&
    [...leftSet].every((item) => rightSet.has(item))
  )
}

function numericHours(value: string | null | undefined) {
  const match = value?.match(/^(\d+(?:\.\d)?)\s*小时$/)
  return match?.[1] ?? value ?? ''
}

function hoursError(value: string) {
  return value && !/^\d+(?:\.\d)?$/.test(value)
    ? '请输入非负整数或至多一位小数。'
    : ''
}

function decodedHash(hash: string) {
  try {
    return { code: decodeURIComponent(hash.slice(1)).trim(), malformed: false }
  } catch {
    return { code: hash.slice(1).trim(), malformed: true }
  }
}

function textField(
  label: string,
  value: string,
  onChange: (value: string) => void,
  options?: { readOnly?: boolean; required?: boolean },
) {
  return (
    <label key={label}>
      {label}
      <input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        readOnly={options?.readOnly}
        required={options?.required}
      />
    </label>
  )
}

function textAreaField(
  label: string,
  value: string,
  onChange: (value: string) => void,
) {
  return (
    <label key={label}>
      {label}
      <textarea
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
    </label>
  )
}

function NodeEditForm({
  node,
  resources,
  onClose,
  onSaved,
}: {
  node: EditableNode
  resources: Resource[]
  onClose: () => void
  onSaved: () => void
}) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const [name, setName] = useState(node.name)
  const [enabled, setEnabled] = useState(node.enabled ?? true)
  const [p4, setP4] = useState(node.p4_description ?? '')
  const [p5, setP5] = useState(node.p5_description ?? '')
  const [p6, setP6] = useState(node.p6_description ?? '')
  const [p7, setP7] = useState(node.p7_description ?? '')
  const [p8, setP8] = useState(node.p8_description ?? '')
  const [recommended, setRecommended] = useState(
    node.recommended_start_level ?? '',
  )
  const [materialsText, setMaterialsText] = useState(node.materials_text ?? '')
  const [expectedOutput, setExpectedOutput] = useState(
    node.expected_output ?? '',
  )
  const [estimatedHours, setEstimatedHours] = useState(
    numericHours(node.estimated_hours),
  )
  const originalHoursEditable =
    !node.estimated_hours ||
    /^\d+(?:\.\d)?(?:\s*小时)?$/.test(node.estimated_hours)
  const [replaceHours, setReplaceHours] = useState(originalHoursEditable)
  const [outputType, setOutputType] = useState(node.output_type ?? '')
  const [notes, setNotes] = useState(node.notes ?? '')
  const [overview, setOverview] = useState(node.overview ?? '')
  const [resourceCodes, setResourceCodes] = useState<Iterable<string>>(
    new Set(node.resource_codes ?? []),
  )
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [hoursValidationError, setHoursValidationError] = useState('')

  const isL3 = node.nodeType === 'L3'
  const isL2 = node.nodeType === 'L2'

  function requestClose() {
    if (!saving) onClose()
  }

  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return
    if (typeof dialog.showModal === 'function') dialog.showModal()
    else dialog.setAttribute('open', '')
    dialog.querySelector<HTMLInputElement>('input[name="name"]')?.focus()
    return () => {
      if (typeof dialog.close === 'function' && dialog.open) dialog.close()
      else dialog.removeAttribute('open')
    }
  }, [])

  function handleDialogKeyDown(event: ReactKeyboardEvent<HTMLDialogElement>) {
    if (event.key === 'Escape') {
      event.preventDefault()
      requestClose()
      return
    }
    if (event.key !== 'Tab') return
    const focusable = Array.from(
      event.currentTarget.querySelectorAll<HTMLElement>(
        'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled])',
      ),
    )
    const first = focusable[0]
    const last = focusable[focusable.length - 1]
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault()
      last?.focus()
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault()
      first?.focus()
    }
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    if (saving) return
    setError('')
    const invalidHours = isL3 && replaceHours ? hoursError(estimatedHours) : ''
    if (invalidHours) {
      setHoursValidationError(invalidHours)
      document.getElementById('estimated-hours')?.focus()
      return
    }
    setHoursValidationError('')
    const body: Record<string, unknown> = {}
    if (name !== node.name) body.name = name
    if (enabled !== (node.enabled ?? true)) body.enabled = enabled
    if (node.nodeType === 'L1' && overview !== (node.overview ?? '')) {
      body.overview = overview
    }
    if (isL2) {
      const levels = [
        ['p4_description', p4, node.p4_description ?? ''],
        ['p5_description', p5, node.p5_description ?? ''],
        ['p6_description', p6, node.p6_description ?? ''],
        ['p7_description', p7, node.p7_description ?? ''],
        ['p8_description', p8, node.p8_description ?? ''],
      ] as const
      levels.forEach(([key, value, original]) => {
        if (value !== original) body[key] = value
      })
    }
    if (isL3) {
      const fields = [
        [
          'recommended_start_level',
          recommended,
          node.recommended_start_level ?? '',
        ],
        ['materials_text', materialsText, node.materials_text ?? ''],
        ['expected_output', expectedOutput, node.expected_output ?? ''],
        ['output_type', outputType, node.output_type ?? ''],
        ['notes', notes, node.notes ?? ''],
      ] as const
      fields.forEach(([key, value, original]) => {
        if (value !== original) body[key] = value
      })
      if (
        replaceHours &&
        estimatedHours !== numericHours(node.estimated_hours)
      ) {
        body.estimated_hours = estimatedHours
      }
      if (!sameValues(resourceCodes, node.resource_codes ?? [])) {
        body.resource_codes = Array.from(resourceCodes)
      }
    }
    if (!Object.keys(body).length) return requestClose()
    setSaving(true)
    try {
      await updateCapabilityNode(node.code, body)
      onSaved()
    } catch (err) {
      setError(err instanceof Error ? err.message : '保存失败')
    } finally {
      setSaving(false)
    }
  }

  function toggleResource(code: string) {
    const next = new Set(resourceCodes)
    if (next.has(code)) next.delete(code)
    else next.add(code)
    setResourceCodes(next)
  }

  return (
    <dialog
      ref={dialogRef}
      className={`${styles.drawer} ${styles.editDrawer}`}
      aria-labelledby="node-edit-title"
      aria-modal="true"
      onCancel={(event) => {
        event.preventDefault()
        requestClose()
      }}
      onKeyDown={handleDialogKeyDown}
    >
      <form className={`edit-form ${styles.editForm}`} onSubmit={handleSubmit}>
        <div className={styles.drawerHeader}>
          <div>
            <p className={styles.sectionKicker}>标准维护</p>
            <h2 id="node-edit-title">
              编辑 {node.code} ({node.nodeType})
            </h2>
          </div>
          <button
            type="button"
            className={styles.drawerClose}
            aria-label="关闭编辑"
            onClick={requestClose}
            disabled={saving}
          >
            ×
          </button>
        </div>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        {isL3 && (
          <fieldset className="link-set">
            <legend>只读上下文</legend>
            <label>
              代码
              <input value={node.code} readOnly />
            </label>
            <label>
              所属能力组
              <input value={node.parentContext ?? ''} readOnly />
            </label>
          </fieldset>
        )}
        <label>
          名称
          <input
            name="name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            required
          />
        </label>
        <label className="checkbox">
          <input
            type="checkbox"
            checked={enabled}
            onChange={(event) => setEnabled(event.target.checked)}
          />
          启用
        </label>
        {node.nodeType === 'L1' &&
          textAreaField('一级概述', overview, setOverview)}
        {isL2 && (
          <>
            {textAreaField('P4 描述', p4, setP4)}
            {textAreaField('P5 描述', p5, setP5)}
            {textAreaField('P6 描述', p6, setP6)}
            {textAreaField('P7 描述', p7, setP7)}
            {textAreaField('P8 描述', p8, setP8)}
          </>
        )}
        {isL3 && (
          <>
            <label>
              建议起始等级
              <select
                value={recommended}
                onChange={(event) => setRecommended(event.target.value)}
              >
                <option value="">未设置</option>
                {!START_LEVELS.includes(recommended) && recommended && (
                  <option value={recommended}>{recommended}</option>
                )}
                {START_LEVELS.map((level) => (
                  <option key={level} value={level}>
                    {level}
                  </option>
                ))}
              </select>
            </label>
            {textAreaField('原始学习材料', materialsText, setMaterialsText)}
            {textAreaField('预期输出', expectedOutput, setExpectedOutput)}
            {replaceHours ? (
              <label>
                预计时长（小时）
                <input
                  id="estimated-hours"
                  value={estimatedHours}
                  aria-invalid={Boolean(hoursValidationError)}
                  aria-describedby={
                    hoursValidationError ? 'estimated-hours-error' : undefined
                  }
                  onChange={(event) => setEstimatedHours(event.target.value)}
                />
                {hoursValidationError && (
                  <small id="estimated-hours-error" role="alert">
                    {hoursValidationError}
                  </small>
                )}
                {!originalHoursEditable && (
                  <button
                    type="button"
                    onClick={() => {
                      setEstimatedHours(numericHours(node.estimated_hours))
                      setHoursValidationError('')
                      setReplaceHours(false)
                    }}
                  >
                    取消修改时长
                  </button>
                )}
              </label>
            ) : (
              <p>
                预计时长：{node.estimated_hours}{' '}
                <button type="button" onClick={() => setReplaceHours(true)}>
                  修改时长
                </button>
              </p>
            )}
            <label>
              输出类型
              <select
                value={outputType}
                onChange={(event) => setOutputType(event.target.value)}
              >
                <option value="">未设置</option>
                {!OUTPUT_TYPES.includes(outputType) && outputType && (
                  <option value={outputType}>{outputType}</option>
                )}
                {OUTPUT_TYPES.map((type) => (
                  <option key={type} value={type}>
                    {type}
                  </option>
                ))}
              </select>
            </label>
            {textAreaField('备注', notes, setNotes)}
            <fieldset className="link-set">
              <legend>关联资源</legend>
              {resources.map((resource) => (
                <label className="checkbox" key={resource.material_code}>
                  <input
                    type="checkbox"
                    checked={new Set(resourceCodes).has(resource.material_code)}
                    onChange={() => toggleResource(resource.material_code)}
                  />
                  {resource.material_code} · {resource.name}
                </label>
              ))}
            </fieldset>
          </>
        )}
        <div className="form-actions">
          <button type="button" onClick={requestClose} disabled={saving}>
            取消
          </button>
          <button type="submit" disabled={saving}>
            保存
          </button>
        </div>
      </form>
    </dialog>
  )
}

export function ResourceForm({
  resource,
  detail,
  l3Nodes,
  onClose,
  onSaved,
  onArchived,
}: {
  resource?: Resource
  detail?: ResourceDetail | null
  l3Nodes: L3Node[]
  onClose: () => void
  onSaved: () => void
  onArchived?: () => void
}) {
  const isCreate = resource === undefined
  const [materialCode, setMaterialCode] = useState(
    resource?.material_code ?? '',
  )
  const [name, setName] = useState(resource?.name ?? '')
  const [materialType, setMaterialType] = useState(
    resource?.material_type ?? '',
  )
  const [sourceText, setSourceText] = useState(resource?.source_text ?? '')
  const [purpose, setPurpose] = useState(resource?.purpose ?? '')
  const [status, setStatus] = useState(resource?.status ?? '')
  const [l3Codes, setL3Codes] = useState<Iterable<string>>(
    new Set(detail?.l3_nodes.map((node) => node.code) ?? []),
  )
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [confirmArchive, setConfirmArchive] = useState(false)

  useEffect(() => {
    setMaterialCode(resource?.material_code ?? '')
    setName(resource?.name ?? '')
    setMaterialType(resource?.material_type ?? '')
    setSourceText(resource?.source_text ?? '')
    setPurpose(resource?.purpose ?? '')
    setStatus(resource?.status ?? '')
    setL3Codes(new Set(detail?.l3_nodes.map((node) => node.code) ?? []))
    setConfirmArchive(false)
  }, [resource, detail])

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    setSaving(true)
    setError('')
    const body = {
      name,
      material_type: materialType,
      source_text: sourceText,
      purpose,
      status,
      l3_codes: Array.from(l3Codes),
    }
    try {
      if (isCreate) {
        await createLearningResource({ material_code: materialCode, ...body })
      } else {
        await updateLearningResource(resource.material_code, body)
      }
      onSaved()
    } catch (err) {
      setError(err instanceof Error ? err.message : '保存失败')
    } finally {
      setSaving(false)
    }
  }

  async function handleArchive() {
    if (!confirmArchive) {
      setConfirmArchive(true)
      return
    }
    if (!resource) return
    setSaving(true)
    setError('')
    try {
      await archiveLearningResource(resource.material_code)
      onArchived?.()
    } catch (err) {
      setError(err instanceof Error ? err.message : '归档失败')
      setSaving(false)
    }
  }

  function toggleL3(code: string) {
    const next = new Set(l3Codes)
    if (next.has(code)) next.delete(code)
    else next.add(code)
    setL3Codes(next)
  }

  return (
    <form className="edit-form" onSubmit={handleSubmit}>
      <h3>{isCreate ? '新建资源' : `编辑资源 ${resource.material_code}`}</h3>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {textField(
        '资源编码',
        materialCode,
        setMaterialCode,
        isCreate ? { required: true } : { readOnly: true },
      )}
      {textField('名称', name, setName, { required: true })}
      {textField('类型', materialType, setMaterialType, { required: true })}
      {textField('来源', sourceText, setSourceText)}
      {textField('用途', purpose, setPurpose)}
      {textField('状态', status, setStatus, { required: true })}
      <fieldset className="link-set">
        <legend>关联三级达成路径</legend>
        {l3Nodes.map((node) => (
          <label className="checkbox" key={node.code}>
            <input
              type="checkbox"
              checked={new Set(l3Codes).has(node.code)}
              onChange={() => toggleL3(node.code)}
            />
            {node.l2_code && node.l2_name
              ? `${node.l2_code} · ${node.l2_name} → `
              : ''}
            {node.code} · {node.name}
          </label>
        ))}
      </fieldset>
      <div className="form-actions">
        <button type="submit" disabled={saving}>
          保存
        </button>
        {!isCreate && (
          <button
            type="button"
            className="archive-button"
            onClick={handleArchive}
            disabled={saving}
          >
            {confirmArchive ? '确认归档' : '归档'}
          </button>
        )}
        <button type="button" onClick={onClose} disabled={saving}>
          取消
        </button>
      </div>
    </form>
  )
}

const LEVELS = [
  { key: 'p4', label: 'P4' },
  { key: 'p5', label: 'P5' },
  { key: 'p6', label: 'P6' },
  { key: 'p7', label: 'P7' },
  { key: 'p8', label: 'P8' },
] as const

type LevelKey = (typeof LEVELS)[number]['key']
type SearchResultKind = 'L1' | 'L2' | 'L3'

type SearchResult = {
  kind: SearchResultKind
  code: string
  name: string
  l1Code: string
  l1Name: string
  l2Code?: string
  l2Name?: string
  l3Code?: string
  l3Name?: string
}

const SEARCH_KIND_LABEL: Record<SearchResultKind, string> = {
  L1: '能力域',
  L2: '能力标准',
  L3: '达成路径',
}

function searchResultsFor(model: CapabilityModel | null): SearchResult[] {
  return enabledDomains(model).flatMap((domain) => [
    {
      kind: 'L1' as const,
      code: domain.code,
      name: domain.name,
      l1Code: domain.code,
      l1Name: domain.name,
    },
    ...domain.children.flatMap((l2) => [
      {
        kind: 'L2' as const,
        code: l2.code,
        name: l2.name,
        l1Code: domain.code,
        l1Name: domain.name,
        l2Code: l2.code,
        l2Name: l2.name,
      },
      ...l2.children.map((l3) => ({
        kind: 'L3' as const,
        code: l3.code,
        name: l3.name,
        l1Code: domain.code,
        l1Name: domain.name,
        l2Code: l2.code,
        l2Name: l2.name,
        l3Code: l3.code,
        l3Name: l3.name,
      })),
    ]),
  ])
}

type SelectedL3Context = {
  domain: Domain
  l2: L2Node
  l3: L3Node
}

function findSelectedL3Context(
  model: CapabilityModel | null,
  code: string,
): SelectedL3Context | null {
  for (const domain of enabledDomains(model)) {
    for (const l2 of domain.children) {
      const l3 = l2.children.find((candidate) => candidate.code === code)
      if (l3) return { domain, l2, l3 }
    }
  }
  return null
}

function levelDescription(
  node: {
    p4_description: string | null
    p5_description: string | null
    p6_description: string | null
    p7_description: string | null
    p8_description: string | null
  },
  key: LevelKey,
) {
  return node[`${key}_description`]
}

function levelSummary(value: string | null) {
  const text = value?.trim() || '未提供等级说明'
  return text.length > 72 ? `${text.slice(0, 72)}…` : text
}

export function CapabilityModelPage() {
  const {
    data: model,
    error,
    refresh: refreshModel,
  } = useCatalog<CapabilityModel>('/api/capability-model')
  const { data: publishedStandard } = useCatalog<PublishedStandardMatrix>(
    model?.id
      ? `/api/capability-standard-versions/published?model_id=${model.id}`
      : null,
  )
  const { data: resources } = useCatalog<Resource[]>('/api/learning-resources')
  const { isLeader, user } = useMe()
  const navigate = useNavigate()
  const location = useLocation()
  const [activeDomain, setActiveDomain] = useState('')
  const [expandedL2ByDomain, setExpandedL2ByDomain] = useState<
    Record<string, Set<string>>
  >({})
  const [searchQuery, setSearchQuery] = useState('')
  const [searchOpen, setSearchOpen] = useState(false)
  const [selectedL2Level, setSelectedL2Level] = useState<{
    l2Code: string
    level: LevelKey
  } | null>(null)
  const [selectedL3, setSelectedL3] = useState<string | null>(null)
  const [selectedCode, setSelectedCode] = useState('')
  const [locationError, setLocationError] = useState('')
  const [searchActiveIndex, setSearchActiveIndex] = useState(-1)
  const [focusTarget, setFocusTarget] = useState('')
  const [focusRequestId, setFocusRequestId] = useState(0)
  const [editingNode, setEditingNode] = useState<EditableNode | null>(null)
  const drawerRef = useRef<HTMLElement | null>(null)
  const domainTabsRef = useRef<HTMLElement | null>(null)
  const returnFocusCode = useRef<string | null>(null)
  const restoreFocus = useRef(false)
  const locationInitialized = useRef(false)
  const pendingDrawerCode = useRef('')
  const pendingDomainScroll = useRef<{ code: string; y: number } | null>(null)
  const consumedFocusTarget = useRef('')
  const editReturnFocus = useRef<HTMLElement | null>(null)
  const restoreEditFocus = useRef(false)
  const editSessionRef = useRef(0)

  const domains = useMemo(() => enabledDomains(model), [model])
  const currentDomain =
    domains.find((domain) => domain.code === activeDomain) ??
    (!location.hash ? domains[0] : undefined)
  const index = useMemo(() => searchResultsFor(model), [model])
  const normalizedQuery = searchQuery.trim().toLocaleLowerCase()
  const searchResults = useMemo(() => {
    if (!normalizedQuery) return []
    return index
      .filter(
        (result) =>
          result.code.toLocaleLowerCase().includes(normalizedQuery) ||
          result.name.toLocaleLowerCase().includes(normalizedQuery),
      )
      .slice(0, 30)
  }, [index, normalizedQuery])
  const expandedL2 = currentDomain
    ? (expandedL2ByDomain[currentDomain.code] ?? new Set<string>())
    : new Set<string>()
  const selectedContext = findSelectedL3Context(model, selectedL3 ?? '')
  const selectedNode = selectedContext?.l3
  const selectedNodeId = selectedNode?.id
  const selectedStandardItems = useMemo(
    () =>
      selectedNodeId !== undefined
        ? (publishedStandard?.items?.filter(
            (item) => item.l3_node_id === selectedNodeId,
          ) ?? [])
        : [],
    [publishedStandard, selectedNodeId],
  )

  useLayoutEffect(() => {
    if (selectedL3) {
      drawerRef.current?.focus()
      return
    }
    if (restoreFocus.current && returnFocusCode.current) {
      document.getElementById(`l3-row-${returnFocusCode.current}`)?.focus()
      restoreFocus.current = false
    }
  }, [selectedL3])

  useLayoutEffect(() => {
    if (editingNode || !restoreEditFocus.current) return
    restoreEditFocus.current = false
    if (editReturnFocus.current?.isConnected) editReturnFocus.current.focus()
    editReturnFocus.current = null
  }, [editingNode])

  useEffect(() => {
    if (!focusTarget || focusTarget === consumedFocusTarget.current) return
    const target = document.getElementById(focusTarget)
    if (!target) return
    consumedFocusTarget.current = focusTarget
    target.focus({ preventScroll: true })
    target.scrollIntoView?.({ block: 'nearest' })
    setFocusTarget('')
  }, [activeDomain, expandedL2ByDomain, focusRequestId, focusTarget])

  useEffect(() => {
    if (!model) return
    const isLaterNavigation = locationInitialized.current
    locationInitialized.current = true
    const { code, malformed } = decodedHash(location.hash)
    if (!code) {
      setLocationError('')
      setSelectedCode('')
      setActiveDomain(domains[0]?.code ?? '')
      closeDrawer(false)
      closeEditor(false)
      if (isLaterNavigation && domains[0]) {
        requestFocusTarget(`capability-domain-content-${domains[0].code}`)
      }
      return
    }
    const result = index.find((item) => item.code === code)
    if (!result) {
      const domainCode = code.split('.')[0]
      const knownDomain = domains.find((domain) => domain.code === domainCode)
      setSelectedCode('')
      setActiveDomain(knownDomain?.code ?? '')
      setLocationError(
        malformed
          ? '链接中的能力路径编码无效，请搜索正确编号或选择能力域。'
          : knownDomain
            ? `“${code}”不在当前模型中，已保留 ${knownDomain.code} 能力域上下文。`
            : `“${code}”无法识别，请搜索正确编号或选择能力域。`,
      )
      closeDrawer(false)
      closeEditor(false)
      pendingDrawerCode.current = ''
      requestFocusTarget('capability-location-error')
      return
    }
    const opensDrawer = pendingDrawerCode.current === result.code
    if (opensDrawer) {
      pendingDrawerCode.current = ''
    } else {
      closeDrawer(false)
    }
    closeEditor(false)
    setLocationError('')
    setSelectedCode(result.code)
    setActiveDomain(result.l1Code)
    revealDomainTab(result.l1Code)
    if (result.l2Code) {
      setExpandedL2ByDomain((current) => ({
        ...current,
        [result.l1Code]: new Set(current[result.l1Code]).add(result.l2Code!),
      }))
    }
    if (
      result.kind === 'L1' &&
      pendingDomainScroll.current?.code === result.code
    ) {
      const { y } = pendingDomainScroll.current
      pendingDomainScroll.current = null
      requestAnimationFrame(() => {
        document
          .getElementById(`capability-domain-tab-${result.code}`)
          ?.focus({ preventScroll: true })
        if (window.scrollY !== y) window.scrollTo(0, y)
      })
    } else if (!opensDrawer) {
      requestFocusTarget(
        result.kind === 'L1'
          ? `capability-domain-content-${result.l1Code}`
          : result.kind === 'L2'
            ? `l2-toggle-${result.l2Code}`
            : `l3-row-${result.l3Code}`,
      )
    }
  }, [domains, index, location.hash, model])

  useEffect(() => {
    if (!selectedL3) return
    function handleEscape(event: KeyboardEvent) {
      if (event.key === 'Escape') closeDrawer()
    }
    window.addEventListener('keydown', handleEscape)
    return () => window.removeEventListener('keydown', handleEscape)
  }, [selectedL3])

  useEffect(() => {
    if (!searchOpen) return
    function handleEscape(event: KeyboardEvent) {
      if (event.key === 'Escape') setSearchOpen(false)
    }
    window.addEventListener('keydown', handleEscape)
    return () => window.removeEventListener('keydown', handleEscape)
  }, [searchOpen])

  useEffect(() => {
    if (!searchOpen || searchActiveIndex < 0) return
    document
      .getElementById(`capability-search-option-${searchActiveIndex}`)
      ?.scrollIntoView?.({ block: 'nearest' })
  }, [normalizedQuery, searchActiveIndex, searchOpen])

  function closeDrawer(shouldRestore = true) {
    restoreFocus.current = shouldRestore
    setSelectedL3(null)
  }

  function closeBeforeNavigation() {
    if (!selectedL3) return
    closeDrawer(false)
  }

  function requestFocusTarget(target: string) {
    consumedFocusTarget.current = ''
    setFocusTarget(target)
    setFocusRequestId((current) => current + 1)
  }

  function focusResult(result: SearchResult) {
    requestFocusTarget(
      result.kind === 'L1'
        ? `capability-domain-content-${result.l1Code}`
        : result.kind === 'L2'
          ? `l2-toggle-${result.l2Code}`
          : `l3-row-${result.l3Code}`,
    )
  }

  function revealDomainTab(code: string) {
    const tabs = domainTabsRef.current
    const tab = document.getElementById(`capability-domain-tab-${code}`)
    if (!tabs || !tab) return
    if (tab.offsetLeft < tabs.scrollLeft) tabs.scrollLeft = tab.offsetLeft
    else if (
      tab.offsetLeft + tab.offsetWidth >
      tabs.scrollLeft + tabs.clientWidth
    ) {
      tabs.scrollLeft = tab.offsetLeft + tab.offsetWidth - tabs.clientWidth
    }
  }

  function selectCode(code: string) {
    const hash = `#${encodeURIComponent(code)}`
    if (decodedHash(location.hash).code === code) return false
    navigate({ pathname: location.pathname, search: location.search, hash })
    return true
  }

  function selectDomain(code: string) {
    closeBeforeNavigation()
    closeEditor(false)
    setSelectedL2Level(null)
    pendingDomainScroll.current = { code, y: window.scrollY }
    if (!selectCode(code)) {
      revealDomainTab(code)
      document
        .getElementById(`capability-domain-tab-${code}`)
        ?.focus({ preventScroll: true })
      pendingDomainScroll.current = null
    }
  }

  function toggleL2(domainCode: string, l2Code: string) {
    const isOpen = expandedL2ByDomain[domainCode]?.has(l2Code) ?? false
    const collapsesSelected =
      selectedCode === l2Code || selectedCode.startsWith(`${l2Code}.`)
    setExpandedL2ByDomain((current) => {
      const next = new Set(current[domainCode] ?? [])
      if (next.has(l2Code)) next.delete(l2Code)
      else next.add(l2Code)
      return { ...current, [domainCode]: next }
    })
    if (isOpen && collapsesSelected) {
      closeDrawer(false)
      selectCode(domainCode)
    } else if (!isOpen) {
      selectCode(l2Code)
    }
  }

  function setCurrentDomainL2(open: boolean) {
    if (!currentDomain) return
    if (!open && selectedCode.startsWith(`${currentDomain.code}.`)) {
      closeDrawer(false)
      selectCode(currentDomain.code)
    }
    setExpandedL2ByDomain((current) => ({
      ...current,
      [currentDomain.code]: open
        ? new Set(currentDomain.children.map((l2) => l2.code))
        : new Set(),
    }))
  }

  function selectResult(result: SearchResult) {
    setSearchOpen(false)
    setSearchActiveIndex(-1)
    closeBeforeNavigation()
    closeEditor(false)
    if (!selectCode(result.code)) focusResult(result)
  }

  function closeEditor(shouldRestore = true) {
    editSessionRef.current += 1
    restoreEditFocus.current = shouldRestore
    setEditingNode(null)
  }

  function startEdit(node: EditableNode, trigger: HTMLElement) {
    closeBeforeNavigation()
    editSessionRef.current += 1
    editReturnFocus.current = trigger
    restoreEditFocus.current = false
    setEditingNode(node)
  }

  function openDrawer(node: L3Node) {
    returnFocusCode.current = node.code
    restoreFocus.current = false
    pendingDrawerCode.current = node.code
    if (!selectCode(node.code)) pendingDrawerCode.current = ''
    setSelectedL3(node.code)
  }

  const editingSession = editSessionRef.current

  return (
    <section
      className={`page ${styles.page}`}
      data-testid="capability-map-page"
    >
      <header className={styles.header}>
        <div>
          <p className="eyebrow">查看团队能力等级与能力项标准</p>
          <h1>能力地图</h1>
          {model && (
            <p className="muted">
              {model.code} · {model.version}
            </p>
          )}
        </div>
        <div className={styles.headerActions}>
          {isLeader && (
            <button
              type="button"
              className={styles.standardVersionsAction}
              onClick={() => navigate('/capability/standards')}
            >
              标准版本维护
            </button>
          )}
          <div className={styles.searchPanel}>
            <label className={styles.searchLabel} htmlFor="capability-search">
              搜索能力地图
            </label>
            <div className={styles.searchBox}>
              <input
                id="capability-search"
                aria-label="搜索能力地图"
                role="combobox"
                aria-autocomplete="list"
                aria-expanded={searchOpen}
                aria-controls="capability-search-results"
                aria-activedescendant={
                  searchOpen && searchActiveIndex >= 0
                    ? `capability-search-option-${searchActiveIndex}`
                    : undefined
                }
                value={searchQuery}
                onChange={(event) => {
                  const value = event.target.value
                  setSearchQuery(value)
                  setSearchOpen(Boolean(value.trim()))
                  setSearchActiveIndex(value.trim() ? 0 : -1)
                }}
                onFocus={() => {
                  if (searchQuery.trim()) setSearchOpen(true)
                }}
                placeholder="搜索 L1 / L2 / L3 编号或名称"
                onKeyDown={(event) => {
                  if (event.key === 'Escape') {
                    setSearchOpen(false)
                    setSearchActiveIndex(-1)
                    return
                  }
                  if (!searchResults.length) return
                  if (
                    ['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)
                  ) {
                    event.preventDefault()
                    setSearchOpen(true)
                    setSearchActiveIndex((current) => {
                      if (event.key === 'Home') return 0
                      if (event.key === 'End') return searchResults.length - 1
                      const index = current < 0 ? 0 : current
                      return event.key === 'ArrowDown'
                        ? (index + 1) % searchResults.length
                        : (index - 1 + searchResults.length) %
                            searchResults.length
                    })
                  }
                  if (event.key === 'Enter' && searchOpen) {
                    event.preventDefault()
                    selectResult(
                      searchResults[
                        searchActiveIndex >= 0 ? searchActiveIndex : 0
                      ],
                    )
                  }
                }}
              />
              {searchQuery && (
                <button
                  type="button"
                  className={styles.clearSearch}
                  aria-label="清除搜索"
                  onClick={() => {
                    setSearchQuery('')
                    setSearchOpen(false)
                    setSearchActiveIndex(-1)
                  }}
                >
                  清除
                </button>
              )}
            </div>
            {searchOpen && searchQuery.trim() && (
              <div
                id="capability-search-results"
                className={styles.searchResults}
                role="listbox"
                aria-label="能力地图搜索结果"
              >
                {searchResults.length ? (
                  searchResults.map((result, resultIndex) => (
                    <button
                      type="button"
                      role="option"
                      tabIndex={-1}
                      id={`capability-search-option-${resultIndex}`}
                      aria-selected={searchActiveIndex === resultIndex}
                      className={styles.searchResult}
                      key={`${result.kind}-${result.code}`}
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={() => selectResult(result)}
                    >
                      <span className={styles.resultKind}>
                        {SEARCH_KIND_LABEL[result.kind]}
                      </span>
                      <span>
                        <strong>{result.code}</strong> · {result.name}
                      </span>
                      <small>
                        {result.kind === 'L1'
                          ? '能力域概览'
                          : `${result.l1Code} · ${result.l1Name}${
                              result.l2Code && result.kind === 'L3'
                                ? ` / ${result.l2Code} · ${result.l2Name}`
                                : ''
                            }`}
                      </small>
                    </button>
                  ))
                ) : (
                  <p className={styles.emptySearch} role="status">
                    未找到 L1、L2 或 L3 编号/名称
                  </p>
                )}
              </div>
            )}
          </div>
        </div>
      </header>

      {error && (
        <p className="error" role="alert">
          目录数据暂不可用，请稍后重试。
          <button type="button" onClick={refreshModel}>
            重试
          </button>
        </p>
      )}
      {locationError && (
        <p
          id="capability-location-error"
          className="error"
          role="alert"
          tabIndex={-1}
        >
          {locationError}
        </p>
      )}
      {!model && !error && <p className="muted">正在加载能力模型…</p>}

      {domains.length > 0 && (
        <>
          <nav
            ref={domainTabsRef}
            className={styles.domainTabs}
            aria-label="能力域导航"
            role="tablist"
          >
            {domains.map((domain) => (
              <button
                type="button"
                role="tab"
                aria-selected={domain.code === currentDomain?.code}
                aria-controls={`capability-domain-content-${domain.code}`}
                data-testid={`capability-domain-tab-${domain.code}`}
                id={`capability-domain-tab-${domain.code}`}
                className={
                  domain.code === currentDomain?.code
                    ? styles.domainTabActive
                    : styles.domainTab
                }
                key={domain.code}
                onClick={() => selectDomain(domain.code)}
                onKeyDown={(event) => {
                  if (
                    !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(
                      event.key,
                    )
                  )
                    return
                  event.preventDefault()
                  const tabs = domains.map((item) => item.code)
                  const current = tabs.indexOf(domain.code)
                  const next =
                    event.key === 'Home'
                      ? 0
                      : event.key === 'End'
                        ? tabs.length - 1
                        : event.key === 'ArrowRight'
                          ? (current + 1) % tabs.length
                          : (current - 1 + tabs.length) % tabs.length
                  revealDomainTab(tabs[next])
                  document
                    .getElementById(`capability-domain-tab-${tabs[next]}`)
                    ?.focus({ preventScroll: true })
                }}
              >
                <strong>{domain.code}</strong>
                <span>{domain.name}</span>
                <small>
                  {domain.children.length} 个 L2 ·{' '}
                  {domain.children.reduce(
                    (count, l2) => count + l2.children.length,
                    0,
                  )}{' '}
                  个 L3
                </small>
              </button>
            ))}
          </nav>

          {currentDomain && (
            <section
              id={`capability-domain-content-${currentDomain.code}`}
              data-testid={`capability-domain-content-${currentDomain.code}`}
              className={styles.domainContent}
              tabIndex={-1}
            >
              <div className={styles.domainHeading}>
                <div>
                  <p className={styles.sectionKicker}>当前能力域</p>
                  <h2>{currentDomain.name}</h2>
                </div>
                {isLeader && (
                  <button
                    type="button"
                    className="inline-edit"
                    onClick={(event) =>
                      startEdit(
                        {
                          code: currentDomain.code,
                          nodeType: 'L1',
                          name: currentDomain.name,
                          enabled: true,
                          overview: currentDomain.overview,
                        },
                        event.currentTarget,
                      )
                    }
                  >
                    编辑
                  </button>
                )}
              </div>

              <section
                className={styles.domainOverview}
                aria-label="能力域概述"
              >
                <p>{currentDomain.overview || '暂未提供一级概述。'}</p>
                <span>
                  {currentDomain.children.length} 个能力标准 ·{' '}
                  {currentDomain.children.reduce(
                    (count, l2) => count + l2.children.length,
                    0,
                  )}{' '}
                  个达成路径
                </span>
              </section>

              <div className={styles.l2Toolbar}>
                <div>
                  <h3>能力组</h3>
                  <span>{currentDomain.children.length} 个 L2 能力组</span>
                </div>
                <div className={styles.toolbarActions}>
                  <button
                    type="button"
                    onClick={() => setCurrentDomainL2(true)}
                  >
                    展开当前域
                  </button>
                  <button
                    type="button"
                    onClick={() => setCurrentDomainL2(false)}
                  >
                    收起当前域
                  </button>
                </div>
              </div>

              <div className={styles.l2List}>
                {currentDomain.children.map((l2) => {
                  const expanded = expandedL2.has(l2.code)
                  return (
                    <section
                      key={l2.code}
                      className={styles.l2Group}
                      data-testid={`l2-group-${l2.code}`}
                    >
                      <div className={styles.l2Header}>
                        <button
                          type="button"
                          id={`l2-toggle-${l2.code}`}
                          data-testid={`l2-toggle-${l2.code}`}
                          className={styles.l2Toggle}
                          aria-expanded={expanded}
                          aria-current={
                            selectedCode === l2.code ? 'location' : undefined
                          }
                          onClick={() => toggleL2(currentDomain.code, l2.code)}
                        >
                          <span
                            className={styles.expandIcon}
                            aria-hidden="true"
                          >
                            {expanded ? '−' : '+'}
                          </span>
                          <span>
                            <strong>{l2.code}</strong> · {l2.name}
                          </span>
                          <small>
                            <b>能力标准</b> · {l2.children.length} 条达成路径
                          </small>
                        </button>
                        {isLeader && (
                          <button
                            type="button"
                            className="inline-edit"
                            data-testid={`l2-edit-${l2.code}`}
                            onClick={(event) =>
                              startEdit(
                                {
                                  code: l2.code,
                                  nodeType: 'L2',
                                  name: l2.name,
                                  enabled: true,
                                  p4_description: l2.p4_description,
                                  p5_description: l2.p5_description,
                                  p6_description: l2.p6_description,
                                  p7_description: l2.p7_description,
                                  p8_description: l2.p8_description,
                                },
                                event.currentTarget,
                              )
                            }
                          >
                            编辑
                          </button>
                        )}
                      </div>
                      {expanded && (
                        <div className={styles.l2Expanded}>
                          <section
                            className={styles.levelSection}
                            aria-label={`${l2.code} 职级要求 P4-P8`}
                          >
                            <h4>职级要求 P4–P8</h4>
                            <div className={styles.levelGrid}>
                              {LEVELS.map(({ key, label }) => {
                                const selected =
                                  selectedL2Level?.l2Code === l2.code &&
                                  selectedL2Level.level === key
                                const description = levelDescription(l2, key)
                                return (
                                  <button
                                    type="button"
                                    className={
                                      selected
                                        ? styles.levelCardActive
                                        : styles.levelCard
                                    }
                                    aria-expanded={selected}
                                    data-testid={`l2-level-summary-${l2.code}-${label}`}
                                    key={key}
                                    onClick={() =>
                                      setSelectedL2Level(
                                        selected
                                          ? null
                                          : { l2Code: l2.code, level: key },
                                      )
                                    }
                                  >
                                    <strong>{label}</strong>
                                    <span>
                                      {description &&
                                      description.trim().length > 72
                                        ? levelSummary(description)
                                        : '查看要求'}
                                    </span>
                                  </button>
                                )
                              })}
                            </div>
                            {selectedL2Level?.l2Code === l2.code && (
                              <div
                                className={styles.inlineLevelDescription}
                                data-testid={`l2-level-inline-description-${l2.code}-${selectedL2Level.level.toUpperCase()}`}
                                role="region"
                                aria-label={`${l2.code} ${selectedL2Level.level.toUpperCase()} 完整职级要求`}
                              >
                                <strong>
                                  {selectedL2Level.level.toUpperCase()}{' '}
                                  完整职级要求
                                </strong>
                                <p>
                                  {levelDescription(
                                    l2,
                                    selectedL2Level.level,
                                  ) ?? '未提供等级说明'}
                                </p>
                              </div>
                            )}
                          </section>
                          <div
                            className={styles.l3List}
                            data-testid={`l3-list-${l2.code}`}
                          >
                            <h4>达成路径 / 学习实践项</h4>
                            {l2.children.length === 0 ? (
                              <p className={styles.l3Empty} role="status">
                                三级达成路径待补充
                              </p>
                            ) : (
                              l2.children.map((l3) => (
                                <div className={styles.l3Row} key={l3.code}>
                                  <button
                                    type="button"
                                    id={`l3-row-${l3.code}`}
                                    data-testid={`l3-row-${l3.code}`}
                                    className={styles.l3Trigger}
                                    aria-current={
                                      selectedCode === l3.code
                                        ? 'location'
                                        : undefined
                                    }
                                    onClick={() => openDrawer(l3)}
                                  >
                                    <span>
                                      <strong>{l3.name}</strong>
                                      <small>{l3.code}</small>
                                    </span>
                                    <span className={styles.l3Meta}>
                                      {l3.recommended_start_level
                                        ? `建议起始职级：${l3.recommended_start_level}`
                                        : '建议起始职级未提供'}
                                      <span aria-hidden="true">查看详情 →</span>
                                    </span>
                                  </button>
                                  <div className={styles.l3Summary}>
                                    <span>
                                      {l3.expected_output ?? '预期输出未提供'}
                                    </span>
                                    <span>
                                      {l3.estimated_hours
                                        ? `预计耗时：${l3.estimated_hours}`
                                        : '预计耗时未提供'}
                                    </span>
                                    {l3.output_type && (
                                      <span>输出类型：{l3.output_type}</span>
                                    )}
                                    <span>
                                      {l3.resources.length
                                        ? `已关联资源：${l3.resources
                                            .map((resource) => resource.name)
                                            .join('、')}`
                                        : '暂无已关联资源'}
                                    </span>
                                    {l3.unmatched_materials.length > 0 && (
                                      <span
                                        className={styles.l3Warning}
                                        role="status"
                                      >
                                        来源待补充 / 未关联：
                                        {l3.unmatched_materials.join('；')}
                                      </span>
                                    )}
                                  </div>
                                  {isLeader && (
                                    <button
                                      type="button"
                                      className={`inline-edit ${styles.l3Edit}`}
                                      data-testid={`l3-edit-${l3.code}`}
                                      onClick={(event) =>
                                        startEdit(
                                          {
                                            code: l3.code,
                                            nodeType: 'L3',
                                            name: l3.name,
                                            enabled: true,
                                            recommended_start_level:
                                              l3.recommended_start_level,
                                            materials_text: l3.materials_text,
                                            expected_output: l3.expected_output,
                                            estimated_hours: l3.estimated_hours,
                                            output_type: l3.output_type,
                                            notes: l3.notes,
                                            resource_codes: l3.resources.map(
                                              (resource) =>
                                                resource.material_code,
                                            ),
                                            parentContext: `${l2.code} · ${l2.name}`,
                                          },
                                          event.currentTarget,
                                        )
                                      }
                                    >
                                      编辑节点
                                    </button>
                                  )}
                                </div>
                              ))
                            )}
                          </div>
                        </div>
                      )}
                    </section>
                  )
                })}
              </div>
            </section>
          )}
        </>
      )}

      {selectedNode && (
        <aside
          ref={drawerRef}
          className={styles.drawer}
          role="dialog"
          aria-labelledby="l3-drawer-title"
          data-testid="l3-drawer"
          tabIndex={-1}
        >
          <div className={styles.drawerHeader}>
            <div>
              <p className={styles.sectionKicker}>达成路径详情</p>
              <h2 id="l3-drawer-title">{selectedNode.code}</h2>
              <p>{selectedNode.name}</p>
            </div>
            <button
              type="button"
              className={styles.drawerClose}
              aria-label="关闭达成路径详情"
              onClick={() => closeDrawer()}
            >
              ×
            </button>
          </div>
          <dl className={styles.contextList}>
            <div>
              <dt>所属能力域</dt>
              <dd>
                {selectedContext
                  ? `${selectedContext.domain.code} · ${selectedContext.domain.name}`
                  : '未提供'}
              </dd>
            </div>
            <div>
              <dt>所属能力组</dt>
              <dd>
                {selectedContext
                  ? `${selectedContext.l2.code} · ${selectedContext.l2.name}`
                  : '未提供'}
              </dd>
            </div>
            <div>
              <dt>达成路径</dt>
              <dd>
                {selectedContext
                  ? `${selectedContext.l3.code} · ${selectedContext.l3.name}`
                  : '未提供'}
              </dd>
            </div>
            <div>
              <dt>建议起始职级</dt>
              <dd>{selectedNode.recommended_start_level ?? '未提供'}</dd>
            </div>
            <div>
              <dt>预期输出</dt>
              <dd>{selectedNode.expected_output ?? '未提供'}</dd>
            </div>
            <div>
              <dt>预计时长</dt>
              <dd>{selectedNode.estimated_hours ?? '未提供'}</dd>
            </div>
            {selectedNode.output_type && (
              <div>
                <dt>输出类型</dt>
                <dd>{selectedNode.output_type}</dd>
              </div>
            )}
            {selectedNode.notes && (
              <div>
                <dt>备注</dt>
                <dd>{selectedNode.notes}</dd>
              </div>
            )}
          </dl>
          <section
            className={styles.drawerSection}
            data-testid="published-standard"
          >
            <h3>当前已发布职级标准</h3>
            {!publishedStandard ? (
              <p>已发布职级标准暂不可用。</p>
            ) : selectedNodeId === undefined ? (
              <p>标准数据不可用（缺少稳定节点身份）。</p>
            ) : (
              <>
                <p className={styles.standardVersion}>
                  {publishedStandard.version.label} · 已发布
                  {publishedStandard.version.published_at
                    ? ` · ${new Date(publishedStandard.version.published_at).toLocaleDateString('zh-CN')}`
                    : ''}
                </p>
                <div className={styles.standardCells}>
                  {['P4', 'P5', 'P6', 'P7', 'P8'].map((level) => {
                    const item = selectedStandardItems.find(
                      (candidate) => candidate.job_level === level,
                    )
                    const isMember = user?.roles.includes('Member')
                    const isCurrent = isMember && user?.current_level === level
                    const isTarget = isMember && user?.target_level === level
                    const hasItem = item && item.applicable
                    return (
                      <div
                        className={
                          isCurrent || isTarget
                            ? styles.standardCellHighlighted
                            : ''
                        }
                        data-testid={
                          isCurrent
                            ? 'member-current-level'
                            : isTarget
                              ? 'member-target-level'
                              : undefined
                        }
                        key={level}
                      >
                        <strong>
                          {level}
                          {isCurrent ? ' 当前' : ''}
                          {isTarget ? ' 目标' : ''}
                        </strong>
                        {!item ? (
                          <span className="muted">—</span>
                        ) : !item.applicable ? (
                          <span>不适用</span>
                        ) : (
                          <span>目标掌握度 {item.target_level} / 5</span>
                        )}
                        {hasItem && (
                          <small className="muted">来源：{item.source}</small>
                        )}
                      </div>
                    )
                  })}
                </div>
              </>
            )}
          </section>
          <section className={styles.drawerSection}>
            <h3>材料与资源</h3>
            <p>
              <strong>原始学习材料：</strong>
              {selectedNode.materials_text || '未提供'}
            </p>
            <p>
              <strong>已关联资源：</strong>
              {selectedNode.resources.length
                ? selectedNode.resources.map((resource) => (
                    <span
                      className={styles.resourceSummary}
                      key={resource.material_code}
                    >
                      {resource.material_code} · {resource.name}（
                      {resource.material_type} / {resource.status}）
                    </span>
                  ))
                : '暂无已关联资源'}
            </p>
            {selectedNode.unmatched_materials.length > 0 && (
              <p className="warning" role="status">
                来源待补充 / 未关联：
                {selectedNode.unmatched_materials.join('；')}
              </p>
            )}
          </section>
        </aside>
      )}

      {editingNode && (
        <NodeEditForm
          key={`${editingNode.nodeType}-${editingNode.code}`}
          node={editingNode}
          resources={resources ?? []}
          onClose={closeEditor}
          onSaved={() => {
            if (editingSession !== editSessionRef.current) return
            refreshModel()
            closeEditor()
          }}
        />
      )}
    </section>
  )
}

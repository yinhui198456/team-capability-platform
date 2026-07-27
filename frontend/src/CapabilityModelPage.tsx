import { useEffect, useState, type FormEvent } from 'react'

import {
  archiveLearningResource,
  createLearningResource,
  enabledDomains,
  updateCapabilityNode,
  updateLearningResource,
  useCatalog,
  useMe,
  type L3Node,
  type CapabilityModel,
  type Resource,
  type ResourceDetail,
  type JobLevel,
} from './catalog'

const JOB_LEVELS: JobLevel[] = ['P4', 'P5', 'P6', 'P7', 'P8']

function earliestJobLevel(value?: string | null): number | null {
  const match = value?.match(/^\s*P([4-8])(?:\s*[-–—]\s*P([4-8]))?\s*$/)
  if (!match) return null
  const start = Number(match[1])
  const end = Number(match[2] ?? match[1])
  return end >= start ? start : null
}

type EditableNode = {
  code: string
  nodeType: 'L1' | 'L2' | 'L3'
  name: string
  enabled?: boolean
  p4_description: string | null
  p5_description: string | null
  p6_description: string | null
  p7_description: string | null
  p8_description: string | null
  recommended_start_level?: string | null
  materials_text?: string
  expected_output?: string | null
  estimated_hours?: string | null
  resource_codes?: string[]
  standard_target_overrides?: Partial<Record<JobLevel, number | null>>
}

function L3Details({ node }: { node: L3Node }) {
  return (
    <article className="l3-node" id={node.code}>
      <h4>
        {node.code} · {node.name}
      </h4>
      <dl className="metadata">
        <div>
          <dt>建议起始等级</dt>
          <dd>{node.recommended_start_level ?? '未提供'}</dd>
        </div>
        <div>
          <dt>预期输出</dt>
          <dd>{node.expected_output ?? '未提供'}</dd>
        </div>
        <div>
          <dt>预计时长</dt>
          <dd>
            {node.estimated_hours ?? '未提供'}
            {node.estimated_hours === null ? '' : ' 小时'}
          </dd>
        </div>
      </dl>
      <p>
        <strong>原始学习材料：</strong>
        {node.materials_text || '未提供'}
      </p>
      <p>
        <strong>已关联资源：</strong>
        {node.resources.length
          ? node.resources.map((resource) => (
              <span className="resource-summary" key={resource.material_code}>
                {resource.material_code} · {resource.name}（
                {resource.material_type} / {resource.status}）
              </span>
            ))
          : '暂无已关联资源'}
      </p>
      {node.unmatched_materials.length > 0 && (
        <p className="warning" role="status">
          来源待补充 / 未关联：{node.unmatched_materials.join('；')}
        </p>
      )}
    </article>
  )
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
    node.estimated_hours ?? '',
  )
  const [resourceCodes, setResourceCodes] = useState<Iterable<string>>(
    new Set(node.resource_codes ?? []),
  )
  const [standardTargets, setStandardTargets] = useState<
    Partial<Record<JobLevel, number | null>>
  >(node.standard_target_overrides ?? {})
  const [standardTargetNotice, setStandardTargetNotice] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const isL3 = node.nodeType === 'L3'

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    setSaving(true)
    setError('')
    const body: Record<string, unknown> = {
      name,
      enabled,
      p4_description: p4 || null,
      p5_description: p5 || null,
      p6_description: p6 || null,
      p7_description: p7 || null,
      p8_description: p8 || null,
    }
    if (isL3) {
      body.recommended_start_level = recommended || null
      body.materials_text = materialsText
      body.expected_output = expectedOutput || null
      body.estimated_hours = estimatedHours || null
      body.resource_codes = Array.from(resourceCodes)
      body.standard_target_overrides = standardTargets
    }
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

  function updateStandardTarget(level: JobLevel, value: string) {
    setStandardTargets((current) => {
      const next = { ...current }
      if (value === '__default__') delete next[level]
      else next[level] = value === '__na__' ? null : Number(value)
      return next
    })
  }

  function updateRecommended(value: string) {
    setRecommended(value)
    const earliest = earliestJobLevel(value)
    const removedLevels = JOB_LEVELS.filter(
      (level) =>
        earliest !== null &&
        Number(level.slice(1)) < earliest &&
        Object.prototype.hasOwnProperty.call(standardTargets, level),
    )
    if (removedLevels.length === 0) {
      setStandardTargetNotice('')
      return
    }
    setStandardTargets((current) => {
      const next = { ...current }
      for (const level of removedLevels) delete next[level]
      return next
    })
    setStandardTargetNotice(`已移除不适用的覆盖项：${removedLevels.join('、')}`)
  }

  return (
    <form className="edit-form" onSubmit={handleSubmit}>
      <h3>
        编辑 {node.code} ({node.nodeType})
      </h3>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {textField('名称', name, setName, { required: true })}
      <label className="checkbox">
        <input
          type="checkbox"
          checked={enabled}
          onChange={(event) => setEnabled(event.target.checked)}
        />
        启用
      </label>
      {textField('P4 描述', p4, setP4)}
      {textField('P5 描述', p5, setP5)}
      {textField('P6 描述', p6, setP6)}
      {textField('P7 描述', p7, setP7)}
      {textField('P8 描述', p8, setP8)}
      {isL3 && (
        <>
          {textField('建议起始等级', recommended, updateRecommended)}
          {standardTargetNotice && (
            <p className="warning" role="status">
              {standardTargetNotice}
            </p>
          )}
          <fieldset className="link-set">
            <legend>P4–P8 标准目标覆盖</legend>
            <p className="muted">
              未设置时使用默认映射；不适用与使用默认是不同状态。
            </p>
            {JOB_LEVELS.map((level) => {
              const earliest = earliestJobLevel(recommended)
              const disabled =
                earliest === null || Number(level.slice(1)) < earliest
              const configured = Object.prototype.hasOwnProperty.call(
                standardTargets,
                level,
              )
              const value = !configured
                ? '__default__'
                : standardTargets[level] === null
                  ? '__na__'
                  : String(standardTargets[level])
              return (
                <label key={level}>
                  {level} 标准目标
                  <select
                    aria-label={`${level} 标准目标`}
                    value={value}
                    disabled={disabled}
                    onChange={(event) =>
                      updateStandardTarget(level, event.target.value)
                    }
                  >
                    <option value="__default__">使用默认</option>
                    {[1, 2, 3, 4, 5].map((target) => (
                      <option key={target} value={target}>
                        {target}
                      </option>
                    ))}
                    <option value="__na__">不适用</option>
                  </select>
                </label>
              )
            })}
          </fieldset>
          {textField('原始学习材料', materialsText, setMaterialsText)}
          {textField('预期输出', expectedOutput, setExpectedOutput)}
          {textField('预计时长', estimatedHours, setEstimatedHours)}
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
        <button type="submit" disabled={saving}>
          保存
        </button>
        <button type="button" onClick={onClose} disabled={saving}>
          取消
        </button>
      </div>
    </form>
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
        <legend>关联 L3</legend>
        {l3Nodes.map((node) => (
          <label className="checkbox" key={node.code}>
            <input
              type="checkbox"
              checked={new Set(l3Codes).has(node.code)}
              onChange={() => toggleL3(node.code)}
            />
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

export function CapabilityModelPage() {
  const {
    data: model,
    error,
    refresh: refreshModel,
  } = useCatalog<CapabilityModel>('/api/capability-model')
  const { data: resources } = useCatalog<Resource[]>('/api/learning-resources')
  const { isLeader } = useMe()
  const targetCode = window.location.hash.slice(1)
  const [editingNode, setEditingNode] = useState<EditableNode | null>(null)

  useEffect(() => {
    if (model && targetCode)
      document.getElementById(targetCode)?.scrollIntoView?.()
  }, [model, targetCode])

  function startEdit(node: EditableNode) {
    setEditingNode(node)
  }

  return (
    <section className="page">
      <header>
        <p className="eyebrow">查看团队能力等级与能力项标准</p>
        <h1>能力地图</h1>
        {model && (
          <p className="muted">
            {model.code} · {model.version}
          </p>
        )}
      </header>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {!model && !error && <p className="muted">正在加载能力模型…</p>}
      <div className="catalog-tree">
        {enabledDomains(model).map((domain) => (
          <details key={domain.code} open>
            <summary>
              {domain.code} · {domain.name}
              {isLeader && (
                <button
                  type="button"
                  className="inline-edit"
                  onClick={() =>
                    startEdit({
                      code: domain.code,
                      nodeType: 'L1',
                      name: domain.name,
                      enabled: true,
                      p4_description: domain.p4_description,
                      p5_description: domain.p5_description,
                      p6_description: domain.p6_description,
                      p7_description: domain.p7_description,
                      p8_description: domain.p8_description,
                    })
                  }
                >
                  编辑
                </button>
              )}
            </summary>
            <dl className="level-descriptions">
              {(['p4', 'p5', 'p6', 'p7', 'p8'] as const).map((level) => (
                <div key={level}>
                  <dt>{level.toUpperCase()}</dt>
                  <dd>{domain[`${level}_description`] ?? '未提供'}</dd>
                </div>
              ))}
            </dl>
            {domain.children.map((l2) => (
              <details
                className="l2-node"
                key={l2.code}
                open={l2.children.some((l3) => l3.code === targetCode)}
              >
                <summary>
                  {l2.code} · {l2.name}
                  {isLeader && (
                    <button
                      type="button"
                      className="inline-edit"
                      onClick={() =>
                        startEdit({
                          code: l2.code,
                          nodeType: 'L2',
                          name: l2.name,
                          enabled: true,
                          p4_description: l2.p4_description,
                          p5_description: l2.p5_description,
                          p6_description: l2.p6_description,
                          p7_description: l2.p7_description,
                          p8_description: l2.p8_description,
                        })
                      }
                    >
                      编辑
                    </button>
                  )}
                </summary>
                {l2.children.map((l3) => (
                  <div key={l3.code} className="l3-wrapper">
                    <L3Details node={l3} />
                    {isLeader && (
                      <button
                        type="button"
                        className="inline-edit"
                        onClick={() =>
                          startEdit({
                            code: l3.code,
                            nodeType: 'L3',
                            name: l3.name,
                            enabled: true,
                            p4_description: l3.p4_description,
                            p5_description: l3.p5_description,
                            p6_description: l3.p6_description,
                            p7_description: l3.p7_description,
                            p8_description: l3.p8_description,
                            recommended_start_level: l3.recommended_start_level,
                            materials_text: l3.materials_text,
                            expected_output: l3.expected_output,
                            estimated_hours: l3.estimated_hours,
                            resource_codes: l3.resources.map(
                              (resource) => resource.material_code,
                            ),
                            standard_target_overrides:
                              l3.standard_target_overrides,
                          })
                        }
                      >
                        编辑节点
                      </button>
                    )}
                  </div>
                ))}
              </details>
            ))}
          </details>
        ))}
      </div>
      {editingNode && (
        <NodeEditForm
          node={editingNode}
          resources={resources ?? []}
          onClose={() => setEditingNode(null)}
          onSaved={() => {
            refreshModel()
            setEditingNode(null)
          }}
        />
      )}
    </section>
  )
}

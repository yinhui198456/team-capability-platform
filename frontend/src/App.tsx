import { useEffect, useState, type FormEvent } from 'react'

import { AnnualPlanPage } from './AnnualPlanPage'
import { BuddyReviewCenter } from './BuddyReviewCenter'
import { AssessmentHistoryPage } from './AssessmentHistoryPage'
import { AssessmentPage } from './AssessmentPage'
import { AssessmentReviewPage } from './AssessmentReviewPage'
import { EvidenceReviewPage } from './EvidenceReviewPage'
import { GapPage } from './GapPage'
import { GrowthGoalPage } from './GrowthGoalPage'
import { LearningTaskPage } from './LearningTaskPage'
import { LoginPage } from './LoginPage'
import { MonthlyReviewPage } from './MonthlyReviewPage'
import { MemberDashboardPage } from './MemberDashboardPage'
import { ProfilePage } from './ProfilePage'
import {
  allL3,
  archiveLearningResource,
  createLearningResource,
  enabledDomains,
  resourcePath,
  updateCapabilityNode,
  updateLearningResource,
  useCatalog,
  useMe,
  type L3Node,
  type CapabilityModel,
  type Resource,
  type ResourceDetail,
} from './catalog'

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
          {textField('建议起始等级', recommended, setRecommended)}
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

function ResourceForm({
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

function CapabilityModelPage() {
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
        <p className="eyebrow">匿名只读目录</p>
        <h1>能力模型</h1>
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

function LearningResourcesPage() {
  const [name, setName] = useState('')
  const [status, setStatus] = useState('')
  const [l3Code, setL3Code] = useState('')
  const [selectedCode, setSelectedCode] = useState('')
  const [creating, setCreating] = useState(false)
  const [editingCode, setEditingCode] = useState('')
  const { data: model } = useCatalog<CapabilityModel>('/api/capability-model')
  const {
    data: resources,
    error,
    refresh: refreshResources,
  } = useCatalog<Resource[]>(resourcePath(name, status, l3Code))
  const {
    data: detail,
    error: detailError,
    refresh: refreshDetail,
  } = useCatalog<ResourceDetail>(
    selectedCode ? `/api/learning-resources/${selectedCode}` : null,
  )
  const { isLeader } = useMe()

  function startCreate() {
    setCreating(true)
    setEditingCode('')
  }

  function startEdit(code: string) {
    setSelectedCode(code)
    setEditingCode(code)
    setCreating(false)
  }

  function handleSaved() {
    refreshResources()
    refreshDetail()
    setCreating(false)
    setEditingCode('')
  }

  function handleArchived() {
    refreshResources()
    refreshDetail()
    setEditingCode('')
    setSelectedCode('')
  }

  return (
    <section className="page">
      <header>
        <p className="eyebrow">匿名只读目录</p>
        <h1>学习资源</h1>
      </header>
      <div className="filters" aria-label="学习资源筛选">
        <label>
          名称
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
        </label>
        <label>
          状态
          <input
            value={status}
            onChange={(event) => setStatus(event.target.value)}
          />
        </label>
        <label>
          L3
          <select
            value={l3Code}
            onChange={(event) => setL3Code(event.target.value)}
          >
            <option value="">全部</option>
            {allL3(model).map((node) => (
              <option key={node.code} value={node.code}>
                {node.code} · {node.name}
              </option>
            ))}
          </select>
        </label>
      </div>
      {isLeader && (
        <div className="leader-bar">
          <button type="button" onClick={startCreate}>
            新建资源
          </button>
        </div>
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {!resources && !error && <p className="muted">正在加载学习资源…</p>}
      <div className="resource-list">
        {(resources ?? []).map((resource) => (
          <article key={resource.material_code}>
            <h2>{resource.name}</h2>
            <p>
              {resource.material_code} · {resource.material_type} ·{' '}
              {resource.status}
            </p>
            <p className="muted">已关联 L3：{resource.l3_count}</p>
            {isLeader && (
              <button
                type="button"
                onClick={() => startEdit(resource.material_code)}
              >
                编辑
              </button>
            )}
          </article>
        ))}
      </div>
      {resources?.length === 0 && <p className="muted">没有匹配的学习资源。</p>}
      <label className="detail-picker">
        资源详情
        <select
          value={selectedCode}
          onChange={(event) => setSelectedCode(event.target.value)}
        >
          <option value="">请选择资源</option>
          {(resources ?? []).map((resource) => (
            <option key={resource.material_code} value={resource.material_code}>
              {resource.material_code} · {resource.name}
            </option>
          ))}
        </select>
      </label>
      {detailError && (
        <p className="error" role="alert">
          {detailError}
        </p>
      )}
      {detail && (
        <article className="resource-detail">
          <h2>
            {detail.material_code} · {detail.name}
          </h2>
          <p>
            {detail.material_type} · {detail.status}
          </p>
          <p>
            <strong>来源：</strong>
            {detail.source_text ?? '未提供'}
          </p>
          <p>
            <strong>用途：</strong>
            {detail.purpose ?? '未提供'}
          </p>
          <h3>关联 L3</h3>
          {detail.l3_nodes.length ? (
            <ul>
              {detail.l3_nodes.map((node) => (
                <li key={node.code}>
                  <a href={`/capability/model#${node.code}`}>
                    {node.code} · {node.name}
                  </a>
                </li>
              ))}
            </ul>
          ) : (
            <p className="muted">暂无关联 L3。</p>
          )}
        </article>
      )}
      {creating && (
        <ResourceForm
          l3Nodes={allL3(model)}
          onClose={() => setCreating(false)}
          onSaved={handleSaved}
        />
      )}
      {editingCode && (
        <ResourceForm
          resource={resources?.find((r) => r.material_code === editingCode)}
          detail={detail}
          l3Nodes={allL3(model)}
          onClose={() => setEditingCode('')}
          onSaved={handleSaved}
          onArchived={handleArchived}
        />
      )}
    </section>
  )
}

export function App() {
  const pathname = window.location.pathname

  if (pathname === '/login') {
    return <LoginPage />
  }

  if (
    pathname !== '/capability/model' &&
    pathname !== '/dashboard/member' &&
    pathname !== '/operations/resources' &&
    pathname !== '/capability/assessment' &&
    pathname !== '/capability/assessment/history' &&
    pathname !== '/capability/gap' &&
    pathname !== '/growth/goals' &&
    pathname !== '/growth/annual-plan' &&
    pathname !== '/growth/tasks' &&
    pathname !== '/growth/profile' &&
    pathname !== '/growth/review/monthly' &&
    pathname !== '/mentoring/assessment-review' &&
    pathname !== '/mentoring/dashboard' &&
    pathname !== '/mentoring/evidence-review'
  ) {
    return (
      <main className="catalog-shell">
        <p>页面不存在</p>
      </main>
    )
  }

  return (
    <main className="catalog-shell">
      <nav aria-label="目录导航">
        <a
          className={pathname === '/dashboard/member' ? 'active' : ''}
          href="/dashboard/member"
        >
          我的成长
        </a>
        <a
          className={pathname === '/mentoring/dashboard' ? 'active' : ''}
          href="/mentoring/dashboard"
        >
          Buddy 审核中心
        </a>
        <a
          className={pathname === '/capability/model' ? 'active' : ''}
          href="/capability/model"
        >
          能力模型
        </a>
        <a
          className={pathname === '/capability/assessment' ? 'active' : ''}
          href="/capability/assessment"
        >
          能力自评
        </a>
        <a
          className={
            pathname === '/capability/assessment/history' ? 'active' : ''
          }
          href="/capability/assessment/history"
        >
          评估历史
        </a>
        <a
          className={pathname === '/capability/gap' ? 'active' : ''}
          href="/capability/gap"
        >
          Gap 分析
        </a>
        <a
          className={pathname === '/growth/goals' ? 'active' : ''}
          href="/growth/goals"
        >
          成长目标
        </a>
        <a
          className={pathname === '/growth/annual-plan' ? 'active' : ''}
          href="/growth/annual-plan"
        >
          年度成长计划
        </a>
        <a
          className={pathname === '/growth/tasks' ? 'active' : ''}
          href="/growth/tasks"
        >
          学习任务
        </a>
        <a
          className={pathname === '/growth/profile' ? 'active' : ''}
          href="/growth/profile"
        >
          成长档案
        </a>
        <a
          className={pathname === '/growth/review/monthly' ? 'active' : ''}
          href="/growth/review/monthly"
        >
          月度复盘
        </a>
        <a
          className={
            pathname === '/mentoring/assessment-review' ? 'active' : ''
          }
          href="/mentoring/assessment-review"
        >
          自评复核
        </a>
        <a
          className={pathname === '/mentoring/evidence-review' ? 'active' : ''}
          href="/mentoring/evidence-review"
        >
          Evidence Review
        </a>
        <a
          className={pathname === '/operations/resources' ? 'active' : ''}
          href="/operations/resources"
        >
          学习资源
        </a>
      </nav>
      {pathname === '/operations/resources' ? (
        <LearningResourcesPage />
      ) : pathname === '/capability/assessment' ? (
        <AssessmentPage />
      ) : pathname === '/capability/assessment/history' ? (
        <AssessmentHistoryPage />
      ) : pathname === '/capability/gap' ? (
        <GapPage />
      ) : pathname === '/growth/goals' ? (
        <GrowthGoalPage />
      ) : pathname === '/growth/annual-plan' ? (
        <AnnualPlanPage />
      ) : pathname === '/growth/tasks' ? (
        <LearningTaskPage />
      ) : pathname === '/growth/profile' ? (
        <ProfilePage />
      ) : pathname === '/growth/review/monthly' ? (
        <MonthlyReviewPage />
      ) : pathname === '/mentoring/assessment-review' ? (
        <AssessmentReviewPage />
      ) : pathname === '/mentoring/dashboard' ? (
        <BuddyReviewCenter />
      ) : pathname === '/mentoring/evidence-review' ? (
        <EvidenceReviewPage />
      ) : pathname === '/dashboard/member' ? (
        <MemberDashboardPage />
      ) : (
        <CapabilityModelPage />
      )}
    </main>
  )
}

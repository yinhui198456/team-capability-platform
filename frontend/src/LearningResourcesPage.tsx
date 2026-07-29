import { useState } from 'react'

import { ResourceForm } from './CapabilityModelPage'
import {
  allL3WithContext,
  resourcePath,
  useCatalog,
  useMe,
  type CapabilityModel,
  type Resource,
  type ResourceDetail,
} from './catalog'

export function LearningResourcesPage() {
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
          三级达成路径
          <select
            value={l3Code}
            onChange={(event) => setL3Code(event.target.value)}
          >
            <option value="">全部</option>
            {allL3WithContext(model).map((node) => (
              <option key={node.code} value={node.code}>
                {node.l2_code} · {node.l2_name} → {node.code} · {node.name}
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
            <p className="muted">已关联三级达成路径：{resource.l3_count}</p>
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
          <h3>关联三级达成路径</h3>
          {detail.l3_nodes.length ? (
            <ul>
              {detail.l3_nodes.map((node) => (
                <li key={node.code}>
                  <a href={`/capability/model#${node.code}`}>
                    {node.l2_code} · {node.l2_name} → {node.code} · {node.name}
                  </a>
                </li>
              ))}
            </ul>
          ) : (
            <p className="muted">暂无关联三级达成路径。</p>
          )}
        </article>
      )}
      {creating && (
        <ResourceForm
          l3Nodes={allL3WithContext(model)}
          onClose={() => setCreating(false)}
          onSaved={handleSaved}
        />
      )}
      {editingCode && (
        <ResourceForm
          resource={resources?.find((r) => r.material_code === editingCode)}
          detail={detail}
          l3Nodes={allL3WithContext(model)}
          onClose={() => setEditingCode('')}
          onSaved={handleSaved}
          onArchived={handleArchived}
        />
      )}
    </section>
  )
}

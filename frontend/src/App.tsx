import { useEffect, useState } from 'react'

import {
  allL3,
  enabledDomains,
  resourcePath,
  useCatalog,
  type L3Node,
  type CapabilityModel,
  type Resource,
  type ResourceDetail,
} from './catalog'

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

function CapabilityModelPage() {
  const { data: model, error } = useCatalog<CapabilityModel>(
    '/api/capability-model',
  )
  const targetCode = window.location.hash.slice(1)

  useEffect(() => {
    if (model && targetCode)
      document.getElementById(targetCode)?.scrollIntoView?.()
  }, [model, targetCode])

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
                </summary>
                {l2.children.map((l3) => (
                  <L3Details key={l3.code} node={l3} />
                ))}
              </details>
            ))}
          </details>
        ))}
      </div>
    </section>
  )
}

function LearningResourcesPage() {
  const [name, setName] = useState('')
  const [status, setStatus] = useState('')
  const [l3Code, setL3Code] = useState('')
  const [selectedCode, setSelectedCode] = useState('')
  const { data: model } = useCatalog<CapabilityModel>('/api/capability-model')
  const { data: resources, error } = useCatalog<Resource[]>(
    resourcePath(name, status, l3Code),
  )
  const { data: detail, error: detailError } = useCatalog<ResourceDetail>(
    selectedCode ? `/api/learning-resources/${selectedCode}` : null,
  )

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
    </section>
  )
}

export function App() {
  const pathname = window.location.pathname

  if (
    pathname !== '/capability/model' &&
    pathname !== '/operations/resources'
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
          className={pathname === '/capability/model' ? 'active' : ''}
          href="/capability/model"
        >
          能力模型
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
      ) : (
        <CapabilityModelPage />
      )}
    </main>
  )
}

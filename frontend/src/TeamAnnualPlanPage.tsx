import { useEffect, useState, type FormEvent } from 'react'

import {
  enabledDomains,
  useCatalog,
  useMe,
  type CapabilityModel,
} from './catalog'
import {
  archiveTeamAnnualPlan,
  getTeamAnnualPlan,
  publishTeamAnnualPlan,
  updateTeamAnnualPlan,
  type TeamAnnualCapabilityPlan,
  type TeamAnnualPlanSave,
} from './planning'

export function TeamAnnualPlanPage() {
  const currentYear = new Date().getFullYear()
  const [year, setYear] = useState(currentYear)
  const { user, isLeader } = useMe()
  const { data: model } = useCatalog<CapabilityModel>('/api/capability-model')
  const domains = enabledDomains(model)

  const [plan, setPlan] = useState<TeamAnnualCapabilityPlan | null>(null)
  const [focusDomains, setFocusDomains] = useState<Set<string>>(new Set())
  const [resourceArrangement, setResourceArrangement] = useState('')
  const [description, setDescription] = useState('')
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [archiving, setArchiving] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')

  async function load() {
    if (!isLeader) return
    setLoading(true)
    setError('')
    try {
      const result = await getTeamAnnualPlan(year)
      setPlan(result)
      setFocusDomains(new Set(result?.focus_domains ?? []))
      setResourceArrangement(result?.resource_arrangement ?? '')
      setDescription(result?.description ?? '')
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载失败')
      setPlan(null)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [year, isLeader])

  function toggleDomain(code: string) {
    if (!isLeader || plan?.status === '已归档') return
    const next = new Set(focusDomains)
    if (next.has(code)) next.delete(code)
    else next.add(code)
    setFocusDomains(next)
  }

  async function save(
    action: (body: TeamAnnualPlanSave) => Promise<TeamAnnualCapabilityPlan>,
    label: string,
  ) {
    setSaving(true)
    setError('')
    setSuccess('')
    try {
      const body: TeamAnnualPlanSave = {
        year,
        focus_domain_codes: Array.from(focusDomains),
        resource_arrangement: resourceArrangement,
        description,
      }
      const result = await action(body)
      setPlan(result)
      setFocusDomains(new Set(result.focus_domains))
      setResourceArrangement(result.resource_arrangement ?? '')
      setDescription(result.description ?? '')
      setSuccess(`${label}成功`)
    } catch (err) {
      setError(err instanceof Error ? err.message : `${label}失败`)
    } finally {
      setSaving(false)
    }
  }

  async function handlePublish(event: FormEvent) {
    event.preventDefault()
    await save(publishTeamAnnualPlan, '发布')
  }

  async function handleUpdate(event: FormEvent) {
    event.preventDefault()
    await save(updateTeamAnnualPlan, '更新')
  }

  async function handleArchive() {
    setArchiving(true)
    setError('')
    setSuccess('')
    try {
      await archiveTeamAnnualPlan(year)
      setSuccess('归档成功')
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : '归档失败')
    } finally {
      setArchiving(false)
    }
  }

  const readOnly = !isLeader || plan?.status === '已归档'
  const canManage = isLeader && plan?.status !== '已归档'

  return (
    <section className="page">
      <header className="page-heading">
        <div>
          <p className="eyebrow">团队运营 · 团队</p>
          <h1>团队年度能力规划</h1>
        </div>
        {isLeader && (
          <button
            type="button"
            onClick={load}
            disabled={loading}
            aria-busy={loading}
          >
            {loading ? '刷新中…' : '刷新'}
          </button>
        )}
      </header>

      {!user && <p className="muted">正在加载用户信息…</p>}
      {user && !isLeader && (
        <p className="muted">无权限，仅 Leader 可管理团队年度能力规划。</p>
      )}

      {isLeader && error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {isLeader && success && (
        <p className="warning" role="status">
          {success}
        </p>
      )}

      {isLeader && loading && !plan && (
        <p className="muted">正在加载团队年度能力规划…</p>
      )}

      {isLeader && (
        <form className="plan-overview" onSubmit={handlePublish}>
          <label>
            年度
            <input
              type="number"
              value={year}
              onChange={(event) => {
                const value = parseInt(event.target.value, 10)
                if (!Number.isNaN(value)) setYear(value)
              }}
              readOnly={readOnly}
            />
          </label>

          <fieldset className="link-set">
            <legend>重点能力域</legend>
            {domains.map((domain) => (
              <label className="checkbox" key={domain.code}>
                <input
                  type="checkbox"
                  checked={focusDomains.has(domain.code)}
                  onChange={() => toggleDomain(domain.code)}
                  readOnly={readOnly}
                />
                {domain.code} · {domain.name}
              </label>
            ))}
            {domains.length === 0 && <p className="muted">暂无可用能力域。</p>}
          </fieldset>

          <label>
            资源安排
            <input
              value={resourceArrangement}
              onChange={(event) => setResourceArrangement(event.target.value)}
              readOnly={readOnly}
            />
          </label>

          <label>
            说明
            <input
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              readOnly={readOnly}
            />
          </label>

          {plan && (
            <div className="plan-summary">
              <p>
                规划编码：{plan.code} · 年度：{plan.year} · 状态：{plan.status}
              </p>
              <p>
                重点能力域：
                {plan.focus_domains.length
                  ? plan.focus_domains.join('、')
                  : '未设置'}
              </p>
            </div>
          )}
          {!plan && !loading && (
            <p className="muted">当前年度尚未发布团队能力规划。</p>
          )}

          {canManage && (
            <div className="form-actions">
              {!plan ? (
                <button type="submit" disabled={saving} aria-busy={saving}>
                  {saving ? '发布中…' : '发布'}
                </button>
              ) : (
                <>
                  <button
                    type="button"
                    onClick={handleUpdate}
                    disabled={saving}
                    aria-busy={saving}
                  >
                    {saving ? '保存中…' : '更新'}
                  </button>
                  <button
                    type="button"
                    className="archive-button"
                    onClick={handleArchive}
                    disabled={archiving}
                    aria-busy={archiving}
                  >
                    {archiving ? '归档中…' : '归档'}
                  </button>
                </>
              )}
            </div>
          )}
        </form>
      )}
    </section>
  )
}

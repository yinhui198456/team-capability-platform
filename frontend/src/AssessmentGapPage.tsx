import { useEffect, useMemo, useState } from 'react'
import s from './AssessmentGapPage.module.css'
import { useYear } from './YearContext'
import {
  type Assessment,
  type AssessmentDetail,
  createAssessment,
  getAssessment,
  listAssessments,
  saveDraft,
  submitAssessment,
} from './assessment'
import { mockAssessment, mockAssessmentSubmitted, isMockEnabled } from './__fixtures__/assessmentMock'

const LEVELS = [1, 2, 3, 4, 5]

function levelSelect(value: number | null, onChange: (v: number | null) => void, disabled: boolean) {
  return (
    <select value={value ?? ''} onChange={e => onChange(e.target.value ? +e.target.value : null)} disabled={disabled}>
      <option value="">请选择</option>
      {LEVELS.map(l => <option key={l} value={l}>{l}</option>)}
    </select>
  )
}

const LEVEL_HELP = 'P4–P8 为岗位等级要求，1–5 为能力项掌握度（1=入门, 3=独立, 5=专家）。建议起始等级来自能力模型，仅供参考。'
const DOMAIN_LABELS: Record<string, string> = { P01: '数据基础设施', P02: 'AI Infra / Agent', P03: '工程编码', C01: '基本办公能力', C02: '沟通协作', C03: '学习创新' }
function domainLabel(code: string): string { const p = code.split('.')[0]; return DOMAIN_LABELS[p] ? `${p} · ${DOMAIN_LABELS[p]}` : code }
function isFilled(d: AssessmentDetail) { return d.current_level != null && d.target_level != null && (d.evidence_note ?? '').trim().length > 0 }
function unfilledReason(d: AssessmentDetail): '' | '需评估等级' | '需自评依据' {
  const hasLevel = d.current_level != null && d.target_level != null
  const hasEvidence = (d.evidence_note ?? '').trim().length > 0
  if (!hasLevel) return '需评估等级'
  if (!hasEvidence) return '需自评依据'
  return ''
}
function priority(gap: number): '高' | '中' | '低' { return gap >= 3 ? '高' : gap > 0 ? '中' : '低' }

type FilterStatus = '全部' | '未完成' | '有Gap' | '计划候选'

export function AssessmentGapPage() {
  const year = useYear()
  const [assessment, setAssessment] = useState<Assessment | null>(null)
  const [details, setDetails] = useState<AssessmentDetail[]>([])
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [activeDomain, setActiveDomain] = useState('全部')
  const [statusFilter, setStatusFilter] = useState<FilterStatus>('全部')
  const [search, setSearch] = useState('')
  const [editingId, setEditingId] = useState<number | null>(null)
  const [editingText, setEditingText] = useState('')

  useEffect(() => {
    let c = false
    async function init() {
      try {
        if (isMockEnabled()) {
          if (!c) { setAssessment(mockAssessment); setDetails(mockAssessment.details ?? []) }
        } else {
          const list = await listAssessments()
          const draft = list.find(a => a.status === '草稿' || a.status === '建议调整')
          if (draft) {
            const full = await getAssessment(draft.id)
            if (!c) { setAssessment(full); setDetails(full.details ?? []) }
          }
        }
      } catch (err: any) { if (!c) setError(err.message ?? '加载失败') }
      finally { if (!c) setLoading(false) }
    }
    init()
    return () => { c = true }
  }, [])

  async function handleCreate() {
    setError('')
    if (isMockEnabled()) { setAssessment(mockAssessment); setDetails(mockAssessment.details ?? []); return }
    try { const { id } = await createAssessment(year); const full = await getAssessment(id); setAssessment(full); setDetails(full.details ?? []) }
    catch (err: any) { setError(err.message ?? '创建失败') }
  }
  async function handleSave() {
    if (!assessment) return; setError(''); setMessage('')
    if (isMockEnabled()) { setMessage('草稿已保存'); return }
    try { await saveDraft(assessment.id, details); setMessage('草稿已保存') }
    catch (err: any) { setError(err.message ?? '保存失败') }
  }
  async function handleSubmit() {
    if (!assessment) return; setError(''); setMessage('')
    if (isMockEnabled()) { const sub = { ...mockAssessmentSubmitted, details }; setAssessment(sub); setDetails(details); setMessage('已提交，Gap 即时生成。等待 Buddy 复核。'); return }
    try { await submitAssessment(assessment.id); const full = await getAssessment(assessment.id); setAssessment(full); setDetails(full.details ?? []); setMessage('已提交，Gap 即时生成。等待 Buddy 复核。') }
    catch (err: any) { setError(err.message ?? '提交失败') }
  }

  function updateDetail(index: number, patch: Partial<AssessmentDetail>) {
    setDetails(prev => prev.map((item, i) => i === index ? { ...item, ...patch } : item))
  }
  function startEdit(id: number | undefined, text: string) { setEditingId(id ?? null); setEditingText(text) }
  function commitEdit(index: number) { updateDetail(index, { evidence_note: editingText }); setEditingId(null) }

  // Derived state
  const isEditable = assessment?.status === '草稿' || assessment?.status === '建议调整'
  const filled = useMemo(() => details.filter(isFilled).length, [details])
  const unfilled = useMemo(() => details.length - filled, [details])
  const reviewLabel = assessment?.status === '已复核' || assessment?.status === '已归档' ? '认可闭环' : assessment?.status === '建议调整' ? '建议调整' : assessment?.status === '待复核' ? '待 Buddy 复核' : '尚未提交'
  const canPlan = assessment?.status === '已复核' || assessment?.status === '已归档'

  // Filter + group
  const filtered = useMemo(() => {
    let list = details
    if (activeDomain !== '全部') list = list.filter(d => (d.l1_code ?? d.l3_code.split('.')[0]) === activeDomain)
    if (statusFilter === '未完成') list = list.filter(d => !isFilled(d))
    if (statusFilter === '有Gap') list = list.filter(d => d.current_level != null && d.target_level != null && d.target_level - d.current_level > 0)
    if (statusFilter === '计划候选') list = list.filter(d => d.plan_candidate)
    if (search.trim()) { const q = search.trim().toLowerCase(); list = list.filter(d => d.l3_code.toLowerCase().includes(q) || (d.l3_name ?? '').includes(q)) }
    return list
  }, [details, activeDomain, statusFilter, search])

  const grouped = useMemo(() => {
    const m = new Map<string, AssessmentDetail[]>()
    for (const d of filtered) { const k = d.l1_code ?? d.l3_code.split('.')[0]; if (!m.has(k)) m.set(k, []); m.get(k)!.push(d) }
    return [...m.entries()]
  }, [filtered])

  // Locate next unfilled
  function locateNextUnfilled() {
    setStatusFilter('全部'); setActiveDomain('全部'); setSearch('')
    const idx = details.findIndex(d => !isFilled(d))
    if (idx < 0) return
    const item = details[idx]
    const l1 = item.l1_code ?? item.l3_code.split('.')[0]
    setActiveDomain(l1)
    setTimeout(() => { const el = document.getElementById(`row-${item.id}`); el?.scrollIntoView({ behavior: 'smooth', block: 'center' }) }, 100)
  }

  const gs = assessment?.gap_summary

  if (loading) return <p className="muted">加载中…</p>
  if (!assessment) return (
    <section className="page"><h1>能力自评与 Gap 分析</h1><p>当前年度暂无草稿。</p><button onClick={handleCreate}>创建年度自评草稿</button>{error && <p className="error">{error}</p>}</section>
  )

  return (
    <section className="page">
      <header className="page-heading">
        <div><p className="eyebrow">能力成长 / 能力自评与 Gap</p><h1>能力自评与 Gap 分析</h1><p className="muted">{assessment.year} 年度 · 版本 {assessment.version} · {assessment.status}</p></div>
        <div className="assessment-actions">
          {isEditable && <button onClick={handleSave}>保存草稿</button>}
          {isEditable && <button className="primary" onClick={handleSubmit} disabled={unfilled > 0}>提交自评</button>}
          <a href="/capability/assessment/history">查看评估历史</a>
        </div>
      </header>

      <section className="assessment-summary" aria-label="评估摘要">
        <div><span>评估进度</span><strong>{filled} / {details.length}</strong></div>
        <div><span>未完成</span><strong>{unfilled}</strong></div>
        <div><span>最新 Review</span><strong>{reviewLabel}</strong></div>
      </section>
      {!canPlan && <p className={s.planGateWarning}>Review 认可闭环后才可正式纳入年度计划。当前状态：{reviewLabel}。</p>}
      {isEditable && unfilled > 0 && <p className={s.submitWarning}>还有 {unfilled} 项未完成，请完成全部自评后再提交。</p>}
      {message && <p className="success">{message}</p>}
      {error && <p className="error">{error}</p>}

      {/* Toolbar */}
      {isEditable && (
        <div className={s.toolbar}>
          <div className={s.toolbarGroup}>
            <select aria-label="能力域筛选" value={activeDomain} onChange={e => setActiveDomain(e.target.value)}>
              <option value="全部">全部能力域</option>
              {['P01','P02','P03','C01','C02','C03'].map(c => <option key={c} value={c}>{domainLabel(c)}</option>)}
            </select>
            <select aria-label="状态筛选" value={statusFilter} onChange={e => setStatusFilter(e.target.value as FilterStatus)}>
              <option value="全部">全部状态</option>
              <option value="未完成">未完成</option>
              <option value="有Gap">有 Gap</option>
              <option value="计划候选">计划候选</option>
            </select>
            <input className={s.searchBox} placeholder="搜索 L3 编号/名称" aria-label="搜索能力项" value={search} onChange={e => setSearch(e.target.value)} />
            <button className={s.locateBtn} onClick={locateNextUnfilled}>定位未填写项</button>
          </div>
          <div className={s.levelHelp}>{LEVEL_HELP}</div>
        </div>
      )}

      {/* Main layout */}
      <div className={s.layout}>
        <div>
          {grouped.map(([code, items]) => (
            <div className={s.domainGroup} key={code}>
              <div className={s.domainHeader} onClick={() => setActiveDomain(code === activeDomain ? '全部' : code)} role="button" tabIndex={0} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setActiveDomain(code === activeDomain ? '全部' : code) } }} aria-expanded={activeDomain === '全部' || activeDomain === code}>
                <span className={s.domainLabel}>{code === activeDomain ? '▾' : '▸'} {domainLabel(code)}</span>
                <span className={s.domainProgress}>{items.filter(isFilled).length}/{items.length} 项</span>
              </div>
              <table className={s.table}>
                <thead><tr><th>L3 能力项</th><th>建议起始</th><th>当前 (1-5)</th><th>目标 (1-5)</th><th>Gap</th><th>优先级</th><th style={{width:'80px'}}>计划候选</th><th style={{width:'30px'}}></th></tr></thead>
                <tbody>
                  {items.map(d => {
                    const gIdx = details.indexOf(d)
                    const hasLevels = d.current_level != null && d.target_level != null
                    const gap = hasLevels ? Math.max(d.target_level! - d.current_level!, 0) : null
                    const pri = hasLevels ? priority(gap!) : null
                    const filled = isFilled(d)
                    const reason = unfilledReason(d)
                    const rowCls = `${filled ? s.rowFilled : s.rowEmpty} ${gap != null && gap > 0 ? s.rowGap : ''}`
                    const gapCls = gap == null ? '' : gap >= 3 ? s.gapHigh : gap > 0 ? s.gapMedium : s.gapLow
                    const priCls = pri === '高' ? s.priorityHigh : pri === '中' ? s.priorityMedium : pri === '低' ? s.priorityLow : ''
                    return (<>
                      <tr className={rowCls} key={d.id} id={`row-${d.id}`}>
                        <td><span className={s.code}>{d.l3_code}</span><span className={s.l3name}>{d.l3_name ?? ''}</span>{!filled && reason && <span className={s.reasonTag}>{reason}</span>}</td>
                        <td><span className={s.recommend}>{d.recommended_start_level ?? '—'}</span></td>
                        <td>{levelSelect(d.current_level, v => updateDetail(gIdx, { current_level: v }), !isEditable)}</td>
                        <td>{levelSelect(d.target_level, v => updateDetail(gIdx, { target_level: v }), !isEditable)}</td>
                        <td className={s.gapCell}><span className={gapCls}>{gap != null ? gap : '—'}</span></td>
                        <td><span className={`${s.pill} ${priCls}`}>{pri ?? '未评估'}</span></td>
                        <td><input type="checkbox" checked={d.plan_candidate ?? false} onChange={e => updateDetail(gIdx, { plan_candidate: e.target.checked })} disabled={!isEditable} /></td>
                        <td>{isEditable && <button className={s.inlineBtn} onClick={() => startEdit(d.id, d.evidence_note ?? '')} title="编辑自评依据">{filled ? '✎' : '+'}</button>}</td>
                      </tr>
                      {editingId === d.id && isEditable && (
                        <tr className={s.evidenceRow} key={`ev-${d.id}`}>
                          <td colSpan={8}>
                            <div className={s.evidenceEditor}>
                              <textarea value={editingText} onChange={e => setEditingText(e.target.value)} placeholder="自评依据…" autoFocus />
                              <div className={s.evidenceActions}>
                                <button onClick={() => { commitEdit(gIdx) }}>确认</button>
                                <button onClick={() => setEditingId(null)}>取消</button>
                              </div>
                            </div>
                          </td>
                        </tr>
                      )}
                    </>)
                  })}
                </tbody>
              </table>
            </div>
          ))}
          {grouped.length === 0 && <p className="muted">当前筛选条件下无匹配能力项。</p>}
        </div>

        {/* Gap sidebar */}
        {gs && (
          <aside className={s.gapSidebar}>
            <h2>本次评估整体 Gap</h2>
            <dl>
              <div className={s.gapStat}><dt>Gap 总数</dt><dd>{gs.total_gaps}</dd></div>
              <div className={s.gapStat}><dt>平均 Gap</dt><dd>{gs.avg_gap}</dd></div>
            </dl>
            <div className={s.gapBars}>
              <div className={s.gapBar}><span>高 ({gs.high_priority})</span></div>
              <div className={`${s.gapBarFill} ${s.fillHigh}`} style={{ width: `${gs.total_gaps ? (gs.high_priority / gs.total_gaps) * 100 : 0}%` }} />
              <div className={s.gapBar}><span>中 ({gs.medium_priority})</span></div>
              <div className={`${s.gapBarFill} ${s.fillMedium}`} style={{ width: `${gs.total_gaps ? (gs.medium_priority / gs.total_gaps) * 100 : 0}%` }} />
              <div className={s.gapBar}><span>低 ({gs.low_priority})</span></div>
              <div className={`${s.gapBarFill} ${s.fillLow}`} style={{ width: `${gs.total_gaps ? (gs.low_priority / gs.total_gaps) * 100 : 0}%` }} />
            </div>
            {!canPlan && <p className={s.submitWarning}>Review 认可闭环后才可正式纳入年度计划。</p>}
            {canPlan && <a href="/growth/goals" style={{ marginTop: 'var(--space-3)', display: 'block' }}>前往成长目标，纳入年度计划</a>}
          </aside>
        )}
      </div>

    </section>
  )
}

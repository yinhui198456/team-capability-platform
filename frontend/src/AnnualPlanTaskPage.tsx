import { useEffect, useState } from 'react'
import {
  formatEstimatedHours,
  formatEstimatedHoursSummary,
} from './estimatedHours'
import s from './AnnualPlanTaskPage.module.css'
import { useYear } from './YearContext'
import {
  formatCapabilityPath,
  getAnnualPlan,
  generatePlanItems,
  type AnnualPlan,
  type Evidence,
  type LearningTask,
} from './planning'
import {
  mockPlan,
  mockTasks,
  mockLogs,
  mockEvidences,
  isMockEnabled,
} from './__fixtures__/annualPlanMock'

const MONTHS = Array.from({ length: 12 }, (_, i) => i + 1)
const STATUS_LABELS: Record<string, string> = {
  未开始: '未开始',
  进行中: '进行中',
  已完成: '已完成',
  延期: '延期',
  暂停: '暂停',
  取消: '取消',
}

type LearningLog = {
  id: number
  record_date: string
  actual_hours: number
  note?: string | null
}

type TaskDetail = {
  task: LearningTask
  logs: LearningLog[]
  evidences: Evidence[]
}

function statusClass(st: string) {
  return st === '已完成'
    ? s.statusDone
    : st === '延期'
      ? s.statusOverdue
      : st === '进行中'
        ? s.statusActive
        : s.statusTodo
}

function evBadge(ev: Evidence) {
  if (!ev) return null
  const cls =
    ev.status === '通过'
      ? s.evidencePass
      : ev.status === '待 Review'
        ? s.evidencePending
        : s.evidenceNeedMore
  return <span className={`${s.evidenceBadge} ${cls}`}>{ev.status}</span>
}

export function AnnualPlanTaskPage() {
  const year = useYear()
  const [plan, setPlan] = useState<AnnualPlan | null>(null)
  const [tasks, setTasks] = useState<Record<number, TaskDetail>>({})
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [selectedMonth, setSelectedMonth] = useState<number | null>(null)
  const [expandedId, setExpandedId] = useState<number | null>(null)
  const [generating, setGenerating] = useState(false)

  useEffect(() => {
    let c = false
    async function load() {
      try {
        if (isMockEnabled()) {
          if (!c) {
            setPlan(mockPlan)
            const tm: Record<number, TaskDetail> = {}
            for (const t of Object.values(mockTasks)) {
              tm[t.plan_item_id] = {
                task: t,
                logs: mockLogs[t.id] ?? [],
                evidences: mockEvidences[t.id] ?? [],
              }
            }
            setTasks(tm)
          }
        } else {
          const p = await getAnnualPlan(year)
          if (!c) setPlan(p)
        }
      } catch (err: unknown) {
        if (!c) setError(err instanceof Error ? err.message : '加载失败')
      } finally {
        if (!c) setLoading(false)
      }
    }
    load()
    return () => {
      c = true
    }
  }, [year])

  async function handleGenerate() {
    setError('')
    setGenerating(true)
    try {
      await generatePlanItems()
      const p = await getAnnualPlan(year)
      setPlan(p)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : '生成失败')
    } finally {
      setGenerating(false)
    }
  }

  const items = plan?.items ?? []
  const visibleItems = selectedMonth
    ? items.filter((i) => i.target_month === selectedMonth)
    : items
  const totalEstimated = formatEstimatedHoursSummary(
    plan?.estimated_hours_summary,
  )
  const hasUnparsedHours = plan?.estimated_hours_summary?.has_unparsed ?? false
  const totalActual = Object.values(tasks).reduce(
    (sum, t) => sum + (t.task.actual_hours ?? 0),
    0,
  )
  const completed = items.filter((i) => i.status === '已完成').length
  const progress =
    items.length === 0 ? 0 : Math.round((completed / items.length) * 100)

  if (loading) return <p className="muted">加载中…</p>

  return (
    <section className="page">
      <header className="page-heading">
        <div>
          <p className="eyebrow">我的计划 / 年度闭环</p>
          <h1>年度成长计划</h1>
          <p className="muted">
            {year} 年度 · {plan?.plan_cycle ?? 12} 个月周期 ·{' '}
            {plan?.status ?? '制定中'}
          </p>
        </div>
        <div>
          {items.length === 0 && (
            <button
              className="primary"
              onClick={handleGenerate}
              disabled={generating}
            >
              {generating ? '生成中…' : '生成计划项'}
            </button>
          )}
          <a
            href="/growth/review/monthly"
            style={{ marginLeft: 'var(--space-3)' }}
          >
            查看月度复盘
          </a>
        </div>
      </header>
      {error && <p className="error">{error}</p>}

      {/* Summary cards */}
      <dl className={s.summary} data-testid="plan-summary">
        <div className={s.summaryCard}>
          <dt>总体进度</dt>
          <dd>{progress}%</dd>
          <div className={s.progressBar}>
            <div className={s.progressFill} style={{ width: `${progress}%` }} />
          </div>
        </div>
        <div className={s.summaryCard}>
          <dt>预计时长</dt>
          <dd>
            {totalEstimated}
            {hasUnparsedHours && '（部分计划项耗时为文本，未计入汇总）'}
          </dd>
        </div>
        <div className={s.summaryCard}>
          <dt>实际时长</dt>
          <dd>{totalActual} h</dd>
        </div>
        <div className={s.summaryCard}>
          <dt>已完成</dt>
          <dd>
            {completed}/{items.length}
          </dd>
        </div>
      </dl>

      {/* Monthly timeline */}
      <div className={s.timeline} data-testid="month-timeline">
        {MONTHS.map((m) => {
          const count = items.filter((i) => i.target_month === m).length
          return (
            <button
              key={m}
              className={`${s.timelineBtn} ${selectedMonth === m ? s.timelineBtnActive : ''}`}
              onClick={() => setSelectedMonth(selectedMonth === m ? null : m)}
              aria-pressed={selectedMonth === m}
            >
              <span className={s.timelineBtnMonth}>{m} 月</span>
              <span className={s.timelineBtnCount}>{count} 项</span>
            </button>
          )
        })}
      </div>

      {/* Plan items */}
      <div className={s.planList}>
        <div
          className={`${s.planHeader} ${s.planHeaderLabel}`}
          style={{
            cursor: 'default',
            borderBottom: '2px solid var(--color-gray-200)',
          }}
        >
          <strong>二级能力标准 → 三级达成路径</strong>
          <strong>掌握度提升</strong>
          <strong>计划时长</strong>
          <strong>实际时长</strong>
          <strong>月份</strong>
          <strong>状态</strong>
          <span />
        </div>
        {visibleItems.length === 0 && (
          <p className="muted">
            {selectedMonth
              ? `${selectedMonth} 月暂无计划项`
              : '暂无计划项，请先生成年度计划。'}
          </p>
        )}
        {visibleItems.map((item) => {
          const td = tasks[item.id]
          const isExpanded = expandedId === item.id
          const st = item.status
          return (
            <div className={s.planItem} key={item.id} data-testid="plan-item">
              <div
                className={s.planHeader}
                data-testid="plan-header"
                onClick={() => setExpandedId(isExpanded ? null : item.id)}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    setExpandedId(isExpanded ? null : item.id)
                  }
                }}
              >
                <div>
                  <span className={s.l3name}>{formatCapabilityPath(item)}</span>
                </div>
                <span>
                  {item.current_level}→{item.target_level}
                </span>
                <span>
                  {formatEstimatedHours(
                    item.estimated_hours,
                    item.estimated_hours_parsed,
                  )}
                </span>
                <span>{td ? td.task.actual_hours : 0} h</span>
                <span>
                  {item.target_month ? `${item.target_month} 月` : '—'}
                </span>
                <span className={`${s.status} ${statusClass(st)}`}>
                  {STATUS_LABELS[st] ?? st}
                </span>
                <span>{isExpanded ? '▾' : '▸'}</span>
              </div>
              {isExpanded && td && (
                <div className={s.taskPanel} data-testid="task-detail-panel">
                  <div className={s.taskGrid}>
                    <div className={s.taskField}>
                      <span>任务状态</span>
                      <strong>{td.task.status}</strong>
                    </div>
                    <div className={s.taskField}>
                      <span>实际耗时</span>
                      <strong>{td.task.actual_hours} h</strong>
                    </div>
                    <div className={s.taskField}>
                      <span>计划开始日期</span>
                      <strong>{item.plan_start_date ?? '—'}</strong>
                    </div>
                    <div className={s.taskField}>
                      <span>计划结束日期</span>
                      <strong>{item.plan_end_date ?? '—'}</strong>
                    </div>
                    <div className={s.taskField}>
                      <span>实际开始日期</span>
                      <strong>{td.task.actual_start_date ?? '—'}</strong>
                    </div>
                    <div className={s.taskField}>
                      <span>完成日期</span>
                      <strong>{td.task.actual_end_date ?? '—'}</strong>
                    </div>
                    <div className={s.taskField}>
                      <span>延期原因</span>
                      <strong>{td.task.delay_reason || '待补充'}</strong>
                    </div>
                    <div className={s.taskField}>
                      <span>下一步行动</span>
                      <strong>{td.task.next_action || '待补充'}</strong>
                    </div>
                    <div
                      className={s.taskField}
                      style={{ gridColumn: '1 / -1' }}
                    >
                      <span>复盘结论</span>
                      <strong>{td.task.review_conclusion || '待补充'}</strong>
                    </div>
                  </div>

                  {/* Evidence */}
                  {td.evidences.length > 0 && (
                    <div className={s.logSection}>
                      <h4>Evidence</h4>
                      {td.evidences.map((ev: Evidence) => (
                        <div key={ev.id} className={s.logItem}>
                          <span className={s.logDate}>
                            v{ev.version_number}
                          </span>
                          <span className={s.logNote}>
                            {ev.content?.slice(0, 60) ?? '—'}
                          </span>
                          {evBadge(ev)}
                          {ev.evidence_link && (
                            <a
                              href={ev.evidence_link}
                              target="_blank"
                              rel="noreferrer"
                              style={{ fontSize: 'var(--text-xs)' }}
                            >
                              链接
                            </a>
                          )}
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Progress logs */}
                  {td.logs.length > 0 && (
                    <div className={s.logSection}>
                      <h4>
                        学习日志 (
                        {td.logs.reduce(
                          (s: number, l: LearningLog) => s + l.actual_hours,
                          0,
                        )}{' '}
                        h)
                      </h4>
                      <ul className={s.logList}>
                        {td.logs.map((log: LearningLog) => (
                          <li key={log.id} className={s.logItem}>
                            <span className={s.logDate}>{log.record_date}</span>
                            <span className={s.logHours}>
                              {log.actual_hours} h
                            </span>
                            <span className={s.logNote}>{log.note ?? ''}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {!td.evidences.length && !td.logs.length && (
                    <p
                      className="muted"
                      style={{ marginTop: 'var(--space-2)' }}
                    >
                      暂无执行记录。前往学习任务页面添加。
                    </p>
                  )}
                  <a
                    href="/growth/tasks"
                    style={{
                      display: 'inline-block',
                      marginTop: 'var(--space-3)',
                      fontSize: 'var(--text-sm)',
                    }}
                  >
                    进入 Evidence 与学习日志
                  </a>
                </div>
              )}
            </div>
          )
        })}
      </div>
    </section>
  )
}

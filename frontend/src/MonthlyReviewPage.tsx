import { useEffect, useState } from 'react'

import { getMonthlyHours, type MonthlyHours } from './planning'

export function MonthlyReviewPage() {
  const [summary, setSummary] = useState<MonthlyHours[]>([])
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setError('')
    getMonthlyHours(2026)
      .then(setSummary)
      .catch((err) => setError(err instanceof Error ? err.message : '加载失败'))
      .finally(() => setLoading(false))
  }, [])

  if (loading) return <p className="muted">加载中…</p>

  return (
    <section className="page">
      <h1>月度复盘</h1>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {summary.length === 0 && (
        <p className="muted">2026 年暂无学习时长记录。</p>
      )}
      <ul className="monthly-hours-list">
        {summary.map((item) => (
          <li key={item.month} className="monthly-hours-item">
            <span className="month">{item.month} 月</span>
            <span className="total-hours">{item.total_hours} 小时</span>
          </li>
        ))}
      </ul>
    </section>
  )
}

import { NavLink, Outlet, useSearchParams, useNavigate } from 'react-router-dom'
import { useMe } from './catalog'
import { useYear, useYearState } from './YearContext'

type NavItem = {
  label: string
  href: string
  roles?: string[]
}

type NavSection = {
  label: string
  items: NavItem[]
}

// Member IA — 5 modules per ChatGPT-confirmed design
const NAV_SECTIONS: NavSection[] = [
  {
    label: '我的工作台',
    items: [{ label: '我的工作台', href: '/dashboard/member', roles: ['Member'] }],
  },
  {
    label: '能力成长',
    items: [
      { label: '能力自评与 Gap', href: '/capability/assessment', roles: ['Member'] },
      { label: '评估历史', href: '/capability/assessment/history', roles: ['Member'] },
    ],
  },
  {
    label: '我的计划',
    items: [
      { label: '年度成长计划', href: '/growth/annual-plan', roles: ['Member'] },
      { label: '学习任务', href: '/growth/tasks', roles: ['Member'] },
      { label: 'Evidence', href: '/growth/evidence', roles: ['Member'] },
    ],
  },
  {
    label: '成长记录',
    items: [
      { label: '月度复盘', href: '/growth/review/monthly', roles: ['Member'] },
      { label: '成长档案', href: '/growth/profile', roles: ['Member'] },
    ],
  },
  {
    label: '能力标准',
    items: [{ label: '能力地图', href: '/capability/model' }],
  },
]

function YearSelector() {
  const year = useYear()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const { availableYears } = useYearState()
  const singleYear = availableYears.length <= 1

  function handleChange(value: string) {
    const next = new URLSearchParams(searchParams)
    next.set('year', value)
    navigate(`${window.location.pathname}?${next.toString()}`, { replace: true })
  }

  return (
    <select
      className="year-selector"
      value={year}
      onChange={(e) => handleChange(e.target.value)}
      disabled={singleYear}
      title={singleYear ? '当前仅有一个年度数据' : '选择年度'}
      aria-label="选择年度"
    >
      {availableYears.map((y) => (
        <option key={y} value={y}>{y} 年</option>
      ))}
    </select>
  )
}

function canAccess(item: NavItem, roles: string[]) {
  return !item.roles || item.roles.some((r) => roles.includes(r))
}

function scopeLabel(roles: string[]) {
  if (roles.includes('Admin')) return '全量'
  if (roles.includes('Leader')) return '团队'
  if (roles.includes('Buddy')) return '负责成员'
  if (roles.includes('Member')) return '本人'
  return '公共目录'
}

export function Layout() {
  const { user } = useMe()
  const roles = user?.roles ?? []
  const [searchParams] = useSearchParams()
  const contextYear = useYear()
  const yearForLinks = searchParams.get('year') ?? String(contextYear)

  function yHref(path: string): string {
    return `${path}?year=${yearForLinks}`
  }

  const visibleSections = NAV_SECTIONS.filter((s) =>
    s.items.some((item) => canAccess(item, roles)),
  )

  return (
    <div className="app-shell">
      {/* Topbar */}
      <header className="app-topbar">
        <NavLink to={yHref("/dashboard/member")} className="app-topbar-brand">
          Team Capability Platform
        </NavLink>
        <nav className="app-topbar-nav">
          {visibleSections.map((s) => (
            <NavLink to={yHref(s.items[0].href)} key={s.label}>
              {s.label}
            </NavLink>
          ))}
        </nav>
        {roles.includes('Member') && <YearSelector />}
        <span className="app-topbar-scope">数据范围：{scopeLabel(roles)}</span>
      </header>

      {/* Sidebar */}
      <aside className="app-sidebar">
        {visibleSections.map((s) => (
          <div className="app-sidebar-section" key={s.label}>
            <div className="app-sidebar-section-label">{s.label}</div>
            {s.items
              .filter((item) => canAccess(item, roles))
              .map((item) => (
                <NavLink
                  to={yHref(item.href)}
                  className={({ isActive }: { isActive: boolean }) =>
                    `app-sidebar-item${isActive ? ' active' : ''}`
                  }
                  key={item.href}
                >
                  {item.label}
                </NavLink>
              ))}
          </div>
        ))}
      </aside>

      {/* Content */}
      <main className="app-content">
        <Outlet />
      </main>
    </div>
  )
}

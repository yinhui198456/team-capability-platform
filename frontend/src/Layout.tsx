import {
  NavLink,
  Outlet,
  useSearchParams,
  useNavigate,
  useLocation,
} from 'react-router-dom'
import { useEffect, useRef, useState } from 'react'
import { useAuth } from './AuthContext'
import { useYear, useYearState } from './YearContext'
import { defaultRouteFor } from './access'
import { useIsNarrow } from './shared/useIsNarrow'

type NavItem = {
  label: string
  href: string
  roles?: string[]
}

type NavSection = {
  label: string
  items: NavItem[]
}

// Role-aware IA — Member / Buddy / Leader sections per ChatGPT-confirmed R3 navigation
const NAV_SECTIONS: NavSection[] = [
  {
    label: '我的工作台',
    items: [
      { label: '我的工作台', href: '/dashboard/member', roles: ['Member'] },
    ],
  },
  {
    label: '能力成长',
    items: [
      {
        label: '能力自评与 Gap',
        href: '/capability/assessment',
        roles: ['Member'],
      },
      {
        label: '评估历史',
        href: '/capability/assessment/history',
        roles: ['Member'],
      },
    ],
  },
  {
    label: '我的计划',
    items: [
      { label: '年度成长计划', href: '/growth/annual-plan', roles: ['Member'] },
      { label: '学习任务', href: '/growth/tasks', roles: ['Member'] },
    ],
  },
  {
    label: '成长管理',
    items: [
      {
        label: '月度复盘',
        href: '/growth/review/monthly',
        roles: ['Member', 'Buddy', 'Leader', 'Admin'],
      },
      {
        label: '成长档案',
        href: '/growth/profile',
        roles: ['Member', 'Buddy', 'Leader', 'Admin'],
      },
    ],
  },
  {
    label: '导师指导',
    items: [
      {
        label: 'Buddy 复核中心',
        href: '/mentoring/dashboard',
        roles: ['Buddy'],
      },
      {
        label: '待验收成果',
        href: '/mentoring/evidence-review',
        roles: ['Buddy'],
      },
    ],
  },
  {
    label: '团队运营',
    items: [
      {
        label: '团队能力分析',
        href: '/operations/analytics',
        roles: ['Leader'],
      },
      {
        label: '团队年度能力规划',
        href: '/operations/team-annual-plan',
        roles: ['Leader'],
      },
      { label: '学习资源', href: '/operations/resources', roles: ['Leader'] },
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
  const { pathname } = useLocation()
  const { availableYears } = useYearState()
  const singleYear = availableYears.length <= 1

  function handleChange(value: string) {
    const next = new URLSearchParams(searchParams)
    next.set('year', value)
    navigate(`${pathname}?${next.toString()}`, {
      replace: true,
    })
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
        <option key={y} value={y}>
          {y} 年
        </option>
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
  const { user, signOut } = useAuth()
  const navigate = useNavigate()
  const roles = user?.roles ?? []
  const [searchParams] = useSearchParams()
  const contextYear = useYear()
  const yearForLinks = searchParams.get('year') ?? String(contextYear)
  const location = useLocation()
  const homePath = defaultRouteFor(roles)
  const isPublicStandard = location.pathname === '/capability/model'
  const [signingOut, setSigningOut] = useState(false)
  const [signOutError, setSignOutError] = useState('')
  const signOutInFlight = useRef(false)

  // Issue #93: at ≤991px the sidebar becomes an overlay drawer behind a
  // topbar toggle, so content never shares the row with a fixed 224px column.
  const narrow = useIsNarrow(991)
  const [navOpen, setNavOpen] = useState(false)
  const sidebarRef = useRef<HTMLElement | null>(null)
  const navToggleRef = useRef<HTMLButtonElement | null>(null)

  // Growing back to desktop leaves the drawer state behind.
  useEffect(() => {
    if (!narrow && navOpen) setNavOpen(false)
  }, [narrow, navOpen])

  function closeNav() {
    const focusInside = sidebarRef.current?.contains(document.activeElement)
    setNavOpen(false)
    if (focusInside) navToggleRef.current?.focus()
  }

  // Esc closes the drawer while it is open.
  useEffect(() => {
    if (!narrow || !navOpen) return
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== 'Escape') return
      setNavOpen(false)
      if (sidebarRef.current?.contains(document.activeElement)) {
        navToggleRef.current?.focus()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [narrow, navOpen])

  // Move focus into the drawer when it opens.
  useEffect(() => {
    if (narrow && navOpen) {
      sidebarRef.current?.querySelector<HTMLElement>('a')?.focus()
    }
  }, [narrow, navOpen])

  function yHref(path: string): string {
    return `${path}?year=${yearForLinks}`
  }

  async function handleSignOut() {
    if (signOutInFlight.current) return
    signOutInFlight.current = true
    setSigningOut(true)
    setSignOutError('')
    try {
      await signOut()
      navigate('/login', { replace: true })
    } catch {
      setSignOutError('退出失败，请重试')
      setSigningOut(false)
      signOutInFlight.current = false
    }
  }

  const visibleSections = NAV_SECTIONS.filter((s) =>
    s.items.some((item) => canAccess(item, roles)),
  )

  return (
    <div className="app-shell" data-narrow={narrow ? 'true' : undefined}>
      {/* Topbar — brand only, nav is sidebar-exclusive (drawer at ≤991px) */}
      <header className="app-topbar">
        <div className="app-topbar-left">
          {narrow && (
            <button
              ref={navToggleRef}
              type="button"
              className="app-nav-toggle"
              aria-label={navOpen ? '关闭导航菜单' : '打开导航菜单'}
              aria-expanded={navOpen}
              aria-controls="app-sidebar"
              data-testid="nav-toggle"
              onClick={() => setNavOpen((open) => !open)}
            >
              {navOpen ? '×' : '☰'}
            </button>
          )}
          <NavLink to={yHref(homePath)} className="app-topbar-brand">
            Team Capability Platform
          </NavLink>
        </div>
        <div className="app-topbar-right">
          {roles.includes('Member') && <YearSelector />}
          {!isPublicStandard && (
            <span className="app-topbar-scope">
              数据范围：{scopeLabel(roles)}
            </span>
          )}
          <span className="app-topbar-user">
            {user?.full_name?.trim() || user?.username}
          </span>
          <button
            className="app-topbar-logout"
            disabled={signingOut}
            onClick={handleSignOut}
            type="button"
          >
            {signingOut ? '退出中…' : '退出'}
          </button>
          {signOutError && (
            <span className="app-topbar-error" role="alert">
              {signOutError}
            </span>
          )}
        </div>
      </header>

      {/* Sidebar — off-canvas drawer when narrow and closed */}
      {(!narrow || navOpen) && (
        <aside ref={sidebarRef} id="app-sidebar" className="app-sidebar">
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
      )}

      {/* Drawer backdrop — closes the nav, keyboard accessible */}
      {narrow && navOpen && (
        <button
          type="button"
          className="app-nav-backdrop"
          aria-label="关闭导航菜单"
          data-testid="nav-backdrop"
          onClick={closeNav}
        />
      )}

      {/* Content */}
      <main className="app-content">
        <Outlet />
      </main>
    </div>
  )
}

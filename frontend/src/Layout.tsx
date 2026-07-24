import {
  NavLink,
  Outlet,
  useSearchParams,
  useNavigate,
  useLocation,
} from 'react-router-dom'
import { useMe } from './catalog'
import { useAuth } from './AuthContext'
import { useYear, useYearState } from './YearContext'
import { defaultRouteFor } from './access'
import { useCallback, useEffect, useRef, useState } from 'react'

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
  {
    label: '系统管理',
    items: [{ label: '用户管理', href: '/system/users', roles: ['Admin'] }],
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

function roleDisplay(roles: string[]): string {
  return roles.join(' / ')
}

function UserMenu() {
  const { user } = useMe()
  const { logout } = useAuth()
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const [loggingOut, setLoggingOut] = useState(false)
  const [error, setError] = useState('')
  const menuRef = useRef<HTMLDivElement>(null)
  const inFlight = useRef(false)

  const close = useCallback(() => setOpen(false), [])

  useEffect(() => {
    if (!open) return
    function handler(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        close()
      }
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') close()
    }
    document.addEventListener('mousedown', handler)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', handler)
      document.removeEventListener('keydown', onKey)
    }
  }, [open, close])

  async function handleLogout() {
    if (inFlight.current) return
    inFlight.current = true
    setLoggingOut(true)
    setError('')
    const ok = await logout()
    if (ok) {
      navigate('/login', { replace: true })
      // keep locked — user is navigating away
    } else {
      setError('退出失败，请重试')
      setLoggingOut(false)
      inFlight.current = false
    }
  }

  const roles = user?.roles ?? []

  return (
    <div className="user-menu" ref={menuRef}>
      <button
        className="user-menu-trigger"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="true"
        type="button"
      >
        <span className="user-menu-name">
          {user?.full_name ?? user?.username}
        </span>
        <span
          className={`user-menu-arrow${open ? ' open' : ''}`}
          aria-hidden="true"
        >
          ▾
        </span>
      </button>
      {open && (
        <div className="user-menu-dropdown" role="menu">
          <div className="user-menu-info">
            <strong>{user?.full_name}</strong>
            <span className="user-menu-username">@{user?.username}</span>
            <span className="user-menu-roles">{roleDisplay(roles)}</span>
          </div>
          <hr className="user-menu-separator" />
          {error && (
            <p className="user-menu-error" role="alert">
              {error}
            </p>
          )}
          <button
            className="user-menu-logout"
            role="menuitem"
            onClick={handleLogout}
            disabled={loggingOut}
          >
            {loggingOut ? '退出中…' : '退出登录'}
          </button>
        </div>
      )}
    </div>
  )
}

export function Layout() {
  const { user } = useMe()
  const roles = user?.roles ?? []
  const [searchParams] = useSearchParams()
  const contextYear = useYear()
  const yearForLinks = searchParams.get('year') ?? String(contextYear)
  const location = useLocation()
  const homePath = defaultRouteFor(roles)
  const isPublicStandard = location.pathname === '/capability/model'

  function yHref(path: string): string {
    return `${path}?year=${yearForLinks}`
  }

  const visibleSections = NAV_SECTIONS.filter((s) =>
    s.items.some((item) => canAccess(item, roles)),
  )

  return (
    <div className="app-shell">
      <header className="app-topbar">
        <NavLink to={yHref(homePath)} className="app-topbar-brand">
          Team Capability Platform
        </NavLink>
        <div className="app-topbar-right">
          {roles.includes('Member') && <YearSelector />}
          {!isPublicStandard && (
            <span className="app-topbar-scope">
              数据范围：{scopeLabel(roles)}
            </span>
          )}
          <UserMenu />
        </div>
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

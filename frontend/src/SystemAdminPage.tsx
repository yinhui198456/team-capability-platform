import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react'

import { useMe } from './catalog'
import {
  createSystemUser,
  getSystemConfigs,
  getSystemRoles,
  getSystemUsers,
  updateSystemConfig,
  updateSystemUser,
  type SystemConfig,
  type SystemUser,
} from './system'
import styles from './SystemAdminPage.module.css'

const LEVEL_OPTIONS = ['P4', 'P5', 'P6', 'P7', 'P8']

const LEVEL_HELP =
  '等级按用户配置；当前支持 P4–P8。当前等级用于现状基线，目标等级用于能力目标/Gap。'

function UserDrawer({
  mode,
  user,
  roles,
  onClose,
  onSaved,
}: {
  mode: 'create' | 'edit'
  user?: SystemUser
  roles: string[]
  onClose: () => void
  onSaved: () => void
}) {
  const [fullName, setFullName] = useState(user?.full_name ?? '')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [isActive, setIsActive] = useState(user?.is_active ?? true)
  const [selectedRoles, setSelectedRoles] = useState<string[]>(
    user?.roles ?? [],
  )
  const [currentLevel, setCurrentLevel] = useState(user?.current_level ?? '')
  const [targetLevel, setTargetLevel] = useState(user?.target_level ?? '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const drawerRef = useRef<HTMLElement | null>(null)

  const isMember = selectedRoles.includes('Member')

  function toggleRole(role: string) {
    setSelectedRoles((current) =>
      current.includes(role)
        ? current.filter((item) => item !== role)
        : [...current, role],
    )
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    if (saving) return
    if (selectedRoles.length === 0) {
      setError('请至少选择一个角色。')
      return
    }
    if (isMember && (!currentLevel || !targetLevel)) {
      setError('请为 Member 用户配置当前等级与目标等级（P4–P8）。')
      return
    }
    setSaving(true)
    setError('')
    const base = {
      full_name: fullName,
      is_active: isActive,
      roles: selectedRoles,
      current_level: currentLevel || null,
      target_level: targetLevel || null,
    }
    try {
      if (mode === 'create') {
        await createSystemUser({ ...base, username, password })
      } else if (user) {
        await updateSystemUser(user.id, base)
      }
      onSaved()
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : mode === 'create'
            ? '创建失败，请检查输入后重试。'
            : '保存失败，请检查输入后重试。',
      )
    } finally {
      setSaving(false)
    }
  }

  // Put focus on the first field as soon as the drawer is on screen.
  useLayoutEffect(() => {
    drawerRef.current?.querySelector<HTMLElement>('input')?.focus()
  }, [])

  // Esc closes the drawer (never while a save is in flight).
  useEffect(() => {
    if (saving) return
    function handleEscape(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handleEscape)
    return () => window.removeEventListener('keydown', handleEscape)
  }, [saving, onClose])

  // Keep Tab focus inside the drawer.
  function handleDrawerKeyDown(event: ReactKeyboardEvent<HTMLElement>) {
    if (event.key !== 'Tab') return
    const focusable = drawerRef.current?.querySelectorAll<HTMLElement>(
      'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [href], [tabindex]:not([tabindex="-1"])',
    )
    if (!focusable || focusable.length === 0) return
    const first = focusable[0]
    const last = focusable[focusable.length - 1]
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault()
      last.focus()
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault()
      first.focus()
    }
  }

  return (
    <>
      <div
        className={styles.userDrawerMask}
        data-testid="user-drawer-mask"
        onClick={onClose}
      />
      <aside
        ref={drawerRef}
        className={styles.userDrawer}
        role="dialog"
        aria-modal="true"
        aria-labelledby="user-drawer-kicker user-drawer-title user-drawer-subtitle"
        data-testid="user-drawer"
        tabIndex={-1}
        onKeyDown={handleDrawerKeyDown}
      >
        <div className={styles.userDrawerHeader}>
          <div>
            <p className={styles.sectionKicker} id="user-drawer-kicker">
              {mode === 'edit' ? '编辑用户' : '创建用户'}
            </p>
            <h2 id="user-drawer-title">
              {mode === 'edit' ? user?.full_name : '新账号'}
            </h2>
            <p id="user-drawer-subtitle">
              {mode === 'edit' ? `@${user?.username}` : '填写账号信息与角色'}
            </p>
          </div>
          <button
            type="button"
            className={styles.drawerClose}
            aria-label="关闭用户抽屉"
            onClick={onClose}
            disabled={saving}
          >
            ×
          </button>
        </div>
        <form className={styles.userDrawerForm} onSubmit={handleSubmit}>
          <div className={styles.userDrawerBody}>
            {error && (
              <p className="error" role="alert">
                {error}
              </p>
            )}
            {mode === 'create' && (
              <>
                <label>
                  用户名
                  <input
                    value={username}
                    onChange={(event) => setUsername(event.target.value)}
                    required
                  />
                </label>
                <label>
                  姓名
                  <input
                    value={fullName}
                    onChange={(event) => setFullName(event.target.value)}
                    required
                  />
                </label>
                <label>
                  初始密码
                  <input
                    type="password"
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    required
                    autoComplete="new-password"
                  />
                </label>
              </>
            )}
            {mode === 'edit' && (
              <label>
                姓名
                <input
                  value={fullName}
                  onChange={(event) => setFullName(event.target.value)}
                  required
                />
              </label>
            )}
            <label className={styles.userDrawerCheckbox}>
              <input
                type="checkbox"
                checked={isActive}
                onChange={(event) => setIsActive(event.target.checked)}
              />
              启用账号
            </label>
            <fieldset className={styles.rolePicker}>
              <legend>角色</legend>
              {roles.map((role) => (
                <label className={styles.userDrawerCheckbox} key={role}>
                  <input
                    type="checkbox"
                    checked={selectedRoles.includes(role)}
                    onChange={() => toggleRole(role)}
                  />
                  {role}
                </label>
              ))}
            </fieldset>
            {isMember && (
              <>
                <label>
                  当前等级
                  <select
                    value={currentLevel}
                    onChange={(event) => setCurrentLevel(event.target.value)}
                  >
                    <option value="">未设置</option>
                    {LEVEL_OPTIONS.map((level) => (
                      <option key={level} value={level}>
                        {level}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  目标等级
                  <select
                    value={targetLevel}
                    onChange={(event) => setTargetLevel(event.target.value)}
                  >
                    <option value="">未设置</option>
                    {LEVEL_OPTIONS.map((level) => (
                      <option key={level} value={level}>
                        {level}
                      </option>
                    ))}
                  </select>
                </label>
                <p className={styles.levelHelp}>{LEVEL_HELP}</p>
              </>
            )}
          </div>
          <div className={`form-actions ${styles.userDrawerFooter}`}>
            <button type="submit" disabled={saving}>
              {saving ? '保存中…' : '保存'}
            </button>
            <button type="button" onClick={onClose} disabled={saving}>
              取消
            </button>
          </div>
        </form>
      </aside>
    </>
  )
}

export function SystemAdminPage() {
  const { user } = useMe()
  const [users, setUsers] = useState<SystemUser[]>([])
  const [roles, setRoles] = useState<string[]>([])
  const [configs, setConfigs] = useState<SystemConfig[]>([])
  const [search, setSearch] = useState('')
  const [roleFilter, setRoleFilter] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [drawer, setDrawer] = useState<
    { mode: 'create' } | { mode: 'edit'; user: SystemUser } | null
  >(null)
  const [error, setError] = useState('')
  const [configSaving, setConfigSaving] = useState(false)
  const editReturnFocusId = useRef<string | null>(null)
  const editRestoreFocus = useRef(false)

  const isAdmin = user?.roles.includes('Admin') ?? false

  async function refresh() {
    const [nextUsers, nextRoles, nextConfigs] = await Promise.all([
      getSystemUsers(),
      getSystemRoles(),
      getSystemConfigs(),
    ])
    setUsers(nextUsers)
    setRoles(nextRoles)
    setConfigs(nextConfigs)
  }

  useEffect(() => {
    if (!isAdmin) return
    refresh().catch((reason: unknown) =>
      setError(reason instanceof Error ? reason.message : '加载失败'),
    )
  }, [isAdmin])

  function startCreate() {
    editReturnFocusId.current = 'create-user-btn'
    editRestoreFocus.current = true
    setDrawer({ mode: 'create' })
  }

  function startEdit(editUser: SystemUser) {
    editReturnFocusId.current = `user-edit-${editUser.id}`
    editRestoreFocus.current = true
    setDrawer({ mode: 'edit', user: editUser })
  }

  function closeDrawer() {
    setDrawer(null)
  }

  // Restore focus to the trigger once the drawer has closed.
  useLayoutEffect(() => {
    if (drawer) return
    if (editRestoreFocus.current && editReturnFocusId.current) {
      document.getElementById(editReturnFocusId.current)?.focus()
      editRestoreFocus.current = false
    }
  }, [drawer])

  const filtered = users.filter((systemUser) => {
    const query = search.trim().toLocaleLowerCase()
    if (
      query &&
      !systemUser.full_name.toLocaleLowerCase().includes(query) &&
      !systemUser.username.toLocaleLowerCase().includes(query)
    ) {
      return false
    }
    if (roleFilter && !systemUser.roles.includes(roleFilter)) return false
    if (statusFilter === 'active' && !systemUser.is_active) return false
    if (statusFilter === 'inactive' && systemUser.is_active) return false
    return true
  })

  async function saveConfig(config: SystemConfig) {
    setConfigSaving(true)
    setError('')
    try {
      await updateSystemConfig(config.code, {
        value: config.value,
        enabled: config.enabled,
      })
      await refresh()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '保存失败')
    } finally {
      setConfigSaving(false)
    }
  }

  if (!user) {
    return (
      <section className="page">
        <p className="muted">正在加载用户信息…</p>
      </section>
    )
  }
  if (!isAdmin) {
    return (
      <section className="page">
        <p className="muted">无权限，仅 Admin 可管理系统。</p>
      </section>
    )
  }

  return (
    <section className="page dashboard-page system-admin-page">
      <header className="page-heading">
        <div>
          <p className="eyebrow">系统 · Admin</p>
          <h1>系统管理</h1>
          <p className="muted">管理账号、固定角色及年度计划的全局参数。</p>
        </div>
      </header>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <section aria-label="用户管理">
        <div className={styles.sectionHead}>
          <h2>用户管理</h2>
          <button
            id="create-user-btn"
            data-testid="create-user-btn"
            className={styles.createButton}
            type="button"
            onClick={startCreate}
          >
            创建用户
          </button>
        </div>
        <div className={styles.toolbar}>
          <label className={styles.searchBox}>
            搜索
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="姓名或用户名"
            />
          </label>
          <label>
            角色筛选
            <select
              value={roleFilter}
              onChange={(event) => setRoleFilter(event.target.value)}
            >
              <option value="">全部角色</option>
              {roles.map((role) => (
                <option key={role} value={role}>
                  {role}
                </option>
              ))}
            </select>
          </label>
          <label>
            状态筛选
            <select
              value={statusFilter}
              onChange={(event) => setStatusFilter(event.target.value)}
            >
              <option value="">全部状态</option>
              <option value="active">启用</option>
              <option value="inactive">停用</option>
            </select>
          </label>
        </div>
        {users.length === 0 ? (
          <p className={styles.emptyState}>
            暂无用户。点击右上角「创建用户」添加第一个账号。
          </p>
        ) : (
          <>
            {filtered.length === 0 && (
              <p className={styles.emptyState}>
                没有符合条件的用户，请调整搜索或筛选条件。
              </p>
            )}
            <div className={styles.tableWrap}>
              <table className={styles.userTable}>
                <thead>
                  <tr>
                    <th scope="col">姓名</th>
                    <th scope="col">用户名</th>
                    <th scope="col">角色</th>
                    <th scope="col">状态</th>
                    <th scope="col">当前等级</th>
                    <th scope="col">目标等级</th>
                    <th scope="col">操作</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((systemUser) => (
                    <tr key={systemUser.id}>
                      <td>{systemUser.full_name}</td>
                      <td>{systemUser.username}</td>
                      <td>{systemUser.roles.join('、')}</td>
                      <td>
                        <span
                          className={
                            systemUser.is_active
                              ? styles.pillEnabled
                              : styles.pillDisabled
                          }
                        >
                          {systemUser.is_active ? '启用' : '停用'}
                        </span>
                      </td>
                      <td>{systemUser.current_level ?? '—'}</td>
                      <td>{systemUser.target_level ?? '—'}</td>
                      <td>
                        <button
                          id={`user-edit-${systemUser.id}`}
                          data-testid={`user-edit-${systemUser.id}`}
                          className={styles.rowAction}
                          type="button"
                          onClick={() => startEdit(systemUser)}
                        >
                          编辑
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </section>
      {drawer && (
        <UserDrawer
          key={drawer.mode === 'edit' ? `edit-${drawer.user.id}` : 'create'}
          mode={drawer.mode}
          user={drawer.mode === 'edit' ? drawer.user : undefined}
          roles={roles}
          onClose={closeDrawer}
          onSaved={() => {
            closeDrawer()
            void refresh()
          }}
        />
      )}
      <article className="dashboard-card system-config-card">
        <h2>系统配置</h2>
        <p className={styles.configScope}>
          以下全局参数作用于全体用户的年度成长计划（计划周期与窗口计算），与账号、角色和职级配置相互独立，修改后立即生效。
        </p>
        {configs.map((config) => (
          <form
            className="config-row"
            key={config.code}
            onSubmit={(event) => {
              event.preventDefault()
              void saveConfig(config)
            }}
          >
            <label>
              {config.name}
              <small>{config.description}</small>
              <input
                value={config.value}
                onChange={(event) =>
                  setConfigs((items) =>
                    items.map((item) =>
                      item.code === config.code
                        ? { ...item, value: event.target.value }
                        : item,
                    ),
                  )
                }
              />
            </label>
            <label className="checkbox">
              <input
                type="checkbox"
                checked={config.enabled}
                onChange={(event) =>
                  setConfigs((items) =>
                    items.map((item) =>
                      item.code === config.code
                        ? { ...item, enabled: event.target.checked }
                        : item,
                    ),
                  )
                }
              />
              启用
            </label>
            <button disabled={configSaving} type="submit">
              保存配置
            </button>
          </form>
        ))}
      </article>
    </section>
  )
}

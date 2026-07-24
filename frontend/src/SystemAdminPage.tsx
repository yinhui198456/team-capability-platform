import { useEffect, useState, type FormEvent } from 'react'

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

function RolePicker({
  roles,
  selected,
  onChange,
}: {
  roles: string[]
  selected: string[]
  onChange: (roles: string[]) => void
}) {
  function toggle(role: string) {
    onChange(
      selected.includes(role)
        ? selected.filter((item) => item !== role)
        : [...selected, role],
    )
  }

  return (
    <fieldset className="role-picker">
      <legend>角色</legend>
      {roles.map((role) => (
        <label className="checkbox" key={role}>
          <input
            type="checkbox"
            checked={selected.includes(role)}
            onChange={() => toggle(role)}
          />
          {role}
        </label>
      ))}
    </fieldset>
  )
}

export function SystemAdminPage() {
  const { user } = useMe()
  const [users, setUsers] = useState<SystemUser[]>([])
  const [roles, setRoles] = useState<string[]>([])
  const [configs, setConfigs] = useState<SystemConfig[]>([])
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [fullName, setFullName] = useState('')
  const [isActive, setIsActive] = useState(true)
  const [selectedRoles, setSelectedRoles] = useState<string[]>([])
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [currentLevel, setCurrentLevel] = useState<string>('')
  const [targetLevel, setTargetLevel] = useState<string>('')
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  const LEVEL_OPTIONS = ['P4', 'P5', 'P6', 'P7', 'P8']

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

  function selectUser(nextUser: SystemUser) {
    setSelectedId(nextUser.id)
    setFullName(nextUser.full_name)
    setIsActive(nextUser.is_active)
    setSelectedRoles(nextUser.roles)
    setCurrentLevel(nextUser.current_level ?? '')
    setTargetLevel(nextUser.target_level ?? '')
  }

  async function saveUser(event: FormEvent) {
    event.preventDefault()
    if (!selectedId || selectedRoles.length === 0) return
    setSaving(true)
    setError('')
    try {
      await updateSystemUser(selectedId, {
        full_name: fullName,
        is_active: isActive,
        roles: selectedRoles,
        current_level: currentLevel || null,
        target_level: targetLevel || null,
      })
      await refresh()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '保存失败')
    } finally {
      setSaving(false)
    }
  }

  async function createUser(event: FormEvent) {
    event.preventDefault()
    if (!username || !password || !fullName || selectedRoles.length === 0)
      return
    setSaving(true)
    setError('')
    try {
      const created = await createSystemUser({
        username,
        password,
        full_name: fullName,
        is_active: isActive,
        roles: selectedRoles,
        current_level: currentLevel || null,
        target_level: targetLevel || null,
      })
      setUsername('')
      setPassword('')
      selectUser(created)
      await refresh()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '创建失败')
    } finally {
      setSaving(false)
    }
  }

  async function saveConfig(config: SystemConfig) {
    setSaving(true)
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
      setSaving(false)
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
      <div className="dashboard-grid">
        <article className="dashboard-card">
          <h2>用户管理</h2>
          <div className="system-user-list" aria-label="系统用户列表">
            {users.map((systemUser) => (
              <button
                className={selectedId === systemUser.id ? 'selected-user' : ''}
                key={systemUser.id}
                onClick={() => selectUser(systemUser)}
                type="button"
              >
                {systemUser.full_name} · {systemUser.username} ·{' '}
                {systemUser.is_active ? '启用' : '停用'}
                <span className="level-hint">
                  {' '}
                  · {systemUser.current_level ?? '—'} →{' '}
                  {systemUser.target_level ?? '—'}
                </span>
              </button>
            ))}
          </div>
          {selectedId ? (
            <form className="system-form" onSubmit={saveUser}>
              <h3>编辑用户</h3>
              <label>
                姓名
                <input
                  value={fullName}
                  onChange={(event) => setFullName(event.target.value)}
                  required
                />
              </label>
              <label className="checkbox">
                <input
                  type="checkbox"
                  checked={isActive}
                  onChange={(event) => setIsActive(event.target.checked)}
                />
                启用账号
              </label>
              <RolePicker
                roles={roles}
                selected={selectedRoles}
                onChange={setSelectedRoles}
              />
              <label>
                当前职级
                <select
                  value={currentLevel}
                  onChange={(e) => setCurrentLevel(e.target.value)}
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
                目标职级
                <select
                  value={targetLevel}
                  onChange={(e) => setTargetLevel(e.target.value)}
                >
                  <option value="">未设置</option>
                  {LEVEL_OPTIONS.map((level) => (
                    <option key={level} value={level}>
                      {level}
                    </option>
                  ))}
                </select>
              </label>
              <button
                disabled={saving || selectedRoles.length === 0}
                type="submit"
              >
                保存用户
              </button>
            </form>
          ) : (
            <p className="muted">选择一个用户后可编辑角色或启停账号。</p>
          )}
        </article>
        <article className="dashboard-card">
          <h2>创建用户</h2>
          <form className="system-form" onSubmit={createUser}>
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
              />
            </label>
            <label className="checkbox">
              <input
                type="checkbox"
                checked={isActive}
                onChange={(event) => setIsActive(event.target.checked)}
              />
              启用账号
            </label>
            <RolePicker
              roles={roles}
              selected={selectedRoles}
              onChange={setSelectedRoles}
            />
            <button
              disabled={saving || selectedRoles.length === 0}
              type="submit"
            >
              创建用户
            </button>
          </form>
        </article>
      </div>
      <article className="dashboard-card system-config-card">
        <h2>系统配置</h2>
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
            <button disabled={saving} type="submit">
              保存配置
            </button>
          </form>
        ))}
      </article>
    </section>
  )
}

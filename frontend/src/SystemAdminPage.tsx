import { useEffect, useState, type FormEvent } from 'react'

import { useMe } from './catalog'
import {
  createBuddyRelationship,
  createSystemUser,
  endBuddyRelationship,
  getAvailableBuddies,
  getBuddyRelationships,
  getSystemConfigs,
  getSystemRoles,
  getSystemUsers,
  updateBuddyRelationship,
  updateSystemConfig,
  updateSystemUser,
  type AvailableBuddy,
  type BuddyRelationship,
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

function relationshipStatus(rel: BuddyRelationship): string {
  const today = new Date().toISOString().split('T')[0]
  if (rel.expiry_date && rel.expiry_date < today) return '已失效'
  if (rel.effective_date > today) return '未来生效'
  return '当前有效'
}

function formatDate(value: string | null): string {
  return value ?? '长期有效'
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

  const [relationships, setRelationships] = useState<BuddyRelationship[]>([])
  const [availableBuddies, setAvailableBuddies] = useState<AvailableBuddy[]>([])
  const [editingRelationship, setEditingRelationship] =
    useState<BuddyRelationship | null>(null)
  const [showAddRelationship, setShowAddRelationship] = useState(false)
  const [buddyId, setBuddyId] = useState('')
  const [effectiveDate, setEffectiveDate] = useState('')
  const [expiryDate, setExpiryDate] = useState('')

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

  async function loadBuddies() {
    const buddies = await getAvailableBuddies()
    setAvailableBuddies(buddies)
  }

  async function loadRelationships(memberId: number) {
    const rels = await getBuddyRelationships(memberId)
    setRelationships(rels)
  }

  useEffect(() => {
    if (!isAdmin) return
    refresh().catch((reason: unknown) =>
      setError(reason instanceof Error ? reason.message : '加载失败'),
    )
    loadBuddies().catch(() => {
      /* ignore: buddy dropdown will be empty and save will surface errors */
    })
  }, [isAdmin])

  function selectUser(nextUser: SystemUser) {
    setSelectedId(nextUser.id)
    setFullName(nextUser.full_name)
    setIsActive(nextUser.is_active)
    setSelectedRoles(nextUser.roles)
    setCurrentLevel(nextUser.current_level ?? '')
    setTargetLevel(nextUser.target_level ?? '')
    resetRelationshipForm()
    if (nextUser.roles.includes('Member')) {
      loadRelationships(nextUser.id).catch((reason: unknown) =>
        setError(reason instanceof Error ? reason.message : '加载关系失败'),
      )
    } else {
      setRelationships([])
    }
  }

  function resetRelationshipForm() {
    setEditingRelationship(null)
    setShowAddRelationship(false)
    setBuddyId('')
    setEffectiveDate('')
    setExpiryDate('')
  }

  function startAddRelationship() {
    setEditingRelationship(null)
    setShowAddRelationship(true)
    setBuddyId(availableBuddies[0]?.id.toString() ?? '')
    setEffectiveDate(new Date().toISOString().split('T')[0])
    setExpiryDate('')
  }

  function startEditRelationship(rel: BuddyRelationship) {
    setShowAddRelationship(false)
    setEditingRelationship(rel)
    setBuddyId(rel.buddy_id.toString())
    setEffectiveDate(rel.effective_date)
    setExpiryDate(rel.expiry_date ?? '')
  }

  async function saveRelationship(event: FormEvent) {
    event.preventDefault()
    if (!selectedId) return
    const selectedBuddyId = Number(buddyId)
    if (!selectedBuddyId) return
    setSaving(true)
    setError('')
    try {
      if (editingRelationship) {
        await updateBuddyRelationship(editingRelationship.id, {
          buddy_id: selectedBuddyId,
          effective_date: effectiveDate,
          expiry_date: expiryDate || null,
        })
      } else {
        await createBuddyRelationship({
          member_id: selectedId,
          buddy_id: selectedBuddyId,
          effective_date: effectiveDate,
          expiry_date: expiryDate || null,
        })
      }
      resetRelationshipForm()
      await loadRelationships(selectedId)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '保存关系失败')
    } finally {
      setSaving(false)
    }
  }

  async function endRelationship(rel: BuddyRelationship) {
    if (!selectedId) return
    const today = new Date().toISOString().split('T')[0]
    if (!window.confirm(`确认将 “${rel.buddy_name}” 的关系结束于 ${today}？`))
      return
    setSaving(true)
    setError('')
    try {
      await endBuddyRelationship(rel.id, today)
      await loadRelationships(selectedId)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '结束关系失败')
    } finally {
      setSaving(false)
    }
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

  const selectedUser = users.find((u) => u.id === selectedId)
  const canManageBuddy = selectedUser?.roles.includes('Member') ?? false

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
      {selectedId && canManageBuddy && (
        <article className="dashboard-card buddy-relationship-card">
          <h2>主 Buddy 关系</h2>
          {relationships.length === 0 ? (
            <p className="muted">该成员暂无 Buddy 关系。</p>
          ) : (
            <ul className="buddy-relationship-list" aria-label="Buddy 关系历史">
              {relationships.map((rel) => (
                <li key={rel.id} className="buddy-relationship-item">
                  <div className="buddy-relationship-summary">
                    <span className="buddy-name">{rel.buddy_name}</span>
                    <span className="buddy-date">
                      {formatDate(rel.effective_date)} ~{' '}
                      {formatDate(rel.expiry_date)}
                    </span>
                    <span
                      className={`buddy-status status-${relationshipStatus(rel)}`}
                    >
                      {relationshipStatus(rel)}
                    </span>
                  </div>
                  <div className="buddy-relationship-actions">
                    <button
                      type="button"
                      onClick={() => startEditRelationship(rel)}
                      disabled={saving}
                    >
                      修改
                    </button>
                    <button
                      type="button"
                      onClick={() => endRelationship(rel)}
                      disabled={saving || rel.expiry_date !== null}
                    >
                      结束
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
          {!showAddRelationship && !editingRelationship && (
            <button
              type="button"
              className="add-relationship-button"
              onClick={startAddRelationship}
              disabled={saving || availableBuddies.length === 0}
            >
              新增关系
            </button>
          )}
          {(showAddRelationship || editingRelationship) && (
            <form className="system-form" onSubmit={saveRelationship}>
              <h3>{editingRelationship ? '修改关系' : '新增关系'}</h3>
              <label>
                Buddy
                <select
                  value={buddyId}
                  onChange={(event) => setBuddyId(event.target.value)}
                  required
                >
                  <option value="">请选择</option>
                  {availableBuddies.map((buddy) => (
                    <option key={buddy.id} value={buddy.id}>
                      {buddy.full_name} · {buddy.username}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                生效日期
                <input
                  type="date"
                  value={effectiveDate}
                  onChange={(event) => setEffectiveDate(event.target.value)}
                  required
                />
              </label>
              <label>
                失效日期（留空为长期有效）
                <input
                  type="date"
                  value={expiryDate}
                  onChange={(event) => setExpiryDate(event.target.value)}
                />
              </label>
              <div className="form-actions">
                <button type="submit" disabled={saving}>
                  保存关系
                </button>
                <button
                  type="button"
                  onClick={resetRelationshipForm}
                  disabled={saving}
                >
                  取消
                </button>
              </div>
            </form>
          )}
        </article>
      )}
      {selectedId && !canManageBuddy && (
        <article className="dashboard-card buddy-relationship-card">
          <h2>主 Buddy 关系</h2>
          <p className="muted">仅 Member 角色可维护 Buddy 关系。</p>
        </article>
      )}
    </section>
  )
}

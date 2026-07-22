import { useState } from 'react'
import { useNavigate } from 'react-router-dom'

import { login, defaultRouteFor, type User } from './access'

export function LoginPage() {
  const navigate = useNavigate()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault()
    setError('')
    setLoading(true)

    try {
      const user: User = await login(username, password)
      navigate(defaultRouteFor(user.roles), { replace: true })
    } catch (error) {
      setError(error instanceof Error ? error.message : '登录失败')
    } finally {
      setLoading(false)
    }
  }

  return (
    <main className="login-shell">
      <form className="login-form" onSubmit={handleSubmit}>
        <h1>UAT 登录</h1>
        <p className="muted">演示账号：leader / 123456</p>
        <label>
          用户名
          <input
            autoComplete="username"
            disabled={loading}
            value={username}
            onChange={(event) => setUsername(event.target.value)}
          />
        </label>
        <label>
          密码
          <input
            autoComplete="current-password"
            disabled={loading}
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
        </label>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <button disabled={loading || !username || !password} type="submit">
          登录
        </button>
      </form>
    </main>
  )
}

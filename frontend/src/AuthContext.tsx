import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react'
import { me, logout as logoutApi, type User } from './access'

type AuthContextValue = {
  user: User | null
  loading: boolean
  hasProvider: boolean
  refresh: () => Promise<void>
  /** Returns true when the session is gone (2xx or 401), false when retryable. */
  logout: () => Promise<boolean>
}

const AuthContext = createContext<AuthContextValue>({
  user: null,
  loading: false,
  hasProvider: false,
  refresh: async () => {},
  logout: async () => false,
})

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      const value = await me()
      setUser(value)
    } catch {
      setUser(null)
    } finally {
      setLoading(false)
    }
  }, [])

  const logout = useCallback(async () => {
    const result = await logoutApi()
    if (result.ok) {
      setUser(null)
      return true
    }
    return false
  }, [])

  useEffect(() => {
    refresh()
  }, [refresh])

  return (
    <AuthContext.Provider
      value={{ user, loading, hasProvider: true, refresh, logout }}
    >
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth(): AuthContextValue {
  return useContext(AuthContext)
}

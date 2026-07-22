import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react'
import { me, type User } from './access'

type AuthContextValue = {
  user: User | null
  loading: boolean
  hasProvider: boolean
}

const AuthContext = createContext<AuthContextValue>({
  user: null,
  loading: false,
  hasProvider: false,
})

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let active = true
    setLoading(true)
    me().then(
      (value) => {
        if (!active) return
        setUser(value)
        setLoading(false)
      },
      () => {
        if (!active) return
        setUser(null)
        setLoading(false)
      },
    )
    return () => {
      active = false
    }
  }, [])

  return (
    <AuthContext.Provider value={{ user, loading, hasProvider: true }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth(): AuthContextValue {
  return useContext(AuthContext)
}

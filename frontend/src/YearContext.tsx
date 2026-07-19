import { createContext, useContext, useEffect, useState } from 'react'
import { useSearchParams, useNavigate, useLocation } from 'react-router-dom'
import { getAvailableYears } from './planning'

const fallbackYear = new Date().getFullYear()

export const YearContext = createContext<number>(fallbackYear)

export type YearState = { availableYears: number[] }

const YearStateContext = createContext<YearState>({ availableYears: [] })

export function useYear(): number {
  return useContext(YearContext)
}

export function useYearState(): YearState {
  return useContext(YearStateContext)
}

export function YearProvider({ children }: { children: React.ReactNode }) {
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const location = useLocation()
  const [year, setYear] = useState<number>(() => {
    const p = searchParams.get('year')
    return p ? parseInt(p, 10) : fallbackYear
  })
  const [availableYears, setAvailableYears] = useState<number[]>([])
  const [ready, setReady] = useState(false)

  useEffect(() => {
    let cancelled = false
    getAvailableYears()
      .then((data) => {
        if (cancelled) return
        const avail = data.available_years ?? []
        const active = data.active_year
        const urlParam = searchParams.get('year')
        const urlYear = urlParam ? parseInt(urlParam, 10) : null

        let resolved: number
        if (urlYear && Number.isFinite(urlYear) && avail.includes(urlYear)) {
          resolved = urlYear
        } else if (urlYear && Number.isFinite(urlYear) && !avail.includes(urlYear)) {
          // Invalid year in URL — redirect to active
          const next = new URLSearchParams(searchParams)
          next.set('year', String(active))
          navigate(`${location.pathname}?${next.toString()}`, { replace: true })
          resolved = active
        } else if (active) {
          resolved = active
        } else if (avail.length > 0) {
          resolved = Math.max(...avail)
        } else {
          resolved = fallbackYear
        }

        setAvailableYears(avail)
        if (!cancelled) setYear(resolved)
        setReady(true)
      })
      .catch(() => {
        if (!cancelled) {
          setAvailableYears([])
          const urlParam = searchParams.get('year')
          const urlYear = urlParam ? parseInt(urlParam, 10) : null
          setYear(urlYear && Number.isFinite(urlYear) ? urlYear : fallbackYear)
          setReady(true)
        }
      })
    return () => { cancelled = true }
  }, [])

  return (
    <YearStateContext.Provider value={{ availableYears }}>
    <YearContext.Provider value={ready ? year : fallbackYear}>
      {children}
    </YearContext.Provider>
    </YearStateContext.Provider>
  )
}

export function withYear(path: string, year?: number): string {
  const y = year ?? fallbackYear
  const sep = path.includes('?') ? '&' : '?'
  return `${path}${sep}year=${y}`
}

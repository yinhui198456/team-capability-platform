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
  const [yearData, setYearData] = useState<{
    availableYears: number[]
    activeYear: number | null
  } | null>(null)
  const [year, setYear] = useState<number>(fallbackYear)
  const [ready, setReady] = useState(false)

  // Fetch available years once on mount.
  useEffect(() => {
    let cancelled = false
    getAvailableYears()
      .then((data) => {
        if (cancelled) return
        setYearData({
          availableYears: data.available_years ?? [],
          activeYear: data.active_year || null,
        })
      })
      .catch(() => {
        if (!cancelled) {
          setYearData({ availableYears: [], activeYear: null })
        }
      })
    return () => {
      cancelled = true
    }
  }, [])

  // Resolve / sync year whenever the URL param or fetched metadata changes.
  useEffect(() => {
    if (!yearData) return

    const { availableYears, activeYear } = yearData
    const urlParam = searchParams.get('year')
    const urlYear = urlParam ? parseInt(urlParam, 10) : null

    const validAvail =
      availableYears.length > 0
        ? availableYears
        : activeYear
          ? [activeYear]
          : []
    const resolvedActive =
      activeYear ||
      (validAvail.length > 0 ? Math.max(...validAvail) : fallbackYear)

    let resolved: number
    if (urlYear && Number.isFinite(urlYear) && validAvail.includes(urlYear)) {
      resolved = urlYear
    } else if (urlYear && Number.isFinite(urlYear)) {
      // Invalid year in URL — redirect to active year without breaking history.
      const next = new URLSearchParams(searchParams)
      next.set('year', String(resolvedActive))
      navigate(`${location.pathname}?${next.toString()}`, { replace: true })
      resolved = resolvedActive
    } else {
      resolved = resolvedActive
    }

    setYear(resolved)
    setReady(true)
  }, [searchParams, yearData, navigate, location.pathname])

  return (
    <YearStateContext.Provider
      value={{ availableYears: yearData?.availableYears ?? [] }}
    >
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

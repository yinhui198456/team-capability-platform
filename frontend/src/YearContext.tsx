import { createContext, useContext } from 'react'
import { useSearchParams } from 'react-router-dom'

const currentYear = new Date().getFullYear()

export const YearContext = createContext<number>(currentYear)

export function useYear(): number {
  return useContext(YearContext)
}

export function YearProvider({ children }: { children: React.ReactNode }) {
  const [searchParams] = useSearchParams()
  const yearParam = searchParams.get('year')
  const year = yearParam ? parseInt(yearParam, 10) : currentYear
  return (
    <YearContext.Provider value={Number.isNaN(year) ? currentYear : year}>
      {children}
    </YearContext.Provider>
  )
}

export function withYear(path: string, year?: number): string {
  const y = year ?? currentYear
  const sep = path.includes('?') ? '&' : '?'
  return `${path}${sep}year=${y}`
}

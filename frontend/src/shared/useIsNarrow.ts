import { useEffect, useState } from 'react'

/** True when the viewport is at or below `maxWidthPx` (Issue #93).
 *
 * Falls back to window.innerWidth when matchMedia is unavailable (jsdom),
 * so existing tests that never stub matchMedia keep the desktop shell.
 */
export function useIsNarrow(maxWidthPx: number): boolean {
  const [narrow, setNarrow] = useState(() => {
    if (typeof window.matchMedia === 'function') {
      return window.matchMedia(`(max-width: ${maxWidthPx}px)`).matches
    }
    return window.innerWidth <= maxWidthPx
  })

  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return
    const query = window.matchMedia(`(max-width: ${maxWidthPx}px)`)
    const onChange = (event: MediaQueryListEvent) => setNarrow(event.matches)
    query.addEventListener('change', onChange)
    return () => query.removeEventListener('change', onChange)
  }, [maxWidthPx])

  return narrow
}

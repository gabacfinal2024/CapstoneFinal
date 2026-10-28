import { useEffect, useRef, useState } from 'react'

/**
 * Calls `fn` immediately and then every `intervalMs` while mounted.
 * `key` restarts the loop (e.g. when the selected device changes); `enabled=false` pauses it.
 * Ticks are skipped while the browser tab is hidden and one runs as soon as it is visible again,
 * so background tabs don't keep hammering the backend.
 */
export function usePolling(fn, intervalMs, key = '', enabled = true) {
  const fnRef = useRef(fn)
  useEffect(() => {
    fnRef.current = fn
  })

  useEffect(() => {
    if (!enabled) return undefined
    let alive = true
    const tick = () => {
      if (alive && !document.hidden) fnRef.current()
    }
    tick()
    const timer = setInterval(tick, intervalMs)
    document.addEventListener('visibilitychange', tick)
    return () => {
      alive = false
      clearInterval(timer)
      document.removeEventListener('visibilitychange', tick)
    }
  }, [intervalMs, key, enabled])
}

/** Current time, refreshed every `intervalMs` (for "last seen 12s ago" labels). */
export function useNow(intervalMs = 1000) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), intervalMs)
    return () => clearInterval(timer)
  }, [intervalMs])
  return now
}

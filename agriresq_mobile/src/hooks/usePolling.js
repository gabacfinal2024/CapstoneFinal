import { useEffect, useRef } from 'react'

/**
 * Call `fn` now and then every `intervalMs`, but only while the tab is visible.
 * Cleans up on unmount and re-fires immediately when the tab becomes visible again.
 * `fn` may be async; errors it throws are swallowed here (handle them inside `fn`).
 */
export default function usePolling(fn, intervalMs, { enabled = true, immediate = true } = {}) {
  const fnRef = useRef(fn)
  useEffect(() => { fnRef.current = fn })

  useEffect(() => {
    if (!enabled) return undefined
    let timer = null
    let stopped = false

    const run = () => {
      if (stopped) return
      try {
        Promise.resolve(fnRef.current()).catch(() => {})
      } catch { /* ignore */ }
    }
    const start = () => { if (timer == null) timer = setInterval(run, intervalMs) }
    const stop = () => { if (timer != null) { clearInterval(timer); timer = null } }
    const onVisibility = () => {
      if (document.hidden) stop()
      else { run(); start() }
    }

    if (!document.hidden) {
      if (immediate) run()
      start()
    }
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      stopped = true
      stop()
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [intervalMs, enabled, immediate])
}

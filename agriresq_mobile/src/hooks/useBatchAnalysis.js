import { useCallback, useEffect, useRef, useState } from 'react'
import { deviceApi } from '../api/deviceApi'
import usePolling from './usePolling'

/**
 * Freshness analysis of one batch from /api/batches/<id>/analysis/:
 * { analysis: object | null, loading, error }. Keeps the last good value if a refresh fails.
 */
export default function useBatchAnalysis(productId, { enabled = true, intervalMs = 30000 } = {}) {
  const [state, setState] = useState({ analysis: null, loading: true, error: '' })
  const active = enabled && productId != null && productId !== ''
  const latest = useRef(0)

  const refresh = useCallback(async () => {
    if (!active) return
    const request = ++latest.current
    try {
      const analysis = await deviceApi.batchAnalysis(productId)
      if (request === latest.current) setState({ analysis, loading: false, error: '' })
    } catch (err) {
      if (request === latest.current) setState((s) => ({ ...s, loading: false, error: err.message || 'Unavailable' }))
    }
  }, [active, productId])
  useEffect(() => () => { latest.current += 1 }, [refresh])
  usePolling(refresh, intervalMs, { enabled: active })

  return { ...(active ? state : { analysis: null, loading: false, error: '' }), refresh }
}

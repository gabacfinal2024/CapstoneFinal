import { useState } from 'react'
import { deviceApi } from '../api/deviceApi'
import usePolling from './usePolling'

/**
 * Freshness analysis of one batch from /api/batches/<id>/analysis/:
 * { analysis: object | null, loading, error }. Keeps the last good value if a refresh fails.
 */
export default function useBatchAnalysis(productId, { enabled = true, intervalMs = 30000 } = {}) {
  const [state, setState] = useState({ analysis: null, loading: true, error: '' })
  const active = enabled && productId != null && productId !== ''

  usePolling(async () => {
    try {
      const analysis = await deviceApi.batchAnalysis(productId)
      setState({ analysis, loading: false, error: '' })
    } catch (err) {
      setState((s) => ({ ...s, loading: false, error: err.message || 'Unavailable' }))
    }
  }, intervalMs, { enabled: active })

  return active ? state : { analysis: null, loading: false, error: '' }
}

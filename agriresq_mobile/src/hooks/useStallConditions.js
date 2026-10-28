import { useState } from 'react'
import { deviceApi } from '../api/deviceApi'
import usePolling from './usePolling'

/**
 * Stall climate from the backend: { stalls: [] | null (not loaded yet), error, loading }.
 * Keeps the last good value if a refresh fails (a flaky Wi-Fi blip should not blank the card).
 */
export default function useStallConditions({ enabled = true, intervalMs = 30000 } = {}) {
  const [state, setState] = useState({ stalls: null, error: '', loading: true })

  usePolling(async () => {
    try {
      const stalls = await deviceApi.stallConditions()
      setState({ stalls, error: '', loading: false })
    } catch (err) {
      setState((s) => ({ ...s, error: err.message || 'Unavailable', loading: false }))
    }
  }, intervalMs, { enabled })

  return state
}

import { useState } from 'react'
import { useLocation } from 'react-router-dom'

/** Keep page controls with their history entry so Back restores them on remount. */
export default function useEntryState(name, initialValue) {
  const { key } = useLocation()
  const [entry, setEntry] = useState(null)
  const history = window.history
  const activeEntry = (history.state?.key ?? 'default') === key
  const value = entry?.key === key ? entry.value
    : (activeEntry ? history.state?.pageState?.[name] : undefined) ?? initialValue

  const setValue = (nextValue) => {
    const state = history.state
    if ((state?.key ?? 'default') !== key) return
    history.replaceState({ ...state, pageState: { ...state?.pageState, [name]: nextValue } }, '')
    setEntry({ key, value: nextValue })
  }
  return [value, setValue]
}

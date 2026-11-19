import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { App as CapacitorApp } from '@capacitor/app'
import { Capacitor } from '@capacitor/core'
import { backFallback, EXIT_WINDOW_MS, getBackAction } from '../utils/backNavigation'
import { useAuth } from './AuthContext'

const BackNavigationContext = createContext(null)
const historyIndex = () => window.history.state?.idx ?? 0

export function BackNavigationProvider({ children }) {
  const { key, pathname } = useLocation()
  const navigate = useNavigate()
  const { user, loading } = useAuth()
  const userId = user?.id ?? null
  const android = Capacitor.getPlatform() === 'android'
  const session = useRef({ userId: undefined, firstIndex: 0 })
  const guard = useRef(null)
  const handler = useRef(null)
  const navigationTimer = useRef(null)
  const exitTimer = useRef(null)
  const exitDeadline = useRef(null)
  const [showExit, setShowExit] = useState(false)

  const clearExit = useCallback(() => {
    clearTimeout(exitTimer.current)
    exitDeadline.current = null
    setShowExit(false)
  }, [])

  const unlockNavigation = useCallback(() => {
    clearTimeout(navigationTimer.current)
    navigationTimer.current = null
  }, [])

  useLayoutEffect(() => {
    if (!loading && session.current.userId !== userId) {
      const firstIndex = session.current.userId === undefined ? 0 : historyIndex()
      session.current = { userId, firstIndex }
    }
    clearExit()
    unlockNavigation()
  }, [key, loading, userId, clearExit, unlockNavigation])

  useLayoutEffect(() => {
    handler.current = () => {
      if (loading || navigationTimer.current !== null) return
      if (guard.current?.()) return

      const now = performance.now()
      const action = getBackAction({
        pathname, authenticated: !!userId, android, now, exitDeadline: exitDeadline.current,
        hasPrevious: historyIndex() > session.current.firstIndex,
      })
      if (action === 'confirm') {
        exitDeadline.current = now + EXIT_WINDOW_MS
        clearTimeout(exitTimer.current)
        setShowExit(true)
        exitTimer.current = setTimeout(clearExit, EXIT_WINDOW_MS)
      } else if (action === 'exit') {
        clearExit()
        navigationTimer.current = setTimeout(unlockNavigation, EXIT_WINDOW_MS)
        CapacitorApp.exitApp().catch(unlockNavigation)
      } else if (action !== 'stay') {
        clearExit()
        // A Router POP is asynchronous. Wait for it before accepting another Back.
        navigationTimer.current = setTimeout(unlockNavigation, 700)
        if (action === 'previous') navigate(-1)
        else navigate(backFallback(pathname, !!userId), { replace: true })
      }
    }
  }, [android, clearExit, loading, navigate, pathname, unlockNavigation, userId])

  useEffect(() => {
    if (!android) return undefined
    let disposed = false
    let listener
    CapacitorApp.addListener('backButton', () => {
      if (!disposed) handler.current?.()
    }).then((handle) => {
      if (disposed) handle.remove()
      else listener = handle
    }).catch((error) => console.error('Could not register Android Back', error))

    const resetOnBackground = () => { if (document.hidden) clearExit() }
    document.addEventListener('visibilitychange', resetOnBackground)
    return () => {
      disposed = true
      listener?.remove()
      document.removeEventListener('visibilitychange', resetOnBackground)
      clearTimeout(exitTimer.current)
      unlockNavigation()
    }
  }, [android, clearExit, unlockNavigation])

  const goBack = useCallback(() => handler.current?.(), [])
  const registerGuard = useCallback((callback) => {
    guard.current = callback
    return () => { if (guard.current === callback) guard.current = null }
  }, [])

  return (
    <BackNavigationContext.Provider value={{ goBack, registerGuard }}>
      {children}
      {showExit && <div className="back-exit-toast" role="status">Press back again to exit the application.</div>}
    </BackNavigationContext.Provider>
  )
}

export function useBackNavigation() {
  return useContext(BackNavigationContext)
}

export function BackLink({ to, ...props }) {
  const { goBack } = useBackNavigation()
  return (
    <Link {...props} to={to} onClick={(event) => {
      if (event.button !== 0 || event.metaKey || event.altKey || event.ctrlKey || event.shiftKey) return
      event.preventDefault()
      goBack()
    }} />
  )
}

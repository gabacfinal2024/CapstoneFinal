import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '../api/supabaseApi'
import { useAuth } from './AuthContext'
import usePolling from '../hooks/usePolling'

const NotificationsContext = createContext({
  unread: 0,
  unreadMessages: 0,
  toast: null,
  dismissToast() {},
  openNotification() {},
  refresh() {},
  alertsSupported: false,
  alertsPermission: 'denied',
  enableAlerts() {},
})

const canNotify = () => typeof window !== 'undefined' && window.isSecureContext && 'Notification' in window

/**
 * Keeps the unread count live and announces new notifications (new batch listed, new message ...)
 * as a banner inside the app, plus a phone/browser notification when the page is in the background
 * and the user allowed it. Realtime when enabled in Supabase (supabase/005_notification_triggers.sql),
 * with a 20 second refresh as a safety net.
 */
export function NotificationsProvider({ children }) {
  const { user } = useAuth()
  const navigate = useNavigate()
  const [items, setItems] = useState([])
  const [toast, setToast] = useState(null)
  const [permission, setPermission] = useState(canNotify() ? Notification.permission : 'denied')
  // ids already announced; null until the first load, so notifications that were already unread stay quiet
  const announced = useRef(null)
  const initialized = useRef(false)
  const userId = user?.id

  const announce = useCallback((n) => {
    if (!announced.current) announced.current = new Set()
    if (announced.current.has(n.id)) return
    announced.current.add(n.id)
    setToast(n)
    if (canNotify() && Notification.permission === 'granted' && document.hidden) {
      try {
        new Notification(n.title, { body: n.message, tag: `agriresq-${n.id}` })
      } catch {
        /* some browsers only allow this from a service worker */
      }
    }
  }, [])

  const refresh = useCallback(async () => {
    if (!userId) return
    const rows = await api.unreadNotifications()
    setItems(rows)
    if (!initialized.current) {
      announced.current = new Set([...rows.map((r) => r.id), ...(announced.current || [])])
      initialized.current = true
      return
    }
    rows.slice().reverse().forEach(announce)
  }, [userId, announce])

  useEffect(() => {
    announced.current = null
    initialized.current = false
    setItems([])
    setToast(null)
  }, [userId])

  usePolling(refresh, 20000, { enabled: !!userId })

  useEffect(() => {
    if (!userId) return undefined
    return api.subscribeNotifications(userId, (payload) => {
      if (payload?.new) announce(payload.new)
      refresh().catch((err) => console.error('Failed to refresh notifications after realtime event', err))
    })
  }, [userId, announce, refresh])

  useEffect(() => {
    if (!toast) return undefined
    const t = setTimeout(() => setToast(null), 7000)
    return () => clearTimeout(t)
  }, [toast])

  const openNotification = useCallback(async (n) => {
    setToast(null)
    if (!n.is_read) {
      setItems((cur) => cur.filter((x) => x.id !== n.id))
      api.acknowledgeNotif(n.id).catch(() => {})
    }
    if (n.notification_type === 'NEW_MESSAGE') {
      return navigate(n.thread_id ? `/chat/${n.thread_id}` : '/messages')
    }
    if (n.notification_type === 'MARKETPLACE' && n.product_id) {
      try {
        const listing = await api.getListingByProduct(n.product_id)
        if (listing?.id) return navigate(`/produce/${listing.id}`)
      } catch {
        /* the listing is gone: fall through to the marketplace */
      }
      return navigate('/marketplace')
    }
    return navigate('/notifications')
  }, [navigate])

  const enableAlerts = useCallback(async () => {
    if (!canNotify()) return
    setPermission(await Notification.requestPermission())
  }, [])

  const value = useMemo(() => ({
    unread: items.length,
    unreadMessages: items.filter((n) => n.notification_type === 'NEW_MESSAGE').length,
    toast,
    dismissToast: () => setToast(null),
    openNotification,
    refresh,
    alertsSupported: canNotify(),
    alertsPermission: permission,
    enableAlerts,
  }), [items, toast, openNotification, refresh, permission, enableAlerts])

  return <NotificationsContext.Provider value={value}>{children}</NotificationsContext.Provider>
}

export const useNotifications = () => useContext(NotificationsContext)

import { Bell, MessageCircle, ShoppingBasket, X } from 'lucide-react'
import { useNotifications } from '../context/NotificationsContext'
import './NotificationToast.css'

const ICONS = { NEW_MESSAGE: MessageCircle, MARKETPLACE: ShoppingBasket }

// Banner that slides in at the top when something new arrives (new batch listed, new message ...)
export default function NotificationToast() {
  const { toast, dismissToast, openNotification } = useNotifications()
  if (!toast) return null
  const Icon = ICONS[toast.notification_type] || Bell
  return (
    <div className="toast-wrap" role="status" aria-live="polite">
      <button type="button" className="toast" onClick={() => openNotification(toast)}>
        <span className="toast__icon"><Icon size={20} /></span>
        <span className="toast__text">
          <strong>{toast.title}</strong>
          <span>{toast.message}</span>
        </span>
      </button>
      <button type="button" className="toast__close" aria-label="Dismiss" onClick={dismissToast}><X size={16} /></button>
    </div>
  )
}

import { NavLink, useLocation } from 'react-router-dom'
import { Home, ShoppingBasket, MessageCircle, UserRound, Camera } from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import { useNotifications } from '../context/NotificationsContext'
import './BottomNav.css'

const tabs = [
  { to: '/home', label: 'Home', icon: Home },
  { to: '/marketplace', label: 'Listings', icon: ShoppingBasket },
  { to: '/devices', label: 'Devices', icon: Camera, operatorOnly: true, also: ['/gallery'] },
  { to: '/messages', label: 'Messages', icon: MessageCircle },
  { to: '/profile', label: 'Profile', icon: UserRound },
]

export default function BottomNav() {
  const { isOperator } = useAuth()
  const { unreadMessages } = useNotifications()
  const { pathname } = useLocation()
  return (
    <nav className="bottom-nav">
      {tabs.filter((t) => !t.operatorOnly || isOperator).map((t) => (
        <NavLink key={t.to} to={t.to} className={({ isActive }) => `nav-item ${isActive || (t.also || []).some((p) => pathname.startsWith(p)) ? 'active' : ''}`}>
          <span className="nav-icon-wrap">
            <t.icon className="nav-icon" strokeWidth={2.2} />
            {t.to === '/messages' && unreadMessages > 0 && <span className="nav-badge">{unreadMessages > 9 ? '9+' : unreadMessages}</span>}
          </span>
          <span className="nav-label">{t.label}</span>
        </NavLink>
      ))}
    </nav>
  )
}

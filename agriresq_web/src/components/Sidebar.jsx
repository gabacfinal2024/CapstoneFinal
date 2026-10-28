import { useEffect, useState } from 'react';
import { NavLink } from 'react-router-dom';
import { api } from '../api/supabaseApi';
import { PROFILE_EVENT } from '../api/avatarApi';

const menuItems = [
  { path: '/', label: 'Dashboard', icon: '📊' },
  { path: '/batches', label: 'Harvest Batches', icon: '📦' },
  { path: '/devices', label: 'Devices', icon: '📡' },
  { path: '/sensors', label: 'Sensor Nodes', icon: '📟' },
  { path: '/ai-vision', label: 'Live Camera', icon: '📹' },
  { path: '/gallery', label: 'Scan Gallery', icon: '🖼️' },
  { path: '/marketplace', label: 'Marketplace', icon: '🛒' },
  { path: '/analytics', label: 'Analytics', icon: '📈' },
  { path: '/basis', label: 'Days-to-Spoil Basis', icon: '🔬' },
  { path: '/roles', label: 'Applications & Roles', icon: '🛡️' },
  { path: '/profile', label: 'My Profile', icon: '👤' },
];

const ROLE_LABEL = { STALL_OPERATOR: 'Stall operator', RESCUE_BUYER: 'Rescue buyer', ADMIN: 'Administrator' };

function storedUser() {
  try {
    return JSON.parse(localStorage.getItem('agriresq_current_user') || '{}');
  } catch {
    return {};
  }
}

const Sidebar = ({ onLogout }) => {
  const [me, setMe] = useState(storedUser);

  // Logged-in user from Supabase (falls back to what the login form stored).
  useEffect(() => {
    let alive = true;
    api.me().then((profile) => { if (alive && profile) setMe((cur) => ({ ...cur, ...profile, avatar_url: profile.avatar_url || cur.avatar_url })); }).catch(() => {});
    // The Profile page announces a new picture / name so it shows here immediately.
    const onProfile = (e) => setMe((cur) => ({ ...cur, ...e.detail }));
    window.addEventListener(PROFILE_EVENT, onProfile);
    return () => { alive = false; window.removeEventListener(PROFILE_EVENT, onProfile); };
  }, []);

  const name = me.full_name || me.name || me.email || 'AgriResQ user';
  const subtitle = [
    ROLE_LABEL[me.role],
    me.stall_number ? `Stall ${me.stall_number}` : null,
  ].filter(Boolean).join(' • ') || me.market_location || 'Bulua Westbound';

  return (
    <div className="w-64 h-screen bg-slate-900 text-white flex flex-col fixed left-0 top-0 shadow-xl">

      {/* Brand Header */}
      <div className="p-6 border-b border-slate-800 flex items-center gap-3">
        <img src="/agriresq-logo.svg" alt="" className="h-10 w-10 shrink-0 rounded-xl object-contain" />
        <h1 className="text-xl font-bold leading-none tracking-wide text-emerald-400">AgriResQ</h1>
      </div>

      {/* Navigation Links */}
      <nav className="flex-1 p-4 space-y-1 overflow-y-auto">
        {menuItems.map((item) => (
          <NavLink
            key={item.path}
            to={item.path}
            end={item.path === '/'}
            className={({ isActive }) =>
              `w-full flex items-center gap-4 px-4 py-3 rounded-xl transition-all duration-200 text-left ${
                isActive
                  ? 'bg-emerald-600 text-white font-medium shadow-md shadow-emerald-900/30'
                  : 'text-slate-400 hover:bg-slate-800 hover:text-slate-200'
              }`
            }
          >
            <span className="text-lg">{item.icon}</span>
            <span>{item.label}</span>
          </NavLink>
        ))}
      </nav>

      {/* User Profile Area */}
      <div className="p-4 border-t border-slate-800">
        <div className="flex items-center gap-3 p-2">
          <div className="w-9 h-9 rounded-full bg-emerald-500/20 text-emerald-400 flex items-center justify-center font-bold shrink-0 overflow-hidden">
            {me.avatar_url
              ? <img src={me.avatar_url} alt={`${name} profile picture`} className="w-full h-full object-cover" />
              : name.trim().charAt(0).toUpperCase()}
          </div>
          <div className="min-w-0">
            <p className="text-sm font-medium text-slate-200 truncate">{name}</p>
            <p className="text-xs text-slate-500 truncate">{subtitle}</p>
          </div>
        </div>

        {/* Logout Button */}
        <button
          onClick={onLogout}
          className="w-full mt-3 flex items-center gap-3 px-4 py-2.5 rounded-xl text-slate-400 hover:bg-red-500/10 hover:text-red-400 transition-all duration-200"
        >
          <span className="text-lg">🔓</span>
          <span className="text-sm">Log out</span>
        </button>
      </div>

    </div>
  );
};

export default Sidebar;

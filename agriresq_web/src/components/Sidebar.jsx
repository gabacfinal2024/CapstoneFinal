import { useEffect, useRef, useState } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import {
  Camera, ChartNoAxesCombined, Cpu, Images, LayoutDashboard, LogOut,
  Menu, Microscope, Package, Radio, ShieldCheck, ShoppingBasket, UserRound, X,
} from 'lucide-react';
import { api } from '../api/supabaseApi';
import { PROFILE_EVENT } from '../api/avatarApi';

const menuItems = [
  { path: '/', label: 'Dashboard', Icon: LayoutDashboard },
  { path: '/batches', label: 'Harvest Batches', Icon: Package },
  { path: '/devices', label: 'Devices', Icon: Radio },
  { path: '/sensors', label: 'Sensor Nodes', Icon: Cpu },
  { path: '/ai-vision', label: 'Live Camera', Icon: Camera },
  { path: '/gallery', label: 'Scan Gallery', Icon: Images },
  { path: '/marketplace', label: 'Marketplace', Icon: ShoppingBasket },
  { path: '/analytics', label: 'Analytics', Icon: ChartNoAxesCombined },
  { path: '/basis', label: 'Days-to-Spoil Basis', Icon: Microscope },
  { path: '/roles', label: 'Applications & Roles', Icon: ShieldCheck },
  { path: '/profile', label: 'My Profile', Icon: UserRound },
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
  const [menuOpen, setMenuOpen] = useState(false);
  const menu = useRef(null);
  const location = useLocation();

  // Logged-in user from Supabase (falls back to what the login form stored).
  useEffect(() => {
    let alive = true;
    api.me().then((profile) => { if (alive && profile) setMe((cur) => ({ ...cur, ...profile, avatar_url: profile.avatar_url || cur.avatar_url })); }).catch(() => {});
    // The Profile page announces a new picture / name so it shows here immediately.
    const onProfile = (e) => setMe((cur) => ({ ...cur, ...e.detail }));
    window.addEventListener(PROFILE_EVENT, onProfile);
    return () => { alive = false; window.removeEventListener(PROFILE_EVENT, onProfile); };
  }, []);

  useEffect(() => { menu.current?.close(); }, [location.key]);

  useEffect(() => {
    const desktop = window.matchMedia('(min-width: 64rem)');
    const closeOnDesktop = (event) => { if (event.matches) menu.current?.close(); };
    desktop.addEventListener('change', closeOnDesktop);
    return () => desktop.removeEventListener('change', closeOnDesktop);
  }, []);

  const name = me.full_name || me.name || me.email || 'AgriResQ user';
  const subtitle = [
    ROLE_LABEL[me.role],
    me.stall_number ? `Stall ${me.stall_number}` : null,
  ].filter(Boolean).join(' • ') || me.market_location || 'Bulua Westbound';

  const brand = (
    <div className="flex items-center gap-3">
      <img src="/agriresq-logo.svg" alt="" className="h-10 w-10 shrink-0 rounded-xl object-contain" />
      <div>
        <p className="text-lg font-semibold leading-none tracking-tight text-white">AgriResQ</p>
        <p className="mt-1 text-[11px] text-emerald-100/70">Admin dashboard</p>
      </div>
    </div>
  );

  const linksAndAccount = (
    <>
      <nav aria-label="Main navigation" className="min-h-0 flex-1 space-y-1 overflow-y-auto p-3">
        {menuItems.map((item) => (
          <NavLink
            key={item.path}
            to={item.path}
            end={item.path === '/'}
            className={({ isActive }) =>
              `flex min-h-11 w-full items-center gap-3 rounded-lg px-3 text-left text-sm transition-colors ${
                isActive
                  ? 'bg-[#2c7366] font-medium text-white'
                  : 'text-emerald-50/75 hover:bg-white/10 hover:text-white'
              }`
            }
          >
            <item.Icon size={18} strokeWidth={1.8} aria-hidden="true" />
            <span>{item.label}</span>
          </NavLink>
        ))}
      </nav>

      <div className="shrink-0 border-t border-white/10 p-3">
        <div className="flex items-center gap-3 rounded-lg px-2 py-2">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-full bg-white/15 font-semibold text-emerald-50">
            {me.avatar_url
              ? <img src={me.avatar_url} alt={`${name} profile picture`} className="w-full h-full object-cover" />
              : name.trim().charAt(0).toUpperCase()}
          </div>
          <div className="min-w-0">
            <p className="truncate text-sm font-medium text-white">{name}</p>
            <p className="truncate text-xs text-emerald-100/60">{subtitle}</p>
          </div>
        </div>

        <button
          onClick={onLogout}
          className="mt-2 flex min-h-10 w-full items-center gap-3 rounded-lg px-3 text-sm text-emerald-50/70 transition-colors hover:bg-white/10 hover:text-white"
        >
          <LogOut size={17} strokeWidth={1.8} aria-hidden="true" />
          <span>Log out</span>
        </button>
      </div>

    </>
  );

  return (
    <>
      <header className="flex shrink-0 items-center justify-between gap-3 bg-[#123b35] px-4 py-2 text-white lg:hidden">
        {brand}
        <button type="button" aria-label="Open navigation" aria-haspopup="dialog" aria-controls="admin-mobile-menu" aria-expanded={menuOpen}
          className="grid size-11 shrink-0 place-items-center rounded-lg bg-white/10 hover:bg-white/20"
          onClick={() => { menu.current.showModal(); setMenuOpen(true); }}>
          <Menu size={23} aria-hidden="true" />
        </button>
      </header>

      <aside className="fixed left-0 top-0 z-20 hidden h-dvh w-64 flex-col bg-[#123b35] text-white shadow-lg shadow-slate-900/10 lg:flex">
        <div className="shrink-0 border-b border-white/10 px-5 py-5">{brand}</div>
        {linksAndAccount}
      </aside>

      <dialog id="admin-mobile-menu" ref={menu} aria-label="Admin navigation"
        className="fixed top-0 left-0 m-0 h-dvh max-h-none w-72 max-w-[85vw] overflow-hidden bg-[#123b35] text-white backdrop:bg-slate-950/45 lg:hidden"
        onClose={() => setMenuOpen(false)}
        onClick={(event) => { if (event.target === event.currentTarget) menu.current.close(); }}>
        <div className="flex h-full flex-col">
          <div className="flex shrink-0 items-center justify-between gap-2 border-b border-white/10 px-4 py-2">
            {brand}
            <button type="button" aria-label="Close navigation" className="grid size-11 shrink-0 place-items-center rounded-lg hover:bg-white/10"
              onClick={() => menu.current.close()}>
              <X size={22} aria-hidden="true" />
            </button>
          </div>
          {linksAndAccount}
        </div>
      </dialog>
    </>
  );
};

export default Sidebar;

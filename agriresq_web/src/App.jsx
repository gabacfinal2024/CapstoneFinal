import { useEffect, useState } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';

import Login from "./pages/Login";
import Sidebar from './components/Sidebar';
import Dashboard from './pages/Dashboard';
import Batches from './pages/Batches';
import Marketplace from './pages/Marketplace';
import Profile from "./pages/Profile";
import Sensors from './pages/Sensors';
import Analytics from './pages/Analytics';
import Basis from './pages/Basis';
import AIVision from './pages/AIVision';
import Devices from './pages/Devices';
import DeviceDetail from './pages/DeviceDetail';
import AdminRoles from './pages/AdminRoles';
import BatchDetail from './pages/BatchDetail';
import Gallery from './pages/Gallery';
import ForgotPassword from './pages/ForgotPassword';
import ResetPassword from './pages/ResetPassword';
import { api } from './api/supabaseApi';
import { supabase } from './lib/supabase';

// The web dashboard is the administrator side (AgriResQ / USTP developers): monitoring of every
// stall, camera and sensor, plus approving stall operator applications. Operators and buyers use the mobile app.
function App() {
  // "loading" | "login" | "app"
  // Start from the persisted Supabase session so a page refresh keeps you signed in.
  // The password-recovery link (/reset-password) carries its own temporary session, so it must
  // never be mistaken for a normal login.
  const [screen, setScreen] = useState("loading");
  const [isAdmin, setIsAdmin] = useState(false);

  useEffect(() => {
    let alive = true;
    const onRecoveryLink = window.location.pathname.startsWith('/reset-password');
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (alive) setScreen(session && !onRecoveryLink ? "app" : "login");
    });
    const { data: listener } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'SIGNED_OUT') {
        setIsAdmin(false);
        setScreen((s) => (s === "app" ? "login" : s));
      }
    });
    return () => {
      alive = false;
      listener.subscription.unsubscribe();
    };
  }, []);

  // A signed-in session that is not an administrator (an old operator session, for example) is ended.
  useEffect(() => {
    if (screen !== "app") return;
    let alive = true;
    api.me().then(async (p) => {
      if (!alive) return;
      if (p?.role === 'ADMIN') return setIsAdmin(true);
      try { await api.logout(); } catch { /* already signed out */ }
      localStorage.removeItem('agriresq_current_user');
      setIsAdmin(false);
      setScreen("login");
    }).catch(() => { if (alive) setScreen("login"); });
    return () => { alive = false; };
  }, [screen]);

  const handleLogout = async () => {
    try {
      await api.logout();
    } catch (err) {
      console.error('Logout failed', err);
    } finally {
      localStorage.removeItem('agriresq_current_user');
      setIsAdmin(false);
      setScreen("login");
    }
  };

  if (screen === "loading" || (screen === "app" && !isAdmin)) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 text-slate-400 animate-pulse">
        Loading AgriResQ…
      </div>
    );
  }

  if (screen === "login") {
    return (
      <Router>
        <Routes>
          <Route path="/" element={<Login onLogin={() => setScreen("app")} />} />
          <Route path="/forgot-password" element={<ForgotPassword />} />
          <Route path="/reset-password" element={<ResetPassword />} />
          <Route path="*" element={<Navigate to="/" />} />
        </Routes>
      </Router>
    );
  }

  return (
    <Router>
      <div className="min-h-screen bg-slate-50 flex">
        <Sidebar onLogout={handleLogout} />
        <main className="flex-1 ml-64 p-8 min-h-screen overflow-y-auto">
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/batches" element={<Batches />} />
            <Route path="/batches/:id" element={<BatchDetail />} />
            <Route path="/gallery" element={<Gallery />} />
            <Route path="/sensors" element={<Sensors />} />
            <Route path="/devices" element={<Devices />} />
            <Route path="/devices/:id" element={<DeviceDetail />} />
            <Route path="/marketplace" element={<Marketplace />} />
            <Route path="/analytics" element={<Analytics />} />
            <Route path="/basis" element={<Basis />} />
            <Route path="/ai-vision" element={<AIVision />} />
            <Route path="/roles" element={<AdminRoles />} />
            <Route path="/profile" element={<Profile />} />
            <Route path="*" element={<Navigate to="/" />} />
          </Routes>
        </main>
      </div>
    </Router>
  );
}

export default App;

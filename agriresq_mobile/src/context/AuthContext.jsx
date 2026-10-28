import React, { createContext, useContext, useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { api } from '../api/supabaseApi';

const AuthContext = createContext();

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const init = async () => {
      try {
        const me = await api.me();
        setUser(me || null);
      } catch (err) {
        const { data: { session } } = await supabase.auth.getSession();
        setUser(session?.user || null);
      }
      setLoading(false);
    };

    init();

    const { data: authListener } = supabase.auth.onAuthStateChange(async (_event, session) => {
      if (!session) return setUser(null)
      setUser((currentUser) => currentUser?.id === session.user.id ? currentUser : session.user)
    });

    // An administrator may approve a stall operator application while the app is open:
    // check again whenever the app comes back to the foreground.
    const refreshRole = async () => {
      if (document.visibilityState === 'hidden') return;
      try {
        const me = await api.me();
        if (me) setUser((cur) => (cur && cur.role !== me.role ? me : cur));
      } catch {
        /* offline: keep what we have */
      }
    };
    document.addEventListener('visibilitychange', refreshRole);
    window.addEventListener('focus', refreshRole);

    return () => {
      document.removeEventListener('visibilitychange', refreshRole);
      window.removeEventListener('focus', refreshRole);
      if (authListener?.subscription?.unsubscribe) {
        authListener.subscription.unsubscribe();
      } else if (authListener?.unsubscribe) {
        authListener.unsubscribe();
      }
    };
  }, []);

  const login = async (email, password) => {
    const authUser = await api.login(email, password);
    let profileUser = null;
    try {
      profileUser = await api.me();
    } catch (err) {
      profileUser = null;
    }
    const user = profileUser || authUser;
    setUser(user);
    return user;
  };

  const register = async (form) => {
    return api.register(form);
  };

  const logout = async () => {
    await api.logout();
    setUser(null);
  };

  return (
    <AuthContext.Provider value={{ user, loading, login, register, logout, supabase, isOperator: user?.role === 'STALL_OPERATOR', isBuyer: user?.role === 'RESCUE_BUYER' }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
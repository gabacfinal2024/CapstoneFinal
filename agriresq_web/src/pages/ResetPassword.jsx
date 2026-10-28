import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api/supabaseApi';
import { supabase } from '../lib/supabase';

/**
 * Opened from the Supabase recovery e-mail (`/reset-password`). Supabase puts a temporary
 * recovery session in the URL; we update the password with it, then sign that session out.
 */
const ResetPassword = () => {
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);
  const [linkState, setLinkState] = useState('checking'); // checking | ok | invalid

  useEffect(() => {
    let alive = true;
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (alive) setLinkState(session ? 'ok' : 'invalid');
    });
    return () => { alive = false; };
  }, []);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setMessage('');
    setError('');

    if (password.length < 8) {
      setError('Use at least 8 characters.');
      return;
    }
    if (password !== confirmPassword) {
      setError('Passwords do not match!');
      return;
    }

    setIsLoading(true);
    try {
      await api.updatePassword(password);
      await api.logout().catch(() => {}); // drop the temporary recovery session
      setIsSuccess(true);
      setMessage('Your password has been successfully reset!');
    } catch (err) {
      setError(err.message || 'Failed to reset password. The link might be expired.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50">
      <div className="bg-white p-8 rounded-2xl shadow-sm border border-slate-200 w-full max-w-md">
        <h2 className="text-2xl font-bold text-slate-800 mb-2">Create New Password</h2>
        <p className="text-sm text-slate-500 mb-6">Your new password must be different from previously used passwords.</p>

        {message && (
          <div role="status" className="mb-4 p-3 bg-emerald-50 border border-emerald-100 text-emerald-700 rounded-lg text-sm font-medium">
            {message}
          </div>
        )}

        {error && (
          <div role="alert" className="mb-4 p-3 bg-rose-50 border border-rose-100 text-rose-700 rounded-lg text-sm font-medium">
            {error}
          </div>
        )}

        {isSuccess ? (
          <div className="mt-4">
            <Link to="/" className="block w-full text-center py-2.5 bg-[#2A6B48] text-white rounded-xl text-sm font-bold hover:bg-[#1f5035] transition-colors">
              Continue to Login
            </Link>
          </div>
        ) : linkState === 'invalid' ? (
          <div className="text-sm text-slate-600 space-y-3">
            <p>This reset link is invalid or has expired.</p>
            <Link to="/forgot-password" className="text-[#2A6B48] font-bold hover:underline">Request a new link</Link>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1" htmlFor="new-password">New Password</label>
              <input
                id="new-password"
                type="password"
                required
                minLength={8}
                autoComplete="new-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full px-4 py-2.5 rounded-xl border border-slate-200 text-sm focus:outline-none focus:border-emerald-500"
                placeholder="••••••••"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1" htmlFor="confirm-password">Confirm New Password</label>
              <input
                id="confirm-password"
                type="password"
                required
                autoComplete="new-password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                className="w-full px-4 py-2.5 rounded-xl border border-slate-200 text-sm focus:outline-none focus:border-emerald-500"
                placeholder="••••••••"
              />
            </div>
            <button
              type="submit"
              disabled={isLoading || linkState === 'checking'}
              className="w-full py-2.5 mt-2 bg-[#2A6B48] text-white rounded-xl text-sm font-bold hover:bg-[#1f5035] transition-colors disabled:opacity-70"
            >
              {isLoading ? 'Resetting...' : 'Reset Password'}
            </button>
          </form>
        )}
      </div>
    </div>
  );
};

export default ResetPassword;

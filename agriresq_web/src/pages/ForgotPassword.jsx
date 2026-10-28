import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api/supabaseApi';

const ForgotPassword = () => {
  const [email, setEmail] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setIsLoading(true);
    setMessage('');
    setError('');

    try {
      await api.sendPasswordResetEmail(email);
      // Same wording whether or not the address is registered (no account enumeration).
      setMessage('If that email is registered, a reset link is on its way. Check your inbox and spam folder.');
    } catch (err) {
      setError(err.message || 'Could not send the reset link. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50">
      <div className="bg-white p-8 rounded-2xl shadow-sm border border-slate-200 w-full max-w-md">
        <h2 className="text-2xl font-bold text-slate-800 mb-2">Reset Password</h2>
        <p className="text-sm text-slate-500 mb-6">Enter your email address and we'll send you a link to reset your password.</p>

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

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1" htmlFor="reset-email">Email address</label>
            <input
              id="reset-email"
              type="email"
              required
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full px-4 py-2.5 rounded-xl border border-slate-200 text-sm focus:outline-none focus:border-emerald-500"
              placeholder="you@agriresq.ph"
            />
          </div>
          <button
            type="submit"
            disabled={isLoading}
            className="w-full py-2.5 bg-[#2A6B48] text-white rounded-xl text-sm font-bold hover:bg-[#1f5035] transition-colors disabled:opacity-70"
          >
            {isLoading ? 'Sending...' : 'Send Reset Link'}
          </button>
        </form>

        <div className="mt-6 text-center text-sm">
          <Link to="/" className="text-[#2A6B48] font-bold hover:underline">Back to Login</Link>
        </div>
      </div>
    </div>
  );
};

export default ForgotPassword;

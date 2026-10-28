import { useCallback, useEffect, useState } from 'react';
import { api } from '../api/supabaseApi';

const ROLE_LABEL = { STALL_OPERATOR: 'Stall operator', RESCUE_BUYER: 'Rescue buyer', ADMIN: 'Administrator' };

export default function AdminRoles() {
  const [requests, setRequests] = useState([]);
  const [users, setUsers] = useState([]);
  const [stalls, setStalls] = useState({});
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(null);
  const [query, setQuery] = useState('');

  const load = useCallback(async () => {
    try {
      const [r, u] = await Promise.all([api.adminRoleRequests(), api.adminUsers()]);
      setRequests(r);
      setUsers(u);
      setError('');
    } catch (err) {
      setError(err.message || 'Could not load users.');
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const run = async (key, fn) => {
    setBusy(key);
    try {
      await fn();
      await load();
    } catch (err) {
      setError(err.message || 'That did not work.');
    } finally {
      setBusy(null);
    }
  };

  const approve = (req) =>
    run(`req-${req.id}`, () => api.adminSetRole(req.user_id, 'STALL_OPERATOR', stalls[req.id] || req.requested_stall_number));

  const reject = (req) => {
    const reason = window.prompt('Reason for declining (optional):', '');
    if (reason === null) return;
    run(`req-${req.id}`, () => api.adminRejectRequest(req.id, reason));
  };

  const changeRole = (u, role) => {
    let stall = null;
    if (role === 'STALL_OPERATOR') {
      stall = window.prompt(`Stall number for ${u.full_name || u.email}:`, u.stall_number || '');
      if (!stall || !stall.trim()) return;
    } else if (!window.confirm(`Make ${u.full_name || u.email} a rescue buyer? They lose stall operator access.`)) {
      return;
    }
    run(`user-${u.id}`, () => api.adminSetRole(u.id, role, stall));
  };

  const shown = users.filter((u) =>
    `${u.full_name || ''} ${u.email || ''}`.toLowerCase().includes(query.trim().toLowerCase()));

  return (
    <div className="max-w-5xl">
      <h1 className="text-2xl font-bold text-slate-800">Stall operator applications</h1>
      <p className="text-sm text-slate-500 mt-1 mb-6">
        New accounts are rescue buyers. Approve an application and that person can list produce in the mobile app the next time they open it.
      </p>

      {error && <div className="mb-4 rounded-lg bg-red-100 text-red-700 text-sm px-4 py-3">{error}</div>}

      <section className="bg-white rounded-2xl border border-slate-200 p-6 mb-8">
        <h2 className="text-lg font-semibold text-slate-800 mb-4">
          Applications waiting <span className="text-slate-400 font-normal">({requests.length})</span>
        </h2>
        {requests.length === 0 ? (
          <p className="text-sm text-slate-500">No applications right now.</p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {requests.map((req) => (
              <li key={req.id} className="py-4 flex flex-wrap items-center gap-4">
                <div className="flex-1 min-w-[220px]">
                  <p className="font-medium text-slate-800">{req.profiles?.full_name || 'Unnamed'}</p>
                  <p className="text-sm text-slate-500">{req.profiles?.email}</p>
                  {req.note && <p className="text-sm text-slate-600 mt-1">“{req.note}”</p>}
                </div>
                <label className="text-xs text-slate-500">
                  Stall number
                  <input
                    className="block mt-1 w-40 rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-800"
                    defaultValue={req.requested_stall_number}
                    onChange={(e) => setStalls((s) => ({ ...s, [req.id]: e.target.value }))}
                  />
                </label>
                <div className="flex gap-2">
                  <button
                    onClick={() => approve(req)}
                    disabled={busy === `req-${req.id}`}
                    className="px-4 py-2 rounded-lg bg-emerald-600 text-white text-sm font-medium hover:bg-emerald-700 disabled:opacity-50"
                  >
                    Approve
                  </button>
                  <button
                    onClick={() => reject(req)}
                    disabled={busy === `req-${req.id}`}
                    className="px-4 py-2 rounded-lg border border-slate-300 text-slate-700 text-sm font-medium hover:bg-slate-50 disabled:opacity-50"
                  >
                    Decline
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="bg-white rounded-2xl border border-slate-200 p-6">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
          <h2 className="text-lg font-semibold text-slate-800">All users <span className="text-slate-400 font-normal">({users.length})</span></h2>
          <input
            className="w-64 rounded-lg border border-slate-200 px-3 py-2 text-sm"
            placeholder="Search name or email"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-slate-500 border-b border-slate-200">
              <th className="py-2 pr-4 font-medium">Name</th>
              <th className="py-2 pr-4 font-medium">Email</th>
              <th className="py-2 pr-4 font-medium">Account type</th>
              <th className="py-2 font-medium">Change to</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((u) => (
              <tr key={u.id} className="border-b border-slate-100">
                <td className="py-3 pr-4 text-slate-800">{u.full_name || '—'}</td>
                <td className="py-3 pr-4 text-slate-600">{u.email}</td>
                <td className="py-3 pr-4 text-slate-800">
                  {ROLE_LABEL[u.role] || u.role}{u.stall_number ? ` · ${u.stall_number}` : ''}
                </td>
                <td className="py-3">
                  {u.role === 'ADMIN' ? (
                    <span className="text-slate-400">Fixed</span>
                  ) : (
                    <button
                      onClick={() => changeRole(u, u.role === 'STALL_OPERATOR' ? 'RESCUE_BUYER' : 'STALL_OPERATOR')}
                      disabled={busy === `user-${u.id}`}
                      className="px-3 py-1.5 rounded-lg border border-slate-300 text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                    >
                      {u.role === 'STALL_OPERATOR' ? 'Make rescue buyer' : 'Make stall operator'}
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}

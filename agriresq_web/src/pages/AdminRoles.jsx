import { useCallback, useEffect, useMemo, useState } from 'react';
import { Search, ShieldCheck, Store, UserRound, UserRoundX, UserRoundCheck } from 'lucide-react';
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

  useEffect(() => {
    let active = true;
    Promise.all([api.adminRoleRequests(), api.adminUsers()])
      .then(([nextRequests, nextUsers]) => {
        if (!active) return;
        setRequests(nextRequests);
        setUsers(nextUsers);
      })
      .catch((err) => {
        if (active) setError(err.message || 'Could not load users.');
      });
    return () => { active = false; };
  }, []);

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

  const saveStall = (user) => {
    const stall = (stalls[user.id] ?? user.stall_number ?? '').trim();
    if (!stall || stall === user.stall_number) return;
    run(`stall-${user.id}`, () => api.adminSetRole(user.id, 'STALL_OPERATOR', stall));
  };

  const toggleActive = (user) => {
    const nextActive = user.is_active === false;
    const label = user.full_name || user.email;
    const message = nextActive
      ? `Restore ${label}'s account? Their existing data will remain available.`
      : `Deactivate ${label}'s account? They will lose access, but their profile and data will be preserved.`;
    if (!window.confirm(message)) return;
    run(`status-${user.id}`, () => api.adminSetAccountActive(user.id, nextActive));
  };

  const shown = useMemo(() => users.filter((user) =>
    `${user.full_name || ''} ${user.email || ''} ${user.stall_number || ''}`
      .toLowerCase()
      .includes(query.trim().toLowerCase())), [users, query]);

  return (
    <div className="mx-auto w-full max-w-6xl">
      <header className="mb-7 border-b border-slate-200 pb-5">
        <p className="mb-1 text-xs font-semibold uppercase tracking-[0.16em] text-emerald-800">Administration</p>
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Applications & accounts</h1>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">
          Review stall applications, maintain operator stall numbers, and manage account access without deleting user data.
        </p>
      </header>

      {error && (
        <div role="alert" className="mb-5 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          {error}
        </div>
      )}

      <section className="mb-7 rounded-xl border border-slate-200 bg-white">
        <div className="border-b border-slate-200 px-5 py-4">
          <div className="flex items-center gap-2">
            <Store size={18} className="text-emerald-800" aria-hidden="true" />
            <h2 className="font-semibold text-slate-900">Pending applications</h2>
            <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-medium text-slate-600">{requests.length}</span>
          </div>
          <p className="mt-1 text-sm text-slate-500">Confirm a stall number before approving an operator.</p>
        </div>

        {requests.length === 0 ? (
          <p className="px-5 py-6 text-sm text-slate-500">No applications waiting for review.</p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {requests.map((req) => (
              <li key={req.id} className="flex flex-wrap items-end gap-4 px-5 py-4">
                <div className="min-w-[220px] flex-1 self-center">
                  <p className="font-medium text-slate-900">{req.profiles?.full_name || 'Unnamed'}</p>
                  <p className="text-sm text-slate-500">{req.profiles?.email}</p>
                  {req.note && <p className="mt-2 text-sm leading-5 text-slate-600">{req.note}</p>}
                </div>
                <label className="text-xs font-medium text-slate-600">
                  Stall number <span className="text-red-700">Required</span>
                  <input
                    className="mt-1 block min-h-10 w-44 rounded-md border border-slate-300 px-3 text-sm text-slate-900 outline-none focus:border-emerald-700 focus:ring-2 focus:ring-emerald-700/15"
                    value={stalls[req.id] ?? req.requested_stall_number ?? ''}
                    onChange={(event) => setStalls((current) => ({ ...current, [req.id]: event.target.value }))}
                  />
                </label>
                <div className="flex gap-2">
                  <button
                    onClick={() => approve(req)}
                    disabled={busy === `req-${req.id}` || !(stalls[req.id] ?? req.requested_stall_number ?? '').trim()}
                    className="min-h-10 rounded-md bg-emerald-800 px-4 text-sm font-medium text-white hover:bg-emerald-900 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    Approve
                  </button>
                  <button
                    onClick={() => reject(req)}
                    disabled={busy === `req-${req.id}`}
                    className="min-h-10 rounded-md border border-slate-300 px-4 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                  >
                    Decline
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="rounded-xl border border-slate-200 bg-white">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-5 py-4">
          <div>
            <div className="flex items-center gap-2">
              <ShieldCheck size={18} className="text-emerald-800" aria-hidden="true" />
              <h2 className="font-semibold text-slate-900">User accounts</h2>
              <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-medium text-slate-600">{users.length}</span>
            </div>
            <p className="mt-1 text-sm text-slate-500">Operator stall edits change only the registered stall number.</p>
          </div>
          <label className="relative block w-full sm:w-72">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" aria-hidden="true" />
            <input
              className="min-h-10 w-full rounded-md border border-slate-300 bg-white pl-9 pr-3 text-sm text-slate-900 outline-none focus:border-emerald-700 focus:ring-2 focus:ring-emerald-700/15"
              placeholder="Search name, email or stall"
              aria-label="Search users by name, email or stall"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </label>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[850px] text-left text-sm">
            <thead className="bg-slate-50 text-xs font-semibold uppercase tracking-wide text-slate-500">
              <tr>
                <th scope="col" className="px-5 py-3">User</th>
                <th scope="col" className="px-5 py-3">Account type</th>
                <th scope="col" className="px-5 py-3">Stall number</th>
                <th scope="col" className="px-5 py-3">Status</th>
                <th scope="col" className="px-5 py-3">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {shown.map((user) => {
                const busyForUser = busy === `user-${user.id}` || busy === `stall-${user.id}` || busy === `status-${user.id}`;
                const active = user.is_active !== false;
                const stallValue = stalls[user.id] ?? user.stall_number ?? '';
                return (
                  <tr key={user.id} className={active ? '' : 'bg-slate-50 text-slate-500'}>
                    <td className="px-5 py-4">
                      <div className="flex items-center gap-3">
                        <UserRound size={17} className="shrink-0 text-slate-400" aria-hidden="true" />
                        <div>
                          <p className="font-medium text-slate-900">{user.full_name || '—'}</p>
                          <p className="text-xs text-slate-500">{user.email}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-5 py-4 text-slate-700">{ROLE_LABEL[user.role] || user.role}</td>
                    <td className="px-5 py-4">
                      {user.role === 'STALL_OPERATOR' ? (
                        <div className="flex items-center gap-2">
                          <input
                            className="min-h-9 w-36 rounded-md border border-slate-300 px-2.5 text-sm text-slate-900 outline-none focus:border-emerald-700 focus:ring-2 focus:ring-emerald-700/15"
                            aria-label={`Stall number for ${user.full_name || user.email}`}
                            value={stallValue}
                            onChange={(event) => setStalls((current) => ({ ...current, [user.id]: event.target.value }))}
                            disabled={!active || busyForUser}
                          />
                          <button
                            onClick={() => saveStall(user)}
                            disabled={!active || busyForUser || !stallValue.trim() || stallValue.trim() === user.stall_number}
                            className="min-h-9 rounded-md border border-slate-300 px-3 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
                          >
                            Save
                          </button>
                        </div>
                      ) : <span className="text-slate-400">—</span>}
                    </td>
                    <td className="px-5 py-4">
                      <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-medium ${active ? 'bg-emerald-50 text-emerald-800' : 'bg-slate-200 text-slate-700'}`}>
                        {active ? 'Active' : 'Deactivated'}
                      </span>
                    </td>
                    <td className="px-5 py-4">
                      <div className="flex items-center gap-2">
                        {user.role !== 'ADMIN' && active && (
                          <button
                            onClick={() => changeRole(user, user.role === 'STALL_OPERATOR' ? 'RESCUE_BUYER' : 'STALL_OPERATOR')}
                            disabled={busyForUser}
                            className="min-h-9 rounded-md border border-slate-300 px-3 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                          >
                            {user.role === 'STALL_OPERATOR' ? 'Change to buyer' : 'Make operator'}
                          </button>
                        )}
                        {user.role === 'ADMIN' ? (
                          <span className="text-xs text-slate-400">Protected</span>
                        ) : (
                          <button
                            onClick={() => toggleActive(user)}
                            disabled={busyForUser}
                            className={`inline-flex min-h-9 items-center gap-1.5 rounded-md px-3 text-xs font-medium disabled:opacity-50 ${active ? 'border border-red-200 text-red-800 hover:bg-red-50' : 'border border-emerald-200 text-emerald-800 hover:bg-emerald-50'}`}
                          >
                            {active
                              ? <><UserRoundX size={15} aria-hidden="true" /> Deactivate</>
                              : <><UserRoundCheck size={15} aria-hidden="true" /> Restore</>}
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
              {shown.length === 0 && (
                <tr><td colSpan="5" className="px-5 py-8 text-center text-sm text-slate-500">No matching users.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

import { useState } from 'react'
import { Eye, Loader2, UserPlus, X } from 'lucide-react'
import { deviceApi, formatDateTime } from '../api/deviceApi'
import { usePolling } from '../hooks/usePolling'

const personLabel = (p) => p.full_name || p.email || `User ${String(p.user_id).slice(0, 8)}`

/**
 * Camera access. A camera works with its owner alone; the owner may also share it with ONE other
 * stall operator (two people at most). The administrator always has access and is not counted.
 * Only the owner (`canManage`) can give or remove access; everyone else sees the list.
 * `onChanged` is called after an add/remove so the parent can refresh the device (monitor_count).
 */
export default function MonitorsPanel({ deviceId, canManage, onChanged }) {
  const [data, setData] = useState(null)
  const [loadError, setLoadError] = useState('')
  const [email, setEmail] = useState('')
  const [busy, setBusy] = useState('') // 'add' | user_id being removed
  const [message, setMessage] = useState({ kind: '', text: '' })

  usePolling(async () => {
    try {
      setData(await deviceApi.monitors(deviceId))
      setLoadError('')
    } catch (err) {
      setLoadError(err.message)
    }
  }, 30000, deviceId)

  const maximum = data?.maximum ?? 2
  const full = data ? data.count >= maximum : false

  const add = async (e) => {
    e.preventDefault()
    const value = email.trim()
    if (!value) return
    setBusy('add')
    setMessage({ kind: '', text: '' })
    try {
      const next = await deviceApi.addMonitor(deviceId, value)
      setData(next)
      setEmail('')
      setMessage({ kind: 'ok', text: 'Access given.' })
      onChanged?.()
    } catch (err) {
      setMessage({ kind: 'error', text: err.message })
    } finally {
      setBusy('')
    }
  }

  const remove = async (person) => {
    if (!window.confirm(`Remove access for ${personLabel(person)}?`)) return
    setBusy(String(person.user_id))
    setMessage({ kind: '', text: '' })
    try {
      setData(await deviceApi.removeMonitor(deviceId, person.user_id))
      setMessage({ kind: 'ok', text: 'Access removed.' })
      onChanged?.()
    } catch (err) {
      setMessage({ kind: 'error', text: err.message })
    } finally {
      setBusy('')
    }
  }

  return (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5 space-y-4">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-lg font-bold text-slate-800 flex items-center gap-2"><Eye size={18} className="text-[#2A6B48]" /> Camera access</h2>
        {data && (
          <span className="px-2.5 py-1 rounded-full text-xs font-bold border bg-slate-50 text-slate-600 border-slate-200">
            {data.count} of {maximum} people have access
          </span>
        )}
      </div>

      {!data && !loadError && <p className="text-sm text-slate-400 animate-pulse">Loading camera access…</p>}
      {loadError && <p role="alert" className="text-sm text-rose-600">Couldn't load camera access: {loadError}</p>}

      {data && (
        <>
          <p className="text-xs text-slate-500">A camera can be used by its owner alone. You may also give one other stall operator access (two people at most).</p>

          <ul className="divide-y divide-slate-100 text-sm">
            <li className="py-2 flex items-center justify-between gap-3">
              <span className="min-w-0">
                <span className="block font-semibold text-slate-800 truncate">{data.owner?.full_name || data.owner?.email || 'Camera owner'}</span>
                {data.owner?.full_name && data.owner?.email && <span className="block text-xs text-slate-400 truncate">{data.owner.email}</span>}
              </span>
              <span className="text-[11px] font-bold px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200">Owner</span>
            </li>
            {data.monitors.map((m) => (
              <li key={m.user_id} className="py-2 flex items-center justify-between gap-3">
                <span className="min-w-0">
                  <span className="block font-semibold text-slate-800 truncate">{personLabel(m)}</span>
                  <span className="block text-xs text-slate-400 truncate">{m.full_name && m.email ? `${m.email} • ` : ''}access given {formatDateTime(m.added_at)}</span>
                </span>
                <span className="flex items-center gap-2 shrink-0">
                  <span className="text-[11px] font-bold px-2 py-0.5 rounded-full bg-slate-100 text-slate-600 border border-slate-200">Shared with</span>
                  {canManage && (
                    <button type="button" onClick={() => remove(m)} disabled={!!busy}
                            aria-label={`Remove access for ${personLabel(m)}`} title="Remove access"
                            className="p-1.5 rounded-lg text-slate-400 hover:text-rose-500 hover:bg-rose-50 disabled:opacity-40">
                      {busy === String(m.user_id) ? <Loader2 size={14} className="animate-spin" /> : <X size={14} />}
                    </button>
                  )}
                </span>
              </li>
            ))}
            <li className="py-2 flex items-center justify-between gap-3">
              <span className="font-semibold text-slate-800">Administrator: always has access</span>
              <span className="text-[11px] font-bold px-2 py-0.5 rounded-full bg-sky-50 text-sky-700 border border-sky-200">Administrator</span>
            </li>
          </ul>

          {canManage && full && (
            <p className="text-xs text-slate-500">Two people have access (the limit). Remove one to choose someone else.</p>
          )}
          {canManage && !full ? (
            <form onSubmit={add} className="space-y-2">
              <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider" htmlFor="monitor-email">Give access to another stall operator (email)</label>
              <div className="flex gap-2">
                <input id="monitor-email" type="email" required value={email} disabled={busy === 'add'}
                       onChange={(e) => { setEmail(e.target.value); setMessage({ kind: '', text: '' }) }}
                       placeholder="operator@example.com"
                       className="flex-1 min-w-0 px-3 py-2 rounded-xl border border-slate-200 focus:border-[#2A6B48] focus:ring-2 focus:ring-emerald-100 outline-none text-sm bg-white disabled:bg-slate-50" />
                <button type="submit" disabled={!email.trim() || !!busy}
                        className="px-4 py-2 rounded-xl font-bold text-white bg-[#2A6B48] hover:bg-[#1f5035] disabled:opacity-50 flex items-center gap-2 text-sm">
                  {busy === 'add' ? <Loader2 size={14} className="animate-spin" /> : <UserPlus size={14} />} Give access
                </button>
              </div>
              <p className="text-[11px] text-slate-400">The person needs an approved stall-operator account.</p>
            </form>
          ) : !canManage ? (
            <p className="text-[11px] text-slate-400">Only the camera owner can choose who has access.</p>
          ) : null}
        </>
      )}

      {message.text && (
        <p role={message.kind === 'error' ? 'alert' : 'status'} className={`text-xs ${message.kind === 'error' ? 'text-rose-600' : 'text-emerald-700'}`}>{message.text}</p>
      )}
    </div>
  )
}

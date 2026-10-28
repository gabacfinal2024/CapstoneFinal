import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Camera, ChevronRight, UserCog, Receipt, Bell, Cpu, LogOut, Pencil, Images, FlaskConical } from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import BottomNav from '../components/BottomNav'
import { supabase } from '../lib/supabase'
import { api } from '../api/supabaseApi'
import { publishAvatar } from '../utils/photo'
import './Profile.css'

export default function Profile() {
  const { user, logout, isOperator } = useAuth()
  const navigate = useNavigate()
  const [uploading, setUploading] = useState(false)
  const [editing, setEditing] = useState(false)
  const [name, setName] = useState(user?.full_name || '')
  const [saving, setSaving] = useState(false)
  const [stats, setStats] = useState(null)
  const [request, setRequest] = useState(null)
  const [applying, setApplying] = useState(false)
  const [stall, setStall] = useState('')
  const [note, setNote] = useState('')
  const [sending, setSending] = useState(false)

  useEffect(() => {
    if (!user?.role) return
    api.profileStats(user.role).then(setStats).catch(() => setStats({}))
  }, [user?.id, user?.role])

  useEffect(() => {
    if (!user?.id || isOperator) return
    api.myRoleRequest().then(setRequest).catch(() => setRequest(null))
  }, [user?.id, isOperator])

  const handleApply = async () => {
    if (!stall.trim()) return alert('Please enter your stall number.')
    setSending(true)
    try {
      await api.requestOperatorRole(stall.trim(), note.trim())
      setRequest(await api.myRoleRequest())
      setApplying(false)
      setStall('')
      setNote('')
    } catch (err) {
      alert(err.message || 'Could not send your request.')
    } finally {
      setSending(false)
    }
  }

  const handleFile = async (e) => {
    const input = e.target
    const file = input.files?.[0]
    if (!file) return
    if (!file.type.startsWith('image/')) {
      input.value = ''
      return alert('Please choose an image file.')
    }
    setUploading(true)
    try {
      const url = await publishAvatar(supabase, file, user.id)
      const { data, error } = await supabase.from('profiles').update({ avatar_url: url }).eq('id', user.id).select('id')
      if (error) throw error
      if (!data?.length) throw new Error('your profile could not be updated')
      window.location.reload()
    } catch (err) {
      alert('Upload failed: ' + (err.message || err))
      setUploading(false)
    } finally {
      input.value = ''
    }
  }

  const handleSave = async () => {
    if (!name.trim()) return alert('Please enter your name.')
    setSaving(true)
    try {
      const { error } = await supabase.from('profiles').update({ full_name: name.trim() }).eq('id', user.id)
      if (error) throw error
      window.location.reload()
    } catch (err) {
      alert('Could not save changes: ' + (err.message || err))
    } finally {
      setSaving(false)
    }
  }

  const startEditing = () => {
    setName(user?.full_name || '')
    setEditing(true)
  }

  const menu = [
    { icon: UserCog, label: 'Account Settings', hint: 'Name, email and password', onClick: () => navigate('/account-settings') },
    { icon: Receipt, label: 'Transaction History', hint: 'Completed deals (Messages → Archived)', onClick: () => navigate('/messages') },
    { icon: Bell, label: 'Notifications', hint: 'Alerts about your batches and chats', onClick: () => navigate('/notifications') },
    { icon: FlaskConical, label: 'How days-to-spoil is calculated', hint: 'The method and the studies behind it', onClick: () => navigate('/basis') },
    ...(isOperator ? [{ icon: Cpu, label: 'IoT Device Management', hint: 'Cameras and sensors', onClick: () => navigate('/devices') },
      { icon: Images, label: 'Scan Gallery', hint: 'Recent pictures your cameras analysed', onClick: () => navigate('/gallery') }] : []),
  ]

  return (
    <div className="app-shell">
      <div className="page profile">
        <h1 className="profile-title">Profile</h1>

        <section className="profile-hero card">
          <div className="avatar-wrap">
            <div className="avatar">
              {user?.avatar_url ? <img src={user.avatar_url} alt="Profile" /> : (user?.full_name?.[0]?.toUpperCase() || '?')}
            </div>
            <label className="avatar-edit" aria-label="Change profile photo">
              <Camera size={16} />
              <input type="file" accept="image/*" onChange={handleFile} hidden />
            </label>
          </div>
          {uploading && <small className="upload-note">Uploading photo...</small>}

          <h2>{user?.full_name || 'Your name'}</h2>
          <p className="profile-email">{user?.email}</p>
          <span className="role-badge">{isOperator ? 'Stall Operator' : 'Rescue Buyer'}</span>

          {!editing ? (
            <button className="btn btn-outline edit-btn" onClick={startEditing}>
              <Pencil size={15} /> Edit Profile
            </button>
          ) : (
            <div className="edit-form">
              <div className="field">
                <label>Full name</label>
                <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Your full name" />
              </div>
              <div className="field">
                <label>Account type</label>
                <input value={isOperator ? 'Stall Operator' : 'Rescue Buyer'} disabled readOnly />
                <small className="field-note">Set when you registered. It cannot be changed.</small>
              </div>
              <div className="edit-actions">
                <button className="btn btn-outline" onClick={() => setEditing(false)}>Cancel</button>
                <button className="btn btn-green" onClick={handleSave} disabled={saving}>
                  {saving ? 'Saving...' : 'Save Changes'}
                </button>
              </div>
            </div>
          )}
        </section>

        {!isOperator && (
          <section className="apply-card card">
            <h3>Sell as a stall operator</h3>
            {request?.status === 'PENDING' ? (
              <p className="apply-status">Request sent for <strong>{request.requested_stall_number}</strong>. An administrator will review it and you will get a notification.</p>
            ) : applying ? (
              <div className="edit-form">
                <div className="field">
                  <label>Stall number</label>
                  <input value={stall} onChange={(e) => setStall(e.target.value)} placeholder="e.g. Stall 1" />
                </div>
                <div className="field">
                  <label>Note for the administrator (optional)</label>
                  <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="What do you sell?" />
                </div>
                <div className="edit-actions">
                  <button className="btn btn-outline" onClick={() => setApplying(false)}>Cancel</button>
                  <button className="btn btn-green" onClick={handleApply} disabled={sending}>{sending ? 'Sending...' : 'Send request'}</button>
                </div>
              </div>
            ) : (
              <>
                <p className="apply-status">
                  {request?.status === 'REJECTED' ? 'Your last request was declined. You can apply again.' : 'Your account is a rescue buyer account. Apply to list your own produce.'}
                </p>
                <button className="btn btn-outline" onClick={() => setApplying(true)}>Apply as stall operator</button>
              </>
            )}
          </section>
        )}

        <section className="stats-row">
          {isOperator ? (
            <>
              <div className="stat card"><strong>{stats?.batches ?? '—'}</strong><span>Batches</span></div>
              <div className="stat card"><strong>{stats?.sold ?? '—'}</strong><span>Sold</span></div>
              <div className="stat card">
                <strong>{stats?.rating ? `★ ${stats.rating.average.toFixed(1)}` : '—'}</strong>
                <span>{stats?.rating ? `${stats.rating.count} rating${stats.rating.count === 1 ? '' : 's'}` : 'No ratings yet'}</span>
              </div>
            </>
          ) : (
            <>
              <div className="stat card"><strong>{stats?.orders ?? '—'}</strong><span>Chats</span></div>
              <div className="stat card"><strong>{stats?.completed ?? '—'}</strong><span>Completed</span></div>
            </>
          )}
        </section>

        <section className="settings-list card">
          {menu.map(({ icon: Icon, label, hint, onClick }) => (
            <button key={label} className="settings-item" onClick={onClick}>
              <span className="settings-icon"><Icon size={18} /></span>
              <span className="settings-text">
                <strong>{label}</strong>
                <small>{hint}</small>
              </span>
              <ChevronRight size={18} className="settings-chevron" />
            </button>
          ))}
        </section>

        <button className="sign-out" onClick={logout}>
          <LogOut size={17} /> Sign Out
        </button>
      </div>
      <BottomNav />
    </div>
  )
}
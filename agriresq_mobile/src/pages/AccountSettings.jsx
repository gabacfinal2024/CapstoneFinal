import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import BottomNav from '../components/BottomNav'
import { supabase } from '../lib/supabase'
import './AccountSettings.css'

function Message({ msg }) {
  if (!msg.text) return null
  return <p className={msg.type === 'error' ? 'error-text' : 'success-text'}>{msg.text}</p>
}

export default function AccountSettings() {
  const { user } = useAuth()

  // profile details
  const [name, setName] = useState(user?.full_name || '')
  const [phone, setPhone] = useState(user?.phone || '')
  const [profileMsg, setProfileMsg] = useState({})
  const [savingProfile, setSavingProfile] = useState(false)

  // email
  const [email, setEmail] = useState(user?.email || '')
  const [emailMsg, setEmailMsg] = useState({})
  const [savingEmail, setSavingEmail] = useState(false)

  // password
  const [currentPw, setCurrentPw] = useState('')
  const [newPw, setNewPw] = useState('')
  const [confirmPw, setConfirmPw] = useState('')
  const [showPw, setShowPw] = useState(false)
  const [pwMsg, setPwMsg] = useState({})
  const [savingPw, setSavingPw] = useState(false)

  const saveProfile = async (e) => {
    e.preventDefault()
    setProfileMsg({})
    if (!name.trim()) return setProfileMsg({ type: 'error', text: 'Name cannot be empty.' })
    setSavingProfile(true)
    const { error } = await supabase
      .from('profiles')
      .update({ full_name: name.trim(), phone: phone.trim() || null })
      .eq('id', user.id)
    setSavingProfile(false)
    if (error) return setProfileMsg({ type: 'error', text: error.message })
    setProfileMsg({ type: 'success', text: 'Profile updated.' })
  }

  const saveEmail = async (e) => {
    e.preventDefault()
    setEmailMsg({})
    if (email.trim() === user.email) return setEmailMsg({ type: 'error', text: 'That is already your email.' })
    setSavingEmail(true)
    const { error } = await supabase.auth.updateUser({ email: email.trim() })
    setSavingEmail(false)
    if (error) return setEmailMsg({ type: 'error', text: error.message })
    setEmailMsg({ type: 'success', text: 'Check your new email inbox to confirm the change.' })
  }

  const savePassword = async (e) => {
    e.preventDefault()
    setPwMsg({})
    if (newPw.length < 6) return setPwMsg({ type: 'error', text: 'New password must be at least 6 characters.' })
    if (newPw !== confirmPw) return setPwMsg({ type: 'error', text: 'Passwords do not match.' })
    setSavingPw(true)
    // verify current password first
    const { error: verifyErr } = await supabase.auth.signInWithPassword({ email: user.email, password: currentPw })
    if (verifyErr) {
      setSavingPw(false)
      return setPwMsg({ type: 'error', text: 'Current password is incorrect.' })
    }
    const { error } = await supabase.auth.updateUser({ password: newPw })
    setSavingPw(false)
    if (error) return setPwMsg({ type: 'error', text: error.message })
    setCurrentPw(''); setNewPw(''); setConfirmPw('')
    setPwMsg({ type: 'success', text: 'Password changed.' })
  }

  return (
    <div className="app-shell">
      <div className="page account-settings">
        <Link to="/profile" className="back-link">← Back</Link>
        <h2>Account Settings</h2>

        <form className="card settings-card" onSubmit={saveProfile}>
          <h3>Personal Info</h3>
          <div className="input-group">
            <label>Full name</label>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Full name" required />
          </div>
          <div className="input-group">
            <label>Phone number</label>
            <input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="09XX XXX XXXX" />
          </div>
          <Message msg={profileMsg} />
          <button className="btn btn-green" disabled={savingProfile}>{savingProfile ? 'Saving...' : 'Save Changes'}</button>
        </form>

        <form className="card settings-card" onSubmit={saveEmail}>
          <h3>Email</h3>
          <div className="input-group">
            <label>Email address</label>
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
          </div>
          <Message msg={emailMsg} />
          <button className="btn btn-green" disabled={savingEmail}>{savingEmail ? 'Saving...' : 'Update Email'}</button>
        </form>

        <form className="card settings-card" onSubmit={savePassword}>
          <h3>Change Password</h3>
          <div className="input-group">
            <label>Current password</label>
            <input type={showPw ? 'text' : 'password'} value={currentPw} onChange={(e) => setCurrentPw(e.target.value)} required />
          </div>
          <div className="input-group">
            <label>New password</label>
            <input type={showPw ? 'text' : 'password'} value={newPw} onChange={(e) => setNewPw(e.target.value)} required />
          </div>
          <div className="input-group">
            <label>Confirm new password</label>
            <input type={showPw ? 'text' : 'password'} value={confirmPw} onChange={(e) => setConfirmPw(e.target.value)} required />
          </div>
          <button type="button" className="btn-link small" onClick={() => setShowPw((s) => !s)}>
            {showPw ? 'Hide passwords' : 'Show passwords'}
          </button>
          <Message msg={pwMsg} />
          <button className="btn btn-green" disabled={savingPw}>{savingPw ? 'Updating...' : 'Change Password'}</button>
        </form>
      </div>
      <BottomNav />
    </div>
  )
}
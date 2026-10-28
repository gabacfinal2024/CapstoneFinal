import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { api } from '../api/supabaseApi'
import './Auth.css'

export default function ResetPassword() {
  const navigate = useNavigate()
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError('')
    setMessage('')

    if (!password || !confirmPassword) {
      setError('Please enter your new password and confirm it.')
      return
    }
    if (password !== confirmPassword) {
      setError('Passwords do not match.')
      return
    }
    if (password.length < 8) {
      setError('Password must be at least 8 characters long.')
      return
    }

    setLoading(true)
    try {
      await api.updatePassword(password)
      setMessage('Password updated successfully. Redirecting to login...')
      setTimeout(() => navigate('/login'), 1800)
    } catch (err) {
      setError(err.message || 'Failed to update password.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="auth-page auth-page--bulua page-no-nav">
      <div className="auth-header">
        <Link to="/login" className="back-link">← Back</Link>
        <h2>Reset Password</h2>
        <p>Choose a new password for your account.</p>
      </div>
      <form className="auth-form card" onSubmit={handleSubmit}>
        <div className="input-group">
          <label>New Password</label>
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required placeholder="••••••••" />
        </div>
        <div className="input-group">
          <label>Confirm Password</label>
          <input type="password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} required placeholder="••••••••" />
        </div>
        {message && <p className="success-text">{message}</p>}
        {error && <p className="error-text">{error}</p>}
        <button type="submit" className="btn btn-green" disabled={loading}>
          {loading ? 'Updating...' : 'Reset Password'}
        </button>
        <p className="auth-footer">
          Remembered your password? <Link to="/login">Sign In</Link>
        </p>
      </form>
    </div>
  )
}

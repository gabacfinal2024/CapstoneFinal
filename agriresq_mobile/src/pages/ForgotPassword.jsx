import { useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../api/supabaseApi'
import './Auth.css'

export default function ForgotPassword() {
  const [email, setEmail] = useState('')
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError('')
    setMessage('')
    setLoading(true)

    try {
      await api.sendPasswordResetEmail(email)
      setMessage('Check your email for a password reset link.')
    } catch (err) {
      setError(err.message || 'Failed to send reset email.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="auth-page auth-page--bulua page-no-nav">
      <div className="auth-header">
        <Link to="/login" className="back-link">← Back</Link>
        <h2>Forgot Password</h2>
        <p>Enter your email to receive a reset link.</p>
      </div>
      <form className="auth-form card" onSubmit={handleSubmit}>
        <div className="input-group">
          <label>Email</label>
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required placeholder="you@email.com" />
        </div>
        {message && <p className="success-text">{message}</p>}
        {error && <p className="error-text">{error}</p>}
        <button type="submit" className="btn btn-green" disabled={loading}>
          {loading ? 'Sending...' : 'Send Reset Link'}
        </button>
        <p className="auth-footer">
          Remember your password? <Link to="/login">Sign In</Link>
        </p>
      </form>
    </div>
  )
}

import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import './Auth.css'

export default function Register() {
  const { register } = useAuth()
  const [form, setForm] = useState({
    full_name: '', email: '', phone_number: '', password: '',
    buyer_type: 'RETAILER',
  })
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [registeredEmail, setRegisteredEmail] = useState('')

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }))

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      await register({ ...form, role: 'RESCUE_BUYER' })
      setRegisteredEmail(form.email.trim().toLowerCase())
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="auth-page auth-page--bulua page-no-nav">
      <div className="auth-header">
        <Link to="/" className="back-link">← Back</Link>
        <h2>Create Account</h2>
        <p>Join the AgriResQ marketplace</p>
      </div>
      {registeredEmail ? (
        <div className="auth-form card">
          <h3>Verify your email</h3>
          <p>
            We sent a confirmation link to <strong>{registeredEmail}</strong>.
            Open that email and verify your address before signing in.
          </p>
          <Link className="btn btn-green" to="/login">Continue to Sign In</Link>
        </div>
      ) : (
      <form className="auth-form card" onSubmit={handleSubmit}>
        <div className="input-group">
          <label>Full Name</label>
          <input value={form.full_name} onChange={(e) => set('full_name', e.target.value)} required />
        </div>
        <div className="input-group">
          <label>Email</label>
          <input type="email" autoComplete="email" value={form.email} onChange={(e) => set('email', e.target.value)} required />
        </div>
        <div className="input-group">
          <label>Phone Number</label>
          <input type="tel" value={form.phone_number} onChange={(e) => set('phone_number', e.target.value)} placeholder="09XX XXX XXXX" />
        </div>
        <div className="input-group">
          <label>Password</label>
          <div className="password-row">
            <input type={showPassword ? 'text' : 'password'} value={form.password} onChange={(e) => set('password', e.target.value)} required minLength={8} />
            <button type="button" className="btn-link small" onClick={() => setShowPassword((s) => !s)}>{showPassword ? 'Hide' : 'Show'}</button>
          </div>
        </div>
        <p className="auth-note">
          New accounts start as <strong>Rescue Buyers</strong>. To sell as a stall operator, apply from your Profile after signing in. An administrator reviews the request.
        </p>
        {error && <p className="error-text">{error}</p>}
        <button type="submit" className="btn btn-green" disabled={loading}>
          {loading ? 'Creating...' : 'Create Account'}
        </button>
        <p className="auth-footer">
          Already have an account? <Link to="/login">Sign In</Link>
        </p>
      </form>
      )}
    </div>
  )
}

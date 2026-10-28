import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import './Auth.css'

export default function Login() {
  const { login } = useAuth()
  const navigate = useNavigate()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      await login(email, password)
      navigate('/home')
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
        <h2>Welcome Back</h2>
        <p>Sign in to your AgriResQ account</p>
      </div>
      <form className="auth-form card" onSubmit={handleSubmit}>
        <div className="input-group">
          <label>Email</label>
          <input type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required placeholder="you@email.com" />
        </div>
        <div className="input-group">
          <label>Password</label>
          <div className="password-row">
            <input type={showPassword ? 'text' : 'password'} autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required placeholder="••••••••" />
            <button type="button" className="btn-link small" onClick={() => setShowPassword((s) => !s)}>{showPassword ? 'Hide' : 'Show'}</button>
          </div>
        </div>

        <div style={{ textAlign: "right", marginBottom: "1.5rem" }}>
                     <Link to="/forgot-password" style={{ fontSize: "12px", color: "#155E52", textDecoration: "none" }}>
                       Forgot password?
                     </Link>
                   </div>
                   
        {error && <p className="error-text">{error}</p>}
        <button type="submit" className="btn btn-green" disabled={loading}>
          {loading ? 'Signing in...' : 'Sign In'}
        </button>
        <p className="auth-footer">
          Don't have an account? <Link to="/register">Register</Link>
        </p>
      </form>
    </div>
  )
}

import { useNavigate } from 'react-router-dom'
import { ArrowRight, LogIn } from 'lucide-react'
import './Splash.css'


export default function Splash() {
  const navigate = useNavigate()
  return (
    <div className="splash splash--bulua page-no-nav">
      <div className="splash-content">
        <div className="logo-wrap">
          <div className="logo-brand">
            <img className="logo-icon" src="/agriresq-logo.svg" alt="" />
            <h1>AgriResQ</h1>
          </div>
          <p>IoT-Assisted Rescue Distribution for Surplus Vegetables</p>
        </div>
        <div className="splash-actions">
          <button className="btn btn-primary" onClick={() => navigate('/register')}>Get Started <ArrowRight size={18} /></button>
          <button className="btn btn-outline" onClick={() => navigate('/login')}><LogIn size={17} /> Login</button>
        </div>
      </div>
    </div>
  )
}
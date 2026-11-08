import { Link, Navigate } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import ScanGallery from '../components/ScanGallery'
import BottomNav from '../components/BottomNav'
import '../styles/devices.css'

/** Scan Gallery: recent analysed pictures from all of the operator's cameras. */
export default function Gallery() {
  const { isOperator } = useAuth()

  if (!isOperator) return <Navigate to="/home" replace />

  return (
    <div className="app-shell">
      <div className="page gallery-page">
        <Link to="/devices" className="dev-back"><ArrowLeft size={16} /> Devices</Link>
        <header style={{ marginBottom: 14 }}>
          <h1 className="dev-title">Scan Gallery</h1>
        </header>
        <ScanGallery pageSize={12} />
      </div>
      <BottomNav />
    </div>
  )
}

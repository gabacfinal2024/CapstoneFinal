import { useState } from 'react'
import { Link, Navigate, useSearchParams } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'
import { deviceApi, isSensor } from '../api/deviceApi'
import { useAuth } from '../context/AuthContext'
import usePolling from '../hooks/usePolling'
import ScanGallery from '../components/ScanGallery'
import BottomNav from '../components/BottomNav'
import '../styles/devices.css'

/** Scan Gallery: recent analysed pictures from all of the operator's cameras. */
export default function Gallery() {
  const { isOperator } = useAuth()
  const [params] = useSearchParams()
  const [devices, setDevices] = useState([])

  // cameras for the filter dropdown (owned + shared with you; sensor nodes take no pictures); a failure just hides the dropdown
  usePolling(async () => {
    try { setDevices((await deviceApi.devices()).filter((d) => !isSensor(d))) } catch { /* keep the previous list */ }
  }, 60000, { enabled: !!isOperator })

  if (!isOperator) return <Navigate to="/home" replace />

  const initial = params.get('device') || ''

  return (
    <div className="app-shell">
      <div className="page gallery-page">
        <Link to="/devices" className="dev-back"><ArrowLeft size={16} /> Devices</Link>
        <header style={{ marginBottom: 14 }}>
          <h1 className="dev-title">Scan Gallery</h1>
          <p className="dev-subtitle">Recent pictures analysed by your cameras</p>
        </header>
        <ScanGallery devices={devices} initialCamera={initial} pageSize={12} />
      </div>
      <BottomNav />
    </div>
  )
}

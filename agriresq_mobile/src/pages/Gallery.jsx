import PageTitle from '../components/PageTitle'
import { Navigate } from 'react-router-dom'
import { BackLink } from '../context/BackNavigationContext'
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
        <BackLink to="/devices" className="dev-back"><ArrowLeft size={16} /> Back</BackLink>
        <header className="page-title-header">
          <PageTitle>Scan Gallery</PageTitle>
        </header>
        <ScanGallery pageSize={12} />
      </div>
      <BottomNav />
    </div>
  )
}

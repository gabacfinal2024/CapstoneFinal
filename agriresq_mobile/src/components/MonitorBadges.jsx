import { Share2, Thermometer } from 'lucide-react'
import { isSharedWithMe, isSensor } from '../api/deviceApi'

/** "Shared with you" badge for devices another stall operator owns and gave you access to. */
export function AccessBadge({ device }) {
  if (!isSharedWithMe(device)) return null
  return <span className="access-badge"><Share2 size={12} /> Shared with you</span>
}

/** "Sensor node" badge for a DHT22-only device (no camera). */
export function SensorBadge({ device }) {
  if (!isSensor(device)) return null
  return <span className="sensor-badge"><Thermometer size={12} /> Sensor node</span>
}

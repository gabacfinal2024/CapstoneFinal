import { Link } from 'react-router-dom'
import { CROP_LABELS } from '../utils/helpers'
import StatusBadge from './StatusBadge'
import './SensorListings.css'

export default function SensorListings({ device }) {
  const listings = device.sensor_listings

  return (
    <div className="sensor-listings">
      <h3>Vegetable listings</h3>
      {device.dht_pin < 0 ? <p>DHT22 is not configured.</p>
        : !Array.isArray(listings) ? <p>Could not load this sensor’s listings.</p>
        : listings.length === 0 ? <p>No active vegetable listings at this stall.</p>
        : (
          <ul>
            {listings.map((item) => (
              <li key={item.listing_id}>
                <Link to={`/produce/${item.listing_id}`}>
                  <span><strong>{CROP_LABELS[item.crop_type] || item.crop_type}</strong><small>Batch #{item.id} · {item.quantity_kg} kg</small></span>
                  <StatusBadge status={item.freshness_status} size="sm" />
                </Link>
              </li>
            ))}
          </ul>
        )}
    </div>
  )
}

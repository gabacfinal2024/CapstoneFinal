import { useEffect, useState } from 'react'
import { Check, Copy, ExternalLink, Eye, Thermometer, Wifi } from 'lucide-react'
import { ACCESS_LABELS, isSensor, signalLabel, timeAgo } from '../api/deviceApi'

/** Copy text to the clipboard (works on plain-http dev origins too). */
async function copyText(text) {
  try {
    if (navigator.clipboard?.writeText && window.isSecureContext) {
      await navigator.clipboard.writeText(text)
      return true
    }
  } catch { /* fall through to the legacy path */ }
  try {
    const area = document.createElement('textarea')
    area.value = text
    area.setAttribute('readonly', '')
    area.style.position = 'fixed'
    area.style.opacity = '0'
    document.body.appendChild(area)
    area.select()
    const ok = document.execCommand('copy')
    document.body.removeChild(area)
    return ok
  } catch {
    return false
  }
}

export function CopyButton({ text, label = 'Copy', className = '' }) {
  const [state, setState] = useState('idle') // idle | copied | failed

  useEffect(() => {
    if (state === 'idle') return undefined
    const t = setTimeout(() => setState('idle'), 1800)
    return () => clearTimeout(t)
  }, [state])

  return (
    <button
      type="button"
      onClick={async (e) => {
        e.preventDefault()
        e.stopPropagation()
        setState((await copyText(text)) ? 'copied' : 'failed')
      }}
      aria-label={`${label} ${text}`}
      title={state === 'failed' ? 'Copy failed, select the text manually' : `${label}`}
      className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[11px] font-bold border border-slate-200 bg-white text-slate-500 hover:text-[#2A6B48] hover:border-emerald-200 ${className}`}
    >
      {state === 'copied' ? <Check size={12} className="text-emerald-600" /> : <Copy size={12} />}
      <span aria-live="polite">{state === 'copied' ? 'Copied' : state === 'failed' ? 'Failed' : label}</span>
    </button>
  )
}

/**
 * The camera's LAN IP with copy + "open" link.
 * The camera's own status page only answers on the same Wi-Fi/LAN as the camera, so the link is
 * labelled that way and only offered while the camera is online.
 */
export function IpAddress({ ip, online = false, showLink = true, className = '' }) {
  if (!ip) {
    return <span className={`text-slate-400 italic ${className}`}>IP unknown</span>
  }
  return (
    <span className={`inline-flex flex-wrap items-center gap-1.5 ${className}`}>
      <span className="font-mono text-slate-700">{ip}</span>
      <CopyButton text={ip} label="Copy IP" />
      {showLink && online && (
        <a
          href={`http://${ip}`}
          target="_blank"
          rel="noopener noreferrer"
          onClick={(e) => e.stopPropagation()}
          title="Opens the device's own status page. Only works from a computer on the same Wi-Fi/LAN as the device."
          className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[11px] font-bold border border-slate-200 bg-white text-slate-500 hover:text-[#2A6B48] hover:border-emerald-200"
        >
          <ExternalLink size={12} /> Open (same Wi-Fi only)
        </a>
      )}
      {!online && <span className="text-[11px] text-slate-400">(last known)</span>}
    </span>
  )
}

/** One-line network facts: SSID, signal, firmware, last seen. */
export function NetworkFacts({ device, now, className = '' }) {
  return (
    <span className={`inline-flex flex-wrap items-center gap-x-3 gap-y-1 ${className}`}>
      <span className="inline-flex items-center gap-1"><Wifi size={12} /> {device.wifi_ssid || 'Wi-Fi unknown'} • {signalLabel(device.rssi)}</span>
      <span>fw {device.fw_version || '—'}</span>
      <span>seen {timeAgo(device.last_seen, now)}</span>
    </span>
  )
}

/** "1 of 2 people have access" chip. Sharing is optional, so this is informational only. */
export function AccessCount({ device, maximum = 2, className = '' }) {
  if (device?.monitor_count == null) return null
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-bold border bg-slate-50 text-slate-600 border-slate-200 ${className}`}>
      <Eye size={12} /> {device.monitor_count} of {maximum} people have access
    </span>
  )
}

/** "Your access: Owner / Shared with you / Administrator". */
export function AccessBadge({ device, className = '' }) {
  if (!device?.my_access) return null
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-bold bg-slate-100 text-slate-600 border border-slate-200 ${className}`}>
      <Eye size={12} /> Your access: {ACCESS_LABELS[device.my_access] || device.my_access}
    </span>
  )
}

/** "Sensor node" badge for a DHT22-only device (no camera). Renders nothing for cameras. */
export function SensorBadge({ device, className = '' }) {
  if (!isSensor(device)) return null
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-bold bg-sky-50 text-sky-700 border border-sky-200 ${className}`}>
      <Thermometer size={12} /> Sensor node
    </span>
  )
}

export function OnlinePill({ online, className = '' }) {
  return (
    <span className={`shrink-0 px-2.5 py-1 text-xs font-bold rounded-full ${online ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-500'} ${className}`}>
      ● {online ? 'Online' : 'Offline'}
    </span>
  )
}

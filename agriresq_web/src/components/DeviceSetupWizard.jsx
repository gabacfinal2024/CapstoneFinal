import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  CheckCircle2, ChevronRight, Loader2, Lock, Power, RefreshCw, Router, Wifi, WifiOff, X,
} from 'lucide-react'
import { CROPS, SETUP_URL, deviceApi } from '../api/deviceApi'
import { useNow, usePolling } from '../hooks/usePolling'

const STEPS = ['Details', 'Join camera Wi-Fi', 'Choose stall Wi-Fi', 'Connecting', 'Reconnect', 'Done']

const DEVICE_STATE_TEXT = {
  idle: 'Waiting for Wi-Fi details…',
  connecting: 'Camera is joining the stall Wi-Fi…',
  wifi_failed: 'The camera could not join that Wi-Fi.',
  claiming: 'Connected to Wi-Fi. Registering with AgriResQ…',
  claim_failed: 'The camera joined Wi-Fi but could not reach the AgriResQ server.',
  done: 'Camera registered. It is restarting in normal mode.',
}

function StepHeader({ step }) {
  return (
    <ol className="flex flex-wrap gap-x-3 gap-y-1 text-[11px] font-bold uppercase tracking-wider mb-6">
      {STEPS.map((label, i) => (
        <li key={label} className={`flex items-center gap-1 ${i === step ? 'text-[#2A6B48]' : i < step ? 'text-slate-400' : 'text-slate-300'}`}>
          <span className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] ${i === step ? 'bg-[#2A6B48] text-white' : i < step ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100'}`}>
            {i < step ? '✓' : i + 1}
          </span>
          {label}
          {i < STEPS.length - 1 && <ChevronRight size={12} className="text-slate-300" />}
        </li>
      ))}
    </ol>
  )
}

function Field({ label, children }) {
  return (
    <label className="block">
      <span className="text-xs font-bold text-slate-500 uppercase tracking-wider">{label}</span>
      <div className="mt-1">{children}</div>
    </label>
  )
}

const inputCls = 'w-full px-3 py-2.5 rounded-xl border border-slate-200 focus:border-[#2A6B48] focus:ring-2 focus:ring-emerald-100 outline-none text-sm'
const primaryBtn = 'px-5 py-2.5 rounded-xl font-bold text-white bg-[#2A6B48] hover:bg-[#1f5035] disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2'
const ghostBtn = 'px-4 py-2.5 rounded-xl font-bold text-slate-600 border border-slate-200 hover:bg-slate-50 flex items-center gap-2'

export default function DeviceSetupWizard({ onClose, onDone }) {
  const navigate = useNavigate()
  const now = useNow(1000)
  const [step, setStep] = useState(0)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const [details, setDetails] = useState({ name: 'Stall camera', stall_location: '', crop_type: 'EGGPLANT' })
  const [pairing, setPairing] = useState(null)
  const [deviceInfo, setDeviceInfo] = useState(null)
  const [networks, setNetworks] = useState([])
  const [scanningNetworks, setScanningNetworks] = useState(false)
  const [ssid, setSsid] = useState('')
  const [manualSsid, setManualSsid] = useState(false)
  const [password, setPassword] = useState('')
  const [deviceState, setDeviceState] = useState(null)
  const [statusMisses, setStatusMisses] = useState(0)
  const [claimedDevice, setClaimedDevice] = useState(null)

  const secondsLeft = pairing ? Math.max(0, Math.round((new Date(pairing.expires_at).getTime() - now) / 1000)) : null

  // Step 0 → create a pairing code (needs the normal internet/LAN connection)
  const createPairing = async () => {
    setBusy(true)
    setError('')
    try {
      const p = await deviceApi.createPairing({
        name: details.name.trim() || 'Stall camera',
        stall_location: details.stall_location.trim(),
        crop_type: details.crop_type,
      })
      setPairing(p)
      setStep(1)
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  // Step 1 → confirm the computer is on the camera's hotspot
  const checkHotspot = async () => {
    setBusy(true)
    setError('')
    try {
      const info = await deviceApi.setup.info()
      setDeviceInfo(info)
      setStep(2)
      loadNetworks()
    } catch (err) {
      setError(`Can't reach the camera at ${SETUP_URL}. Make sure this computer is connected to the ${pairing.setup_ap_prefix}XXXX Wi-Fi. (${err.message})`)
    } finally {
      setBusy(false)
    }
  }

  const loadNetworks = async () => {
    setScanningNetworks(true)
    try {
      const list = await deviceApi.setup.networks()
      const unique = []
      for (const n of [...list].sort((a, b) => b.rssi - a.rssi)) {
        if (n.ssid && !unique.some((u) => u.ssid === n.ssid)) unique.push(n)
      }
      setNetworks(unique)
      if (unique.length && !ssid) setSsid(unique[0].ssid)
    } catch (err) {
      setError(`Couldn't list Wi-Fi networks: ${err.message}. You can type the network name instead.`)
      setManualSsid(true)
    } finally {
      setScanningNetworks(false)
    }
  }

  // Step 2 → send Wi-Fi + pairing code to the camera
  const provision = async () => {
    setBusy(true)
    setError('')
    try {
      await deviceApi.setup.provision({ ssid: ssid.trim(), password, server: pairing.server_url, code: pairing.code })
      setDeviceState({ state: 'connecting' })
      setStatusMisses(0)
      setStep(3)
    } catch (err) {
      setError(`The camera did not accept the settings: ${err.message}`)
    } finally {
      setBusy(false)
    }
  }

  // Step 3 → follow the camera's progress while we're still on its hotspot
  usePolling(async () => {
    try {
      const s = await deviceApi.setup.status()
      setDeviceState(s)
      setStatusMisses(0)
      if (s.state === 'wifi_failed') {
        setError(`${DEVICE_STATE_TEXT.wifi_failed} Check the password and that it is a 2.4 GHz network. ${s.message || ''}`)
        setStep(2)
      } else if (s.state === 'claim_failed') {
        setError(`${DEVICE_STATE_TEXT.claim_failed} Is the Django server running and reachable at ${pairing.server_url}? ${s.message || ''}`)
        setStep(2)
      } else if (s.state === 'done') {
        setStep(4)
      }
    } catch {
      // Expected: once the camera leaves setup mode its hotspot disappears.
      const misses = statusMisses + 1
      setStatusMisses(misses)
      if (misses >= 3) setStep(4)
    }
  }, 1500, 'device-status', step === 3)

  // Step 4 → back on the normal network, wait for the backend to see the claim
  usePolling(async () => {
    try {
      const res = await deviceApi.pairingStatus(pairing.code)
      if (res.status === 'CLAIMED') {
        setClaimedDevice(res.device)
        setStep(5)
        onDone?.(res.device)
      } else if (res.status === 'EXPIRED') {
        setError('The pairing code expired before the camera registered. Start again with a new code.')
      }
    } catch {
      // still on the camera hotspot / reconnecting — keep waiting
    }
  }, 2000, 'pairing-status', step === 4 && !!pairing)

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-white rounded-3xl shadow-2xl w-full max-w-2xl max-h-[92vh] overflow-y-auto">
        <div className="p-6 border-b border-slate-100 flex justify-between items-start">
          <div>
            <h2 className="text-xl font-bold text-slate-800">Add an ESP32-CAM</h2>
            <p className="text-sm text-slate-500">Connect a new camera to your stall in a few steps — no cables or code needed.</p>
          </div>
          <button onClick={onClose} className="p-2 rounded-lg hover:bg-slate-100 text-slate-400" aria-label="Close"><X size={20} /></button>
        </div>

        <div className="p-6">
          <StepHeader step={step} />

          {pairing && step > 0 && step < 5 && (
            <div className="mb-5 p-3 rounded-xl bg-slate-50 border border-slate-100 flex items-center justify-between text-sm">
              <span className="text-slate-500">Pairing code <strong className="font-mono text-lg text-slate-800 tracking-widest ml-1">{pairing.code}</strong></span>
              <span className={`text-xs font-semibold ${secondsLeft < 120 ? 'text-rose-500' : 'text-slate-400'}`}>
                {secondsLeft > 0 ? `expires in ${Math.floor(secondsLeft / 60)}:${String(secondsLeft % 60).padStart(2, '0')}` : 'expired'}
              </span>
            </div>
          )}

          {step === 0 && (
            <div className="space-y-4">
              <Field label="Device name">
                <input className={inputCls} value={details.name} onChange={(e) => setDetails({ ...details, name: e.target.value })} />
              </Field>
              <Field label="Stall / location">
                <input className={inputCls} placeholder="e.g. Stall 41, Bulua WBIT" value={details.stall_location}
                       onChange={(e) => setDetails({ ...details, stall_location: e.target.value })} />
              </Field>
              <Field label="Crop this camera watches">
                <select className={inputCls} value={details.crop_type} onChange={(e) => setDetails({ ...details, crop_type: e.target.value })}>
                  {CROPS.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
                </select>
              </Field>
              <p className="text-xs text-slate-400">You can change these later in the device settings.</p>
            </div>
          )}

          {step === 1 && (
            <div className="space-y-4 text-sm text-slate-600">
              <div className="flex gap-3 p-4 rounded-2xl bg-emerald-50/60 border border-emerald-100">
                <Power className="text-[#2A6B48] shrink-0" size={22} />
                <p><strong>Power on the ESP32-CAM.</strong> A new camera (or one that was reset) opens its own Wi-Fi called
                  <strong> {pairing.setup_ap_prefix}XXXX</strong> within about 10 seconds.</p>
              </div>
              <div className="flex gap-3 p-4 rounded-2xl bg-slate-50 border border-slate-100">
                <Wifi className="text-[#2A6B48] shrink-0" size={22} />
                <div>
                  <p><strong>Connect this computer to that Wi-Fi.</strong> Click the Wi-Fi icon on the Windows taskbar,
                    choose <strong>{pairing.setup_ap_prefix}XXXX</strong> and enter the password:</p>
                  <p className="mt-2 inline-flex items-center gap-2 font-mono font-bold text-slate-800 bg-white border border-slate-200 rounded-lg px-3 py-1.5">
                    <Lock size={14} /> {pairing.setup_ap_password}
                  </p>
                  <p className="mt-2 text-xs text-slate-400">Windows may warn “No internet” — that is normal. Stay connected.</p>
                </div>
              </div>
              <div className="flex gap-3 p-4 rounded-2xl bg-slate-50 border border-slate-100">
                <Router className="text-slate-400 shrink-0" size={22} />
                <p className="text-xs text-slate-500">
                  Hotspot not showing? Power the camera off and on 3 times within 10 seconds to put it back in setup mode.
                  If this page can't reach it, open <a className="text-[#2A6B48] font-bold underline" href={SETUP_URL} target="_blank" rel="noreferrer">{SETUP_URL}</a> in
                  a new tab and enter the pairing code <strong className="font-mono">{pairing.code}</strong> and server <strong className="font-mono">{pairing.server_url}</strong> there. Use the backend server address, not the camera setup address {SETUP_URL}.
                </p>
              </div>
            </div>
          )}

          {step === 2 && (
            <div className="space-y-4">
              {deviceInfo && (
                <p className="text-xs text-emerald-700 bg-emerald-50 border border-emerald-100 rounded-lg px-3 py-2 flex items-center gap-2">
                  <CheckCircle2 size={14} /> Connected to camera {deviceInfo.mac} (firmware {deviceInfo.fw})
                </p>
              )}
              <Field label="Stall Wi-Fi network (2.4 GHz)">
                {!manualSsid ? (
                  <div className="flex gap-2">
                    <select className={inputCls} value={ssid} onChange={(e) => setSsid(e.target.value)} disabled={scanningNetworks}>
                      {networks.length === 0 && <option value="">{scanningNetworks ? 'Scanning…' : 'No networks found'}</option>}
                      {networks.map((n) => (
                        <option key={n.ssid} value={n.ssid}>{n.ssid} {n.secure ? '🔒' : ''} ({n.rssi} dBm)</option>
                      ))}
                    </select>
                    <button type="button" onClick={loadNetworks} className={ghostBtn} disabled={scanningNetworks} title="Scan again">
                      <RefreshCw size={16} className={scanningNetworks ? 'animate-spin' : ''} />
                    </button>
                  </div>
                ) : (
                  <input className={inputCls} placeholder="Network name (SSID)" value={ssid} onChange={(e) => setSsid(e.target.value)} />
                )}
              </Field>
              <button type="button" className="text-xs font-bold text-[#2A6B48] hover:underline" onClick={() => setManualSsid(!manualSsid)}>
                {manualSsid ? 'Pick from the list instead' : 'My network is hidden / not listed'}
              </button>
              <Field label="Wi-Fi password">
                <input className={inputCls} type="password" value={password} onChange={(e) => setPassword(e.target.value)}
                       placeholder="Leave empty for an open network" />
              </Field>
              <p className="text-xs text-slate-400">The ESP32 only supports 2.4 GHz Wi-Fi. If your router shows both, pick the one without “5G”.</p>
            </div>
          )}

          {step === 3 && (
            <div className="py-6 text-center">
              <Loader2 size={40} className="mx-auto text-[#2A6B48] animate-spin" />
              <p className="mt-4 font-bold text-slate-700">{DEVICE_STATE_TEXT[deviceState?.state] || 'Working…'}</p>
              {deviceState?.message && <p className="text-xs text-slate-400 mt-1">{deviceState.message}</p>}
              <p className="text-xs text-slate-400 mt-4">This computer may disconnect from the camera's Wi-Fi when it finishes — that is expected.</p>
            </div>
          )}

          {step === 4 && (
            <div className="py-4 text-center space-y-3">
              <WifiOff size={36} className="mx-auto text-slate-400" />
              <p className="font-bold text-slate-700">Reconnect this computer to your normal Wi-Fi</p>
              <p className="text-sm text-slate-500">The camera has your Wi-Fi details and is registering itself.
                Switch back to your usual network — this page will update automatically.</p>
              <p className="flex items-center justify-center gap-2 text-sm text-[#2A6B48] font-semibold">
                <Loader2 size={16} className="animate-spin" /> Waiting for the camera to come online…
              </p>
            </div>
          )}

          {step === 5 && claimedDevice && (
            <div className="py-6 text-center space-y-2">
              <CheckCircle2 size={48} className="mx-auto text-emerald-500" />
              <p className="text-lg font-bold text-slate-800">{claimedDevice.name} is connected!</p>
              <p className="text-sm text-slate-500">
                On Wi-Fi “{claimedDevice.wifi_ssid || ssid}” {claimedDevice.ip ? `at ${claimedDevice.ip}` : ''}. It will start scanning your {details.crop_type.toLowerCase()} automatically.
              </p>
            </div>
          )}

          {error && <p className="mt-5 text-sm text-rose-600 bg-rose-50 border border-rose-100 rounded-xl px-4 py-3">{error}</p>}
        </div>

        <div className="p-6 border-t border-slate-100 flex justify-between gap-3">
          <button onClick={onClose} className={ghostBtn}>{step === 5 ? 'Close' : 'Cancel'}</button>
          <div className="flex gap-3">
            {step === 0 && (
              <button onClick={createPairing} disabled={busy} className={primaryBtn}>
                {busy && <Loader2 size={16} className="animate-spin" />} Get pairing code
              </button>
            )}
            {step === 1 && (
              <button onClick={checkHotspot} disabled={busy || secondsLeft === 0} className={primaryBtn}>
                {busy && <Loader2 size={16} className="animate-spin" />} I'm connected to the camera
              </button>
            )}
            {step === 2 && (
              <button onClick={provision} disabled={busy || !ssid.trim() || secondsLeft === 0} className={primaryBtn}>
                {busy && <Loader2 size={16} className="animate-spin" />} Connect camera
              </button>
            )}
            {step === 4 && secondsLeft === 0 && (
              <button onClick={() => { setStep(0); setPairing(null); setError('') }} className={primaryBtn}>Start again</button>
            )}
            {step === 5 && claimedDevice && (
              <button onClick={() => navigate(`/devices/${claimedDevice.id}`)} className={primaryBtn}>Open device</button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

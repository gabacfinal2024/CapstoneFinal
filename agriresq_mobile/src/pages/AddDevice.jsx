import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { ArrowLeft, Camera, CheckCircle2, Lock, RefreshCw, Wifi, WifiOff, Loader2, Smartphone } from 'lucide-react'
import { deviceApi, deviceSetup, signalLabel } from '../api/deviceApi'
import { useAuth } from '../context/AuthContext'
import ErrorNotice from '../components/ErrorNotice'
import '../styles/devices.css'
import './AddDevice.css'

const STEPS = ['Details', 'Join camera', 'Stall Wi-Fi', 'Finish']
const PAIRING_POLL_MS = 2000
const PAIRING_TIMEOUT_MS = 3 * 60 * 1000
const STATUS_POLL_MS = 1500

const STATUS_TEXT = {
  idle: 'Waiting for Wi-Fi details…',
  connecting: 'Camera is joining your Wi-Fi…',
  wifi_failed: 'The camera could not join that Wi-Fi.',
  claiming: 'Connected! Registering the camera to your account…',
  claim_failed: 'The camera joined Wi-Fi but could not reach the AgriResQ server.',
  done: 'Camera registered.',
}

export default function AddDevice() {
  const navigate = useNavigate()
  const { user } = useAuth()
  const [step, setStep] = useState(0)

  // Step 0
  const [details, setDetails] = useState({
    name: 'Stall Camera',
    stall_location: user?.stall_number ? `Stall ${user.stall_number}` : '',
    crop_type: 'EGGPLANT',
  })
  const [pairing, setPairing] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [retryAction, setRetryAction] = useState('') // which step the error's Retry button repeats
  const [errorHint, setErrorHint] = useState('')

  // Step 1
  const [deviceInfo, setDeviceInfo] = useState(null)

  // Step 2
  const [networks, setNetworks] = useState([])
  const [scanning, setScanning] = useState(false)
  const [manualSsid, setManualSsid] = useState(false)
  const [ssid, setSsid] = useState('')
  const [password, setPassword] = useState('')
  const [provisionState, setProvisionState] = useState(null) // device /status state
  const [provisionMessage, setProvisionMessage] = useState('') // camera's own explanation
  const statusTimer = useRef(null)
  const statusFailures = useRef(0)

  // Step 3
  const [waitingSince, setWaitingSince] = useState(null)
  const [pairingProgress, setPairingProgress] = useState('')
  const [timedOut, setTimedOut] = useState(false)
  const [claimedDevice, setClaimedDevice] = useState(null)

  useEffect(() => () => clearInterval(statusTimer.current), [])

  const fail = (message, action = '', hint = '') => { setError(message); setRetryAction(action); setErrorHint(hint) }
  const clearError = () => { setError(''); setRetryAction(''); setErrorHint('') }

  // ── Step 0: create a pairing code (online) ──
  const startPairing = async (e) => {
    e.preventDefault()
    setBusy(true)
    clearError()
    try {
      const p = await deviceApi.createPairing(details)
      setPairing(p)
      setStep(1)
    } catch (err) {
      fail(err.message, 'pairing', 'Your phone needs to be on the same Wi-Fi as the AgriResQ server for this step.')
    } finally {
      setBusy(false)
    }
  }

  // ── Step 1: verify the phone is on the camera's hotspot ──
  const checkCamera = async () => {
    setBusy(true)
    clearError()
    try {
      const info = await deviceSetup.info()
      setDeviceInfo(info)
      setStep(2)
      loadNetworks()
    } catch (err) {
      fail(err.message, 'camera', "Make sure the phone is connected to the camera's \"AgriResQ-…\" Wi-Fi. Turn off mobile data if your phone keeps switching away.")
    } finally {
      setBusy(false)
    }
  }

  // ── Step 2: choose stall Wi-Fi and send it to the camera ──
  const loadNetworks = async () => {
    setScanning(true)
    clearError()
    try {
      const list = await deviceSetup.networks()
      setNetworks(list)
      if (!ssid && list[0]) setSsid(list[0].ssid)
      if (list.length === 0) setManualSsid(true)
    } catch (err) {
      fail(err.message, 'networks', 'You can also type your Wi-Fi name yourself.')
      setManualSsid(true)
    } finally {
      setScanning(false)
    }
  }

  const selectedNetwork = networks.find((n) => n.ssid === ssid)

  const sendWifi = async (e) => {
    e.preventDefault()
    if (!ssid.trim()) { fail('Choose or type your stall Wi-Fi name.'); return }
    setBusy(true)
    clearError()
    setProvisionState('connecting')
    setProvisionMessage('')
    try {
      await deviceSetup.provision({ ssid: ssid.trim(), password, server: pairing.server_url, code: pairing.code })
      statusFailures.current = 0
      clearInterval(statusTimer.current)
      statusTimer.current = setInterval(pollDeviceStatus, STATUS_POLL_MS)
    } catch (err) {
      fail(err.message, 'camera', 'The camera did not accept the Wi-Fi details. Check you are still connected to its "AgriResQ-…" Wi-Fi.')
      setProvisionState(null)
      setBusy(false)
    }
  }

  const pollDeviceStatus = async () => {
    try {
      const s = await deviceSetup.status()
      statusFailures.current = 0
      setProvisionState(s.state)
      setProvisionMessage(s.message || '')
      if (s.state === 'wifi_failed' || s.state === 'claim_failed') {
        clearInterval(statusTimer.current)
        setBusy(false)
        fail(
          s.message || STATUS_TEXT[s.state],
          '',
          s.state === 'wifi_failed'
            ? 'Re-enter the Wi-Fi password below. The camera only supports 2.4 GHz networks.'
            : 'Make sure the AgriResQ server is running and on the same Wi-Fi network as the camera.',
        )
      } else if (s.state === 'done') {
        clearInterval(statusTimer.current)
        setBusy(false)
        goToFinish()
      }
    } catch {
      // The camera closes its hotspot once it joins the stall Wi-Fi, so the phone loses it.
      // That is expected: continue on the "Finish" step.
      statusFailures.current += 1
      if (statusFailures.current >= 3) {
        clearInterval(statusTimer.current)
        setBusy(false)
        goToFinish()
      }
    }
  }

  const goToFinish = () => {
    setStep(3)
    setTimedOut(false)
    setWaitingSince(Date.now())
  }

  // ── Step 3: phone back on normal Wi-Fi, wait for the device to claim the code ──
  useEffect(() => {
    if (step !== 3 || !pairing || !waitingSince || claimedDevice) return undefined
    let cancelled = false
    const tick = async () => {
      if (Date.now() - waitingSince > PAIRING_TIMEOUT_MS) {
        setTimedOut(true)
        return
      }
      try {
        const res = await deviceApi.pairingStatus(pairing.code)
        if (cancelled) return
        setPairingProgress(res.device_progress || '')
        if (res.status === 'CLAIMED' && res.device) {
          setClaimedDevice(res.device)
        } else if (res.status === 'EXPIRED') {
          fail('This pairing code expired. Start again to get a new code.')
          setTimedOut(true)
        }
      } catch {
        if (!cancelled) setPairingProgress('Waiting for your phone to get back online…')
      }
    }
    tick()
    const t = setInterval(tick, PAIRING_POLL_MS)
    return () => { cancelled = true; clearInterval(t) }
  }, [step, pairing, waitingSince, claimedDevice])

  const retryWaiting = () => {
    clearError()
    setTimedOut(false)
    setWaitingSince(Date.now())
  }

  const restart = () => {
    clearInterval(statusTimer.current)
    setStep(0)
    setPairing(null)
    setDeviceInfo(null)
    setNetworks([])
    setSsid('')
    setPassword('')
    setProvisionState(null)
    setProvisionMessage('')
    setClaimedDevice(null)
    setTimedOut(false)
    clearError()
  }

  const retry = () => {
    if (retryAction === 'pairing') startPairing({ preventDefault() {} })
    else if (retryAction === 'camera') checkCamera()
    else if (retryAction === 'networks') loadNetworks()
  }

  return (
    <div className="app-shell">
      <div className="page page-no-nav add-device">
        <Link to="/devices" className="dev-back"><ArrowLeft size={16} /> Devices</Link>
        <h1 className="dev-title">Add a camera</h1>
        <p className="dev-subtitle">Connect your AgriResQ ESP32-CAM to your stall Wi-Fi.</p>

        {step < 3 && (
          <div className="notice warn wifi-band-note">
            <strong>Use 2.4 GHz Wi-Fi (not 5 GHz).</strong> The camera cannot join 5 GHz networks. If your router has two names,
            pick the one <em>without</em> “5G” in it.
          </div>
        )}

        <ol className="wizard-steps">
          {STEPS.map((label, i) => (
            <li key={label} className={i === step ? 'active' : i < step ? 'done' : ''}>
              <span>{i < step ? '✓' : i + 1}</span>{label}
            </li>
          ))}
        </ol>

        <ErrorNotice message={error} onRetry={retryAction ? retry : undefined} retrying={busy || scanning} hint={errorHint} />

        {step === 0 && (
          <form className="card" onSubmit={startPairing}>
            <div className="input-group">
              <label>Camera name</label>
              <input value={details.name} onChange={(e) => setDetails({ ...details, name: e.target.value })} required />
            </div>
            <div className="input-group">
              <label>Stall / location</label>
              <input value={details.stall_location} placeholder="e.g. Stall 41, Bulua" onChange={(e) => setDetails({ ...details, stall_location: e.target.value })} />
            </div>
            <div className="input-group">
              <label>Produce this camera watches</label>
              <select value={details.crop_type} onChange={(e) => setDetails({ ...details, crop_type: e.target.value })}>
                <option value="EGGPLANT">Eggplant</option>
                <option value="CUCUMBER">Cucumber</option>
                <option value="CARROT">Carrot</option>
              </select>
            </div>
            <button className="btn btn-green" disabled={busy}>{busy ? 'Preparing…' : 'Next'}</button>
          </form>
        )}

        {step === 1 && pairing && (
          <div className="card wizard-card">
            <div className="wizard-icon"><Smartphone size={28} /></div>
            <h3>Connect your phone to the camera</h3>
            <ol className="wizard-instructions">
              <li>Plug in the camera and wait about 10 seconds.</li>
              <li>Open your phone's <strong>Wi-Fi settings</strong>.</li>
              <li>Join the network <strong>{pairing.setup_ap_prefix || 'AgriResQ-'}XXXX</strong> with password <strong className="mono">{pairing.setup_ap_password || 'agriresq'}</strong>.</li>
              <li>If your phone says “No internet”, choose <strong>Stay connected</strong>.</li>
              <li>Come back here and tap the button below.</li>
            </ol>
            <div className="pairing-code">
              <span>Pairing code</span>
              <strong className="mono">{pairing.code}</strong>
            </div>
            <button className="btn btn-green" onClick={checkCamera} disabled={busy}>
              {busy ? <><Loader2 className="spin" size={18} /> Looking for camera…</> : <><Camera size={18} /> I'm connected to the camera</>}
            </button>
            <p className="fallback-note">
              Not working? While connected to the camera's Wi-Fi, open <strong>{pairing.setup_url || 'http://192.168.4.1'}</strong> in your
              browser and enter your Wi-Fi details and the pairing code <strong className="mono">{pairing.code}</strong> there.
              The server address to enter is <strong className="mono">{pairing.server_url}</strong>.
            </p>
          </div>
        )}

        {step === 2 && pairing && (
          <form className="card wizard-card" onSubmit={sendWifi}>
            <div className="wizard-icon"><Wifi size={28} /></div>
            <h3>Choose your stall Wi-Fi</h3>
            {deviceInfo?.mac && <p className="muted small-center">Camera found · {deviceInfo.mac}{deviceInfo.fw ? ` · fw ${deviceInfo.fw}` : ''}</p>}
            <p className="notice info">The camera only works with <strong>2.4 GHz</strong> Wi-Fi. Avoid networks ending in “5G”.</p>

            {!manualSsid && (
              <div className="network-list">
                {scanning && <p className="muted"><Loader2 className="spin" size={14} /> Scanning nearby Wi-Fi…</p>}
                {!scanning && networks.map((n) => (
                  <label key={n.ssid} className={`network-item ${ssid === n.ssid ? 'selected' : ''}`}>
                    <input type="radio" name="ssid" value={n.ssid} checked={ssid === n.ssid} onChange={() => setSsid(n.ssid)} />
                    <span className="network-name">{n.ssid}</span>
                    <span className="network-meta">{n.secure ? <Lock size={12} /> : null} {signalLabel(n.rssi)}</span>
                  </label>
                ))}
              </div>
            )}

            {manualSsid && (
              <div className="input-group">
                <label>Wi-Fi name (SSID)</label>
                <input value={ssid} onChange={(e) => setSsid(e.target.value)} placeholder="Your stall Wi-Fi" />
              </div>
            )}

            <div className="network-actions">
              <button type="button" className="link-btn" onClick={loadNetworks} disabled={scanning || busy}><RefreshCw size={14} /> Rescan</button>
              <button type="button" className="link-btn" onClick={() => setManualSsid(!manualSsid)}>{manualSsid ? 'Show list' : 'Type name instead'}</button>
            </div>

            {(manualSsid || selectedNetwork?.secure !== false) && (
              <div className="input-group">
                <label>Wi-Fi password</label>
                <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="off" />
              </div>
            )}

            {provisionState && (
              <div className={`notice ${provisionState.includes('failed') ? 'error' : 'info'}`}>
                {!provisionState.includes('failed') && <Loader2 className="spin" size={14} />} {provisionMessage || STATUS_TEXT[provisionState] || provisionState}
              </div>
            )}

            <button className="btn btn-green" disabled={busy || !ssid}>
              {busy ? 'Connecting camera…' : 'Connect camera to this Wi-Fi'}
            </button>
          </form>
        )}

        {step === 3 && !claimedDevice && (
          <div className="card wizard-card">
            <div className="wizard-icon"><WifiOff size={28} /></div>
            <h3>Reconnect your phone</h3>
            <p className="wizard-text">
              The camera is now joining <strong>{ssid || 'your Wi-Fi'}</strong>. Switch your phone back to your normal Wi-Fi
              (the same network as the AgriResQ server) and keep this screen open.
            </p>
            {!timedOut ? (
              <div className="notice info"><Loader2 className="spin" size={14} /> {pairingProgress || 'Waiting for the camera to register…'}</div>
            ) : (
              <>
                <div className="notice warn">
                  The camera hasn't registered yet. Check that the Wi-Fi password was correct and that the camera's light is on.
                  If it still has its hotspot open, the password was probably wrong. Go back and try again.
                </div>
                <div className="btn-row">
                  <button className="btn btn-ghost" onClick={() => { clearError(); setStep(1) }}>Back to setup</button>
                  <button className="btn btn-green" onClick={retryWaiting}>Keep waiting</button>
                </div>
              </>
            )}
            <button className="link-btn center" onClick={restart}>Start over</button>
          </div>
        )}

        {step === 3 && claimedDevice && (
          <div className="card wizard-card success">
            <div className="wizard-icon ok"><CheckCircle2 size={34} /></div>
            <h3>Camera connected!</h3>
            <p className="wizard-text">
              <strong>{claimedDevice.name || 'Your camera'}</strong> is online and will start checking freshness automatically.
            </p>
            <button className="btn btn-green" onClick={() => navigate(`/devices/${claimedDevice.id}`, { replace: true })}>Open camera</button>
          </div>
        )}
      </div>
    </div>
  )
}

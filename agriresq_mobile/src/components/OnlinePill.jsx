/** One consistent Online / Offline badge for every device screen. */
export default function OnlinePill({ online }) {
  return (
    <span className={`online-pill ${online ? 'is-online' : 'is-offline'}`} role="status">
      {online ? 'Online' : 'Offline'}
    </span>
  )
}

export const EXIT_WINDOW_MS = 2000

export function backFallback(pathname, authenticated) {
  const path = pathname.toLowerCase().replace(/\/+$/, '') || '/'
  const sensorReport = /^\/devices\/([0-9]+)\/report$/.exec(path)
  if (sensorReport) return `/devices/${sensorReport[1]}`
  if (path.startsWith('/devices/') || path === '/gallery') return '/devices'
  if (path.startsWith('/produce/') || path === '/saved-listings') return '/marketplace'
  if (path.startsWith('/chat/')) return '/messages'
  if (path === '/basis' || path === '/account-settings') return '/profile'
  if (path === '/login' || path === '/register') return '/'
  if (path === '/forgot-password' || path === '/reset-password') return '/login'
  return authenticated ? '/home' : '/'
}

export function getBackAction({ pathname, hasPrevious, authenticated, android, exitDeadline, now }) {
  if (hasPrevious) return 'previous'
  const path = pathname.toLowerCase().replace(/\/+$/, '') || '/'
  if (path === '/home' && authenticated) {
    if (!android) return 'stay'
    return exitDeadline !== null && now < exitDeadline ? 'exit' : 'confirm'
  }
  return path === backFallback(path, authenticated) ? 'stay' : 'fallback'
}

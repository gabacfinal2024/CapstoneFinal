import { Component } from 'react'

// Without this, one render error leaves a blank white page. Show what went wrong instead.
export default class ErrorBoundary extends Component {
  state = { error: null }

  static getDerivedStateFromError(error) {
    return { error }
  }

  componentDidCatch(error, info) {
    console.error('App crashed:', error, info?.componentStack)
  }

  render() {
    if (!this.state.error) return this.props.children
    return (
      <div style={{ padding: 24, fontFamily: 'sans-serif' }}>
        <h2>Something went wrong</h2>
        <p style={{ color: '#9B2C21', wordBreak: 'break-word' }}>{String(this.state.error?.message || this.state.error)}</p>
        <button className="btn btn-primary" onClick={() => window.location.reload()}>Reload</button>
      </div>
    )
  }
}

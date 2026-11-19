import React from 'react'
import ReactDOM from 'react-dom/client'
import '@fontsource-variable/dm-sans'
import '@fontsource-variable/space-grotesk'
import App from './App'
import ErrorBoundary from './components/ErrorBoundary'
import './styles/global.css'

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>,
)

import React from 'react'
import ReactDOM from 'react-dom/client'
import Root from './Root'
import './styles.css'
import './app.css'
import { startLiquidGlass } from './lib/liquidGlass'

// Refracting rims for the main glass surfaces (Chromium; elsewhere the stylesheet's glass)
startLiquidGlass('.app-bar, .map-heading, .map-empty, .auth-card')

// Map tiles, imagery and terrain are kept in the browser and refreshed in the background
// (public/map-cache-sw.js). Needs a secure context: localhost, or HTTPS over the LAN.
if ('serviceWorker' in navigator && window.isSecureContext) {
  navigator.serviceWorker.register('/map-cache-sw.js').catch((error) => console.warn('地图缓存未启用', error))
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <Root />
  </React.StrictMode>,
)

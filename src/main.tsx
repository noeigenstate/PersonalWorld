import React from 'react'
import ReactDOM from 'react-dom/client'
import Root from './Root'
import './styles.css'
import './app.css'
import { startLiquidGlass } from './lib/liquidGlass'

// Refracting rims for the main glass surfaces (Chromium; elsewhere the stylesheet's glass)
startLiquidGlass('.app-bar, .map-heading, .timebar, .map-empty, .auth-card')

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <Root />
  </React.StrictMode>,
)

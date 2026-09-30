import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import { initializeTelegramWebApp } from './lib/telegram.js'
import { mountViewportDiagnostic } from './diagnostics/viewportDiagnostic.js'
import { shouldMountViewportDiagnostic } from './diagnostics/viewportDiagnosticActivation.js'

initializeTelegramWebApp();

// Developer overlay only: mounts behind ?viewportDiagnostic=1 (or the
// viewportDiagnostic startapp param) to read live viewport/layout numbers
// off a physical device. Invisible in normal sessions.
if (shouldMountViewportDiagnostic()) {
  mountViewportDiagnostic();
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

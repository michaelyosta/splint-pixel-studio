import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import { initializeTelegramWebApp } from './lib/telegram.js'

initializeTelegramWebApp();

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

if (new URLSearchParams(window.location.search).get('viewportDiagnostic') === '1') {
  import('./diagnostics/viewportDiagnostic.js').then(({ mountViewportDiagnostic }) => {
    mountViewportDiagnostic();
  });
}

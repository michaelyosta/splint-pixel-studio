import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import { initializeTelegramWebApp } from './lib/telegram.js'
import { resolveViewportDiagnosticVariant } from './diagnostics/viewportDiagnosticActivation.js'

initializeTelegramWebApp();

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

const viewportDiagnosticVariant = resolveViewportDiagnosticVariant();
if (viewportDiagnosticVariant) {
  import('./diagnostics/viewportDiagnostic.js').then(({ mountViewportDiagnostic }) => {
    mountViewportDiagnostic({ variant: viewportDiagnosticVariant });
  });
}

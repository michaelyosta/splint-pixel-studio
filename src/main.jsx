import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import { initializeTelegramWebApp } from './lib/telegram.js'
import { resolveViewportDiagnosticVariant } from './diagnostics/viewportDiagnosticActivation.js'
import {
  resolveViewportDiagnosticOneShot,
  showViewportDiagnosticArmedStatus,
} from './diagnostics/viewportDiagnosticOneShot.js'

const viewportDiagnosticOneShot = resolveViewportDiagnosticOneShot();
const viewportDiagnosticVariant = viewportDiagnosticOneShot.mode === 'ordinary'
  ? resolveViewportDiagnosticVariant()
  : null;

// Compact diagnostic launches deliberately skip the existing full-height
// initializer, whose legacy expand() call would invalidate the compact test.
// Ordinary launches retain the exact existing initialization path.
if (viewportDiagnosticOneShot.mode === 'ordinary' && !viewportDiagnosticVariant) {
  initializeTelegramWebApp();
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

if (viewportDiagnosticOneShot.mode === 'arm' && viewportDiagnosticOneShot.armed) {
  showViewportDiagnosticArmedStatus({ variant: viewportDiagnosticOneShot.variant });
} else if (viewportDiagnosticOneShot.mode === 'consume') {
  import('./diagnostics/viewportDiagnostic.js').then(({ mountViewportDiagnostic }) => {
    mountViewportDiagnostic({ variant: viewportDiagnosticOneShot.variant });
  });
} else if (viewportDiagnosticVariant) {
  import('./diagnostics/viewportDiagnostic.js').then(({ mountViewportDiagnostic }) => {
    mountViewportDiagnostic({ variant: viewportDiagnosticVariant });
  });
}

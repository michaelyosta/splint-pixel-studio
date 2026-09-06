import { StrictMode } from 'react'
import { flushSync } from 'react-dom'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import { initializeTelegramWebApp } from './lib/telegram.js'
import {
  createTelegramIosViewportSelfHealSession,
  shouldRunTelegramIosViewportSelfHeal,
} from './lib/telegramIosViewportSelfHeal.js'
import { shouldMountViewportDiagnostic } from './diagnostics/viewportDiagnosticActivation.js'

const webApp = initializeTelegramWebApp();
const iosViewportSelfHeal = createTelegramIosViewportSelfHealSession();
const root = createRoot(document.getElementById('root'));
let shellGeneration = 0;
let startupBlocked = shouldRunTelegramIosViewportSelfHeal(webApp);

function renderApp() {
  root.render(
    <StrictMode>
      <App shellGeneration={shellGeneration} telegramStartupBlocked={startupBlocked} />
    </StrictMode>,
  );
}

if (startupBlocked) {
  // Commit the real visual shell before requesting Telegram's native frame
  // transition. The opaque startup surface prevents interaction mid-cycle.
  flushSync(renderApp);
  void iosViewportSelfHeal.run({
    webApp,
    invalidateShell() {
      shellGeneration += 1;
      flushSync(renderApp);
    },
  }).then((result) => {
    window.__splintIosViewportSelfHeal = result;
  }).catch(() => {
    // The state machine is designed to resolve every bounded failure. Keep a
    // final fail-open guard so bootstrap can never strand the application.
    window.__splintIosViewportSelfHeal = {
      attempted: true,
      outcome: 'unexpected-failure',
      fullscreenTransitionConfirmed: false,
      fullscreenExitConfirmed: false,
      viewportResyncExecuted: false,
      shellInvalidationExecuted: false,
    };
  }).finally(() => {
    startupBlocked = false;
    flushSync(renderApp);
  });
} else {
  renderApp();
}

if (shouldMountViewportDiagnostic()) {
  import('./diagnostics/viewportDiagnostic.js').then(({ mountViewportDiagnostic }) => {
    mountViewportDiagnostic();
  });
}

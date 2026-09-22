/**
 * Query-gated entry for the read-only viewport diagnostic panel used by the
 * bounded physical Telegram iOS pass (docs/TELEGRAM_IOS_VIEWPORT_DIAGNOSTIC.md).
 * It is inert without ?viewportDiagnostic=1 and is not a paint workaround.
 */
import { shouldMountViewportDiagnostic } from './viewportDiagnosticActivation.js';

if (shouldMountViewportDiagnostic()) {
  import('./viewportDiagnostic.js').then(({ mountViewportDiagnostic }) => {
    mountViewportDiagnostic();
  });
}

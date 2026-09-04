import { VIEWPORT_DIAGNOSTIC_VARIANTS } from './viewportDiagnosticActivation.js';

const VALID_VARIANTS = new Set(Object.values(VIEWPORT_DIAGNOSTIC_VARIANTS));

function isKnownVariant(variant) {
  return VALID_VARIANTS.has(variant);
}

/**
 * Return the smallest possible diagnostic-only style delta for a variant.
 * No production stylesheet is edited and no other computed property is
 * overridden by these rules.
 */
export function getViewportDiagnosticExperimentCss(variant) {
  if (!isKnownVariant(variant) || variant === VIEWPORT_DIAGNOSTIC_VARIANTS.baseline) return '';
  if (variant === VIEWPORT_DIAGNOSTIC_VARIANTS.noBackdrop) {
    return [
      '@supports (backdrop-filter: blur(0)) { .app-tab-bar { backdrop-filter: none !important; } }',
      '@supports (-webkit-backdrop-filter: blur(0)) { .app-tab-bar { -webkit-backdrop-filter: none !important; } }',
    ].join('\n');
  }
  if (variant === VIEWPORT_DIAGNOSTIC_VARIANTS.promotedLayer) {
    return '.app-tab-bar { transform: translateZ(0) !important; }';
  }
  return '';
}

/**
 * Install a disposable style element for the explicitly activated variant.
 * Unknown and ordinary-flow values intentionally install nothing.
 */
export function applyViewportDiagnosticExperiment({
  documentRef = globalThis.document,
  variant,
} = {}) {
  const css = getViewportDiagnosticExperimentCss(variant);
  if (!css || !documentRef?.createElement || !documentRef?.head?.append) return () => {};

  const style = documentRef.createElement('style');
  style.dataset.viewportDiagnosticExperiment = variant;
  style.textContent = css;
  documentRef.head.append(style);
  return () => style.remove?.();
}

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  applyViewportDiagnosticExperiment,
  getViewportDiagnosticExperimentCss,
} from '../src/diagnostics/viewportDiagnosticExperiment.js';

const FORBIDDEN_OVERRIDE_PROPERTIES = [
  'background', 'position', 'left', 'right', 'top', 'bottom', 'width', 'height',
  'safe-area', 'padding', 'border', 'z-index', 'opacity', 'overflow', 'will-change',
  'animation', 'contain', 'isolation', 'box-shadow',
];

test('baseline and unknown variants have no diagnostic CSS override', () => {
  assert.equal(getViewportDiagnosticExperimentCss('baseline'), '');
  assert.equal(getViewportDiagnosticExperimentCss('unknown'), '');
  assert.equal(getViewportDiagnosticExperimentCss(null), '');
});

test('noBackdrop changes only backdrop properties', () => {
  const css = getViewportDiagnosticExperimentCss('noBackdrop');
  assert.match(css, /backdrop-filter: none !important/);
  assert.match(css, /-webkit-backdrop-filter: none !important/);
  for (const property of FORBIDDEN_OVERRIDE_PROPERTIES) {
    assert.doesNotMatch(css, new RegExp(`${property.replace('-', '\\-')}\\s*:`, 'i'));
  }
  assert.doesNotMatch(css, /rgba|rgb\(|#/i);
});

test('promotedLayer changes only transform', () => {
  const css = getViewportDiagnosticExperimentCss('promotedLayer');
  assert.equal(css, '.app-tab-bar { transform: translateZ(0) !important; }');
  for (const property of FORBIDDEN_OVERRIDE_PROPERTIES) {
    assert.doesNotMatch(css, new RegExp(`${property.replace('-', '\\-')}\\s*:`, 'i'));
  }
  assert.doesNotMatch(css, /backdrop-filter|translateY|scale\(|will-change/i);
});

test('experiment style injection is disposable and only runs for a known variant', () => {
  const appended = [];
  let removed = false;
  const documentRef = {
    head: { append: (style) => appended.push(style) },
    createElement: () => ({
      dataset: {},
      textContent: '',
      remove: () => { removed = true; },
    }),
  };
  const cleanup = applyViewportDiagnosticExperiment({ documentRef, variant: 'promotedLayer' });
  assert.equal(appended.length, 1);
  assert.equal(appended[0].dataset.viewportDiagnosticExperiment, 'promotedLayer');
  assert.equal(appended[0].textContent, getViewportDiagnosticExperimentCss('promotedLayer'));
  cleanup();
  assert.equal(removed, true);

  const ordinaryCleanup = applyViewportDiagnosticExperiment({ documentRef, variant: 'unknown' });
  assert.equal(appended.length, 1);
  ordinaryCleanup();
});

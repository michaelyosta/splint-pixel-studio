import test from 'node:test';
import assert from 'node:assert/strict';
import {
  contrastRatio,
  createBoundedAnnouncer,
  formatPaletteState,
  hexToRgb,
  isReadablePair,
  moveKeyboardCursor,
  relativeLuminance,
} from '../src/lib/accessibility.js';

test('moveKeyboardCursor clamps movement to grid bounds without wrapping', () => {
  const grid = { width: 4, height: 3 };
  assert.equal(moveKeyboardCursor(5, 'ArrowRight', grid), 6);
  assert.equal(moveKeyboardCursor(7, 'ArrowRight', grid), 7);
  assert.equal(moveKeyboardCursor(4, 'ArrowLeft', grid), 4);
  assert.equal(moveKeyboardCursor(2, 'ArrowUp', grid), 2);
  assert.equal(moveKeyboardCursor(8, 'ArrowDown', grid), 8);
  assert.equal(moveKeyboardCursor(11, 'ArrowDown', grid), 11);
  assert.equal(moveKeyboardCursor(99, 'ArrowRight', grid), 11);
  assert.equal(moveKeyboardCursor(5, 'Home', grid), 0);
  assert.equal(moveKeyboardCursor(0, 'End', grid), 11);
  assert.equal(moveKeyboardCursor(4, 'PageUp', grid), 0);
  assert.equal(moveKeyboardCursor(0, 'PageDown', grid), 8);
});

test('formatPaletteState never relies on color alone for swatch state', () => {
  assert.equal(formatPaletteState({ index: 0, remaining: 4 }), 'Цвет 1, осталось 4');
  assert.equal(formatPaletteState({ index: 1, remaining: 2, selected: true }), 'Цвет 2, выбран, осталось 2');
  assert.equal(formatPaletteState({ index: 2, remaining: 0, completed: true }), 'Цвет 3, готово');
  assert.equal(
    formatPaletteState({ index: 0, remaining: 0, completed: true, selected: true }),
    'Цвет 1, выбран, готово',
  );
  assert.equal(formatPaletteState({ index: 4, remaining: 9, disabled: true }), 'Цвет 5, заблокирован');
});

test('contrast helpers measure WCAG-style ratios', () => {
  assert.deepEqual(hexToRgb('#2BD9FE'), { r: 43, g: 217, b: 254 });
  assert.deepEqual(hexToRgb('#fff'), { r: 255, g: 255, b: 255 });
  assert.equal(hexToRgb('not-a-color'), null);
  assert.equal(relativeLuminance('#000000'), 0);
  assert.ok(contrastRatio('#FFFFFF', '#000000') >= 20);
  assert.ok(contrastRatio('#F0F6FC', '#0B1522') >= 10);
  assert.equal(isReadablePair('#F0F6FC', '#0B1522'), true);
  assert.equal(isReadablePair('#2C4A66', '#0B1522'), false);
});

test('createBoundedAnnouncer coalesces and de-duplicates announcements', async () => {
  const delivered = [];
  const announcer = createBoundedAnnouncer({
    onAnnounce: (text) => delivered.push(text),
    debounceMs: 10,
    minIntervalMs: 30,
  });

  announcer.announce('one');
  announcer.announce('one');
  await new Promise((resolve) => setTimeout(resolve, 25));
  announcer.flush();
  assert.deepEqual(delivered, ['one']);

  // Identical text inside the minimum interval is suppressed entirely.
  announcer.announce('one');
  announcer.flush();
  assert.deepEqual(delivered, ['one']);

  await new Promise((resolve) => setTimeout(resolve, 40));
  announcer.announce('two');
  announcer.announce('three');
  await new Promise((resolve) => setTimeout(resolve, 25));
  announcer.flush();
  assert.deepEqual(delivered, ['one', 'three']);
  announcer.destroy();
});

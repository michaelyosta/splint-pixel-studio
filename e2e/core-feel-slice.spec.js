import { test, expect } from '@playwright/test';
import { createTouchSession, sendTouch } from './input-gesture-helpers.js';

function freshSubject(variant, projectName) {
  const project = projectName.toLowerCase().replace(/[^a-z0-9]+/g, '').slice(0, 10);
  return `corefeel_${variant}_${project}_${Date.now().toString(36)}`;
}

async function paintActiveFragment(page) {
  const canvas = page.locator('canvas.coloring-canvas');
  const geometry = await canvas.evaluate((element) => {
    const box = element.getBoundingClientRect();
    const viewport = element.parentElement;
    return {
      box: { x: box.x, y: box.y },
      camera: {
        x: Number(viewport.dataset.cameraX),
        y: Number(viewport.dataset.cameraY),
        zoom: Number(viewport.dataset.cameraZoom),
      },
      indices: element.dataset.activeWorkCells.split(',').filter(Boolean).map(Number),
    };
  });

  const indexSet = new Set(geometry.indices);
  let continuousRun = [];
  for (const index of geometry.indices) {
    if (indexSet.has(index - 1) && Math.floor((index - 1) / 28) === Math.floor(index / 28)) continue;
    const run = [];
    let cursor = index;
    while (indexSet.has(cursor) && Math.floor(cursor / 28) === Math.floor(index / 28)) {
      run.push(cursor);
      cursor += 1;
    }
    if (run.length > continuousRun.length) continuousRun = run;
  }

  const pointFor = (index) => ({
    x: geometry.box.x + geometry.camera.x + (index % 28) * 32 * geometry.camera.zoom + 16 * geometry.camera.zoom,
    y: geometry.box.y + geometry.camera.y + Math.floor(index / 28) * 32 * geometry.camera.zoom + 16 * geometry.camera.zoom,
  });

  const start = pointFor(continuousRun[0]);
  const end = pointFor(continuousRun.at(-1));
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(end.x, end.y, { steps: Math.max(2, continuousRun.length) });
  await page.mouse.up();

  for (const index of geometry.indices.filter((candidate) => !continuousRun.includes(candidate))) {
    const point = pointFor(index);
    await page.mouse.click(point.x, point.y);
  }
  return { indices: geometry.indices, continuousRun };
}

async function clickFirstActiveCell(page) {
  const canvas = page.locator('canvas.coloring-canvas');
  const point = await canvas.evaluate((element) => {
    const viewport = element.parentElement;
    const box = element.getBoundingClientRect();
    const index = Number(element.dataset.activeWorkCells.split(',').find(Boolean));
    const zoom = Number(viewport.dataset.cameraZoom);
    return {
      index,
      x: box.x + Number(viewport.dataset.cameraX) + (index % 28) * 32 * zoom + 16 * zoom,
      y: box.y + Number(viewport.dataset.cameraY) + Math.floor(index / 28) * 32 * zoom + 16 * zoom,
    };
  });
  await page.mouse.click(point.x, point.y);
  return point.index;
}

for (const variant of ['a', 'b', 'c']) {
  test(`core feel ${variant}: manual reveal owns the first minute`, async ({ page }, testInfo) => {
    const analyticsEvents = [];
    page.on('request', (request) => {
      if (!request.url().endsWith('/api/meta/analytics') || request.method() !== 'POST') return;
      try {
        analyticsEvents.push(request.postDataJSON()?.event);
      } catch {
        // Malformed analytics are covered by the server contract test.
      }
    });
    const userId = freshSubject(variant, testInfo.project.name);
    await page.goto(`/?coreFeel=${variant}&coreSubject=${userId}`);

    await expect(page.locator('.coloring-session')).toHaveAttribute('data-core-feel-variant', variant);
    await expect(page.locator('[data-core-feel-hint]')).toContainText('светлому контуру');
    await expect(page.locator('.onboarding-overlay')).toHaveCount(0);
    await expect(page.locator('.session-goal-card')).toHaveCount(0);
    await expect(page.locator('[data-special-help-hint]')).toHaveCount(0);
    await expect(page.getByText(/XP|Серия|Достижение/i)).toHaveCount(0);

    const painted = await paintActiveFragment(page);
    expect(painted.indices).toHaveLength(26);
    expect(painted.continuousRun.length).toBeGreaterThanOrEqual(5);
    await expect(page.locator('[data-core-feel-ownership-pause]')).toBeVisible();
    await expect(page.locator('[data-core-feel-ownership-pause]')).toContainText('Контур головы');
    await expect(page.locator('[data-core-feel-reveal="whale-head-contour"]').first()).toBeVisible();
    await expect(page.locator('[data-core-feel-stop]')).toBeVisible();
    await expect(page.locator('[data-core-feel-next]')).toContainText('Лицо кита');
    await expect(page.getByText(/\+\d+ XP/)).toHaveCount(0);
    await expect(page.locator('.coloring-canvas-viewport')).toHaveAttribute('data-interaction-disabled', 'true');
    await expect.poll(() => analyticsEvents).toContain('core_feel_manual_fragment_reveal');
    expect(analyticsEvents).not.toEqual(expect.arrayContaining([
      'coloring_stroke_commit',
      'coloring_color_complete',
      'camera_activate_target',
      'first_pixel',
      'progress_milestone',
    ]));

    if (variant === 'a') {
      await page.locator('[data-core-feel-stop]').click();
      await expect(page.locator('.core-feel-stop-page')).toBeVisible();
      await expect(page.getByRole('button', { name: /Продолжить кита/i })).toBeVisible();
      await expect.poll(() => analyticsEvents).toContain('core_feel_session_stop');
    } else {
      await page.locator('[data-core-feel-next]').click();
      await expect(page.locator('[data-core-feel-ownership-pause]')).toHaveCount(0);
      await expect(page.locator('.coloring-canvas-viewport')).toHaveAttribute('data-interaction-disabled', 'false');
      await expect(page.locator('.coloring-session')).toHaveAttribute('data-target-color', '3');
      await expect(page.locator('canvas.coloring-canvas')).toHaveAttribute('data-active-work-cells', /233/);
      await expect.poll(() => analyticsEvents).toContain('core_feel_next_beat_selected');
    }
  });
}

test('control keeps the existing flat/automatic behavior for comparison', async ({ page }, testInfo) => {
  const userId = freshSubject('control', testInfo.project.name);
  await page.goto(`/?coreFeel=control&coreSubject=${userId}`);
  await expect(page.locator('.coloring-session')).toHaveAttribute('data-core-feel-variant', 'control');
  await expect(page.locator('[data-core-feel-hint]')).toHaveCount(0);
  await expect(page.locator('[data-core-feel-ownership-pause]')).toHaveCount(0);
});

test('manual pinch/pan pauses direction without forfeiting the authored reveal', async ({ page, browserName }, testInfo) => {
  test.skip(browserName !== 'chromium', 'Synthetic multi-touch uses Chromium CDP; real iPhone stays in the physical Telegram gate.');
  const userId = freshSubject('b_pinch', testInfo.project.name);
  await page.goto(`/?coreFeel=b&coreSubject=${userId}`);
  const viewport = page.locator('.coloring-canvas-viewport');
  await expect(viewport).toBeVisible();
  await expect(page.locator('.coloring-session')).toHaveAttribute('data-route-status', 'ready');
  const box = await viewport.boundingBox();
  const before = {
    x: Number(await viewport.getAttribute('data-camera-x')),
    zoom: Number(await viewport.getAttribute('data-camera-zoom')),
  };
  const centerX = box.x + box.width / 2;
  const centerY = box.y + box.height / 2;
  const session = await createTouchSession(page);
  await sendTouch(session, 'touchStart', [
    { x: centerX - 36, y: centerY },
    { x: centerX + 36, y: centerY },
  ]);
  await sendTouch(session, 'touchMove', [
    { x: centerX - 48, y: centerY - 6 },
    { x: centerX + 58, y: centerY + 6 },
  ]);
  await sendTouch(session, 'touchEnd', []);
  await expect(page.locator('.coloring-session')).toHaveAttribute('data-route-status', 'freeExploration');
  const after = {
    x: Number(await viewport.getAttribute('data-camera-x')),
    zoom: Number(await viewport.getAttribute('data-camera-zoom')),
  };
  expect(after.zoom !== before.zoom || after.x !== before.x).toBe(true);

  await paintActiveFragment(page);
  await expect(page.locator('[data-core-feel-ownership-pause]')).toBeVisible();
  await expect(page.locator('[data-core-feel-reveal="whale-head-contour"]')).toBeVisible();
  await session.detach();
});

test('partial manual progress reloads into a meaningful resume action', async ({ page }, testInfo) => {
  const userId = freshSubject('b_resume', testInfo.project.name);
  const url = `/?coreFeel=b&coreSubject=${userId}`;
  await page.goto(url);
  await expect(page.locator('.coloring-session')).toHaveAttribute('data-route-status', 'ready');
  const saved = page.waitForResponse((response) => (
    response.url().includes('/api/colorings/color_astro-whale/progress/actions')
    && response.request().method() === 'POST'
    && response.ok()
  ));
  const firstIndex = await clickFirstActiveCell(page);
  await saved;
  await page.reload();
  await expect(page.locator('.coloring-session')).toHaveAttribute('data-core-feel-variant', 'b');
  await expect(page.locator('canvas.coloring-canvas')).not.toHaveAttribute(
    'data-active-work-cells',
    new RegExp(`(^|,)${firstIndex}(,|$)`),
  );
  await expect(page.locator('.coloring-session')).toHaveAttribute('data-route-status', 'ready');
  const resumeEvent = page.waitForRequest((request) => {
    if (!request.url().endsWith('/api/meta/analytics') || request.method() !== 'POST') return false;
    try {
      return request.postDataJSON()?.event === 'core_feel_resume_action';
    } catch {
      return false;
    }
  });
  await clickFirstActiveCell(page);
  await resumeEvent;
});

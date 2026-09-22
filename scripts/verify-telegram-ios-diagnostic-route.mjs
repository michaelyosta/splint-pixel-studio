import { chromium } from 'playwright';

const SECRET_MARKERS = /initData|token|cookie|authorization|x-telegram-init-data/i;
const PAGE_IDS = ['viewport', 'telegram', 'layout', 'overlap'];
const PAGE_VALUES = new Set(['1', '2', '3', '4', ...PAGE_IDS, 'auto']);
const DIAGNOSTIC_KEYS = new Set(['viewportDiagnostic', 'viewportDiagnosticPage']);
const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]']);
const inputUrl = process.env.TELEGRAM_IOS_DIAGNOSTIC_URL || process.argv[2];

function fail(message) {
  throw new Error(message);
}

function parseRoute(value) {
  if (!value) fail('missing diagnostic URL (pass it as argv[2] or TELEGRAM_IOS_DIAGNOSTIC_URL)');
  let url;
  try {
    url = new URL(value);
  } catch {
    fail('diagnostic URL is invalid');
  }
  if (url.username || url.password || url.hash) fail('diagnostic URL must not contain credentials or a fragment');
  if (url.pathname !== '/') fail('diagnostic URL must target the preview root path');
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && LOOPBACK_HOSTS.has(url.hostname))) {
    fail('diagnostic URL must use HTTPS, except for an explicit loopback preview');
  }
  const keys = [...url.searchParams.keys()];
  if (keys.some((key) => !DIAGNOSTIC_KEYS.has(key))) fail('diagnostic URL contains a non-diagnostic query key');
  if (url.searchParams.getAll('viewportDiagnostic').length !== 1
    || url.searchParams.get('viewportDiagnostic') !== '1') {
    fail('diagnostic URL must contain exactly viewportDiagnostic=1');
  }
  if (url.searchParams.getAll('viewportDiagnosticPage').length > 1) {
    fail('diagnostic URL must contain at most one viewportDiagnosticPage value');
  }
  const selectedPage = url.searchParams.get('viewportDiagnosticPage');
  if (selectedPage && !PAGE_VALUES.has(selectedPage.trim().toLowerCase())) {
    fail('diagnostic URL contains an invalid viewportDiagnosticPage value');
  }
  return url;
}

function pageUrl(base, page) {
  const url = new URL(base);
  url.searchParams.set('viewportDiagnosticPage', String(page));
  return url;
}

function autoCycleUrl(base) {
  const url = new URL(base);
  url.searchParams.delete('viewportDiagnosticPage');
  return url;
}

async function openAndRead(page, url) {
  const response = await page.goto(url.toString(), { waitUntil: 'domcontentloaded' });
  if (response?.status() !== 200) fail('diagnostic route did not return HTTP 200');
  const panel = page.locator('[data-viewport-diagnostic]');
  await panel.waitFor({ state: 'visible', timeout: 15000 });
  const text = await panel.innerText();
  if (SECRET_MARKERS.test(text)) fail('diagnostic panel contains a forbidden secret marker');
  return { panel, text };
}

async function main() {
  const base = parseRoute(inputUrl);
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3 });
    const staticPages = [];
    for (let index = 0; index < PAGE_IDS.length; index += 1) {
      const { text } = await openAndRead(page, pageUrl(base, index + 1));
      const expectedHeader = `page ${index + 1}/4 · ${PAGE_IDS[index]}`;
      if (!text.includes(expectedHeader)) fail(`static diagnostic page ${index + 1} did not expose its page header`);
      staticPages.push(index + 1);
    }

    const { panel } = await openAndRead(page, autoCycleUrl(base));
    const seen = [];
    const deadline = Date.now() + 10000;
    while (Date.now() < deadline && seen.length < PAGE_IDS.length) {
      const text = await panel.innerText();
      const match = text.match(/page ([1-4])\/4 · (viewport|telegram|layout|overlap)/);
      if (match && !seen.includes(Number(match[1]))) seen.push(Number(match[1]));
      if (seen.length < PAGE_IDS.length) await page.waitForTimeout(150);
    }
    if (seen.length !== PAGE_IDS.length) fail('diagnostic auto-cycle did not expose all four pages within 10 seconds');

    console.log(JSON.stringify({
      status: 'PASS',
      route: 'diagnostic-opt-in',
      protocol: base.protocol.slice(0, -1),
      staticPages: `${staticPages.length}/4`,
      autoCycle: `${seen.length}/4`,
      secretMarkers: 'none',
      retries: 0,
      quarantine: 0,
    }));
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error(JSON.stringify({ status: 'FAIL', reason: error instanceof Error ? error.message : 'diagnostic route verification failed' }));
  process.exitCode = 1;
});

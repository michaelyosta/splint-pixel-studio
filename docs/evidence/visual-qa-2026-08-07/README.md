# Visual QA evidence — 2026-08-07

Команда воспроизведения:

```text
node scripts/capture-visual-evidence.mjs
```

Собраны screenshots для home, catalog, player и profile на 360×800, 390×844 и 430×932, а также отдельный 1200×1200 tiled flow на 390×844. Метрики находятся в [`metrics.json`](metrics.json).

Локальные измерения Chromium:

- `documentWidth` совпал с шириной viewport на всех 13 снимках: горизонтального overflow не обнаружено.
- Обычный player: 132 DOM-узла и один Canvas.
- Tiled 1200×1200: 129 DOM-узлов, один Canvas, 247 544 backing-store pixels в viewport 390×844.
- Heap в tiled-сценарии составил около 81,4 MB в Chromium dev-аудите; это не замена измерению в реальном Telegram WebView.
- Снимки player включают onboarding overlay, потому что это первый запуск чистой E2E-сессии; completion overlay отдельно подтверждён в `e2e/creator.spec.js`.

Ограничения evidence: capture запускается через Vite dev server, поэтому его resource waterfall включает dev-модули. Для production bundle отдельно подтверждены `npm run build` и gzip-размеры из build output. Реальные Telegram WebView memory/FPS/input и production network waterfall остаются внешними release-gates.
The tiled player now persists a bounded 512px preview, renders it beneath loaded Canvas tiles, and shows a compact overview card before the first tile batch arrives. This keeps first contact informative without allocating a 1200×1200 DOM grid.
The capture flow dismisses the onboarding card before the player screenshots; the completion dialog remains covered by the targeted creator E2E.
Latest settled tiled capture: 64 successful tile responses, one Canvas, 118 DOM nodes, 247,544 backing-store pixels, Chromium heap 86.4 MB, 60-frame median 16.8 ms / p95 17.8 ms, and wheel interaction confirmed. The capture uses `public/assets/catalog/alpine-train.png` so the visual evidence exercises a non-empty artwork.

## Latest 1200x1200 regression capture

The post-fix capture completed on 2026-08-07 with one Canvas, 119 DOM nodes, 241,336 backing-store pixels, 62 successful tile responses, and no horizontal overflow at 390x844. The 60-frame sample measured 16.9 ms median / 17.6 ms p95 and wheel interaction was confirmed. Chromium reported about 26 MB of used JS heap in this dev-server run; this remains supporting local evidence, not a substitute for measurements in a real Telegram WebView.

The deterministic creator E2E also passed on Desktop Chrome, iPhone 13, and Pixel 5 profiles. Each profile created a 1200x1200 tiled coloring, changed zone, painted on the first tap even when the target tile was initially unloaded, and received HTTP 200 from `/progress/actions` with `completed_cells > 0`.

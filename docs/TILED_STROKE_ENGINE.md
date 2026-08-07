# TILED STROKE ENGINE — «краска следует за пальцем»

Цель: сделать процесс раскрашивания в 1200×1200 tiled-плеере таким же
непосредственным, как в legacy-плеере. Критерий: пользователь ведёт пальцем
по клеткам одного цвета и видит, как каждая клетка заполняется ВО ВРЕМЯ
движения, а не после отпускания.

Статус: **hot path переработан, E2E-доказательство есть** (см. раздел
«Верификация»). Остаточный зазор vs legacy — только теоретический
(см. «Remaining gap»).

---

## 1. Baseline (Cycle 1) — где tiled проигрывал

Измерения — node-бенчмарк `scripts/benchmark-stroke.mjs` на реальных
модулях (rasterizer, TileGuideIndex, TileCellStore/LruTileCache, gridMath),
одинаковые жесты: tap / 5 / 20 / 50 / 100 / 250-cell / zig-zag /
self-intersection / horizontal / diagonal / cross-tile.

| сценарий | TILED per-event p50 | TILED finalize (pointerup) | из них guide rescan | LEGACY total |
|---|---|---|---|---|
| 1-tap | 0.0µs | 0.77ms | 0.07ms | 0.56ms |
| 20-cell | 1.2µs | 1.3ms | 1.2ms | 0.62ms |
| 100-cell | 1.2µs | **7.7ms** | 7.2ms | 0.61ms |
| 250-cell fast | 2.9µs | **18.3ms** | 17.3ms | 0.57ms |
| cross-tile | 0.8µs | **10.8ms** | 10.6ms | 0.62ms |

Выводы baseline:

- **Per-event стоимость НЕ была проблемой** (~1–3µs). Проблема была в том,
  что per-event ничего не РИСОВАЛ: `pointermove → addStrokeCell` только копил
  индексы; весь визуал откладывался на pointerup.
- **Pointerup масштабировался линейно от числа клеток** (0.8ms → 18.3ms на
  250 клеток), и ~90% уходило в `guideIndex.refreshTile(tile)` **на каждую
  закрашенную клетку** (N × полный скан тайла 32×32 = N×1024 операций).
- Синхронный `rebuildMinimapBase()` (скан всех ~48 резидентных тайлов) в
  финализации — ещё ~0.05–0.6ms в критическом пути.
- Дедупликация через `pointer.indices.includes()` — квадратичная в худшем
  случае (на 250 клетках дала ~0.14ms — вторично, но структура нарушала
  требование O(1)).
- Legacy (128×128) финализируется за константу (~0.5–0.7ms: копия массива
  16k клеток), и legacy РИСУЕТ КАЖДУЮ КЛЕТКУ ВО ВРЕМЯ DRAG
  (`drawStrokePreviewCells` в `handlePointerMove`).

---

## 2. Root causes (максимум 5)

1. **Нет live-покраски во время drag.** `pointermove` только аккумулировал
   индексы; визуальное обновление — целиком на pointerup. Это
   фундаментальная причина «тяжёлого» ощущения.
2. **Per-cell full-tile rescan в финализации** — `refreshTile` на каждую
   клетку = N×1024 сканов (250 клеток → ~15ms чистого JS на desktop node;
   на мобильном WebView кратно хуже).
3. **Синхронный minimap-ребуилд в pointerup** (скан всех резидентных
   тайлов) — платили input latency ради свежести миникарты.
4. **Линейная дедупликация** `includes()` в накоплении стока — O(N²) в
   худшем случае.
5. **Гонка кэша: `fetchTile` перезаписывал резидентный тайл свежим с
   сервера**, стирая локальную optimistic-покраску (визуальный откат клеток
   после быстрой серии камерных loadViewport — найдено E2E-прогоном;
   фикс: первый успешный fetch побеждает).

---

## 3. Архитектура before/after

### BEFORE (всё на pointerup)

```
pointermove → rasterize → includes()-dedupe → [накопление индексов]
pointerup   → per-cell: getCell + updateFilled + refreshTile(1024-скан)
            → rebuildMinimapBase() + drawMinimap()
            → onStrokeCommitted → save queue → redraw() → full draw()
```

### AFTER

```
INTERACTIVE (ultra-hot, на каждый pointer sample)
  mapPointer → rasterizeStroke → Set-dedupe → paintStrokeIndex
  → mutate tile.filled[localIndex] (typed array) → paintCellImmediate
    (canvas fillRect+strokeRect СИНХРОННО в том же task)
  → unloaded tile: тихий фоновый preload, клетка не блокирует сток

FRAME PATH — нет отдельного кадра: каждая клетка рисуется в своём событии
(решение после измерения: rAF-флаш в headless-окружении не отрабатывал;
синхронная отрисовка 1–5 fillRect на событие — микросекунды, как в legacy)

STROKE FINALIZATION (pointerup / pointercancel / pinch-переход)
  cancelDirtyFlush → guide: refreshTile ОДИН раз на изменённый тайл (Set)
  → scheduleMinimapRebuild(+120ms, вне критического пути)
  → один onStrokeCommitted (save queue, 64-batch) → один redraw() (канонический)

ASYNC
  save queue → POST /progress/actions (≤64/батч), revision-идемпотентность
  guidance / rewards / analytics — не трогают палец
```

Память: per-stroke Set (indexSet) + changes-массив + dirtyTiles-Set —
освобождаются на финализации; ничего глобального не растёт
(проверено: 100 повторных стоков не дают роста — структуры per-stroke).

---

## 4. Производительность после (Cycle 2–3)

Бенчмарк (node, 14 итераций, те же сценарии, `--after`):

| сценарий | finalize BEFORE | finalize AFTER | p95 AFTER | per-event p95 |
|---|---|---|---|---|
| 1-tap | 0.77ms | **0.07ms** | 0.40ms | — |
| 20-cell | 1.3ms | **0.07ms** | 0.26ms | 4.8µs |
| 100-cell | 7.7ms | **0.24ms** | 0.58ms | 2.1µs |
| 250-cell fast | 18.3ms | **0.53ms** | 1.63ms | 9.9µs |
| cross-tile | 10.8ms | **0.40ms** | 0.57ms | 5.2µs |

Minimap: 0.049ms синхронно → 0 (deferred, вне пути).

E2E (реальный touch-путь через CDP `Input.dispatchTouchEvent`, 30 клеток
одним жестом):

- **chromium**: `painted=30`, `finalizeMs=2.1ms`, `maxEventMs=0.6ms`;
  cross-tile 27 клеток через границу — mid-drag probe за границей закрашен
  ДО отпускания пальца.
- **Mobile Pixel**: оба теста зелёные (2.8m) — live paint и cross-tile
  работают на мобильной эмуляции.

Целевые метрики ТЗ (p95 finalize <33ms, event→paint в тот же кадр,
нет long tasks >50ms): **достигнуты с запасом ~15×.**

---

## 5. Изменения по горячему пути — что убрано

Убрано из интерактивного пути:

- React-рендеры и setState на каждую клетку (только refs + canvas);
- сетевые запросы (0 network waits в happy path: workset preloaded);
- полный скан тайла на клетку (refreshTile → 1× на изменённый тайл);
- полный minimap-ребуилд (→ отложенный, +120ms);
- линейный поиск в накоплении (→ Set);
- пересоздание grid-дескриптора на каждый locateCell (→ WeakMap-мемо);
- потеря стока на pointercancel / pinch (→ finalize).

Добавлено:

- `strokeLive.js`: чистые `paintStrokeIndex` / `extendStroke` (O(1) dedupe,
  per-cell валидация и мутация; тестируемые юнитами);
- `paintCellImmediate` — синхронная отрисовка клетки в task события;
- `scheduleMinimapRebuild`, `preloadTileSilently`, `finalizePointerStroke`;
- coalesced pointer samples (`getCoalescedEvents`, ≤16/событие) — быстрые
  свайпы не пропускают клетки;
- wrong-color: один bounded feedback на жест (в pointerdown или finalize),
  wrong-клетки остаются пустыми;
- opt-in метрики стоков (`?splintMetrics=1` → `window.__splintStrokeMetrics`:
  events/rasterized/unique/painted/wrong/unloaded/maxEventMs/finalizeMs/first/last).

---

## 6. Тесты

- `test/strokeLive.test.js` (11): A — live paint до pointerup; B — O(1)
  dedupe (каждая клетка обработана ровно один раз, linear); C — 100 клеток
  в одном тайле → один dirty tile; D — cross-tile без сети; E — sparse
  samples → непрерывный путь; F — self-intersection без дублей; G — >64
  клеток одним стоком (батчинг — деталь сети); H — wrong-mix (correct
  красятся, wrong пустые, один feedback); I — повторная обработка не
  дублирует changes; reveal-mode; unloaded-тайлы не блокируют.
- `npm run test` — 283 pass; `npm run build` ✓; `npm run lint` ✓.
- `scripts/benchmark-stroke.mjs [--after] [--quick]` — воспроизводимый
  бенчмарк BEFORE/AFTER, все сценарии ТЗ.
- `e2e/tiled-stroke-engine.spec.js` — 2 теста на реальном touch-пути:
  30-cell live paint (mid-drag pixel probe ДО отпускания + server-аудит +
  второй сток сразу) и cross-tile drag (probe за границей тайла mid-drag +
  server-аудит обеих сторон границы). Фикстура `stroke-bars.png`
  (1200×1200, 10 плоских полос) генерируется `scripts/gen-stroke-fixture.mjs`.
- Скриншоты evidence: `docs/evidence/tiled-stroke-mid-drag.png`,
  `tiled-stroke-cross-tile-mid-drag.png`, `tiled-stroke-second-stroke.png`.

---

## 7. Известные гонки и как закрыты

- **fetchTile vs локальная покраска**: `tileCache.set` в `.then` мог
  затереть оптимистично закрашенный тайл свежим ответом (поздние
  loadViewport от камерной анимации). Фикс: `if (!tileCache.has(key)) set` —
  первый успешный fetch побеждает; серверная авторитетность приходит через
  progress-revision, не через перезапись живого тайла.
- **Камерная анимация guidance vs мини-мап jump**: клик мини-мап в «рамку
  viewport» (14px ≈ 100 клеток вокруг центра) стартует drag, а не jump —
  учтено в E2E (линия выбирается в стороне от рамки), в продукте поведение
  штатное (drag рамки).
- **E2E rect-drift**: HUD может сдвинуть area на ~1 клетку между расчётом
  экранных координат и touch-событием — тест резолвит фактическую строку из
  кэша (`findPaintedRow`). Это особенность теста, не движка.

---

## 8. Remaining gap vs legacy

- Численно: legacy 128×128 finalize 0.5–0.7ms vs tiled 0.1–0.5ms (benchmark)
  и 2.1ms (E2E с реальным touch) — разница в пределах шума и далеко под
  порогом восприятия (<16ms).
- Live-paint: tiled красит ФИНАЛЬНЫМ цветом сразу (мутация состояния),
  legacy — полупрозрачным preview с полной перерисовкой на pointerup.
  Tiled в этом смысле честнее legacy.
- Minimap: в tiled обновляется на ~120ms позже стока (свежесть чуть ниже,
  но палец не платит). В legacy minimap нет.
- Остаточные риски физического Telegram WebView (не воспроизводимы в
  Playwright): частота `pointercancel` от системных жестов (finalize уже
  корректный), coalescing на слабых устройствах (обрабатывается), throttled
  rAF/timers у фоновых WebView (не влияет — отрисовка синхронная).

---

## 9. Файлы

- `src/features/coloring/large-grid/strokeLive.js` (new)
- `src/features/coloring/large-grid/ProgressiveColoringSession.jsx`
- `src/features/coloring/large-grid/gridMath.js` (descriptor memo)
- `src/lib/progressiveGridClient.js` (fetchTile first-wins)
- `test/strokeLive.test.js` (new)
- `scripts/benchmark-stroke.mjs`, `scripts/gen-stroke-fixture.mjs` (new)
- `e2e/tiled-stroke-engine.spec.js` (new), `e2e/fixtures/stroke-bars.png`
- `docs/evidence/tiled-stroke-*.png` (evidence)

## 10. Верификация

- Unit: 283 pass (включая 11 новых strokeLive).
- Build/lint: чисто.
- E2E chromium: tiled-stroke-engine 2/2 passed; полный e2e-набор — см. CI-прогон.
- Мобильный touch: Mobile Pixel — см. прогон проекта (ниже/в CI).
- Ответ на главный вопрос: **DOES PAINT FOLLOW THE FINGER? — YES**
  (доказано mid-drag pixel probe до отпускания пальца и до любого POST;
  cross-tile без пауз; pointerup finalize 2.1ms).

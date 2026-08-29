# Special Cells MVP Plan

> **Current implementation note (2026-08-11).** The original plan below is
> retained as the conservative product decision and rollback boundary. The
> working branch has since added server/client slices for Bomb, Fuse, Choice,
> Artifact, and Hazard behind the same existing progress/actions path. These later
> slices remain experimental until the long-journey and product gates in
> `docs/SPECIAL_CELLS_BALANCE.md` pass; Spark-only remains the safe fallback.

## Current implementation facts

The active production path is mixed-kind v4 for newly-created tiled maps:

- tiny maps up to 8,192 cells: one deterministic candidate;
- small tiled maps: one candidate per 600 cells;
- medium tiled maps below 800,000 cells: one per 150 cells;
- 1200-class maps: one per 175 cells, bounded by 8,192 generated candidates;
- generated records are capped at eight per tile because tile payloads are
  bounded at eight;
- `SPECIAL_EVENT_MAX_CELLS` is 8,192; Spark fills its bounded 12x12 Smart
  target (<=144), while other derived effects retain their existing caps;
- Spark pity/guidance semantics remain Spark-specific at 6,000 cells;
- the deterministic mix is Spark/Bomb/Fuse/Choice/Artifact, with one separate
  disjoint Hazard row on eligible maps;
- the first/early candidate is always Spark for tiled and larger legacy maps,
  preserving the INITIAL_TARGET early-discovery contract.

Legacy semantics are no longer tiled-only: the exact 28x28 legacy fixture
stays Spark-only, while larger legacy maps use the same mixed placement plus
Hazard and render discovery/offer UI through the legacy session. Client claim
detection checks committed changes against the marker target color in both
classic and reveal modes.

The historical Slice 3/4 proposals in this document are superseded: current
Bomb uses the shared 32-cell derived-change cap (not 24), and current Fuse is
a bounded chain resolved through the offer UI (`disarm_fuse`/`skip_fuse`), not
a long-press disarm.

The Spark-only density and pity values in the historical sections below are
kept only to explain the original rollback baseline. They must not be used as
the current mixed-kind implementation specification.

Статус: implementation plan only. Production-код пока не изменять.

## 1. Окончательный MVP

### Spark Cell — единственная механика v0

```text
видимый marker в Canvas
→ игрок правильно закрашивает Spark Cell
→ сервер возвращает два допустимых Smart Engine target
→ игрок выбирает один или пропускает
→ сервер применяет весь persisted Smart target (max 12x12 / 144)
→ обычная раскраска продолжается
```

Ограничения:

- Spark candidates use density `ceil(total_cells / 6000)`, bounded at 512;
- 128x128 macro-region stratification keeps regional counts balanced;
- one deterministic early Spark is inside the first treatment Smart Engine target;
- server pity may route the next Spark target at each 6000 completed-cell boundary;
- максимум 2 target options;
- complete persisted Smart target, max 12x12 / 144 server-derived changes per use;
- 0 inventory;
- 0 trap;
- 0 Choice Cell;
- 0 новых endpoint;
- legacy player в первой версии не меняется.

## 2. Что исключено

| Исключено | Почему |
|---|---|
| Bomb | Второй effect не нужен для проверки базовой гипотезы; добавляется только после положительного Spark-сигнала |
| Smart Boost | Слишком близок к обычному Smart Engine `next target`; трудно доказать отдельную ценность |
| Jammer | Искусственно ухудшает Smart Engine и не создаёт хорошего skill expression |
| Fuse/trap | Более честная альтернатива, но negative event пока добавит confound и риск раздражения |
| Choice Cell | Выбор Smart target уже является достаточным решением v0 |
| Inventory | Добавляет persistent state и UI до доказательства, что power хочется откладывать |
| Chains/artifacts/XP/currency | Не относятся к moment-to-moment эксперименту |

## 3. Vertical slices

### Slice 1 — Spark end-to-end

**Изменяемые модули:**

- узкий server special service;
- tiled template/progress/guidance routes;
- `ProgressiveGridClient`, `smartRoute.js`;
- `ProgressiveColoringSession`, `ColoringHud`;
- minimal `useColoringSession` wiring.

**Данные:**

- `coloring_special_cells` — immutable static rows;
- `coloring_special_progress` — per-user/per-template status и одноразовый
  offer hash;
- existing `coloring_progress_batches` — idempotency/replay.

**API:** additive tile `specials`, existing guidance с bounded
`SPECIAL_TARGETS`, existing progress/actions с `claim_spark` и `use_spark`.

**Unit verifier:**

- deterministic placement;
- valid tile/local/global coordinates;
- max two options;
- full selected target, max 12x12 / 144 derived cells;
- token/status transitions;
- special lookup не находится в pointermove hot path.

**Integration verifier:**

- correct claim and exact-color validation;
- wrong color does not claim;
- use computes cells on server;
- stale revision/options do not spend offer;
- duplicate request/replay gives no second effect;
- concurrent devices produce one result;
- no full-grid arrays in responses.

**E2E verifier:**

- tiled 1200×1200 fixture;
- 360, 390, 430 px;
- marker → paint → two options → select → progress response → three ordinary
  strokes;
- reload/offline retry and accessibility labels.

**Rollback boundary:**

Feature flag off removes special overlays and action branches from UI. Existing
ordinary painting, tiled progress and guidance continue unchanged. Unused static
rows may remain in storage; no inventory or global user data is created.

### Slice 2 — Experiment quality, без новой механики

**Scope:** control/treatment assignment, marker visibility, target difference,
cooldown и event completeness.

**Изменяемые модули:** existing feature-flag/session assignment, guidance
scoring/copy и minimal event emitter; gameplay state не расширяется.

**Новые данные:** только пять experiment events; новых progress/state tables
нет.

**API:** existing progress/guidance responses и existing telemetry path; новых
endpoint нет.

**Verifier:**

- comparable control/treatment fixtures;
- `special_cell_claimed`, `special_targets_presented`,
  `special_target_selected`, `special_applied`,
  `session_continued_after_special`;
- mobile visual QA;
- no material FPS/p95 regression with overlays enabled.

**Rollback boundary:**

Scoring, pacing и feature assignment can be reverted without schema changes.

### Slice 3 — Bomb, conditional

Начинать только после положительного Spark result.

**Scope:** local radius, exact-color filter, maximum 24 cells, same endpoint,
no inventory and no Choice Cell.

**Verifier:** unit geometry, server integration, stale/replay/concurrency,
mobile radius preview and post-use continuation.

**Rollback boundary:**

Disable `bomb` generation/action branch; Spark rows/state remain valid.

### Slice 4 — Fuse, conditional

Начинать только если нужен отдельный test внимательности после positive-event
сигнала.

**Scope:** long press disarms a visible fuse and preserves progress; missing it
loses only an optional bonus, not Smart guidance or completed work.

**Изменяемые модули:** узкий trap-state service, special overlay state,
long-press handler и existing progress action branch.

**Новые данные:** `kind=fuse` и bounded `disarmed/missed` status в уже
существующем special status storage; inventory/temporary guidance timer не
добавляются.

**API:** existing tile metadata и existing progress/actions с `disarm_fuse`;
новых endpoint нет.

**Verifier:** long-press unit, disarm/miss integration, reload/replay,
360–430 px E2E and real Telegram WebView.

**Rollback boundary:**

Disable fuse generation/action; Spark/Bomb progress does not depend on trap state.

## 4. Product experiment

### Минимальные события

1. `special_cell_claimed`;
2. `special_targets_presented`;
3. `special_target_selected` с `skipped=true/false`;
4. `special_applied`;
5. `session_continued_after_special`.

События содержат template/session/special identifiers, revision и timestamp.
Отдельные inventory/trap/replace события в v0 не нужны.

### SUCCESS

При достаточной treatment/control выборке:

- continuation после special выше control примерно на 8 percentage points или
  больше;
- минимум 70% presented options заканчиваются selection;
- median presentation → selection меньше 10 секунд;
- нет заметного роста network/stale/error exits;
- qualitative feedback говорит о выборе участка и приятной неожиданности, а не
  о лишнем popup.

### INCONCLUSIVE

- слишком мало реально увиденных Spark cells;
- плохое различие двух options;
- недостаточная длительность после event;
- несопоставимые template/control группы;
- потерянные события из-за offline/retry.

Сначала исправить measurement/fixture/pacing, не добавлять новые mechanics.

### FAILURE

Удалить или переделать Spark, если после достаточной выборки:

- continuation не лучше control или хуже;
- большинство игроков закрывает/пропускает rail;
- игроки не понимают различие options;
- event воспринимается как interruption;
- server/UI complexity создаёт больше ошибок, чем обычная раскраска.

Не пытаться лечить такой failure добавлением Bomb, inventory или Jammer.

## 5. Архитектурные границы

- tiled 1200×1200 и bounded LRU/cache сохраняются;
- новая LOD overview/work не меняется;
- `strokeLive` hot path не получает network/React/DOM work на обычную клетку;
- special hit проверяется после stroke по редкому sidecar metadata;
- Smart Engine остаётся единственным planner;
- `progress/actions` остаётся server-authoritative;
- revision/CAS/idempotency и offline journal сохраняются;
- legacy player не меняется в Slice 1;
- power effect вычисляется сервером, клиент отправляет только intent;
- production rollout выключается одним feature flag.

## 6. Решения владельца до начала работ

> Historical decision list. These decisions were approved before the current
> mixed-kind implementation; see the current implementation facts above for
> what shipped, and the loop/log/QA documents for the remaining physical
> Telegram gate.

1. Утвердить Spark-only v0 без inventory, trap и Choice Cell.
2. Утвердить tiled-only rollout для Slice 1.
3. Утвердить максимум два options и 32 derived cells.
4. Утвердить control/treatment experiment.
5. Утвердить две bounded state tables либо эквивалентное atomic storage без
   расширения API.
6. Утвердить правило: Bomb начинается только после positive Spark result.

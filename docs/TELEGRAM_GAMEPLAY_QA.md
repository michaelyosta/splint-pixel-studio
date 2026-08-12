# Telegram Gameplay QA: input, gesture, onboarding, diagnostics

Практический чек-лист для ручной QA в Telegram WebView и автоматической
проверки input/gesture-слоя. Документ не меняет игровую механику: он
описывает, как включить treatment/control, с какого пользователя тестировать
и какие результаты считать проходными.

## Окружение

Для ручного QA нужен disposable dev-пользователь и явный QA-оверрайд:

```dotenv
# .env.local
ALLOW_DEV_AUTH=true
VITE_ALLOW_DEV_AUTH=true
VITE_DEV_USER_ID=qa_input_2026_08
NODE_ENV=development
SPECIAL_CELLS_QA_OVERRIDE=true
SPECIAL_CELLS_QA_USER_ID=qa_input_2026_08
SPECIAL_CELLS_COHORT=SPECIALS_TREATMENT
SPECIAL_CELLS_DIAGNOSTICS=true
VITE_SHOW_SPECIAL_CELLS_DIAGNOSTICS=true
```

`SPECIALS_CONTROL` включается той же парой `QA_OVERRIDE` +
`QA_USER_ID`, но с `SPECIAL_CELLS_COHORT=SPECIALS_CONTROL`. Оверрайд
применяется только к allowlisted-пользователю; другие dev-пользователи
получают детерминированное назначение. `NODE_ENV` должен быть ровно
`development` или `test`; пропущенное/опечатанное значение делает QA-флаги
инертными.

Запуск:

```powershell
npm run dev
npm run dev:api
```

Проверка через Vite: `http://127.0.0.1:5173/`. Для реального Telegram
открыть тот же URL в WebView Android/iOS через тестовый бот или tunnel.

## Disposable QA user

- `VITE_DEV_USER_ID` и `SPECIAL_CELLS_QA_USER_ID` должны совпадать.
- Используйте уникальный суффикс на каждый прогон, чтобы не таскать
  состояние предыдущего QA.
- Для полной изоляции можно стартовать API с отдельным `SQLITE_DB_PATH`
  и удалить этот файл после прогона.
- Production никогда не должен получать `ALLOW_DEV_AUTH=true`,
  `SPECIAL_CELLS_QA_OVERRIDE=true` или `SPECIAL_CELLS_DIAGNOSTICS=true`.

## Автоматизированные проверки

Сфокусированный набор:

```powershell
npx playwright test e2e/coloring-surface-gesture-guard.spec.js e2e/input-gesture-evidence.spec.js --project=chromium --project="Mobile Pixel"
```

Что доказывается:

- обычный paint коммитится в `/progress/actions` (`completed_cells > 0`);
- после агрессивного drag нет текстового selection;
- реальный touch (CDP `Input.dispatchTouchEvent`) красит клетку и держит
  pointer capture;
- two-pointer pinch меняет `data-camera-zoom`;
- `pointercancel` не оставляет застрявший stroke: следующее касание снова
  коммитится;
- вне player обычный скролл каталога работает;
- surface не выходит за 360/390/430 px;
- WebKit-assertions используют `webkitUserSelect` и не требуют
  unsupported computed-свойств.

## Manual Android steps

1. Открыть treatment-сборку в WebView, выбрать небольшую legacy и tiled
   картину.
2. Закрасить клетку пальцем: сразу после касания клетка заполняется,
   после поднятия пальца появляется POST `/progress/actions` и растёт
   `completed_cells`.
3. Быстрый swipe по холсту: штрих непрерывный, selection не появляется,
   long-press не выделяет текст и не открывает callout.
4. Двумя пальцами развести/свести: zoom меняется, карта не прыгает при
   смене пальцев.
5. Начать штрих и прервать системным жестом (edge swipe, уход с экрана):
   после возврата следующий штрих сразу работает, нет «залипшего»
   painting/pan состояния.
6. Перевести приложение в фон во время pending save, вернуть и дождаться
   `Синхронизация… → Сохранено`; offline-очередь не теряет клетки.
7. Special discovery: закрасить маркер, проверить discovery-бейдж, offer
   (Spark/Bomb/Fuse/Choice/Artifact/Hazard), применение и возврат к обычной
   раскраске.
8. Onboarding/help: fresh-пользователь проходит краткий вводный шаг,
   первая встреча каждого вида показывает одну контекстную подсказку с
   действием, «Особые клетки» открывается из меню и не гасит будущие
   kind-подсказки.
9. Diagnostics: при `SPECIAL_CELLS_DIAGNOSTICS=true` проверить payload
   `/colorings/:id/progress` (`special_diagnostics`, `artifact_progress`) и
   dev-HUD (в dev также работает `?specialDiagnostics=1` на Vite URL; query
   не меняет cohort).

## Manual iOS steps

1. Те же шаги 1–9, но особое внимание: Safari/WKWebView long-press и
   callout, image drag у preview, отсутствие selection на canvas.
2. Проверить, что `-webkit-user-select: none`, `-webkit-touch-callout: none`
   и `-webkit-user-drag: none` применены, а редактируемые контролы
   (`textarea`, `[contenteditable]`) остаются selectable.
3. WebKit может не отдавать стандартные computed-свойства
   (`userSelect`, `overscrollBehavior`); QA смотрит на `webkitUserSelect`
   и реальное поведение жеста, а не на отсутствующие computed props.

## Expected results / evidence

- Selection: `window.getSelection().rangeCount === 0` после drag.
- Paint: `completed_cells` растёт в ответе `/progress/actions`.
- Pinch: `data-camera-zoom` увеличивается/уменьшается без page errors.
- Pointercancel: следующий POST после cancel содержит новый commit.
- Scroll: `.screen-content` в каталоге имеет `scrollTop > 0` после wheel;
  play-screen не скроллится.
- Onboarding: control-пользователь не видит special intro/hint/overlay;
  treatment видит ровно один kind-hint на первый контекст.
- Evidence: скриншоты и metrics класть в
  `docs/evidence/input-gesture-<date>/` рядом с именами проектов
  (`chromium`, `Mobile Pixel`, `Mobile iPhone`).

## Runtime blockers

Если сфокусированные e2e падают, это фиксируется отдельно от тестов:
занятые файлы (`ColoringCanvas.jsx`, `ProgressiveColoringSession.jsx`,
`telegram.js`) не правятся в рамках этой работы, пока их меняют другие
агенты. Точные patch proposals для таких блокеров перечисляются в ответе,
а не маскируются в тестах.

## Human gate

Automated suites verify contracts and layout only. Physical Telegram Android
and iOS WebView sessions remain pending: haptic delivery, long-press/callout,
pagehide/resume during pending actions, safe area/lifecycle, and touch feel
of markers/offers must be observed on real devices before this document's
manual checklist is marked complete.

## Analytics audit for the upcoming real gameplay test

The existing analytics allowlist already covers the essential Special Cells
questions without a new analytics project or special-id leaks. Event names and
payload fields below are the current contract; the server persists every
accepted event in `analytics_events` with `user_id`, `event`, `payload_json`,
and `created_at`, and `/meta/analytics/summary` returns per-user counts.

### Essential question to event mapping

| Question | Event | Payload fields to read |
|---|---|---|
| Treatment exposure | `special_targets_presented`, `special_cell_claimed`, `powerup_received` | `template_id`, `special_id`, `kind`, `option_count`, `revision`, `experiment_group` |
| First discovery | `special_cell_discovered` | `template_id`, `special_id`, `kind`, `session_id`, `revision`, `experiment_group` |
| Received | `powerup_received` | `special_id`, `kind`, `revision`, `experiment_group` |
| Used | `special_applied`, `powerup_used`, `special_action_selected` | `special_id`, `kind`, `action`, `cells`, `time_to_use_ms`, `revision`, `experiment_group` |
| Skipped | `special_action_selected` with `action=skip_*`/`disarm_*`, plus `special_target_selected` with `skipped=true` | `special_id`, `kind`, `action`, `option_id`, `skipped`, `experiment_group` |
| Type | `kind` on every special event | `kind` |
| Continuation after event | `session_continued_after_special` | `template_id`, `session_id`, `experiment_group` |
| Acquisition-to-use | `time_to_use_ms` on `special_applied`/`powerup_used` | `time_to_use_ms` |

### Existing event names (server allowlist)

`special_cell_discovered`, `special_cell_claimed`, `special_targets_presented`,
`special_target_selected`, `special_applied`, `powerup_received`,
`powerup_used`, `special_action_selected`, and
`session_continued_after_special` are all accepted by the analytics route.
`special_help_hint_shown` and `special_help_opened` are also accepted for
onboarding QA.

### Storage and queries

The analytics route is `POST /meta/analytics` with `{ event, payload }`; the
payload is stored as `payload_json` and is not joined to any Special Cells
table. Per-user counts are available via `GET /meta/analytics/summary`.

Example SQL against the stored rows:

```sql
SELECT event, COUNT(*) AS count
FROM analytics_events
WHERE user_id = ? AND created_at >= ?
GROUP BY event;
```

For acquisition-to-use, join `special_cell_claimed`/`special_targets_presented`
with `special_applied`/`powerup_used` on `(user_id, template_id, special_id)`
and read `time_to_use_ms` when present. No special coordinates, tokens, option
payloads, or effect cell lists are stored in analytics payloads.

## Deterministic cohort fixture endpoint (Luna handoff)

`POST /__e2e/seed-cohort-template` is a test-only seed hook mounted only when
`E2E_SEED_HOOKS=true`; production never mounts the router and never accepts
the QA override flags. It creates a real template whose production cohort
assignment matches the requested cohort for the authenticated `req.userId`.
No cohort override is persisted or consulted.

Request body:

```json
{
  "cohort": "treatment",
  "storage": "tiled",
  "size": { "width": 64, "height": 64 }
}
```

Allowed values:

- `cohort`: `treatment` or `control`;
- `storage`: `tiled` or `legacy`;
- `size`: one of the supported fixtures. Tiled: 64x64, 160x160, 1200x1200.
  Legacy: 28x28, 96x96, 160x160. Omit `size` to use the first supported size.

The template id is derived deterministically from
`(userId, cohort, attempt, size)`, where `attempt` is the first id whose real
deterministic `isSparkTreatmentUser` assignment matches the requested cohort
(`attempt` is usually `0` but not guaranteed). The same request always returns
the same id and reuses the existing template (idempotent). Requests are
bounded to 64 candidate attempts and fail explicitly if no valid seed is
found. Templates are owner-scoped to the authenticated user and the endpoint
never accepts a `progressUser`/other-user id. The endpoint deliberately uses
the deterministic hash function, not `getSparkExperimentGroup`, so a running
QA override cannot flip a seeded fixture's cohort.

Example response:

```json
{
  "id": "tpl_cohort_e2e_<user>_treatment_0_64x64",
  "cohort": "treatment",
  "storage": "tiled",
  "size": { "width": 64, "height": 64 },
  "tileSize": 32,
  "user_id": "<authenticated user>",
  "specials_experiment_group": "treatment",
  "deterministic_seed": "tpl_cohort_e2e_<user>_treatment_0_64x64",
  "reused": false
}
```

Luna can replace the current random-cohort retry loops in e2e specs with this
endpoint while keeping the same public template/progress semantics.

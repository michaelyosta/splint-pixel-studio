# Splint Product Recovery — Phase 2 Handoff

Статус этой поставки: **READY FOR PHASE 2 HUMAN PLAYTEST**.

Это означает, что vertical slice собран, серверный контракт и automated regression checks проходят. Это **не** означает, что удовольствие, желание продолжить или retention доказаны: для этого нужны настоящие игроки на Telegram device.

## 1. Scope выполненного slice

Phase 2 ограничен одной гипотезой: ручная раскраска должна превращаться в спокойную игру с осмысленным следующим beat.

В treatment включены только:

- ручной Spark как один spectacle/reveal prototype;
- Artifact как редкая находка, возникающая из ручного stroke;
- Smart Director как предложение следующего fragment, а не принудительный автопилот;
- явная пауза после Spark и кнопка «Пауза» в top bar;
- минимальные события для будущего сравнения.

В control специальные события полностью скрыты в клиентском slice. Fuse, Hazard, Choice и Bomb не показываются в этом эксперименте. Их production implementation и серверная инфраструктура не удалялись.

Не менялись: Stars, магазин, social feed, XP/progression architecture, новые виды Special Cells, 1200×1200 как отдельный продуктовый режим и backend migration strategy.

## 2. Как открыть сравнение

Нужен tiled artwork и его `coloringId`.

Treatment:

```text
/?coloringId=<ID>&phase2=session&phase2Variant=treatment&phase2Subject=phase2_human_01
```

Control:

```text
/?coloringId=<ID>&phase2=session&phase2Variant=control&phase2Subject=phase2_human_01
```

`phase2Subject` используется только при dev auth и ограничен форматом `phase2_[a-z0-9_-]{1,40}`. В production build query не активирует эксперимент без явного `VITE_PHASE2_SESSION_GAME_ENABLED=true`.

## 3. Что было до Phase 2

До этого Spark в основном был throughput shortcut: сервер мог вернуть один default target, а клиент автоматически применял его через Smart Engine. Игрок не выбирал reveal beat и не получал ownership pause. Остальные Special Cells конкурировали за внимание с базовой раскраской.

## 4. Что теперь происходит

1. Игрок вручную закрашивает клетку Spark.
2. Сервер сохраняет stroke и создаёт persisted offer.
3. В treatment показываются до двух вариантов: «Крупный фрагмент» и «Другой фрагмент».
4. Пока игрок не нажал вариант, Spark ничего не применяет.
5. Сервер применяет ровно выбранный bounded target; `auto_apply=false`.
6. Canvas получает restrained reveal: bounded glow rectangle и короткий «Участок раскрыт» beat.
7. Camera не телепортируется дальше автоматически: появляется `Следующий фрагмент`; игрок сам решает продолжить.
8. В top bar доступна `Пауза`; прогресс остаётся сохраняемым и resumable.
9. Artifact claim не открывает отдельный inventory flow: ручной claim даёт короткий visual discovery overlay и fragment count 1/3, 2/3 или 3/3.

## 5. Smart Director и agency

Обычная guidance-навигация остаётся bounded и tile-based. Только закрытие Phase 2 Spark offer переводится в ownership pause. Это сознательно не переписывает весь Smart Engine до Phase 2 human evidence.

Варианты Spark используют общий server-authoritative contract и option IDs `scene` / `nearby`; labels не обещают ложную географическую близость.

## 6. Meta и Special Cells

Session goals, zone reward, contextual Special Help hint и XP-facing noise скрыты в Phase 2 player slice. Серверные rewards и progression infrastructure остаются для совместимости. Никаких новых XP, streak, timers, inventory или combo economy не добавлено.

## 7. Measurement layer

Allowlisted events:

- `session_game_experiment_open`;
- `session_game_first_action`;
- `session_game_special_offered`;
- `session_game_special_selected`;
- `session_game_special_applied`;
- `session_game_artifact_discovered`;
- `session_game_stop`.

Для playtest нужно сравнивать treatment/control по:

- open → first manual action;
- first action → first Spark offer;
- offer → selection;
- selection → applied reveal;
- reveal → continue / pause;
- resumed open → meaningful action.

События не заменяют интервью и наблюдение. Нельзя интерпретировать automated completion как proof of fun.

## 8. Technical verification

Пройдено в Phase 2 worktree:

- `npm.cmd run build` — PASS;
- root tests — 399 PASS;
- `npm.cmd --prefix server test` — 362 PASS / 65 skipped / 0 failed;
- `server/test/tiled-guidance.test.js` — 10 PASS;
- `server/test/tiled-specials.integration.test.js` — 20 PASS;
- `server/test/analytics-allowlist.integration.test.js` — PASS;
- session-game unit tests — 3 PASS;
- `npx playwright test e2e/phase2-session-game.spec.js --project=chromium` — 1 PASS;
- `git diff --check` — PASS;
- pinned Oxlint 1.74.0 — 93 existing warnings, no new changed-file warning observed; npm lint in the empty worktree would otherwise install a newer tool and exceed the repository budget.

Input/performance guardrails retained: pointermove hot path, tile-bounded Canvas work, Stroke Engine, bounded cache, reduced-motion branch, sound-off compatibility, offline/reload persistence.

## 9. Что пока не проверено

- 8–12 физически наблюдаемых игроков;
- Telegram Android/iOS WebView в реальном устройстве;
- subjective rating calmness, agency, want-again и perceived authorship;
- Spark/Artifact frequency и human stopping points на 30 секунд / 3 минуты / 15 минут;
- визуальная доступность overlay на всех реальных safe-area размерах.

До этих проверок нельзя переходить к Phase 3, возвращать новые Special Cells или строить retention/meta слой.

## 10. Что должен оценить владелец руками

Открыть один и тот же artwork в treatment и control и записать вслух:

1. Что понятно в первые 10 секунд без подсказки?
2. Ощущается ли stroke как непрерывное ручное действие?
3. Видно ли, что именно игрок раскрыл, а не Smart Engine сделал это?
4. Действительно ли два Spark варианта различимы и осмысленны?
5. Хочется ли нажать `Следующий фрагмент` после reveal?
6. Хочется ли встретить Artifact ещё раз?
7. Нормально ли остановиться через 30 секунд и вернуться позже?
8. Есть ли раздражение от камеры, HUD или паузы?

Решение по дальнейшему направлению принимается только после этого сравнения.

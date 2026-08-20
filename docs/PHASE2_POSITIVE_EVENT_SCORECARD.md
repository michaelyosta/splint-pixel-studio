# Phase 2 positive-event candidate scorecard

Статус: **reversible agent prototype; не выбор победителя**.

Цель сравнения — проверить, какой один редкий positive event лучше усиливает
ручное раскрытие картины. В обоих treatment-вариантах Artifact остаётся
пассивной находкой: игрок обнаруживает её своим stroke, получает короткий
visual beat и не попадает в inventory/economy flow.

## Сравниваемые варианты

| Вариант | URL knob | Что делает игрок | Что делает сервер | Early special kinds |
| --- | --- | --- | --- | --- |
| Spark choice | `phase2Event=spark_choice` (default) | Закрашивает Spark, выбирает один из двух предложенных участков | Авторитетно применяет выбранный bounded target | Spark + Artifact |
| Spark auto | `phase2Event=spark_auto` | Закрашивает Spark | Авторитетно применяет default target без второй кнопки | Spark + Artifact |
| Bomb spatial | `phase2Event=bomb` | Закрашивает Bomb, нажимает «Раскрыть здесь» | Авторитетно применяет bounded radial target вокруг marker | Bomb + Artifact |

`Fuse`, `Choice`, `Hazard`, невыбранный positive event и их HUD не попадают в
эти treatment slices. Production server implementation не удаляется.

## Независимый provisional scorecard

Шкала 0–10; это agent judgement по коду, interaction contract, bounded
transport и текущему visual language. Это не human taste evidence и не claim
о retention.

| Критерий | Spark choice | Spark auto | Bomb spatial | Основание / uncertainty |
| --- | ---: | ---: | ---: | --- |
| Agency | 7 | 4 | 6 | Choice явно оставляет ownership решения. Auto сохраняет ручной trigger, но effect начинается без согласия; Bomb оставляет один use intent, но center пока default. Нужен blinded human review. |
| Interaction cost (10 = низкая цена) | 7 | 10 | 8 | Choice: stroke + 1 выбор. Auto: только stroke. Bomb: stroke + 1 подтверждение, без nudging в slice. |
| Spectacle | 6 | 7 | 7 | Spark получает bounded fragment outline/wave; auto усиливает continuity, Bomb получает radial bounds + distinct warm wave. Сила payoff не доказана без visual/human comparison. |
| Calmness | 7 | 8 | 6 | Spark language остаётся cyan/soft; auto убирает modal choice; Bomb intentionally warmer/redder and one action, поэтому риск interruption выше. |
| Performance safety | 9 | 9 | 8 | All effects use existing tiled cache and post-commit reconciliation. Spark target is capped by server; Bomb derives at most existing bounded change cap and reads local tiles. Needs device profiling. |
| Manual / assisted ratio (first event) | `1 : 4–12+` expected | `1 : 4–12+` expected | `1 : 2–32` expected | Left side is the player trigger cell/stroke; right side is server-derived effect. Actual distributions must come from event telemetry, not this estimate. |

### Interpretation, not winner declaration

- `Spark auto` is the cleanest throughput/calmness experiment, but it may
  violate PARB if the player experiences the reveal as an automatic reward
  rather than an authored beat. Its main validation question is **“did my
  gesture cause this?”**, not whether it is faster.
- `Spark choice` is the safest current agency baseline, but the two target
  options can still be fake choice when their visual distinction is weak.
- `Bomb spatial` has the most legible spatial metaphor, but the current
  one-tap center default is only a bounded action, not yet a strong decision.
  More aiming controls would raise cognitive cost and are deliberately not
  included in this slice.

Current provisional baseline for further comparison: keep `spark_choice` as
control treatment and run `spark_auto` / `bomb` as isolated candidate knobs.
This is reversible and does **not** establish a Phase 2 winner.

## Evidence boundary

Machine/agent evidence to collect in this branch:

- session-game unit tests for event allowlists and URL resolution;
- Playwright first-event checks for automatic Spark and Bomb;
- bounded server responses (`special_applied_changes`, revision, target cap);
- screenshot/DOM evidence for Spark/Bomb wave and Artifact discovery;
- no off-family marker leakage in each slice.

Still validation debt:

- 8–12 real players and observed first-minute behavior;
- physical Telegram Android/iOS WebView input and safe-area review;
- perceived authorship, calmness, desire to continue;
- actual manual/assisted distributions and stop points.

Do not interpret an E2E pass as proof that automatic Spark is enjoyable or
player-authored.

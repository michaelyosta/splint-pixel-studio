# Splint Content Playability Model

Версия: 1.0 (калибровка CYCLE 2)
Pipeline: `scripts/content/content_lib.py`

## Принцип

Красивое исходное изображение ≠ хорошая раскраска. Каждый кандидат
оценивается как **игровой контент**: читается ли объект после пикселизации,
есть ли крупные цветовые регионы, не превращается ли работа в механический
труд, хорошо ли работает Smart Engine.

## Метрики

### 1. Регионная структура (`analyze_regions`)

4-связные connected components по сетке template (scipy.ndimage):

| Метрика | Определение |
|---|---|
| `component_count` | число связных регионов (≈ число умных тапов) |
| `component_count_per_10k` | регионов на 10 000 клеток (масштабно-инвариантно) |
| `singleton_ratio` | клетки в регионах размера 1 / все клетки |
| `tiny_component_ratio` | регионы размера 2–3 / все регионы |
| `small_region_cell_ratio` | клетки в регионах ≤3 / все клетки |
| `largest_region_ratio` | крупнейший регион / все клетки (dead-area detector) |
| `median_region_size` | медианный размер региона |

### 2. Палитра (`palette_separation`)

* `min_lab_distance` — минимальное попарное LAB-расстояние между цветами
  палитры. Порог < 12 → цвета визуально неразличимы → reject.
* `color_efficiency` — использованные цвета / размер палитры. < 0.5 →
  палитра раздута впустую.

### 3. Структура источника (`source_structure_metrics`)

Измеряется на **полном разрешении** (thumbnail 256px), а не на grid:
BOX-усреднение при даунскейле маскирует шум.

* `source_contrast` — средняя локальная (3×3) дисперсия яркости.
  Калибровка: production-шаблоны 157–360, градиент ~0.7, шум ~2155.
* `grid_contrast` — та же метрика на grid-разрешении (диагностика).
* `edge_ratio` — доля клеток с сильным яркостным ребром на grid.

## Пороги (экспериментальная калибровка CYCLE 2)

Собраны на 6 production-шаблонах (заведомо хорошие) + синтетических
шум/градиент (заведомо плохие). Воркшоп: `scripts/content/calibration_notes.md`.

| Tier | Сетки | singleton | tiny | per10k | contrast |
|---|---|---|---|---|---|
| small | 12–32 | < 0.10 | < 0.32 | < 2000 | 60–1200 |
| medium | 48–192 | < 0.07 | < 0.28 | < 900 | 60–1200 |
| large | 256–512 | < 0.05 | < 0.25 | < 300 | 60–1200 |
| masterpiece | 600–1200 | < 0.04 | < 0.22 | < 150 | 60–1200 |

Проверка на калибровочной выборке:

| Кандидат | score | difficulty | rejection |
|---|---|---|---|
| astro-whale 32 | 84.0 | VERY_EASY | 0 |
| tea-dragon 32 | 74.0 | EASY | 0 |
| neon-cat 32 | 72.2 | VERY_EASY | 0 |
| coral-jellyfish 128 | 67.1 | HARD | 0 |
| noise 32 | 45.0 (cap) | NORMAL | 2 |
| gradient 64 | 45.0 (cap) | NORMAL | 2 |

## Композитный score

```
raw = structure*0.30 + palette*0.15 + efficiency*0.10 + gameplay*0.25 + source*0.20
if source_penalty >= 0.5: raw = min(raw, 45)   # жёсткий cap
```

* `structure` = 1 − max(singleton, tiny, frag×0.7, dead×0.5)
* `gameplay` = 1 − cost_penalty (per10k против тирового лимита),
  дополнительно ×(1 − 0.25×frag) при включённом Smart Engine
* `source` = 1 − source_penalty (flat/noise)

### Rejection-правила (автоматические)

1. `singleton_ratio` > тировый лимит
2. `tiny_component_ratio` > тировый лимит
3. `min_lab_distance` < 12 (неразличимые цвета)
4. `component_count_per_10k` > тировый лимит
5. `source_contrast` вне 60–1200 (плоский или шумный источник)

Любой сигнал → кандидат помечается в review; 2+ сигнала или score < 50 →
автоматический REJECT (человек может пересмотреть вручную).

## Модель сложности

Difficulty НЕ выводится из числа клеток. Комбинирует: масштаб сетки,
фрагментацию (per10k), tiny-ratio, структуру источника.

| Tier | Условия | Difficulty |
|---|---|---|
| ≤32×32 | per10k < 900, tiny < 0.22 | VERY_EASY |
| ≤32×32 | per10k < 1400 | EASY |
| ≤64×64 | per10k < 600, tiny < 0.2 | EASY |
| 64–192 | per10k < 350 | NORMAL |
| 192–512 | per10k < 120 | HARD |
| >512 | per10k < 60, tiny < 0.15 | MASTERPIECE |
| иначе | | EXPERT |

## Smart Engine совместимость

Для large/masterpiece кандидатов scorer оценивает:

* плотность actionable targets (`component_count_per_10k` в пределах тира);
* микро-острова (`tiny_component_ratio`) — цвет, разбросанный по сотням
  островков по 2–3 клетки, ломает планировщик маршрута;
* мёртвые зоны (`largest_region_ratio` > 0.45 штрафуется);
* sparse colors ловятся через `color_efficiency` + per-color fragmentation.

`smart_engine_friendly` = score ≥ 60 && tiny < 0.25.

## Чего модель НЕ измеряет (ручной review)

* художественную композицию и «wow»-фактор;
* смысловые промежуточные reveal'ы;
* соответствие категории/темы;
* корректность attribution (проверяется в provenance review).

Финальное решение — за человеком (QUALITY_REVIEW → APPROVED/REJECTED).

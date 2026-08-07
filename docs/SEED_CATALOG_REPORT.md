# Splint Seed Catalog Report

Версия: 1.0 (2026-08-07) · Pipeline 1.0.0 · Все 84 APPROVED имеют полный provenance

## Funnel

| Стадия | Количество |
|---|---|
| Discovered (источники в манифесте) | 194 |
| Downloaded + LICENSE_VERIFIED | 194 |
| Converted candidates | 801 |
| Auto-review: APPROVED (score≥58, 0 сигналов) | 347 |
| Curated (best-per-source + тировый баланс) | 84 |
| **Production-ready (APPROVED)** | **84** |
| Rejected (conversion/license/quality) | 110 |

## Breakdown по тирам

| Тиер | Сетки | Количество | Источники |
|---|---|---|---|
| small | 12–32 | 20 | Kenney Tiny Town/Farm, OGA 16×16 food |
| medium | 32–64 | 20 | Kenney Animal/Food, CMA flowers |
| medium-large | 96–192 | 14 | Kenney Animal, Food, Nature |
| large | 256–512 | 15 | Met ukiyo-e/prints, CMA ukiyo-e |
| masterpiece | 600–1200 | 15 | Met ukiyo-e, NASA nebula, CMA |

## Breakdown по темам

| Тема | Кол-во |
|---|---|
| animals | 30 |
| botanical | 26 |
| japanese-art | 24 |
| food | 24 |
| classic-art | 22 |
| farm | 12 |
| flowers | 6 |
| architecture / cities | 6+6 |
| space | 6 |
| landscapes / history | 2+2 |

## Breakdown по сложности

VERY_EASY 20 · EASY 20 · NORMAL 14 · HARD 4 · EXPERT 26 · MASTERPIECE 0 (тир 600+ пока маркируется EXPERT — мастерпис-статус присваивается человеком при публикации)

## Breakdown по лицензиям

CC0: 78 · Public Domain: 6 (NASA). Всё в production-ready pool.

## Breakdown по институциям

Kenney.nl 44 · Met 22 · Cleveland 10 · NASA 6 · OGA 2

## Rejection reasons (количественно)

Из 801 converted → 84 approved; остальные не прошли curation (score/сигналы/тировый баланс):

| Причина | Оценка |
|---|---|
| score < 58 или 1+ rejection signal | ~370 кандидатов (музейные на больших сетках, шумные тайлы) |
| Тировый кап (лимит разнообразия) | ~330 (best-per-source отбор) |
| License REJECTED (не в пуле) | 0 — лицензионный гейт стоит ДО скачивания |
| Conversion failed | 0 (все 194 скачаны и сконвертированы) |
| Duplicate | 0 жёстких дубликатов (sha256 уникальны) |

Характерные rejection signals:
* `component_count_per_10k > лимит` — самый частый (штриховка укиё-э, текстура);
* `tiny_component_ratio > лимит` — микроостровки;
* `palette min LAB < 12` — исправлено merge-этапом (палитры теперь чище);
* `source_contrast` вне 60–1200 — плоские/шумные источники (градиенты, фото).

## Лучшие кандидаты

### Masterpiece-тир (600–1200), топ-5
1. **cma-hokusai-south-wind_g384** (Красная Фудзи) — знаменитая композиция, чёткий силуэт, крупные регионы. Vision: «отличная раскраска». Рекомендованная сетка 384–512 (на 800+ штриховка облаков фрагментирует → per10k сигнал).
2. **met-317877_g512 / g800** — японская гравюра, HARD/EXPERT, сильная композиция.
3. **nasa-PIA07906_g800** — туманность, MASTERPIECE-difficulty по scorer, крупные цветные регионы.
4. **met-207157_g384** — 67.0, чистейший кандидат large-тира.
5. **nasa-PIA15656_g1200** — 68.1, высший score в masterpiece-тире.

### Лучшие small/medium
* kenney-tiny-town / tiny-farm тайлы — 90–96 score, VERY_EASY, идеальны для FTUE.
* kenney-animal-pack (elephant, parrot, monkey, hippo) — 75–86, EASY, читаемые морды.
* cma-flower-* — 65–91, EASY/NORMAL, ботаника с белым фоном.
* oga-food-16x16 — 60–90, VERY_EASY, плотные иконки.

## Masterpiece shortlist (кандидаты 600+)

| Source | Работа | Лицензия | Сетки | Зоны | Оценка |
|---|---|---|---|---|---|
| CMA | Hokusai, Red Fuji | CC0 | 384–600 | небо/облака/гора/подножие | лучший японский кандидат; на 384 чисто |
| CMA | Hiroshige, Kanazawa | CC0 | 256–512 | небо/вода/город | сильный, EXPERT |
| Met | японские гравюры (317877, 207157, 237451) | CC0 | 384–800 | по композиции | стабильно 60–67 |
| NASA | туманности (PIA07906, PIA15656, PIA04225) | PD | 800–1200 | ядро/выбросы/фон | крупные регионы, 1200-пригодны |

Для каждого masterpiece при публикации нужен ручной план зон (chapters) и проверка intermediate reveals — scorer это не оценивает.

## Остающиеся пробелы

* **256–512 тир** — наполнен музейными (15), но хочется больше разнообразия тем (сейчас укиё-э доминирует).
* **600+ / masterpiece** — 15 кандидатов, все EXPERT; нужен ручной отбор 5–10 «экстраординарных» и план зон.
* **Темы-пробелы**: транспорт (1), транспортный large отсутствует; мифология; сезонные (Хэллоуин/НГ — Holiday Kit ещё не загружен); dark-тема.
* **CC-BY пул** заморожен до внедрения attribution-UI (Wellcome botanical — лучший будущий источник).

## Проверки

* Provenance: все 84 → source → license (CC0/PD), schema-валидировано.
* Duplicate: sha256 источников уникальны; perceptual-проверка — субагент F.
* Tests: 29 контентных + 200 npm — зелёные.
* Воспроизводимость: manifest → download → hash → convert (pipeline_version 1.0.0).

## Экспорт

`data/content/import-ready/manifest.json` — 84 шаблона в формате Splint
(`{id, title, category, difficulty, width, height, palette, cells, provenance}`).
Импорт в production — отдельный explicit шаг (НЕ автоматический).

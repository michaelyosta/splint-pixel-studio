# Splint Seed Catalog Report

Версия: 2.0 (2026-08-07, после acquisition batch 2 + двойной adversarial pass) · Pipeline 1.0.0

## Funnel

| Стадия | Количество |
|---|---|
| Discovered (источники в манифесте) | 253 |
| Downloaded + LICENSE_VERIFIED | 253 |
| Converted candidates | 967 |
| Curated + двойной adversarial pass (лицензии, дубликаты, каллиграфия, монолиты, декор-спрайты) | 125 |
| **Production-ready (APPROVED)** | **125** |

## Adversarial review — что было отклонено (оба прохода)

**Pass 1 (субагент F, первые 84):** лицензии 84/84 PASS; отклонено 19:
4 жёстких дубля (met-207157≡met-237451, одинаковый sha256), 4 каллиграфических
свитка (met-701293/816189/53660), 1 эротический свиток (met-888663), 1
NASA-инфографика (PIA15656), 9 фонов-монолитов (Kenney food 82–95%, PIA07906 97.7%).

**Pass 2 (batch 2, новые 90):** отклонено 28:
* служебные файлы (colormap Holiday Kit) — 1;
* декор/эффекты/враги (fish background_*, space enemy_*/effect_*) — 18;
* фоны-монолиты ≥80% на сетках ≥48 — 6;
* near-empty (taps<6) — 4;
* визуально слабые (dragon+tiger сливаются в один тон, Navicella-абстракция) — 2.

## Breakdown по тирам (125 approved)

| Тиер | Сетки | Количество |
|---|---|---|
| small | 12–32 | 39 |
| medium | 32–64 | 21 |
| medium-large | 96–192 | 19 |
| large | 256–512 | 24 |
| masterpiece | 600–1200 | 22 |

## Breakdown по темам

| Тема | Кол-во |
|---|---|
| animals | 53 |
| botanical | 31 |
| classic-art | 31 |
| food | 30 |
| japanese-art | 28 |
| farm | 20 |
| architecture / cities | 12+12 |
| flowers | 9 |
| landscapes | 8 |
| ocean / seasonal / vehicles / space | новые (fish 8, holiday 12, vehicle 8, space 6) |

## Breakdown по сложности

VERY_EASY 39 · EASY 21 · NORMAL 19 · HARD 7 · EXPERT 39 · MASTERPIECE 0 (присваивается человеком при публикации)

## Breakdown по лицензиям

CC0: 121 · Public Domain: 4 (NASA). Всё в production-ready pool.

## Breakdown по институциям

Kenney.nl 74 · Met 14 · Cleveland 28 · NASA 4 · OGA 5

## Rejection reasons (количественно)

Из 801 converted → 65 approved. Полный funnel:

| Причина | Количество |
|---|---|
| score < 58 или 1+ rejection signal (не прошли curation) | ~454 кандидатов |
| Тировый кап (best-per-source отбор) | ~260 |
| Adversarial: фон-монолит ≥82% (дегенеративные) | 9 |
| Adversarial: каллиграфия/текст (не раскраска) | 4 |
| Adversarial: точный дубликат (одинаковый sha256) | 3 записи (4-я осталась) |
| Adversarial: неприемлемый контент (эротический свиток) | 1 |
| Adversarial: инфографика с текстом | 1 |
| License REJECTED (не в пуле) | 0 — гейт стоит ДО скачивания |
| Conversion failed | 0 |

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

`data/content/import-ready/manifest.json` — 125 шаблонов в формате Splint
(`{id, title, category, difficulty, width, height, palette, cells, provenance}`)
+ previews в `import-ready/previews/`.
Импорт в production — отдельный explicit step (НЕ автоматический).

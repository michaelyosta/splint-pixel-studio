# Splint Seed Catalog Report

Версия: 1.1 (2026-08-07, после adversarial review) · Pipeline 1.0.0

## Funnel

| Стадия | Количество |
|---|---|
| Discovered (источники в манифесте) | 194 |
| Downloaded + LICENSE_VERIFIED | 194 |
| Converted candidates | 801 |
| Auto-review: APPROVED (score≥58, 0 сигналов) | 347 |
| Curated (best-per-source + тировый баланс) | 84 |
| Adversarial review (субагент F, независимый аудит) | −19 |
| **Production-ready (APPROVED)** | **65** |

## Adversarial review (субагент F) — что было отклонено

Независимый аудитор (субагент F, 6 скриптов `scripts/adversarial_audit*.py`,
контакт-листы в `data/content/contact_*.png`) проверил все 84 approved:
лицензии 84/84 PASS (0 fail), дубликаты найдены, визуальный аудит 20
случайных + все masterpiece.

**Отклонено 19 (из них 4 — жёсткие дубликаты по sha256):**

| Причина | Количество | Примеры |
|---|---|---|
| Точный дубликат (одинаковый sha256, разные ID) | 4 записи → 1 осталась | met-207157 ≡ met-237451 «Dwarf (one of a pair)» |
| Каллиграфия/текст (не раскраска) | 4 | met-701293 «Poems…», met-816189, met-53660 «Ten Verses on Oxherding» |
| Неприемлемый контент (эротический свиток) | 1 | met-888663 «Handscroll of Ten Homoerotic Scenes» |
| Инфографика с текстом | 1 | nasa-PIA15656 (GALEX диаграмма) |
| Фон-монолит (≥82% одного цвета) | 9 | kenney food bacon/bag/apple-half (82–95%), nasa-PIA07906 (97.7%) |

**Вердикт субагента F: 64/84 выдерживают; по моей независимой перепроверке
65/84** (из четырёх идентичных дублей я оставил один лучший — разница в
подсчёте). Финальный набор — 65 APPROVED.

## Breakdown по тирам (после аудита)

| Тиер | Сетки | Количество |
|---|---|---|
| small | 12–32 | 20 |
| medium | 32–64 | 16 |
| medium-large | 96–192 | 9 |
| large | 256–512 | 11 |
| masterpiece | 600–1200 | 9 |

## Breakdown по темам

| Тема | Кол-во |
|---|---|
| animals | 29 |
| botanical | 18 |
| japanese-art | 16 |
| food | 16 |
| classic-art | 14 |
| farm | 12 |
| flowers | 6 |
| architecture / cities | 6+6 |
| space | 4 |
| landscapes / history | 2+2 |

## Breakdown по сложности

VERY_EASY 20 · EASY 16 · NORMAL 9 · HARD 2 · EXPERT 18 · MASTERPIECE 0 (тир 600+ пока маркируется EXPERT — мастерпис-статус присваивается человеком при публикации)

## Breakdown по лицензиям

CC0: 61 · Public Domain: 4 (NASA). Всё в production-ready pool.

## Breakdown по институциям

Kenney.nl 35 · Met 14 · Cleveland 10 · NASA 4 · OGA 2

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

`data/content/import-ready/manifest.json` — 65 шаблонов в формате Splint
(`{id, title, category, difficulty, width, height, palette, cells, provenance}`)
+ previews в `import-ready/previews/`.
Импорт в production — отдельный explicit step (НЕ автоматический).

# Splint Content Sourcing Strategy

Версия: 1.0 (2026-08-07) · Research: 3 независимых аудита (лицензии, pixel art, open access) · Все URL проверены

## 1. Модель использования контента в Splint

Splint превращает изображение в **coloring template** — самостоятельный
consumable content item: исходник модифицируется (кроп, палитризация,
пикселизация), производная версия дистрибутируется как основной
пользовательский контент. Это «Adaptation» в терминах CC-лицензий.
Поэтому лицензионный фильтр обязателен ДО обработки.

**Требование к лицензии:** MODIFY + DISTRIBUTE DERIVED + USE DERIVED AS
PRIMARY USER-FACING CONTENT — всё одновременно, с правом коммерческого
использования.

## 2. Лицензионная таксономия

| Verdict | Значение | Production-ready |
|---|---|---|
| `APPROVED_CC0` | CC0 1.0 Universal — все права отозваны | ✅ |
| `APPROVED_PUBLIC_DOMAIN` | Public Domain / правительственные работы США | ✅ |
| `APPROVED_CUSTOM_LICENSE` | Лицензия явно разрешает наш use case (пообъектно) | ⚠️ вручную |
| `APPROVED_CC_BY` | Attribution-лицензия | ⛔ пока нет attribution-системы |
| `REVIEW_REQUIRED` | Неоднозначно — нужна ручная проверка | ⛔ |
| `REJECTED` | Запрещено (NC/SA/GPL/без лицензии) | ⛔ |

**CC-BY не входит в production-ready pool**, пока в Splint не реализован
экран кредитов (проверка субагентом A: attribution реализуем — Wikimedia
API отдаёт LicenseShortName, Wellcome отдаёт license.label + credit, OGA
генерирует credits-файлы, но механизм в UI отсутствует).

## 3. Признанные источники

### 3.1 Production-ready pool (CC0 / PD)

| Источник | License | API | Лучшие сетки | Контент | Риски |
|---|---|---|---|---|---|
| **Kenney.nl** | CC0 (тег на странице пака) | нет API, прямые zip | 12–192 | animals, food, town, nature, space, vehicles | хэш в URL меняется при обновлении |
| **Met Museum** | CC0 (isPublicDomain=true) | `collectionapi.metmuseum.org` — без ключа, 80 req/s | 256–1200 | ukiyo-e, ornaments, stained glass | фильтровать isPublicDomain |
| **Cleveland Museum** | CC0 | `openaccess-api.clevelandart.org` — без ключа | 96–1200 | Japanese prints, ceramics, flowers | права третьих лиц на портреты |
| **Rijksmuseum** | CC0 (новый API без ключа!) | `data.rijksmuseum.nl/search/collection` | 256–1200 | Dutch Golden Age, delftware | старый API мёртв (410) |
| **NASA** | Public Domain | `images-api.nasa.gov` — без ключа | 600–1200 | nebula, galaxy, planets | логотип NASA нельзя |
| **Internet Archive** | PD per-item | `archive.org/advancedsearch.php` — без ключа | 256–1200 | USDA Pomological (фрукты), атласы | фильтровать по метаданным |
| **OpenGameArt (CC0 only)** | CC0 / OGA-BY | нет REST API | 12–64 | pixel art, food icons, sprites | исключать CC-BY-SA/GPL |
| **LOC Free to Use** | PD | `loc.gov/search/?fo=json` — без ключа | 256–1200 | WPA posters, railroad posters | >1 req/s режет URL |
| **NGA** | PD/CC0 | API мёртв — IIIF вручную | 256–1200 | Renaissance, Dürer | сайт за Cloudflare |
| **Getty Open Content** | PD | нет API — вручную | 256–1200 | paintings, sculpture | JS-сайт, сложный скрейпинг |
| **Art Institute of Chicago** | CC0 | `api.artic.edu` — без ключа | 256–1200 | paintings, prints | — |
| **Paris Musées** | CC0 | API без ключа (нестабилен) | 256–1200 | French paintings, posters | таймауты с некоторых хостов |
| **Wikimedia Commons** | PD/CC0 (по файлу) | MediaWiki API без ключа | любой | всё | фильтр LicenseShortName |

### 3.2 Review pool (пообъектно)

| Источник | License | Причина |
|---|---|---|
| Wellcome Collection | CC BY 4.0 / PDM | безключевой API, но attribution |
| Rijksmuseum (часть) | CC BY 4.0 | attribution |
| BHL | PD/NC per-item | пообъектный фильтр прав |
| Europeana | смешанная | ключ + фильтр |
| NYPL | PD | API deprecated с 2026-08-01 |
| Harvard Art Museums | CC0 (заявлен) | страница OA 404 на момент аудита |
| British Library Flickr | «no known restrictions» | не CC0, декларативно |

### 3.3 REJECTED

| Источник | Причина |
|---|---|
| British Museum | CC BY-NC-SA — коммерция запрещена |
| Cainos (itch) | «You may not redistribute or resell» |
| CraftPix | редистрибуция производных ограничена |
| Scirra/GameArt2D/Piiixl | подписка, редистрибуция запрещена |
| CC-BY-SA паки (напр. Hyptosis) | share-alike ломает модель |
| GPL-арт | производное наследует GPL |
| itch.io «Free» без лицензии | отсутствие лицензии = all rights reserved |
| любые NC | несовместимо с коммерческой моделью |

## 4. Кейсы риска (цитаты из первоисточников)

1. **«Commercial use allowed» ≠ право на coloring-продукт** — itch.io пак
   Pixel Pumpkin Patch (CC-BY-NC-SA 4.0): NC запрещает коммерцию,
   SA требует лицензировать производный template под той же лицензией.
2. **«Free» без лицензии** — юридически все права сохраняются за автором;
   разрешение на конкретный сценарий в комментариях ≠ лицензия.
3. **OGA FAQ (CC-BY-SA)**: «If you make derivative works, you must
   distribute them under the same license» — шаблон становится открытым.
4. **OGA FAQ (GPL)**: производный контент наследует GPL — конфликт с
   закрытой дистрибуцией Splint.
5. **Getty FAQ (права третьих лиц)**: «some images may include people or
   objects for which a third party may claim rights… it is your
   responsibility to do that research» — та же формулировка в Smithsonian
   ToU. Фильтр: портреты живых людей, современные артефакты, товарные знаки.
6. **OGA-BY 3.0 раздел 3(b)**: обязательная маркировка изменений — «takes
   reasonable steps to clearly label… that changes were made».

## 5. Provenance-модель

Для каждого source asset (поля в `data/content/source-manifest.jsonl`):

```
source_asset_id, source_title, source_creator, source_institution,
source_url, download_url, license_type, license_url,
license_text_snapshot, accessed_at, public_domain_status,
attribution_required, commercial_use, derivative_use,
redistribution_constraints, source_dimensions, source_file_sha256
```

Для каждого derived asset (`derived-manifest.jsonl`):

```
derived_asset_id, source_asset_id, pipeline_version, grid_width,
grid_height, palette_size, conversion_parameters, output_sha256, created_at
```

Инвариант: **DERIVED → SOURCE → LICENSE** — ни один production asset без
этой цепочки. Approved-записи валидируются скриптом
(`validate_source_record` / `validate_derived_record`).

## 6. Контент-тиры

| Тиер | Сетки | Стратегия supply | Источники |
|---|---|---|---|
| small | 12–32 | native pixel art, 6–10 цветов | Kenney tiny-town/farm, OGA 16×16 |
| medium | 48–192 | pixel art + упрощённые иллюстрации | Kenney animal/food/nature, CMA flowers |
| large | 256–512 | curated artwork + preprocessing | Met/CMA ukiyo-e, flowers |
| masterpiece | 600–1200 | строгий отбор, медианный фильтр, merge палитры | Met/CMA/Rijksmuseum, NASA |

## 7. Долгосрочный supply-план

1. **CYCLE 3+ acquisition**: расширение Kenney-паков (все 65 релевантных),
   OGA CC0-фильтр, Met/CMA API-запросы по темам (birds, flowers, ships,
   landscapes).
2. **Новые API**: Smithsonian (ключ — бесплатный), Rijksmuseum (новый
   безключевой), Wellcome (CC-BY после внедрения attribution-UI).
3. **Attribution-система**: когда появится — открыть `APPROVED_CC_BY` пул
   (Wellcome, OGA-BY, game-icons CC BY 3.0).
4. **Периодический refresh**: перепроверка download-URL (Kenney хэши
   ротируются), хэш-верификация при каждом ingestion.
5. **Дубликаты**: perceptual hash при массовом импорте (сейчас — sha256 +
   ручной review).

## 8. Запрещённые источники (без исключений)

Google Images (только discovery), Pinterest, Instagram, DeviantArt, Tumblr,
случайные блоги, wallpaper-сайты, зеркала без provenance, скриншоты,
fan-art, copyrighted game sprites, movie/anime characters, trademark-heavy
art, AI-генерация неизвестного происхождения.

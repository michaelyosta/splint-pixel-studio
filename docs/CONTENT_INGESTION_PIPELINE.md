# Splint Content Ingestion Pipeline

Версия: 1.0.0 · Репозиторий: `scripts/content/` + `data/content/`

## Архитектура

```
SOURCE MANIFEST (JSONL)          DERIVED MANIFEST (JSONL)
  source_asset_id                 derived_asset_id
  license metadata                source_asset_id  ──┐
  download_url                    grid, palette      │ DERIVED → SOURCE → LICENSE
  state: DISCOVERED...            playability score  │
        │                         template (cells)   │
        ▼                         state: CONVERTED.. ▼
┌────────────────────────────────────────────────────────────┐
│ scripts/content/                                          │
│   import_source.py      CLI: download → convert → score    │
│   content_lib.py        core: license, security, convert,  │
│                         playability scorer                │
│   make_review_html.py   previews + review gallery (HTML)   │
│   calibration_notes.md  как калибровались пороги           │
└────────────────────────────────────────────────────────────┘
        │
        ▼
HUMAN REVIEW (data/content/review-decisions.jsonl)
        │ APPROVED
        ▼
data/content/import-ready/   — production-ready bundle
```

## CLI

```bash
# Скачать + верифицировать лицензии + сконвертировать + оценить
python scripts/content/import_source.py data/content/source-manifest.jsonl --convert --report

# Только скачивание/верификация
python scripts/content/import_source.py data/content/source-manifest.jsonl --only LICENSE_VERIFIED

# Сэмпл для CYCLE 2 (первые N источников)
python scripts/content/import_source.py data/content/source-manifest.jsonl --convert --max-sources 25 --report

# Применить человеческое ревью (JSONL: {id, decision, notes})
python scripts/content/import_source.py data/content/source-manifest.jsonl --review data/content/review-decisions.jsonl

# Сгенерировать previews + HTML gallery
python scripts/content/make_review_html.py
```

## Staging lifecycle

| State | Значение | Кто ставит |
|---|---|---|
| DISCOVERED | запись в манифесте с лицензией | curator |
| DOWNLOADED | файл скачан, sha256 проверен | pipeline |
| LICENSE_VERIFIED | verdict в production-ready pool | pipeline |
| CONVERTED | кандидаты сгенерированы и оценены | pipeline |
| QUALITY_REVIEW | кандидат на ручном ревью | pipeline/человек |
| APPROVED | production-ready | человек |
| REJECTED | причина записана | pipeline/человек |

**Никакой внешний source asset не становится public template
автоматически.** Только APPROVED попадает в import-ready.

## Лицензионный гейт

* Производственный пул: `APPROVED_CC0`, `APPROVED_PUBLIC_DOMAIN`.
* `APPROVED_CC_BY` — НЕ production-ready, пока в Splint нет системы
  attribution (credit'ы в интерфейсе, экран лицензий).
* `REVIEW_REQUIRED` / `REJECTED` — не скачиваются и не конвертируются.

При сомнении — REVIEW_REQUIRED + запись причины в манифест.
Никаких юридических заключений от pipeline: только флаги.

## Манифест: обязательные поля source

```json
{
  "source_asset_id": "...",
  "source_title": "...",
  "source_creator": "...",
  "source_institution": "...",
  "source_url": "...",
  "download_url": "...",
  "license_type": "CC0",
  "license_url": "...",
  "license_text_snapshot": "...",
  "accessed_at": "...",
  "public_domain_status": true,
  "attribution_required": false,
  "commercial_use": true,
  "derivative_use": true,
  "redistribution_constraints": "none",
  "source_dimensions": "1024x768",
  "source_file_sha256": "...",
  "license_verdict": "APPROVED_CC0",
  "content_tier": "medium",
  "themes": ["animals"],
  "state": "DISCOVERED"
}
```

Поля `source_dimensions` и `source_file_sha256` заполняются pipeline после
скачивания; `state` — движется по lifecycle.

## Воспроизводимость

Любой approved asset воспроизводим по манифесту:
1. `download_url` → файл;
2. `source_file_sha256` сверяется;
3. `conversion_parameters` (grid, palette_size, cleanup, enhance, quantize)
   зафиксированы в derived-записи;
4. `pipeline_version` в derived-записи;
5. детерминированная конверсия (тест `test_deterministic_conversion`).

## Безопасность (скачанный медиа = untrusted)

* `MAX_DOWNLOAD_BYTES = 50 MB` (content-length + фактический размер);
* `MAX_IMAGE_PIXELS = 60M` — защита от decompression bombs;
* проверка content-type и расширения, санитизация имён файлов;
* таймаут 60s, обрабатываются redirects (фиксируется final_url);
* скачанные файлы никогда не исполняются; только PIL decode;
* malformed изображения → ImageValidationError → REJECTED.

## Review-процесс

1. `make_review_html.py` генерирует previews + `review-gallery.html`
   (группировка APPROVE / REVIEW / REJECT, score, license, сигналы);
2. человек просматривает галерею;
3. решения в `data/content/review-decisions.jsonl`:
   `{"id": "met-123_g256", "decision": "APPROVED|REJECTED", "notes": "..."}`;
4. `--review` применяет решения к derived-манифесту;
5. APPROVED → экспорт в `data/content/import-ready/` (отдельный шаг,
   не автоматический).

## Новая эпоха контента: шаги для curator'а

1. Добавить строку в `data/content/source-manifest.jsonl`
   (DISCOVERED + полная license-метадата);
2. `python scripts/content/import_source.py ... --convert`;
3. глянуть кандидата в `review-gallery.html`;
4. решение в review-decisions.jsonl;
5. `--review` + экспорт.

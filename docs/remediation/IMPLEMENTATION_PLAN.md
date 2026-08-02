# Implementation plan: public alpha without real payments

## Independent final-review addendum (2026-08-02)

The plan below is historical implementation guidance. The external validation pass concluded `infrastructure_rc_partially_verified`: disposable PostgreSQL 16.14, MinIO/S3, migrations, concurrency, media sweep, PostgreSQL backup/restore and readiness checks passed. Telegram WebView, real Telegram Stars, production credentials, object-storage backup/restore, `/live`, and target-runtime graceful signals remain gates. Exact counts and caveats are in [FINAL_REPORT.md](FINAL_REPORT.md) and [EXTERNAL_VALIDATION.md](EXTERNAL_VALIDATION.md).

The completion path has deterministic retry-on-replay for canonical artwork and media keys, but it does not include a durable render outbox. The external S3 suite and PostgreSQL suite passed only against disposable services; production IAM, scale, Telegram WebView, and restore of object storage remain unverified.

Цель: довести локальный репозиторий до состояния, пригодного для public-alpha release candidate, при этом не притворяться, что внешние Telegram/PostgreSQL/S3/observability проверки уже выполнены.

## Phase 0 — terminology, payment gate, audit registry

Статус: `resolved` для кода и документации; `strategic_decision_required` для включения реальных Stars.

- `PAYMENTS_MODE=disabled|internal_credits|telegram_stars` с production fail-closed.
- В продуктовых ответах используется `internal credits`, а не fake Stars.
- ADR и future Telegram Stars design фиксируют webhook, refund, reconciliation, idempotency и kill-switch.
- Канонический audit registry добавлен в `docs/ADJUDICATED_AUDIT_2026-08-02.md`.

## Phase 1 — canonical completion and integrity

Статус: `resolved` в server path; `needs_environment_validation` для production object storage.

- Сервер строит deterministic canonical PNG из template + authoritative filled state.
- `resultDataUrl` клиента не является источником истины.
- Completion, artwork, achievements and progress batch are coordinated transactionally.
- `coloring_progress_batches` makes a retried client batch idempotent.
- Legacy `POST /users/artworks/:id/complete` is removed from the accessible route surface.

## Phase 2 — durable client save

Статус: `resolved` for the implemented queue/journal; `needs_environment_validation` for real mobile WebView lifecycle.

- `flushAndDispose()` drains before session switch/unmount.
- IndexedDB journal is bounded and TTL-compacted.
- `pagehide`/unmount attempts recovery; server receives `clientBatchId`.
- Conflict retry is bounded to one retry per snapshot and preserves local UI state.

## Phase 3 — media/feed/payload budgets

Статус: `partially_resolved`; production S3/CDN, object lifecycle and measured latency remain `needs_environment_validation`.

- Artwork metadata and render status are persisted; media is served through `/media`.
- Feed uses one bounded joined query, compact DTOs and opaque cursors.
- Public DTOs do not expose private storage keys or authoritative data URIs.
- Complexity validation rejects adversarial public templates; worker offloads image generation in capable browsers.

## Phase 4 — social integrity and abuse controls

Статус: `partially_resolved`.

- Likes/comments are transactionally counter-safe and comment listing is batched.
- One active published post per artwork is enforced by route checks and a unique migration where applicable.
- Messages have idempotency, quotas, pending-request limits, CAS transitions and expiry cleanup.
- Durable `abuse_counters` is shared through PostgreSQL across instances; thresholds and moderation playbook still require staging calibration.

## Phase 5 — complexity/performance

Статус: `partially_resolved`; benchmark numbers are not production device certification.

- Complexity metrics and adversarial fixtures are test-covered.
- Creator pipeline has a worker path with main-thread fallback.
- Existing benchmark remains the historical source; new release candidate runs must be attached to the final report.

## Phase 6 — operations and release gates

Статус: `partially_resolved`; disposable PostgreSQL/MinIO and database restore passed, while platform-specific and production drills remain pending.

- `/health`, `/ready`, structured request logs, JSON metrics and graceful shutdown exist.
- Backup/restore and media inventory scripts exist for PostgreSQL/S3 workflows.
- Release-candidate CI runs install, tests, check, lint, build and media inventory.
- Docker/PostgreSQL/MinIO disposable rehearsal and PostgreSQL restore drill passed; repeat against a prior production-sized schema, object-storage backup and target runtime before public rollout.

## Phase 7 — architecture and documentation

Статус: `partially_resolved`.

- Runbooks, abuse matrix, ADRs, migration notes and final report are maintained under `docs/`.
- Remaining decisions: legacy engine removal, public profile sync policy, moderation staffing, production hosting/IAM and payment activation.

## Exit criteria

1. Root and server tests, lint, build and migration checks pass.
2. PostgreSQL test suite passes against a real disposable PostgreSQL instance. (Passed in the external validation record.)
3. S3/MinIO object write/read/delete and media sweep are verified against disposable storage. (Passed; production IAM/CDN remains.)
4. Staging smoke checks cover Telegram auth, save/reload, completion, publish, feed, comments, likes, reports and moderation.
5. PostgreSQL backup restore is rehearsed and object-storage recovery is verified; the release owner signs the payment mode as `disabled`.

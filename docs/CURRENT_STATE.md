# Current State

Status: CURRENT
Authority: Current operational truth for this repository.
Last reviewed: 2026-10-02
Always verify current HEAD, origin/main, CI and deployment receipts.

Read [../AGENTS.md](../AGENTS.md), [INDEX.md](INDEX.md) and the domain contracts.
Dated production evidence below does not prove a later deployment.

## Product and repository behavior

- Splint is a visual studio for painting, creating, collecting and discovering.
  Primary IA remains exactly `Каталог` / `Создать` / `Профиль`.
  Catalog is the cold start; Create is import-first; Profile is the showcase.
  [PRODUCT_CONTRACT_MIGRATION.md](PRODUCT_CONTRACT_MIGRATION.md) owns the IA.
- Creator defaults remain 512×512 / 16 colours. `classic-v1` and
  `paintable-v1` remain supported; no universal algorithm winner is declared.
  See [CONTENT_PIPELINE_CONTRACT.md](CONTENT_PIPELINE_CONTRACT.md).
- Painting, large tiled maps, bounded action/revision/CAS, autosave/resume,
  upload, private media and canonical render outbox remain active. Contracts:
  [TILED_STROKE_ENGINE.md](TILED_STROKE_ENGINE.md),
  [TILED_SMART_ENGINE.md](TILED_SMART_ENGINE.md),
  [RESULT_IMAGE_INTEGRITY.md](RESULT_IMAGE_INTEGRITY.md).
- A tiled journal write must succeed before the player promises a local save.
  Storage failure produces an unsaved warning and retains the in-memory queue
  for synchronization. Only a durable journal or server acknowledgement can
  protect those changes across page closure; the warning must remain truthful.
- Premium-card routing uses server-projected ownership even at 0% progress.
  Collection DTOs normalize `access` and `access_type`; browse does not grant
  ownership, and the per-item server read gate stays authoritative.
- Special Cells resolve on the committed tap through existing action envelopes,
  using the persisted server default. Kind-specific effects and reduced-motion
  marks remain; manual target/confirm controls are retired from normal flow.
- XP, levels, RPG streaks, achievements, session goals and progression UI remain
  `FROZEN`. Home/Feed/Gallery/Store are not primary destinations; retained
  compatibility code does not authorize restoring their UI.
- Standalone browsers hand off to `@splint_pixel_studio_bot`. Browser OIDC
  remains dormant and feature-gated; see
  [RESPONSIVE_WEB_AND_TELEGRAM_IDENTITY.md](RESPONSIVE_WEB_AND_TELEGRAM_IDENTITY.md).

## Existing stack

Frontend: Cloudflare Pages `splint-pixel-studio`.
Primary origin: `https://pixel.showalove.ru`.
Fallbacks: `https://showalove.ru` and `https://www.showalove.ru`.
Backend: Render `splint-api`; database: Neon PostgreSQL.
Objects: R2 `splint-originals`; Telegram: existing production bot.

Reuse these services. Credentials, initData, cookies and private object keys
never belong in bundles, logs or documentation.
See [INFRASTRUCTURE_CONTRACT.md](INFRASTRUCTURE_CONTRACT.md).

## Dated production evidence

- Origin migration is `PIXEL_SUBDOMAIN_MIGRATED`; see
  [evidence/PIXEL_SUBDOMAIN_MIGRATION_2026-09-08.md](evidence/PIXEL_SUBDOMAIN_MIGRATION_2026-09-08.md).
- The 2026-10-02 audit observed frontend, `/health` and `/ready` HTTP 200;
  database/object-storage/configuration checks were healthy. An untrusted
  development user header returned 401; primary-origin CORS worked while an
  unrelated origin received no ACAO.
- The production Mini App in Chrome / Telegram Web passed the route sequence
  Catalog → Create → Profile → Catalog with visible navigation. It showed nine
  shelves, sixteen collections, 321 works and 173 free / 148 premium (320
  published works plus one user work).
- At the audit baseline, public JS/CSS matched the reproducible main build
  byte-for-byte. This proves frontend delivery at that point, not a backend SHA
  or a later remediation deployment. Exact baseline and findings:
  [evidence/2026-10-02-audit-remediation.md](evidence/2026-10-02-audit-remediation.md).
- On 2026-10-02 the owner confirmed real-phone use with gradual expansion of
  users: the basic experience works, and UX fixes remain ongoing. This is
  owner-reported production evidence, not an agent-run device checklist.
  Telegram Web, emulation and Safari remain separate evidence classes.

## Commerce

- The dated activation record reports `PAYMENTS_MODE=telegram_stars_controlled`,
  hot DB gate `public` since 2026-09-29, registered webhook and only
  `col_premium-gallery` at its server-owned 120 XTR price:
  [evidence/STARS_PUBLIC_ACTIVATION_2026-09-29.md](evidence/STARS_PUBLIC_ACTIVATION_2026-09-29.md).
  Obtain fresh gate/runtime evidence before any activation or economic claim.
- The gate supports disabled/controlled/public; public removes only the user
  allowlist, never the product allowlist. Capture/refund/reconciliation remain
  available while purchases are disabled.
- On 2026-10-02 the owner confirmed a real purchase of the sole Premium product,
  correct access to the expanded functionality, and a successful refund.
  Status: owner-confirmed production purchase/refund PASS. No new transaction
  was performed by the agents; local internal-credit tests remain separate.
- Payouts and additional monetization products remain `FROZEN`. Browser
  readiness does not activate commerce; production rejects internal credits
  and Telegram Test API. [COMMERCE_CONTRACT.md](COMMERCE_CONTRACT.md) owns the
  authoritative payment → entitlement order.
- The audit remediation changes no price, invoice, ledger, grant, refund, gate
  or payout semantics.

## Content and catalog

- Canonical catalog: 320 works, sixteen collections, thirty-two albums,
  172 free / 148 premium. Source approval, technical validity, visual approval
  and publication remain separate.
- Owner approval covers the specific 1200-max classic-v1 set on 2026-09-25,
  including effort/fragmentation tradeoffs. It does not change Creator defaults
  or establish a universal pixelization winner.
- Production publication completed 2026-09-29. Retirement preserves direct
  play/resume/progress/ownership while excluding stale work from discovery:
  [catalog-publishing.md](catalog-publishing.md),
  [evidence/CATALOG_PRODUCTION_PUBLISH_2026-09-29.md](evidence/CATALOG_PRODUCTION_PUBLISH_2026-09-29.md).
- Dated R2 evidence verifies all 1,056 media and 320 content-addressed grids,
  zero missing/mismatched objects and representative checksum-matching restores:
  [evidence/CATALOG_R2_1200_ASSETS_2026-09-25.md](evidence/CATALOG_R2_1200_ASSETS_2026-09-25.md).
  The temporary transfer token was deleted; originals were not touched.
- Keep heavy source binaries until continued runtime delivery is proven.
  Historical Git blobs survive deletion from a future tree. The audit observed
  a 2.72 GiB shared object store; no history rewrite was performed.
- Fresh provider inspection on 2026-10-02 found Neon Free with 6-hour history,
  one production snapshot from 2026-09-25 (no expiry), and no scheduled
  snapshots. This short history and historical snapshot do not establish
  independent recurring protection.
  The owner chose to defer daily backup automation on 2026-10-02. Current
  independent operator copies and recovery checks are recorded separately;
  no active daily schedule or multi-day automated protection is claimed.
  A fresh protected operator archive contains the current 14.3 MB database dump
  and all 1,698 R2 objects (2.20 GB), verified by checksum. The database restored
  to a separate local PostgreSQL 18 target with matching migration/user/progress
  aggregates; representative media bytes were recovered from the archive.
- The historical manual Neon snapshot and disposable PostgreSQL restore are
  recorded in:
  [evidence/POSTGRES_RESTORE_REHEARSAL_2026-09-25.md](evidence/POSTGRES_RESTORE_REHEARSAL_2026-09-25.md).
  Fresh disposable restore covers the 37-migration schema, checksum validation,
  isolated recovery and a repeated restore. R2 independent-copy coverage and
  measured production RPO/RTO still require current receipts.

## CI and release

- Normal path: fresh branch/worktree → local checks → push/PR → required CI
  green → main merge → configured auto-deployment → fresh smoke.
- Generated inventory: 42 specs, 158 logical tests, 474 nominal project cases,
  24 weighted extended shards. Runtime: Node 22.23.2 / npm 10.9.8; retries 0.
- Critical selection: 32 named journeys, Pixel partitions 16 + 16, selected
  sixteen-journey WebKit lane. Browser-specific skips remain explicit and are
  not physical-device proof.
- Premium owner/non-owner, quota recovery and responsive automatic Spark are
  now critical pre-merge checks; see [E2E_TEST_INVENTORY.md](E2E_TEST_INVENTORY.md).
- Extended E2E runs on main push, schedule and dispatch, not PR. A green PR does
  not prove the full matrix. The last released audit fix passed both full
  candidate and main CI, including all 24 extended shards. New operational
  changes still require fresh configured CI and deployment receipts.
- The migrated Spark test covers the one-tap default, effect and persistence.
  Operational recovery adds current-schema backup/restore to the PostgreSQL job.
  The public monitoring workflow is hourly with separate hermetic/alert drills.

## Remaining evidence and debt

- Owner-confirmed phone usage and real Stars purchase/refund are recorded above.
  Daily independent backup automation is deferred by owner decision. Remaining
  operational evidence: production recovery limits and effective failure
  notifications. Render health-check path
  is now `/ready`. The owner explicitly chose to retain Free compute on
  2026-10-02; cold-start latency remains an accepted hosting limitation, and
  no always-on availability claim or paid upgrade is implied.
- A universal pixelization winner remains unknown; approval of the specific
  published catalog set is known and does not require a new algorithm decision.
- Legacy compatibility/experiment code, bundle-size/dynamic-import warnings
  and existing lint warnings remain scoped debt. The candidate updates only
  server patch dependencies (Express/body-parser/qs); production-dependency
  audit is zero. No platform/performance rewrite or major upgrade is implied.
- Establish readiness from fresh CI and deployment receipts at the intended
  SHA; an older handoff or this document alone is not sufficient evidence.

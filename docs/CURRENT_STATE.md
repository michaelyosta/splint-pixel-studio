# Current State

Status: CURRENT
Authority: Current operational truth for this repository.
Last verified: 2026-09-24
Repository state: verify current HEAD and origin/main at task start per AGENTS.md.

This document is intentionally short and bounded. It records what is
currently verifiable from the repository and its checked-in configuration. It
does not replace the stable rules in [../AGENTS.md](../AGENTS.md), canonical
contracts, or direct production evidence.

## Production status

Origin migration status: `PIXEL_SUBDOMAIN_MIGRATED`. Direct provider and live
smoke evidence verified on 2026-09-08 is recorded in
[evidence/PIXEL_SUBDOMAIN_MIGRATION_2026-09-08.md](evidence/PIXEL_SUBDOMAIN_MIGRATION_2026-09-08.md).
This confirms the primary public origin and Telegram launch path. Current
commerce status below also incorporates the controlled-production evidence
recorded through 2026-09-15; it does not promote physical-iOS or editorial
claims into verified state.

Recovery release `5a829a7` (PR #47) is deployed: the browser handoff renders
only for a plain browser without a session, a Telegram host keeps the shell and
its three-tab navigation while signed `initData` is resolving, the three primary
buttons share the navigation bar equally, and the daily assignment never hands
out content the read gate locks. Migration `033` applied with the server deploy.
Direct smoke evidence from 2026-09-22 is recorded in
[evidence/RECOVERY_DEPLOY_SMOKE_2026-09-22.md](evidence/RECOVERY_DEPLOY_SMOKE_2026-09-22.md).

## Product

- Splint is a Telegram Mini App for painting, creating, collecting, and
  discovering visual works. The stable product contract is in
  [PRODUCT_CONTRACT_MIGRATION.md](PRODUCT_CONTRACT_MIGRATION.md).
- The primary navigation is exactly `Каталог` / `Создать` / `Профиль`, verified
  by `src/components/BottomNavigation.jsx` and
  `test/primary-ia-contract.test.js`.
- `Каталог` is the cold-start/default route in `src/App.jsx` and owns artwork
  and collection discovery.
- `Создать` is import-first; `Загрузить изображение` is the primary action and
  collection management is secondary. The default creator preset is 512×512
  with 16 colours, verified in `src/hooks/useCreatorData.js` and
  `src/views/CreatorView.jsx`.
- `Профиль` is the creator/collector showcase for completed and created work.
- Legacy views, routes, and compatibility data for Home, Feed, Gallery, Store,
  achievements, progression, and session goals remain in the codebase. Their
  presence is not permission to restore them to primary product UI.

## Active workstreams

- `ACTIVE` — painting and tiled rendering. The current tree contains tiled manifests/tiles, the live stroke engine, save/resume flows, and server-side render outbox code. Contracts are routed through [TILED_STROKE_ENGINE.md](TILED_STROKE_ENGINE.md), [TILED_SMART_ENGINE.md](TILED_SMART_ENGINE.md), and [remediation/RENDER_OUTBOX_CHECKPOINT.md](remediation/RENDER_OUTBOX_CHECKPOINT.md).
- `ACTIVE` — creator/content pipeline. The worker, creator quality assessment,
  preview resolutions, and catalog build script are present. Technical
  validity, visual approval, and publication remain separate states; see
  [CONTENT_PIPELINE_CONTRACT.md](CONTENT_PIPELINE_CONTRACT.md).
- `ACTIVE` — authentication, authorization, persistence, private media, and
  canonical result rendering. Relevant contracts are
  [authentication.md](authentication.md),
  [PUBLIC_ALPHA_SECURITY_MATRIX.md](PUBLIC_ALPHA_SECURITY_MATRIX.md),
  [RESULT_IMAGE_INTEGRITY.md](RESULT_IMAGE_INTEGRITY.md), and
  [adr/ADR-002-canonical-artwork-and-media.md](adr/ADR-002-canonical-artwork-and-media.md).
- `ACTIVE` — responsive browser shell with Telegram Mini App handoff.
  Standalone browser visitors are directed to the existing production bot
  `@splint_pixel_studio_bot` and authenticate only after opening the Mini App;
  the dormant browser OIDC implementation is not part of the current production
  path. The capability boundary is documented in
  [RESPONSIVE_WEB_AND_TELEGRAM_IDENTITY.md](RESPONSIVE_WEB_AND_TELEGRAM_IDENTITY.md).
- `ACTIVE` — E2E/CI integrity. The checked-in manifest generated on
  2026-09-07 selects 24 weighted shards for 150 logical tests and 450 project
  cases across Chromium, Mobile iPhone, and Mobile Pixel. The suite keeps
  retries at zero; see [E2E_TEST_INVENTORY.md](E2E_TEST_INVENTORY.md) and
  [E2E_QUARANTINE_POLICY.md](E2E_QUARANTINE_POLICY.md).

## Frozen workstreams

- `FROZEN` — XP, levels, streak-RPG loops, achievements, session-goal reward
  loops, and progression-oriented profile UI are removed from the normal
  product surface. Compatibility implementations and historical evidence are
  retained only for migration/audit purposes.
- `FROZEN` — Feed/Community, Gallery, Store, Home, and Achievements are not
  primary destinations. Social API compatibility may remain server-side.

## Commerce

- Production currently runs the real Telegram Bot API integration in
  `PAYMENTS_MODE=telegram_stars_controlled`. The webhook is registered and the
  only configured product is `col_premium-gallery` at its server-owned catalog
  price of 120 XTR. Public access is not asserted until the hot database gate
  is explicitly drilled and changed from `controlled` to `public` after a
  green release.
- The launch-hardening candidate adds a durable `disabled` / `controlled` /
  `public` gate. Public mode removes only the user allowlist; it never removes
  the product allowlist. Capture, refund and reconciliation remain available
  while new purchases are disabled.
- Local development may default to `internal_credits` when `NODE_ENV` is local
  or omitted. That is a test/development ledger and is not Telegram Stars.
- Marketplace payout remains off and outside this launch. Telegram Test API
  is rejected in production. Browser OIDC is unchanged.
- `TELEGRAM_STARS_PRODUCTION_ROUNDTRIP_PENDING` remains historical evidence and
  is consciously waived only as a pre-launch requirement. A real production
  `successful_payment` and refund have not been performed; the first live user
  transaction is the canary once public access is deliberately activated.
- The stable payment order, idempotency, replay, refund, reconciliation, and
  kill-switch boundary is [COMMERCE_CONTRACT.md](COMMERCE_CONTRACT.md).

## Content

- Built-in catalog templates and a reproducible catalog asset builder are
  present in the current tree.
- `TECHNICALLY_VALID`, `VISUALLY_APPROVED`, and `PUBLISHED` are distinct
  states. Current editorial approval and publication status are `UNKNOWN` from
  this repository audit; no content is being published by this migration.
- Quality and metadata rules are canonical in
  [CONTENT_PIPELINE_CONTRACT.md](CONTENT_PIPELINE_CONTRACT.md) and
  [PHASE4_CONTENT_METADATA_UI.md](PHASE4_CONTENT_METADATA_UI.md).

## Catalog delivery

- The canonical manifest contains 320 artworks, 16 collections, 32 albums,
  172 free and 148 premium items. PR #53 merged to `main` at `623ad03`; its
  change adds tiled-map publishing capability only and explicitly did not
  approve or publish the 1200-pixel candidates or mutate production catalog
  rows. The PR run reported 33 checks passed.
- The latest authorized read-only Telegram catalog smoke observed 7 works and
  0 collections. Production is therefore not verified at the 320-item target;
  `catalog:publish` has not been run against production. On 2026-09-25, direct
  `/health` and `/ready` checks returned 200, but a HEAD request for a verified
  R2 catalog preview through the production media route returned 404. Runtime
  asset delivery remains unverified; the cause is unknown. See
  [evidence/PRODUCTION_CATALOG_SMOKE_2026-09-25.md](evidence/PRODUCTION_CATALOG_SMOKE_2026-09-25.md).
  No user progress, ownership, payment, or catalog database state was changed
  by the R2 migration or these read-only checks.
- The 1,056 canonical source/runtime image objects (2,167,344,016 bytes) were
  uploaded to existing R2 bucket `splint-originals` under `catalog/`. The
  inventory has 1:1 path coverage of the tracked catalog binaries, all remote
  size/SHA-256 checks passed, and three representative objects (master, full,
  preview) were restored and matched. The eight pre-frame history masters
  (28,498,751 bytes) remain in Git and are outside that migration inventory.
  Evidence and the checksum inventory are in
  [evidence/CATALOG_R2_MIGRATION_2026-09-24.md](evidence/CATALOG_R2_MIGRATION_2026-09-24.md)
  and [evidence/catalog-r2-inventory.json](evidence/catalog-r2-inventory.json).
- The temporary R2 migration credentials were revoked after verification;
  `originals/` was not read or modified. Heavy binaries remain in the current
  Git tree until production publication and runtime delivery are proven. The
  shared Git object pack is 2.09 GiB; deleting files from a future `main` tree
  alone will not remove their historical blobs.
- The catalog publisher and tiled player support maps up to 1200 pixels per
  side while preserving aspect ratio; this is not blocked by the separate
  25,600-cell public-import visibility budget. The 1200-pixel candidate set is
  technically valid, but visual/effort approval and production publication
  remain pending under the canonical content gate. Do not remove source
  binaries until production publication and runtime delivery are proven.

## Pixelization

- The client code exposes `classic-v1` and `paintable-v1` pipeline versions;
  `paintable-dither` maps to the paintable pipeline. An explicit
  `VITE_CREATOR_PREVIEW_STYLE_PRESET` can select a preset; absent that setting,
  the converter defaults to `classic-v1` while the creator defaults to the
  512×512 option.
- Current production winner/no-winner status: `UNKNOWN`. Historical benchmark
  and recommendation files are evidence, not approval. Do not replace the
  production algorithm because one metric or candidate looks better.

## Telegram / iOS

- Telegram initData authentication and WebView integration contracts are in [authentication.md](authentication.md) and the Telegram QA/diagnostic docs routed by [INDEX.md](INDEX.md).
- Physical Telegram iOS validation result: `UNKNOWN`. Chromium, Playwright
  WebKit, emulation, and physical Safari evidence must not be presented as
  equivalent proof. The project has owner access to a physical iPhone; the
  device is not to be described as unavailable.

## Public origin migration

- Primary origin: `https://pixel.showalove.ru`.
- Fallback origins: `https://showalove.ru` and
  `https://www.showalove.ru`; both remained active and returned HTTP 200 during
  verification.
- Cloudflare Pages project `splint-pixel-studio` showed the pixel subdomain and
  both legacy domains as active with SSL enabled. DNS showed the pixel
  subdomain CNAME to `splint-pixel-studio.pages.dev`; unrelated tunnel/worker
  records were left untouched.
- Render `/ready` returned `{"ready":true}` with database, object-storage, and
  configuration checks `ok`. API CORS allowed the pixel and legacy origins
  exactly and rejected an unrelated origin; no wildcard was introduced.
- R2 CORS was not required: the frontend uses the server `/media` route and
  R2 originals remain private.
- The existing production bot `@splint_pixel_studio_bot` showed an active Menu
  Button `Open` targeting `https://pixel.showalove.ru`. A fresh Telegram Web
  launch opened that origin and loaded `Каталог`, `Создать`, and `Профиль`.

## Infrastructure

The stable stack is Cloudflare Pages, Render, Neon PostgreSQL, Cloudflare R2,
and the existing Telegram bot. Reuse that stack; do not create parallel
projects, services, buckets, bots, or a full staging environment without a
concrete isolation requirement. The origin-migration evidence above is direct
live evidence; it does not assert that this documentation-only branch is a
production deployment.

## CI / release

The normal flow is fresh branch/worktree → focused local checks → push/PR →
required CI green → merge `main` → automatic deployment → smoke verification.
This is a stable operating contract, not evidence that a current merge or
deployment occurred. The checked-in workflow is `.github/workflows/ci.yml`.

## Known blockers

- `UNKNOWN` — physical Telegram iOS runtime result.
- `UNKNOWN` — current editorial approval/publication and pixelization winner.
- `PAYMENT GATE` — public Stars access remains closed until the launch-hardening
  PR is green, deployed, and the production kill-switch drill succeeds.
- `DEFERRED` — the owned production purchase/refund round-trip was consciously
  waived before launch, not proven. After public activation it becomes
  `TELEGRAM_STARS_FIRST_LIVE_TRANSACTION_MONITORING`.
- `FROZEN` — marketplace payouts and additional monetization products.

## Non-blocking debt

- One root unit-suite failure was observed once and never reproduced: `npm test`
  reported `# fail 1` on a single run of the diagnostic branch, the failing name
  was not captured, and twelve later runs (six sequential, six under concurrent
  load) were clean. Treat as a rare load-sensitive flake and capture the name
  the next time `npm test` fails locally before assuming it is new.
- Legacy product views, server compatibility routes, and historical experiment
  code remain and require scope discipline when touched.
- Historical documents still contain useful forensic detail; they are being
  demoted and linked rather than treated as current truth.

## Next recommended action

For a new task, read [../AGENTS.md](../AGENTS.md), this file, and
[INDEX.md](INDEX.md), then read only the one to three canonical domain
documents routed for that task. Before any release or economic claim, obtain
fresh direct evidence; do not promote an old handoff into current state.

# Current State

Status: CURRENT
Authority: Current operational truth for this repository.
Last verified: 2026-09-08
Repository state: verify current HEAD and origin/main at task start per AGENTS.md.

This document is intentionally short and bounded. It records what is
currently verifiable from the repository and its checked-in configuration. It
does not replace the stable rules in [../AGENTS.md](../AGENTS.md), canonical
contracts, or direct production evidence.

## Production status

UNKNOWN. No production telemetry, deployment receipt, live smoke result, or current cloud configuration was available in this repository audit. Do not infer that production is deployed, healthy, or serving this HEAD from old handoffs. The configured operating model is the existing controlled closed-alpha stack described in [INFRASTRUCTURE_CONTRACT.md](INFRASTRUCTURE_CONTRACT.md).

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

- Production configuration policy: `DISABLED` / fail-closed. `server/config.js` rejects `internal_credits` and `telegram_stars` in production; live production activation remains `UNKNOWN` without environment evidence.
- Real Telegram Stars are **not active**. The provider-shaped service and
  webhook factory exist for contract tests, but the real adapter/webhook is not
  mounted by `server/index.js`.
- Local development may default to `internal_credits` when `NODE_ENV` is local
  or omitted. That is a test/development ledger and is not Telegram Stars.
- Marketplace purchase activation: `UNKNOWN` and fail-closed. Payout
  activation: `UNKNOWN` and fail-closed. They are separate economic decisions.
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

## Infrastructure

The stable stack is Cloudflare Pages, Render, Neon PostgreSQL, Cloudflare R2,
and the existing Telegram bot. Reuse that stack; do not create parallel
projects, services, buckets, bots, or a full staging environment without a
concrete isolation requirement. Current deployment configuration/health is
`UNKNOWN`; see [INFRASTRUCTURE_CONTRACT.md](INFRASTRUCTURE_CONTRACT.md).

## CI / release

The normal flow is fresh branch/worktree → focused local checks → push/PR →
required CI green → merge `main` → automatic deployment → smoke verification.
This is a stable operating contract, not evidence that a current merge or
deployment occurred. The checked-in workflow is `.github/workflows/ci.yml`.

## Known blockers

- `UNKNOWN` — production deployment/health and current cloud state.
- `UNKNOWN` — physical Telegram iOS runtime result.
- `UNKNOWN` — current editorial approval/publication and pixelization winner.
- `FROZEN` — real Stars, marketplace purchases, and payouts until their
  evidence and explicit activation decisions exist.

## Non-blocking debt

- Legacy product views, server compatibility routes, and historical experiment
  code remain and require scope discipline when touched.
- Historical documents still contain useful forensic detail; they are being
  demoted and linked rather than treated as current truth.

## Next recommended action

For a new task, read [../AGENTS.md](../AGENTS.md), this file, and
[INDEX.md](INDEX.md), then read only the one to three canonical domain
documents routed for that task. Before any release or economic claim, obtain
fresh direct evidence; do not promote an old handoff into current state.

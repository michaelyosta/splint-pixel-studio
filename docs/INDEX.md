# Documentation index

Status: CANONICAL
Authority: Documentation routing and reading map.

## EVERY TASK

1. `/AGENTS.md`
2. `/docs/CURRENT_STATE.md`
3. `/docs/INDEX.md`
4. documents listed for your domain

`AGENTS.md` is the stable operating contract. `CURRENT_STATE.md` owns volatile
operational truth. This index routes to canonical domain contracts and then to
historical handoffs, research, or evidence. A historical document is never
current merely because it is detailed.

## Canonical entry points

| Document | Purpose | Authority | Read when | Do not use for |
| --- | --- | --- | --- | --- |
| [../AGENTS.md](../AGENTS.md) | Stable operating, product, security, commerce, and release rules | Root operating contract | Every task | Current SHA, CI run, blocker, or experiment status |
| [CURRENT_STATE.md](CURRENT_STATE.md) | Current operational truth and bounded known state | Current-state owner | Every task after AGENTS | Permanent architecture rationale or project chronology |
| [INDEX.md](INDEX.md) | Domain routing and source-of-truth map | Documentation router | Every task after CURRENT_STATE | Product or release assertions not linked here |
| [PRODUCT_CONTRACT_MIGRATION.md](PRODUCT_CONTRACT_MIGRATION.md) | Three-tab IA and retired-surface contract | Canonical product contract | Changing Product/UX, Create, Profile, Catalog, completion, or progression UI | Current release status |
| [COMMERCE_CONTRACT.md](COMMERCE_CONTRACT.md) | XTR payment, entitlement, marketplace, payout, and fail-closed boundary | Canonical commerce contract | Any payment, Stars, marketplace, purchase, refund, or payout task | Whether production is currently active |
| [CONTENT_PIPELINE_CONTRACT.md](CONTENT_PIPELINE_CONTRACT.md) | Source approval, technical validity, quality, and publication separation | Canonical content/pixelization contract | Upload, content factory, catalog, or pixelization work | Declaring visual approval from metrics alone |
| [INFRASTRUCTURE_CONTRACT.md](INFRASTRUCTURE_CONTRACT.md) | Existing stack and normal release path | Canonical infrastructure contract | Deployment, hosting, database, storage, or environment work | Current deployment health without direct evidence |
| [RESPONSIVE_WEB_AND_TELEGRAM_IDENTITY.md](RESPONSIVE_WEB_AND_TELEGRAM_IDENTITY.md) | Responsive web host, platform adapter, browser OIDC, session, CSRF, and shared Telegram identity | Canonical cross-platform contract | Responsive web, browser login, cross-device identity, or host capability work | Production activation or physical Telegram proof |

## Product / UX

| Document | Purpose | Authority | Read when | Do not use for |
| --- | --- | --- | --- | --- |
| [PRODUCT_CONTRACT_MIGRATION.md](PRODUCT_CONTRACT_MIGRATION.md) | Old-to-new IA migration and tested replacement contracts | Canonical | Changing primary IA, completion flow, Create, Profile, Catalog, or retired progression surfaces | Current release status |
| [PHASE4_CONTENT_METADATA_UI.md](PHASE4_CONTENT_METADATA_UI.md) | Bounded server-owned content metadata presentation | Canonical UI contract | Changing metadata on Catalog, Profile, player, or premium previews | Editorial approval or payment activation |
| [TELEGRAM_GAMEPLAY_QA.md](TELEGRAM_GAMEPLAY_QA.md) | Gameplay QA checklist and device boundaries | Canonical QA protocol | Manual Telegram/WebView gameplay validation | Claiming physical iOS proof from browser evidence |
| [PRODUCT_MEASUREMENT_BASELINE.md](PRODUCT_MEASUREMENT_BASELINE.md) | Bounded measurement scope for the current three-tab product | Experimental | Reviewing product-flow instrumentation | Inferring human, device, or commercial outcomes |

Historical product rationale and experiments: [GAME_EXPERIENCE_AUDIT.md](GAME_EXPERIENCE_AUDIT.md),
[GAME_EXPERIENCE_ROADMAP.md](GAME_EXPERIENCE_ROADMAP.md),
[GUIDED_AUTONOMY_BLUEPRINT.md](GUIDED_AUTONOMY_BLUEPRINT.md),
[PRODUCT_SIMPLIFICATION_DESIGN.md](PRODUCT_SIMPLIFICATION_DESIGN.md),
[PRODUCT_SIMPLIFICATION_HANDOFF.md](PRODUCT_SIMPLIFICATION_HANDOFF.md),
[SPLINT_GAME_PRODUCT_AUDIT.md](SPLINT_GAME_PRODUCT_AUDIT.md), and the Phase 2–5
documents. Read them only to recover rationale or historical decisions; never
for current release state.

## Player / painting / rendering

| Document | Purpose | Authority | Read when | Do not use for |
| --- | --- | --- | --- | --- |
| [TILED_STROKE_ENGINE.md](TILED_STROKE_ENGINE.md) | Live tiled stroke, pointer, tile-boundary, and painting invariants | Canonical player contract | Changing stroke input, tile writes, or paint feel | Current device pass result |
| [TILED_SMART_ENGINE.md](TILED_SMART_ENGINE.md) | Tiled guidance, loading, and bounded exploration design | Canonical player contract | Changing guidance, LOD, or large-map behavior | Declaring a device/runtime issue fixed |
| [RESULT_IMAGE_INTEGRITY.md](RESULT_IMAGE_INTEGRITY.md) | Server-authoritative completed image and publication invariant | Canonical media contract | Changing completion, result media, or publishability | Old client-PNG threat analysis as current code |
| [remediation/RENDER_OUTBOX_CHECKPOINT.md](remediation/RENDER_OUTBOX_CHECKPOINT.md) | Durable render job lifecycle and recovery | Canonical technical contract | Changing render worker, retries, or ready/dead state | Production health or deployment proof |
| [UNLOCKS_CHECKPOINT.md](UNLOCKS_CHECKPOINT.md) | Server authorization and bounded unlock projection | Canonical backend contract | Changing access checks or premium/locked states | Permission to restore progression UI |

Historical player evidence: [GRID_ARCHITECTURE_PLAN.md](GRID_ARCHITECTURE_PLAN.md),
[GRID_BENCHMARK.md](GRID_BENCHMARK.md), [GRID_TILED_CHECKPOINT.md](GRID_TILED_CHECKPOINT.md),
and [TILED_PLAYER_UX_CHECKPOINT.md](TILED_PLAYER_UX_CHECKPOINT.md). They are
benchmarks/checkpoints, not current runtime truth.

## Creator / upload

| Document | Purpose | Authority | Read when | Do not use for |
| --- | --- | --- | --- | --- |
| [CONTENT_PIPELINE_CONTRACT.md](CONTENT_PIPELINE_CONTRACT.md) | Creator pipeline and quality-state separation | Canonical | Changing conversion, preview, quality, or catalog ingestion | Automatic visual approval |
| [authentication.md](authentication.md) | Telegram initData and local dev-auth modes | Canonical auth contract | Changing identity, headers, or roles | Enabling dev auth in production |
| [security/upload-abuse-guardrails.md](security/upload-abuse-guardrails.md) | Upload bounds and abuse controls | Canonical security contract | Changing upload/render limits or storage keys | Treating local limits as production abuse proof |
| [RESULT_IMAGE_INTEGRITY.md](RESULT_IMAGE_INTEGRITY.md) | Canonical result media after completion | Canonical media contract | Changing upload-to-artwork or publication flow | Trusting client preview bytes |

## Content Factory

Read [CONTENT_PIPELINE_CONTRACT.md](CONTENT_PIPELINE_CONTRACT.md) and
[PHASE4_CONTENT_METADATA_UI.md](PHASE4_CONTENT_METADATA_UI.md). Use
[evidence/content-quality/REPORT.md](evidence/content-quality/REPORT.md) and
[evidence/content-quality/current-catalog.json](evidence/content-quality/current-catalog.json)
as dated evidence only. Technical status, visual approval, and publication
must remain separate.

## Pixelization

Read [CONTENT_PIPELINE_CONTRACT.md](CONTENT_PIPELINE_CONTRACT.md), then inspect
the implementation in `src/lib/pixelColoring.js` and the relevant tests.
The `docs/evidence/pixelization/` trees contain hash-pinned candidate matrices,
recommendations, assessments, and reviews. They are research/evidence and do
not establish a current winner or authorize a production algorithm change.

## Telegram / iOS

| Document | Purpose | Authority | Read when | Do not use for |
| --- | --- | --- | --- | --- |
| [TELEGRAM_GAMEPLAY_QA.md](TELEGRAM_GAMEPLAY_QA.md) | Manual gameplay and WebView QA | Canonical QA protocol | Running Telegram gameplay checks | Calling browser evidence physical Telegram proof |
| [TELEGRAM_IOS_VIEWPORT_DIAGNOSTIC.md](TELEGRAM_IOS_VIEWPORT_DIAGNOSTIC.md) | Bounded physical iOS measurement protocol | Canonical protocol | A defect is isolated to iOS/WebView after autonomous prerequisites | Current result; protocol is not a pass |
| [evidence/TELEGRAM_IOS_PHYSICAL_BLOCKER_2026-09-04.md](evidence/TELEGRAM_IOS_PHYSICAL_BLOCKER_2026-09-04.md) | Dated physical Telegram evidence/blocker | Historical evidence | Reviewing that specific validation attempt | Generic permanent blocker or current root cause |
| [TELEGRAM_IOS_NAV_LOCAL_EVIDENCE.md](TELEGRAM_IOS_NAV_LOCAL_EVIDENCE.md) | Local/browser navigation evidence | Historical evidence | Comparing the 2026-09-03 local run | Physical Telegram iOS proof |
| [evidence/PHYSICAL_SAFARI_LAYOUT_EVIDENCE_2026-09-04.md](evidence/PHYSICAL_SAFARI_LAYOUT_EVIDENCE_2026-09-04.md) | Physical Safari screenshot analysis | Historical evidence | Reviewing that screenshot | Telegram WebView proof |

For browser login and cross-platform identity, read
[RESPONSIVE_WEB_AND_TELEGRAM_IDENTITY.md](RESPONSIVE_WEB_AND_TELEGRAM_IDENTITY.md)
and [authentication.md](authentication.md). The OIDC provider's current
protocol details are maintained in the official [Telegram Login
documentation](https://core.telegram.org/bots/telegram-login).

## E2E / CI

| Document | Purpose | Authority | Read when | Do not use for |
| --- | --- | --- | --- | --- |
| [E2E_TEST_INVENTORY.md](E2E_TEST_INVENTORY.md) | Current suite topology, critical/extended split, and manifest relationship | Canonical E2E contract | Changing tests, shards, CI, retries, or quarantine | Reusing old counts from a handoff |
| [E2E_QUARANTINE_POLICY.md](E2E_QUARANTINE_POLICY.md) | Evidence requirements for temporary quarantine | Canonical E2E policy | Handling a proven flaky test | Making a failing release gate green |
| [E2E_SHARD_LOAD_MANIFEST.json](E2E_SHARD_LOAD_MANIFEST.json) | Generated test-to-shard assignment and fingerprint | Current generated evidence | Running or validating extended shards | Claiming a CI run passed |
| [../.github/workflows/ci.yml](../.github/workflows/ci.yml) | Authoritative CI jobs and required dependency groups | Implementation/config evidence | Verifying release flow | Current CI result without a run link |

Historical E2E investigations: [E2E_CI_PERFORMANCE.md](E2E_CI_PERFORMANCE.md),
[E2E_DIAGNOSTIC_MATRIX.md](E2E_DIAGNOSTIC_MATRIX.md),
[E2E_FAILURE_CLUSTERS.md](E2E_FAILURE_CLUSTERS.md),
[E2E_HARNESS_AUDIT.md](E2E_HARNESS_AUDIT.md),
[E2E_STABILIZATION_RUN_STATE.md](E2E_STABILIZATION_RUN_STATE.md), and
[E2E_SYSTEM_STABILIZATION_HANDOFF.md](E2E_SYSTEM_STABILIZATION_HANDOFF.md).

## Commerce / Stars

| Document | Purpose | Authority | Read when | Do not use for |
| --- | --- | --- | --- | --- |
| [COMMERCE_CONTRACT.md](COMMERCE_CONTRACT.md) | Canonical XTR order, entitlement, marketplace, payout, and fail-closed rules | Canonical commerce overview | Any economic boundary task | Current activation without direct evidence |
| [TELEGRAM_STARS_LAUNCH_GATE.md](TELEGRAM_STARS_LAUNCH_GATE.md) | Deferred controlled-production round-trip gate | Operational gate | Preparing a public Stars activation decision | Treating checkout/tests as a real production payment |
| [TELEGRAM_STARS_ACCEPTANCE_MATRIX.md](TELEGRAM_STARS_ACCEPTANCE_MATRIX.md) | Dated requirement-by-requirement Stars evidence and pending criteria | Current verification record | Reviewing readiness and exact gaps | Claiming production round-trip completion |
| [telegram-stars-xtr.md](telegram-stars-xtr.md) | Detailed provider-shaped order/refund/reconciliation lifecycle | Canonical implementation contract | Working on XTR service or webhook design | Claiming real Bot API or Stars activation |
| [adr/ADR-001-payment-modes-and-telegram-stars.md](adr/ADR-001-payment-modes-and-telegram-stars.md) | Payment mode decision and activation checklist | Canonical decision record | Reviewing why production is disabled | Current production state |
| [stars-transactions.md](stars-transactions.md) | Legacy internal-credit transaction design | Historical compatibility record | Working on legacy ledger compatibility | Telegram Stars, marketplace, or payout truth |
| [PREMIUM_PACK_PROTOTYPE.md](PREMIUM_PACK_PROTOTYPE.md) | Premium showcase prototype rationale | Historical prototype | Recovering bounded prototype intent | Live store or payment activation |

## Marketplace

Marketplace purchase is a buyer entitlement boundary; payout is a separate
settlement boundary. Read [COMMERCE_CONTRACT.md](COMMERCE_CONTRACT.md) first,
then [telegram-stars-xtr.md](telegram-stars-xtr.md) for provider lifecycle.
[PHASE5_STORE_SHARE.md](PHASE5_STORE_SHARE.md) and
[PRODUCT_PHASE_5_HANDOFF.md](PRODUCT_PHASE_5_HANDOFF.md) are historical
prototype/handoff material and cannot establish that a marketplace is live.

## Backend / database

| Document | Purpose | Authority | Read when | Do not use for |
| --- | --- | --- | --- | --- |
| [database-operations.md](database-operations.md) | SQLite/PostgreSQL operations and migrations | Canonical operations contract | Changing persistence or migration flows | Production database health without direct evidence |
| [authentication.md](authentication.md) | Auth and role enforcement | Canonical auth contract | Changing identity/authorization | Treating a user header as production auth |
| [UNLOCKS_CHECKPOINT.md](UNLOCKS_CHECKPOINT.md) | Server-authoritative access facts | Canonical backend contract | Changing unlock/entitlement projection | Reintroducing progression UI |
| [remediation/RENDER_OUTBOX_CHECKPOINT.md](remediation/RENDER_OUTBOX_CHECKPOINT.md) | Render durability and media readiness | Canonical technical contract | Changing completion media persistence | Production render health |

## Infrastructure / deployment

Read [INFRASTRUCTURE_CONTRACT.md](INFRASTRUCTURE_CONTRACT.md),
[deployment-runbook.md](deployment-runbook.md),
[runbooks/BACKUP_RESTORE.md](runbooks/BACKUP_RESTORE.md), and
[runbooks/DEPLOY_ROLLBACK.md](runbooks/DEPLOY_ROLLBACK.md). The broad
[TELEGRAM_DEPLOY_BEGINNER.md](TELEGRAM_DEPLOY_BEGINNER.md) guide is historical
and must not override the existing-stack contract or current state.

## Security

Read [authentication.md](authentication.md),
[PUBLIC_ALPHA_SECURITY_MATRIX.md](PUBLIC_ALPHA_SECURITY_MATRIX.md),
[security/ABUSE_MATRIX.md](security/ABUSE_MATRIX.md),
[security/upload-abuse-guardrails.md](security/upload-abuse-guardrails.md),
and [RESULT_IMAGE_INTEGRITY.md](RESULT_IMAGE_INTEGRITY.md). The root
[../SECURITY_FOLLOWUPS.md](../SECURITY_FOLLOWUPS.md),
[SECURITY_FOLLOWUPS.md](SECURITY_FOLLOWUPS.md), [AUDIT_FINDINGS.md](AUDIT_FINDINGS.md),
and [ADJUDICATED_AUDIT_2026-08-02.md](ADJUDICATED_AUDIT_2026-08-02.md) are dated
security evidence/handoffs, not current adjudication.

## Historical research / evidence

Historical handoffs, reports, benchmarks, phase decisions, and evidence are
preserved for forensic traceability. They must carry an explicit historical
header and link back to [CURRENT_STATE.md](CURRENT_STATE.md). This includes:

- alpha/release records: `ALPHA_*`, `CLOSED_ALPHA_*`, `RELEASE_RUN_STATE.md`,
  and `remediation/*` reports;
- product research and phases: `GAME_*`, `GUIDED_*`, `PHASE2_*`, `PHASE4_*`
  decision/slice docs, `PHASE5_*`, `PRODUCT_*_HANDOFF.md`, and `SPLINT_*_AUDIT.md`;
- E2E and security investigations listed above;
- dated evidence under `evidence/`, including JSON metrics and pixelization
  matrices;
- grid, special-cell, recovery, and validation-debt documents.

Use the historical documents to answer “what was tested or decided then?”
Never use them alone to answer “what is true now?”

## Status vocabulary

Use only precise statuses where a status is needed:
`CURRENT`, `CANONICAL`, `HISTORICAL`, `EXPERIMENTAL`, `FROZEN`, `ACTIVE`,
`BLOCKED`, `READY_FOR_VALIDATION`, `DEPRECATED`, `UNKNOWN`.

For the full initial audit, including per-file purpose, state, role, domain,
contradictions, and action, see
[DOCUMENTATION_INVENTORY.md](DOCUMENTATION_INVENTORY.md).
For the migration decisions and validation record, see
[DOCUMENTATION_MIGRATION_REPORT.md](DOCUMENTATION_MIGRATION_REPORT.md).

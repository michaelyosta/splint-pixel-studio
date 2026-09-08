# Documentation inventory — initial audit

Status: HISTORICAL MIGRATION RECORD

This inventory records the documentation topology found on the clean
`origin/main` baseline (`98ecec59e844d5b188f982d4e3bf354c71e9da53`) before the
migration. It is not a source of current product or release truth. Current
state belongs to [CURRENT_STATE.md](CURRENT_STATE.md), routing belongs to
[INDEX.md](INDEX.md), and stable rules belong to [../AGENTS.md](../AGENTS.md).

Legend: `CURRENT` means usable as operational truth only after verification;
`MIXED` combines useful contract text with stale state; `STALE` is historical
or one-off state. `CANONICAL`, `CURRENT_STATE`, `HANDOFF`, `RESEARCH`,
`EVIDENCE`, and `INDEX` are documentation roles. `KEEP` means preserve in
place; `REWRITE` means make the contract/routing explicit; `ARCHIVE` means
preserve but demote with a historical header.

| Path | Purpose | State | Role | Domain | Duplicates / contradictions | Action |
| --- | --- | --- | --- | --- | --- | --- |
| `AGENTS.md` | Stable operating contract | NEW | CANONICAL | all | Supplied attachment; no repository copy | CREATE |
| `README.md` | Human developer entry point | MIXED | INDEX | onboarding | Retired XP/feed/release claims conflict with AGENTS | REWRITE |
| `DEVELOPMENT.md` | Local setup and checks | CURRENT | CANONICAL | onboarding | Some setup detail overlaps README | KEEP |
| `IDEA.md` | One-line project idea | STALE | REDUNDANT | product | Adds no contract beyond README/AGENTS | ARCHIVE |
| `SECURITY_FOLLOWUPS.md` | Security recheck log | STALE | HANDOFF | security | Duplicates `docs/SECURITY_FOLLOWUPS.md`, old SHA | ARCHIVE |
| `docs/ADJUDICATED_AUDIT_2026-08-02.md` | Adjudicated audit specification | STALE | HANDOFF | security/product | Dated verification and old baseline | ARCHIVE |
| `docs/adr/ADR-001-payment-modes-and-telegram-stars.md` | Payment mode decision | MIXED | CANONICAL | commerce | Needs explicit separation from current activation state | REWRITE |
| `docs/adr/ADR-002-canonical-artwork-and-media.md` | Artwork/media invariant | CURRENT | CANONICAL | media | Overlaps result integrity/outbox | KEEP |
| `docs/agent-remediation-progress.md` | Engineering remediation log | STALE | HANDOFF | engineering | Old branch and task state | ARCHIVE |
| `docs/ALPHA_RC_1_HANDOFF.md` | Alpha release handoff | STALE | HANDOFF | release | Old candidate and CI state | ARCHIVE |
| `docs/ALPHA_RC_BURNDOWN.md` | RC failure burn-down | STALE | HANDOFF | E2E/release | One-run result, not current gate | ARCHIVE |
| `docs/ALPHA_RC_FAILURE_TRIAGE.md` | RC failure triage | STALE | HANDOFF | E2E | One-run clusters and old SHA | ARCHIVE |
| `docs/ALPHA_RC_GIT_CONSOLIDATION.md` | Git consolidation audit | STALE | HANDOFF | git/release | Old branches/SHAs | ARCHIVE |
| `docs/ALPHA_RC_REPRODUCIBILITY.md` | RC reproducibility evidence | STALE | EVIDENCE | release | Dated environment evidence | ARCHIVE |
| `docs/ALPHA_RC_SECURITY_CONFIG.md` | RC security configuration review | STALE | EVIDENCE | security | Old RC pass and debt | ARCHIVE |
| `docs/ALPHA_RELEASE_NOTES.md` | Alpha release notes | STALE | HANDOFF | release | Candidate-specific claims | ARCHIVE |
| `docs/AUDIT_FINDINGS.md` | Security/audit findings ledger | STALE | HANDOFF | security | Old “current” snapshots and duplicated follow-ups | ARCHIVE |
| `docs/authentication.md` | Auth modes and role boundary | CURRENT | CANONICAL | auth/security | Supports README/AGENTS | KEEP |
| `docs/benchmarks/PUBLIC_ALPHA_BENCHMARK.md` | Public-alpha benchmark | STALE | EVIDENCE | performance | Dated benchmark | ARCHIVE |
| `docs/CLOSED_ALPHA_RELEASE_CHECKLIST.md` | Release checklist result | STALE | HANDOFF | release | One release decision | ARCHIVE |
| `docs/CLOSED_ALPHA_RELEASE_HANDOFF.md` | Closed-alpha handoff | STALE | HANDOFF | release | Old branch/SHA | ARCHIVE |
| `docs/CORE_FEEL_PLAYTEST.md` | Core-feel experiment protocol | STALE | RESEARCH | product/UX | Experimental, not product contract | ARCHIVE |
| `docs/database-operations.md` | SQLite/PostgreSQL operations | CURRENT | CANONICAL | backend/database | Supports deployment contract | KEEP |
| `docs/deployment-runbook.md` | Deployment/rollback procedure | MIXED | CANONICAL | infrastructure | Text claims missing stack while AGENTS names stack | REWRITE |
| `docs/E2E_CI_PERFORMANCE.md` | E2E timing study | STALE | EVIDENCE | E2E/CI | Exact old run and timing | ARCHIVE |
| `docs/E2E_DIAGNOSTIC_MATRIX.md` | Frozen E2E failure matrix | STALE | EVIDENCE | E2E | Frozen pre-fix results | ARCHIVE |
| `docs/E2E_FAILURE_CLUSTERS.md` | E2E causal cluster ledger | STALE | HANDOFF | E2E | Old run classification | ARCHIVE |
| `docs/E2E_HARNESS_AUDIT.md` | Static harness audit | STALE | RESEARCH | E2E/CI | Dated inventory | ARCHIVE |
| `docs/E2E_QUARANTINE_POLICY.md` | Quarantine rules | CURRENT | CANONICAL | E2E/CI | Stable policy; old zero count must be demoted | KEEP |
| `docs/E2E_SHARD_LOAD_MANIFEST.json` | Shard assignment/fingerprint | CURRENT | EVIDENCE | E2E/CI | Authoritative generated manifest | KEEP |
| `docs/E2E_STABILIZATION_RUN_STATE.md` | Stabilization run state | STALE | HANDOFF | E2E/CI | Old run state and branch | ARCHIVE |
| `docs/E2E_SYSTEM_STABILIZATION_HANDOFF.md` | Stabilization handoff | STALE | HANDOFF | E2E/CI | Duplicate of stabilization run state | ARCHIVE |
| `docs/E2E_TEST_INVENTORY.md` | E2E suite topology | MIXED | CANONICAL | E2E/CI | Counts disagree with current manifest | REWRITE |
| `docs/GAME_EXPERIENCE_AUDIT.md` | Product/game research | STALE | RESEARCH | product/UX | Pre-simplification rationale | ARCHIVE |
| `docs/GAME_EXPERIENCE_ROADMAP.md` | Product experiment roadmap | STALE | RESEARCH | product/UX | Contains retired Home/progression hypotheses | ARCHIVE |
| `docs/GIT_CHECKPOINT_PLAN.md` | Local checkpoint plan | STALE | HANDOFF | git | One-off branch state | ARCHIVE |
| `docs/GRID_ARCHITECTURE_PLAN.md` | Grid scaling research | STALE | RESEARCH | pixelization/player | Superseded by tiled implementation | ARCHIVE |
| `docs/GRID_BENCHMARK.md` | Large-grid benchmark | STALE | EVIDENCE | pixelization/player | Dated benchmark | ARCHIVE |
| `docs/GRID_TILED_CHECKPOINT.md` | Tiled 1200 checkpoint | STALE | HANDOFF | player | Dated implementation checkpoint | ARCHIVE |
| `docs/GUIDED_AUTONOMY_BLUEPRINT.md` | Guided UX blueprint | STALE | RESEARCH | product/UX | Includes session-goal concepts | ARCHIVE |
| `docs/migrations/2026-08-02-public-alpha.md` | Migration/backfill notes | STALE | EVIDENCE | database | Dated migration rehearsal | ARCHIVE |
| `docs/PHASE2_DECISIONS.md` | Phase 2 experiment decisions | STALE | RESEARCH | special cells/product | Experimental session-game contract | ARCHIVE |
| `docs/PHASE2_POSITIVE_EVENT_SCORECARD.md` | Event candidate scorecard | STALE | RESEARCH | special cells | Provisional/no winner | ARCHIVE |
| `docs/PHASE2_SESSION_SIMULATOR.md` | Session simulator | STALE | RESEARCH | special cells | Experiment harness | ARCHIVE |
| `docs/PHASE4_CONTENT_METADATA_UI.md` | Content metadata display contract | CURRENT | CANONICAL | content | Supports content pipeline contract | KEEP |
| `docs/PHASE4_CONTENT_QUALITY.md` | Content-quality slice | MIXED | CANONICAL | content/pixelization | Advisory status needs stable gate wording | REWRITE |
| `docs/PHASE4_DECISIONS.md` | Phase 4 product decisions | STALE | HANDOFF | product | Old phase record | ARCHIVE |
| `docs/PHASE4_GALLERY_SLICE.md` | Gallery/profile slice | STALE | HANDOFF | product | Old provisional UI slice | ARCHIVE |
| `docs/PHASE4_RESUME_DECISIONS.md` | Resume slice decisions | STALE | HANDOFF | player | Old phase record | ARCHIVE |
| `docs/PHASE4_SESSION_PACING.md` | Session pacing pilot | STALE | RESEARCH | product | Human-validation experiment | ARCHIVE |
| `docs/PHASE5_DECISIONS.md` | Phase 5 commerce decisions | STALE | HANDOFF | commerce | Prototype decision, not activation | ARCHIVE |
| `docs/PHASE5_STORE_SHARE.md` | Store/share prototype | STALE | RESEARCH | commerce/product | Prototype only | ARCHIVE |
| `docs/PREMIUM_PACK_PROTOTYPE.md` | Premium showcase prototype | STALE | RESEARCH | commerce/content | Can be mistaken for live commerce | ARCHIVE |
| `docs/PRODUCT_CONTRACT_MIGRATION.md` | Product IA migration contract | CURRENT | CANONICAL | product/UX | Main source for three-tab migration | REWRITE |
| `docs/PRODUCT_PHASE_4_HANDOFF.md` | Phase 4 handoff | STALE | HANDOFF | product | Old status and branch | ARCHIVE |
| `docs/PRODUCT_PHASE_5_HANDOFF.md` | Phase 5 handoff | STALE | HANDOFF | commerce/product | Old status and activation caveats | ARCHIVE |
| `docs/PRODUCT_RECOVERY_PHASE_0_1_HANDOFF.md` | Recovery phase handoff | STALE | HANDOFF | player | Old phase state | ARCHIVE |
| `docs/PRODUCT_RECOVERY_PHASE_2_HANDOFF.md` | Recovery Phase 2 handoff | STALE | HANDOFF | player/product | Old phase state | ARCHIVE |
| `docs/PRODUCT_SIMPLIFICATION_DESIGN.md` | Simplification design | STALE | RESEARCH | product/UX | Rationale only | ARCHIVE |
| `docs/PRODUCT_SIMPLIFICATION_HANDOFF.md` | Simplification handoff | STALE | HANDOFF | product/UX | Explicitly not current release truth | ARCHIVE |
| `docs/PROGRESSION_CHECKPOINT.md` | Server progression compatibility | MIXED | HANDOFF | backend/product | Retired UI systems remain in backend | ARCHIVE |
| `docs/PROJECT_MAP.md` | Large project map | STALE | HANDOFF | all | Competes with current state; many old “current” sections | ARCHIVE |
| `docs/PUBLIC_ALPHA_SECURITY_MATRIX.md` | Security route/data matrix | CURRENT | CANONICAL | security | Supports auth/upload boundaries | KEEP |
| `docs/RELEASE_RUN_STATE.md` | Release execution state | STALE | HANDOFF | release | Exact old candidate/SHA/run | ARCHIVE |
| `docs/RESULT_IMAGE_INTEGRITY.md` | Canonical result media integrity | MIXED | CANONICAL | painting/storage/security | Historical body conflicts with fixed code | REWRITE |
| `docs/remediation/BASELINE.md` | Remediation baseline | STALE | EVIDENCE | security/release | Dated baseline | ARCHIVE |
| `docs/remediation/EXTERNAL_VALIDATION.md` | External validation report | STALE | EVIDENCE | infrastructure | Old environment evidence | ARCHIVE |
| `docs/remediation/FINAL_REPORT.md` | RC final report | STALE | HANDOFF | release/security | Old release verdict | ARCHIVE |
| `docs/remediation/IMPLEMENTATION_PLAN.md` | Remediation implementation plan | STALE | HANDOFF | security/release | Old plan/status | ARCHIVE |
| `docs/remediation/RENDER_OUTBOX_CHECKPOINT.md` | Render outbox contract | CURRENT | CANONICAL | rendering/storage | Stable implementation contract | KEEP |
| `docs/remediation/TELEGRAM_VALIDATION_REPORT.md` | Telegram validation report | STALE | EVIDENCE | Telegram/iOS | Dated manual evidence | ARCHIVE |
| `docs/remediation/TELEGRAM_WEBVIEW_VALIDATION.md` | WebView validation package | STALE | HANDOFF | Telegram/iOS | Old environment gate | ARCHIVE |
| `docs/runbooks/BACKUP_RESTORE.md` | Backup/restore procedure | CURRENT | CANONICAL | infrastructure/database | Dated execution caveat needs demotion | KEEP |
| `docs/runbooks/DEPLOY_ROLLBACK.md` | Deploy/rollback procedure | CURRENT | CANONICAL | infrastructure | Short duplicate of deployment runbook | KEEP |
| `docs/SECURITY_FOLLOWUPS.md` | Security follow-up index/snapshots | STALE | HANDOFF | security | Duplicates root file and old snapshots | ARCHIVE |
| `docs/security/ABUSE_MATRIX.md` | Abuse control contract | CURRENT | CANONICAL | security | Supports upload/content security | KEEP |
| `docs/security/upload-abuse-guardrails.md` | Upload abuse limits | CURRENT | CANONICAL | security/content | Stable guardrails; roadmap detail remains | KEEP |
| `docs/SPECIAL_CELLS_BALANCE.md` | Special-cell balance record | STALE | RESEARCH | special cells | Hypothesis, “production” wording | ARCHIVE |
| `docs/SPECIAL_CELLS_DIAGNOSTICS.md` | QA override/diagnostics contract | CURRENT | CANONICAL | QA/security | Explicitly non-production | KEEP |
| `docs/SPECIAL_CELLS_EXPERIMENT.md` | Special-cell experiment | STALE | RESEARCH | special cells | Experimental product premise | ARCHIVE |
| `docs/SPECIAL_CELLS_GAMEPLAY_DESIGN.md` | Adversarial gameplay design | STALE | RESEARCH | special cells | Design review, not current contract | ARCHIVE |
| `docs/SPECIAL_CELLS_LOOP_LOG.md` | Special-cell engineering log | STALE | HANDOFF | special cells | One implementation loop | ARCHIVE |
| `docs/SPECIAL_CELLS_MVP_PLAN.md` | Special-cell MVP plan | STALE | RESEARCH | special cells | Plan/status mix | ARCHIVE |
| `docs/SPLINT_AUTONOMOUS_PRODUCT_HANDOFF.md` | Autonomous product handoff | STALE | HANDOFF | product | Old phase/branch | ARCHIVE |
| `docs/SPLINT_GAME_PRODUCT_AUDIT.md` | Independent product audit | STALE | RESEARCH | product/UX | Rationale and hypotheses | ARCHIVE |
| `docs/SPLINT_RECOVERY_HANDOFF.md` | Recovery handoff | STALE | HANDOFF | player/iOS | Old branch/device gate | ARCHIVE |
| `docs/stars-transactions.md` | Internal credits ledger design | MIXED | HANDOFF | commerce/backend | “Stars” name conflicts with XTR boundary | ARCHIVE |
| `docs/TELEGRAM_DEPLOY_BEGINNER.md` | Broad first-deploy guide | MIXED | HANDOFF | Telegram/infrastructure | Product/release claims are stale | ARCHIVE |
| `docs/TELEGRAM_GAMEPLAY_QA.md` | Telegram gameplay QA checklist | CURRENT | CANONICAL | Telegram/player | Physical evidence boundary must be explicit | KEEP |
| `docs/TELEGRAM_IOS_NAV_LOCAL_EVIDENCE.md` | Local iOS navigation evidence | STALE | EVIDENCE | Telegram/iOS | Browser/local, not physical proof | ARCHIVE |
| `docs/TELEGRAM_IOS_VIEWPORT_DIAGNOSTIC.md` | Physical viewport protocol | CURRENT | CANONICAL | Telegram/iOS | Protocol useful; results are evidence elsewhere | KEEP |
| `docs/telegram-stars-xtr.md` | XTR provider lifecycle | CURRENT | CANONICAL | commerce | Detailed counterpart to commerce overview | KEEP |
| `docs/TILED_PLAYER_UX_CHECKPOINT.md` | Tiled UX checkpoint | STALE | HANDOFF | player/iOS | Old readiness status | ARCHIVE |
| `docs/TILED_SMART_ENGINE.md` | Tiled guidance/render design | CURRENT | CANONICAL | player/rendering | Stable engine contract | KEEP |
| `docs/TILED_STROKE_ENGINE.md` | Tiled stroke design | CURRENT | CANONICAL | player/rendering | Stable engine contract; old cycles need context | KEEP |
| `docs/UNLOCKS_CHECKPOINT.md` | Unlock authorization contract | CURRENT | CANONICAL | backend/commerce | Stable server boundary; no UI permission | KEEP |
| `docs/UPLOAD_ABUSE_HARDENING.md` | Upload hardening roadmap | MIXED | HANDOFF | security/content | Current and roadmap statuses mixed | ARCHIVE |
| `docs/VALIDATION_DEBT.md` | Validation-debt ledger | STALE | HANDOFF | all | Old blockers and branches; current debt moves to CURRENT_STATE | ARCHIVE |
| `docs/evidence/accessibility-2026-08-07/README.md` | Accessibility capture notes | STALE | EVIDENCE | accessibility | Dated capture | KEEP |
| `docs/evidence/accessibility-2026-08-07/metrics.json` | Accessibility metrics | STALE | EVIDENCE | accessibility | Dated capture | KEEP |
| `docs/evidence/content-quality/REPORT.md` | Content quality report | STALE | EVIDENCE | content | Dated generated report | KEEP |
| `docs/evidence/content-quality/current-catalog.json` | Catalog quality snapshot | STALE | EVIDENCE | content | Snapshot, not approval | KEEP |
| `docs/evidence/device-metrics-2026-08-07.json` | Device metrics | STALE | EVIDENCE | player/iOS | Dated capture | KEEP |
| `docs/evidence/IOS_DEPLOYMENT_READINESS_EXISTING_STACK_2026-09-04.md` | iOS diagnostic readiness | STALE | EVIDENCE | Telegram/iOS | Exact SHA/PR evidence | KEEP |
| `docs/evidence/PHYSICAL_SAFARI_LAYOUT_EVIDENCE_2026-09-04.md` | Physical Safari screenshot analysis | STALE | EVIDENCE | Telegram/iOS | Safari is not Telegram proof | KEEP |
| `docs/evidence/TELEGRAM_IOS_PHYSICAL_BLOCKER_2026-09-04.md` | Physical Telegram evidence blocker | STALE | EVIDENCE | Telegram/iOS | Dated blocker; owner access exists | KEEP |
| `docs/evidence/session-goals-2026-08-07/README.md` | Retired goal-loop evidence | STALE | EVIDENCE | product | Must not be read as current product | KEEP |
| `docs/evidence/session-goals-2026-08-07/metrics.json` | Retired goal-loop metrics | STALE | EVIDENCE | product | Historical evidence | KEEP |
| `docs/evidence/special-cells-1200-delivery-2026-08-09/chromium-metrics.json` | Special-cell metrics | STALE | EVIDENCE | special cells | Dated capture | KEEP |
| `docs/evidence/special-cells-long-journey-2026-08-09/chromium-metrics.json` | Special journey metrics | STALE | EVIDENCE | special cells | Dated capture | KEEP |
| `docs/evidence/special-cells-long-journey-2026-08-09/Mobile Pixel-metrics.json` | Mobile special metrics | STALE | EVIDENCE | special cells | Dated capture | KEEP |
| `docs/evidence/special-cells-long-journey-evidence-2026-08-09/chromium-metrics.json` | Special journey evidence | STALE | EVIDENCE | special cells | Dated capture | KEEP |
| `docs/evidence/special-cells-long-journey-evidence-2026-08-09/Mobile Pixel-metrics.json` | Mobile special evidence | STALE | EVIDENCE | special cells | Dated capture | KEEP |
| `docs/evidence/special-cells-visual-audit-2026-08-12/README.md` | Special visual audit notes | STALE | EVIDENCE | special cells | Dated capture | KEEP |
| `docs/evidence/special-cells-visual-audit-2026-08-12/audit.json` | Special visual audit metrics | STALE | EVIDENCE | special cells | Dated capture | KEEP |
| `docs/evidence/special-cells-visual-live-2026-08-12/live-1200-overview.json` | Live overview evidence | STALE | EVIDENCE | special cells | Dated capture | KEEP |
| `docs/evidence/special-cells-visual-live-2026-08-12/live-1200-work-390-fresh.json` | Live 390 evidence | STALE | EVIDENCE | special cells | Dated capture | KEEP |
| `docs/evidence/special-cells-visual-live-2026-08-12/live-1200-work-spark-missing.json` | Spark missing evidence | STALE | EVIDENCE | special cells | Dated capture | KEEP |
| `docs/evidence/special-cells-visual-live-2026-08-12/live-1200-work-spark-safe-area-fixed.json` | Safe-area evidence | STALE | EVIDENCE | special cells | Dated capture | KEEP |
| `docs/evidence/special-cells-visual-live-2026-08-12/live-1200-work-spark-visible-after-safe-pan.json` | Safe-pan evidence | STALE | EVIDENCE | special cells | Dated capture | KEEP |
| `docs/evidence/special-cells-visual-live-2026-08-12/live-responsive.json` | Responsive special evidence | STALE | EVIDENCE | special cells | Dated capture | KEEP |
| `docs/evidence/tiled-low-zoom-2026-08-08/chromium-metrics.json` | Tiled low-zoom metrics | STALE | EVIDENCE | player/rendering | Dated capture | KEEP |
| `docs/evidence/tiled-low-zoom-2026-08-08/Mobile iPhone-metrics.json` | iPhone low-zoom metrics | STALE | EVIDENCE | player/iOS | Dated capture | KEEP |
| `docs/evidence/tiled-low-zoom-2026-08-08/Mobile Pixel-metrics.json` | Pixel low-zoom metrics | STALE | EVIDENCE | player/mobile | Dated capture | KEEP |
| `docs/evidence/visual-qa-2026-08-07/README.md` | Visual QA notes | STALE | EVIDENCE | player/UX | Dated capture | KEEP |
| `docs/evidence/visual-qa-2026-08-07/metrics.json` | Visual QA metrics | STALE | EVIDENCE | player/UX | Dated capture | KEEP |
| `docs/evidence/pixelization/**/README.md` | Pixelization run metadata | STALE | EVIDENCE | pixelization | Measurements deliberately do not prove approval | KEEP |
| `docs/evidence/pixelization/**/{CURRENT_REPORT.md,DIAGNOSTIC.md,ASSESSMENT.md,REVIEW.md,VERIFICATION.md}` | Pixelization analysis | STALE | EVIDENCE | pixelization | Historical candidate comparisons | KEEP |
| `docs/evidence/pixelization/**/*.json` | Pixelization matrices/recommendations | STALE | EVIDENCE | pixelization | Hash-pinned snapshots, not current winner | KEEP |

The glob rows above are inventory shorthand for every matching file present
under the listed directories; no evidence JSON is deleted or rewritten by
this migration.

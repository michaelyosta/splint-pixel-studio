# Documentation migration report

Status: HISTORICAL MIGRATION RECORD
Authority: Records the documentation reorganization performed on 2026-09-08.
Current truth is [CURRENT_STATE.md](CURRENT_STATE.md); routing is [INDEX.md](INDEX.md); stable operating rules are [../AGENTS.md](../AGENTS.md).

## Scope and baseline

The migration started from a clean worktree at `origin/main`, commit
`98ecec59e844d5b188f982d4e3bf354c71e9da53`. The baseline contained 117
Markdown-like files plus checked-in JSON evidence. The user-owned checkout
was already dirty, so all migration changes were made in the isolated
worktree `splint-pixel-studio-docs-migration` on branch
`codex/documentation-architecture`; the original checkout was not modified.

No application code, deployment, production environment, payment provider,
catalog content, or E2E behavior was changed by this migration.

## Old topology and problems found

The old tree mixed durable contracts, current-looking run states, research,
handoffs, and generated evidence in one flat namespace. README and several
phase documents described retired Feed/Home/progression surfaces as if they
were current. Separate security and project-map files competed for authority.
Payment notes mixed internal test credits with Telegram Stars. Deployment
notes did not consistently describe the existing Cloudflare Pages / Render /
Neon / R2 / Telegram operating model. E2E inventory counts disagreed with the
checked-in shard manifest. iOS and content-quality documents could be read as
release conclusions even where they only described a protocol or dated run.

## New topology

New readers follow this order: `AGENTS.md` → `docs/CURRENT_STATE.md` →
`docs/INDEX.md` → the one to three domain documents routed by the index.

The root now contains a stable contract and a short developer entry point.
`docs/INDEX.md` is the router, `docs/CURRENT_STATE.md` is the bounded current
snapshot, and `docs/DOCUMENTATION_INVENTORY.md` records the baseline audit.
Canonical domain contracts now cover product IA, content, commerce, existing
infrastructure, rendering/media, auth/security, Telegram/iOS, and E2E/CI.
Historical handoffs, research, reports, and evidence remain available at
their original paths but carry `Status: HISTORICAL` and point to current
state. The inventory is the authoritative explanation of each file's role.

## File disposition

- Kept in place: useful setup/runbook/contract documents, the E2E manifest,
  and dated evidence assets.
- Rewritten: `README.md`, `docs/CURRENT_STATE.md`,
  `docs/E2E_TEST_INVENTORY.md`, `docs/PHASE4_CONTENT_QUALITY.md`,
  `docs/RESULT_IMAGE_INTEGRITY.md`, `docs/deployment-runbook.md`, and the
  payment ADR. These now separate stable rules from observed status.
- Split into clear authorities: product routing/current state/inventory;
  commerce overview versus XTR provider lifecycle; content pipeline versus
  content metadata UI; infrastructure contract versus release runbooks.
- Renamed: none. Stable links were preserved to avoid breaking existing
  references.
- Archived: no files were deleted or moved. Historical and research material
  was demoted in place with explicit headers and index routing.
- Deleted: none. JSON evidence and forensic detail remain recoverable.

## Source-of-truth decisions

- Product identity and operating constraints: `AGENTS.md`.
- What is verified now and what remains unknown: `CURRENT_STATE.md`.
- Where to start and which document answers a domain question: `INDEX.md`.
- Exact three-tab shell and retired primary destinations: source code,
  `test/primary-ia-contract.test.js`, and the product migration contract.
- XTR payment authority: `COMMERCE_CONTRACT.md` plus
  `telegram-stars-xtr.md`; production activation remains fail-closed and
  unproven.
- Current E2E topology: `E2E_TEST_INVENTORY.md` plus the generated shard
  manifest; historical run counts do not override these.
- Canonical result media: `RESULT_IMAGE_INTEGRITY.md`, ADR-002, and the
  render outbox contract; client previews are not server-authoritative media.
- Content lifecycle: `CONTENT_PIPELINE_CONTRACT.md`; technical validity,
  visual approval, and publication are separate states.
- Existing infrastructure: `INFRASTRUCTURE_CONTRACT.md`; no parallel stack
  is implied or authorized by documentation.

## Contradictions resolved

The migration resolved or explicitly bounded the following conflicts:

- Feed/Home/Gallery/Store/Achievements and XP/levels/streak/session-goal
  language was marked legacy or historical; the current shell is exactly
  `Каталог` / `Создать` / `Профиль`.
- Old Stars/ledger wording was separated from real Telegram XTR activation;
  invoice creation is not entitlement, and successful server-verified payment
  is the capture boundary.
- The E2E inventory was aligned to the checked-in manifest: 40 spec files,
  150 logical tests, 450 nominal project cases, three projects, and 24
  weighted shards as verified on 2026-09-07.
- Deployment text now describes the existing stack and release flow without
  asserting a live deployment or current health.
- The iOS diagnostic is a physical-validation protocol; browser, emulation,
  WebKit, or Safari evidence is not silently upgraded to Telegram iOS proof.
- Content technical QA, visual approval, and publication are not inferred
  from one another; no automatic publication is claimed.
- Old rendering analysis is historical; the canonical result is generated by
  the server and delivered through the durable render-outbox path.
- Duplicate security follow-up files are retained as historical audit trails,
  while current security boundaries route through the canonical security and
  auth documents.

`AGENTS_CONTRACT_CONFLICT`: none detected. The supplied AGENTS contract is
consistent with the checked-in three-tab IA, compatibility-only legacy
surfaces, and fail-closed commerce policy. Live production facts remain
unknown because they require environment evidence.

## Onboarding audit

Using only `AGENTS.md`, `CURRENT_STATE.md`, and `INDEX.md`, a new task can
answer the required questions: Splint is a Telegram Mini App for painting,
creating, collecting, and discovering visual works; the primary tabs are
`Каталог`, `Создать`, and `Профиль`; commerce work starts with the commerce
contract; real Stars are not active in this release; physical iOS evidence is
routed to the diagnostic protocol and dated evidence; old handoffs are
historical; release flow is branch/worktree → checks → PR/CI → main → deploy
→ smoke; E2E weakening is prohibited; and blockers belong in
`CURRENT_STATE.md`.

## Validation and remaining debt

Performed checks:

- Canonical product/content/pixelization/session tests: 44 passed, 0 failed.
- Server config/auth tests: 18 passed, 0 failed.
- Required-file, header, and internal-Markdown-link audits: passed after
  correcting nested historical links.
- `CURRENT_STATE.md`: 143 lines; no code files changed.

Not runnable in this environment: `npm`/full dependency-backed `npm test`,
lint, build, full server suite, Playwright preflight, and E2E execution. The
worktree has no installed Node dependency tree and no npm executable was
available. This is a validation limitation, not a claim about the application.

Remaining documentation debt is intentional and visible: historical files
still contain dated branch/SHA/PR detail; evidence JSON is not rewritten; the
two security follow-up paths remain for audit continuity; and production
deployment/health, physical Telegram iOS results, editorial publication,
pixelization winner, marketplace activation, and payout activation require
fresh external evidence before being promoted to current truth.

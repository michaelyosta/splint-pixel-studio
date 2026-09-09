# AGENTS.md — Splint Pixel Studio

This file is the stable operating contract for every coding/research agent working in this repository.

Do not put temporary PR numbers, current SHAs, incident logs, tunnels, current blockers, or short-lived experiment status into this file.

For volatile project state read:

`docs/CURRENT_STATE.md`

For task-specific documentation read:

`docs/INDEX.md`

---

# 1. Mandatory startup protocol

Before modifying the repository:

1. Read this `AGENTS.md`.
2. Read `docs/CURRENT_STATE.md`.
3. Read `docs/INDEX.md`.
4. Read all canonical documents marked required for your task domain.
5. Inspect:

   * `git status`
   * current branch
   * current HEAD
   * `origin/main`
   * relevant code
   * relevant tests
6. Determine whether the current checkout contains unrelated or foreign changes.

Never overwrite, clean, reset, stash, or modify a dirty checkout that you do not own.

For substantial work, create a fresh branch/worktree from the intended base.

Do not start implementation until existing contracts and relevant tests have been inspected.

---

# 2. Product definition

Splint Pixel Studio is a Telegram Mini App centered on painting, creating and collecting visual works.

Core product model:

```text
Paint
Create
Collect / Showcase
Discover / Acquire content
```

Splint is NOT an RPG wrapped around coloring.

Primary product principle:

> Splint is a visual collection of completed and user-created works where painting itself is the primary action.

Do not reintroduce progression/meta systems without an explicit new product decision.

---

# 3. Primary information architecture

The primary application navigation contains exactly:

```text
Каталог
Создать
Профиль
```

Contracts:

```text
Каталог
→ default/cold-start discovery surface
→ artwork and collection discovery
→ premium/marketplace surfaces belong here

Создать
→ import-first
→ image upload is the primary action
→ collection management may be secondary
→ manual drawing is not a primary Create destination

Профиль
→ Creator + Collector showcase
→ completed works
→ created works
→ collections / ownership presentation
```

Do not restore as primary tabs:

```text
Home
Feed / Community
Gallery
Store
Achievements
```

Do not create a fourth primary tab without an explicit product-contract change.

---

# 4. Removed product systems

The normal product surface must not reintroduce:

```text
XP
levels
streak RPG loops
daily progression
achievements
session-goal reward loops
progression-oriented profile UI
```

Backend compatibility code may remain where required, but dormant compatibility is not permission to restore UI.

---

# 5. Preserved product contracts

Product simplification must NOT weaken:

```text
painting
Stroke Engine
tiled rendering
large-map support
save/autosave
resume/reopen
Creator upload
conversion
authentication
authorization
R2 storage
entitlements
payment fail-closed behavior
```

If a task changes one of these contracts, state that explicitly.

Do not silently treat a regression as a product simplification.

---

# 6. Infrastructure

Existing project stack is the default environment.

```text
Frontend:
Cloudflare Pages
project: splint-pixel-studio

Public domain:
showalove.ru

Backend:
Render
service: splint-api

Database:
Neon PostgreSQL

Object storage:
Cloudflare R2
bucket: splint-originals

Telegram:
existing production bot launches the Mini App
```

The project is currently operated as a controlled closed-alpha system.

Prefer reuse of the existing stack.

Do NOT create a second:

```text
Cloudflare project
Render service
Neon project
R2 bucket
Telegram bot
full staging environment
```

unless a concrete safety or isolation requirement proves it necessary.

Do not invent infrastructure blockers for infrastructure that already exists.

---

# 7. Deployment model

Normal release path:

```text
fresh feature branch/worktree
→ relevant local checks
→ push
→ PR
→ required CI GREEN
→ merge main
→ automatic deployment
→ smoke verification
```

Cloudflare Pages deploys the frontend from the production branch.

Render deploys the backend through the configured production deployment flow.

A feature-branch push is not a production deployment.

A merge to the production branch may trigger real deployment.

Always understand the deployment consequence before merging.

Never:

```text
force-push main
bypass required CI
use admin bypass to hide a failing gate
manually mutate production when the normal deploy path works
```

---

# 8. Secrets and credentials

Never commit or expose:

```text
bot tokens
database credentials
API secrets
signing secrets
cookies
authorization headers
Telegram initData
private user identity payloads
```

Temporary credentials may be used only where project policy explicitly permits it.

Never place secrets in:

```text
frontend bundles
logs
screenshots
test artifacts
documentation
commits
PR descriptions
```

---

# 9. Commerce is a separate economic boundary

Telegram Stars, purchases, marketplace settlement and payouts are high-risk boundaries.

Default production posture is fail-closed unless `docs/CURRENT_STATE.md` explicitly states otherwise.

Never infer payment activation from the presence of payment code.

Digital goods in Telegram use Telegram Stars / `XTR`.

Entitlement may be granted only from authoritative server-confirmed payment state.

Never grant ownership because:

```text
frontend says payment succeeded
invoice was opened
invoice was created
pre_checkout was received
```

Canonical order:

```text
invoice
→ pre_checkout validation
→ successful_payment
→ authoritative entitlement
```

Commerce changes must preserve:

```text
idempotency
replay protection
ownership validation
refund handling
immutable ledger semantics
reconciliation
kill switches
server-side authorization
```

Payout activation is a separate decision from marketplace purchase activation.

Never enable real payments, marketplace purchases, or payouts merely to make a test pass.

---

# 10. Test integrity

Tests are product contracts, not obstacles.

Do not fix a failing test by:

```text
adding arbitrary sleeps
adding hidden retries
weakening assertions
widening visual tolerances without evidence
skipping the test
quarantining the test
changing expected behavior to match a regression
```

If the harness is wrong, fix the harness.

If the product is wrong, fix the product.

If the product contract intentionally changed, document the migration and update the test to the new explicit contract.

Retries should remain zero unless an explicit project-wide decision changes that policy.

Do not rerun expensive broad matrices repeatedly when no relevant code/configuration changed.

Use focused evidence first.

Run the authoritative required suite before merge.

---

# 11. Product-contract migrations

Any intentional user-visible contract change must answer:

```text
OLD CONTRACT
NEW CONTRACT
WHY INTENTIONAL
WHERE NEW BEHAVIOR IS TESTED
WHAT CONTRACTS REMAIN UNCHANGED
```

Do not silently delete behavior and call it simplification.

Canonical product migration reference:

`docs/PRODUCT_CONTRACT_MIGRATION.md`

---

# 12. Known-good regression principle

Before inventing a new workaround for a regression:

1. Identify whether the behavior previously worked.
2. Find the last known-good commit.
3. Compare known-good → first known-bad.
4. Prefer restoring/transplanting the known-good behavior over accumulating speculative workarounds.

Do not assume an external platform bug when project history provides a narrower regression window.

A failed experiment must remain classified as failed evidence.

Do not repeat previously rejected experiments unless new evidence changes the premise.

---

# 13. Telegram / physical-device evidence

Desktop Chromium, Playwright WebKit and emulation are useful but are not equivalent to a physical Telegram iOS WebView.

Do not claim physical Telegram behavior from headless/browser evidence alone.

At the same time, do not declare a generic `HUMAN_DEVICE_VALIDATION_REQUIRED` blocker before every autonomous prerequisite has been completed.

Physical-device validation is a final evidence step when the defect genuinely exists only on that device/runtime.

The project has access to a physical iPhone through owner validation.

Do not describe the physical device as unavailable.

---

# 14. Content and pixelization

Do not automatically generate, publish or expand catalog content merely because the content pipeline can produce technically valid output.

Technical validity is not visual approval.

Publishing decisions must follow the current Content/Pipeline state in:

`docs/CURRENT_STATE.md`

and the canonical content contracts linked from:

`docs/INDEX.md`.

Do not change the production pixelization algorithm because a candidate improves one metric.

Quality changes require the complete quality/effort/fragmentation contract and visual approval.

---

# 15. Scope discipline

Do not fix unrelated defects while completing a bounded goal.

Classify them separately.

Examples:

```text
OUT_OF_SCOPE_DEFECT
NON_BLOCKING_DEBT
BLOCKING_DEPENDENCY
```

Do not turn a one-file fix into a platform rewrite.

Do not create new infrastructure when configuration or an existing service solves the problem.

Do not create a new agent for every micro-task.

---

# 16. Agent execution model

For substantial tasks use a full goal contract containing:

```text
OUTCOME

SCOPE

CURRENT PROVEN STATE

CURRENT MISSING STATE

REQUIRED EVIDENCE

DECISION RULES

MUTATION POLICY

STOP POLICY

TERMINAL OUTPUT
```

For independent work that takes more than a few minutes and can be independently verified, delegation is preferred.

Each specialist should work in an isolated branch/worktree.

The coordinating agent owns integration and final consistency.

Do not leave several specialists modifying the same files without an explicit integration plan.

---

# 17. Autonomous-first rule

Perform every safe action that can be completed autonomously before asking the owner to do something manually.

Do not ask the owner to:

```text
run commands the agent can run
inspect CI the agent can inspect
create infrastructure the project already has
copy values the agent can derive
perform repetitive screenshots when telemetry can provide the evidence
```

When a genuinely human-only action remains, reduce it to the smallest possible bounded action.

---

# 18. External blocker rule

Do not repeatedly poll an unchanged external blocker.

When blocked:

```text
prepare everything possible
record exact state
record exact evidence
state one minimal unblock action
STOP
```

Do not burn agent cycles rediscovering the same blocked condition.

---

# 19. Documentation hierarchy

Use documentation according to this order:

```text
AGENTS.md
→ stable project operating contract

docs/CURRENT_STATE.md
→ current operational truth

docs/INDEX.md
→ task-specific documentation map

canonical domain contract
→ intended behavior

current code + tests
→ implementation evidence

handoff/evidence docs
→ historical/research evidence
```

A historical handoff is not automatically current truth.

If documentation contradicts current `main`, investigate and report the discrepancy.

Do not silently choose whichever source is convenient.

---

# 20. Documentation updates

When a task changes a stable product or technical contract:

update the canonical contract document in the same PR.

When a task changes only current operational state:

update `docs/CURRENT_STATE.md`.

Do not append permanent history to `CURRENT_STATE.md`.

Rewrite obsolete state.

Long experiment logs belong under evidence/handoff documents, not `AGENTS.md`.

---

# 21. Definition of done

A code task is not complete merely because local tests pass.

Terminal report must state:

```text
STATUS

branch
HEAD SHA
PR
CI

what changed

what did NOT change

tests/evidence

production deployment status

security/economic impact

remaining blocker or debt
```

Never claim:

```text
production deployed
physical validation passed
Stars enabled
payment verified
catalog published
```

without direct evidence.

---

# 22. Stop conditions

STOP rather than improvise when:

```text
the required action could destroy production data

the requested payment/payout state is ambiguous

a secret would need to be exposed

the task requires bypassing a security boundary

canonical contracts directly conflict

a dirty foreign checkout would need to be overwritten

the only next step is a genuinely external/manual prerequisite
```

Return the exact blocker and the smallest next action.

---

# 23. Core project bias

Prefer:

```text
simple
reversible
bounded
server-authoritative
evidence-based
known-good
existing infrastructure
```

over:

```text
new infrastructure
speculative abstraction
repeated workaround layers
hidden automation
unbounded retries
large refactors without proof
```

The goal is to ship Splint, not to maximize the sophistication of the implementation.

---

# 24. Responsive web and unified Telegram identity

The primary IA remains exactly `Каталог` / `Создать` / `Профиль` across Telegram
iOS, Android, Desktop, Telegram Web, and ordinary browsers. Layout responds to
viewport width; host capabilities are read through `src/lib/platform.js` and
must not be inferred from viewport size.

Browser owner functions require the server-side Telegram OIDC Authorization
Code flow with PKCE S256, state, nonce, exact redirect URI, signed token
validation, an opaque Secure HttpOnly SameSite session, and CSRF protection.
The verified numeric Telegram user identifier is the only account-linking key;
never trust frontend user ids, localStorage, usernames, or `X-User-Id` outside
explicit local development.

Browser OIDC is feature-gated and must remain inactive until its server-only
configuration and BotFather Allowed URLs are manually verified. Cross-platform
identity readiness does not enable Stars, marketplace purchases, payouts, or
any other commerce path; those remain disabled and fail-closed.

See [docs/RESPONSIVE_WEB_AND_TELEGRAM_IDENTITY.md](docs/RESPONSIVE_WEB_AND_TELEGRAM_IDENTITY.md)
for the canonical responsive, browser-auth, and verification contract.

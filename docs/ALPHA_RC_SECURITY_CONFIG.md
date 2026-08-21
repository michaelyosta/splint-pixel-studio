# Alpha RC Security / Configuration Red-Team

Status: `PASS WITH NON-BLOCKING OPERATIONAL DEBT`

Scope: adversarial review of the Alpha RC integration branch for payment and
entitlement boundaries, development-only controls, fixture routes, upload
amplification, secrets/logging, and environment safety. No new product
surface was added.

## Findings and fixes

### RC-SEC-001 — E2E fixture routes could be mounted by flag alone

- **Risk:** `E2E_SEED_HOOKS=true` was sufficient to mount `/__e2e/*`. A
  production process carrying that flag could expose authenticated fixture
  creation and migration-corruption helpers.
- **Fix:** the router now mounts only when both `E2E_SEED_HOOKS=true` and
  `NODE_ENV=test`; production configuration also fails fast when the flag is
  present.
- **Verifier:** `server/test/config.test.js`; `scripts/run-e2e-api.mjs` now
  explicitly sets `NODE_ENV=test` for the disposable E2E API.

### RC-SEC-002 — Production accepted the internal credit ledger mode

- **Risk:** `PAYMENTS_MODE=internal_credits` was accepted by the production
  configuration validator even though it is a local/test ledger and not a
  Telegram payment provider. This could expose a non-provider purchase path in
  a misconfigured deployment.
- **Fix:** production now accepts only `PAYMENTS_MODE=disabled`; both
  `internal_credits` and the not-yet-mounted `telegram_stars` path fail fast.
- **Verifier:** `server/test/config.test.js` and the XTR state-machine suite.

### RC-SEC-003 — Explicit staging-like environments could inherit local auth

- **Risk:** `ALLOW_DEV_AUTH=true` was honored for any non-production
  `NODE_ENV`, including a deployment named `staging` or `preview`.
- **Fix:** development auth and the `/users/:id/add-stars` debug route now
  require an omitted, `development`, or `test` environment. Explicit
  `staging`, `preview`, and other deployment names do not inherit the local
  `X-User-Id` surface.
- **Verifier:** `server/test/config.test.js`; existing auth integration suite.

### RC-SEC-004 — Staging-like environments defaulted to the internal ledger

- **Risk:** when `PAYMENTS_MODE` was omitted, every non-production environment
  defaulted to `internal_credits`. A staging/preview deployment with existing
  ledger rows could therefore expose a non-provider purchase path by default.
- **Fix:** only local/test environments retain the `internal_credits` default;
  every explicitly named deployment environment defaults to `disabled`.
- **Verifier:** `server/test/config.test.js`.

### RC-SEC-005 — Production S3 credentials could target plain HTTP

- **Risk:** presence-only validation accepted an `http://` S3 endpoint. With
  real credentials this could expose private originals and access keys in
  transit.
- **Fix:** production configuration now requires an HTTPS S3 endpoint without
  embedded credentials. Local HTTP MinIO remains a DEV/TEST concern.
- **Verifier:** `server/test/config.test.js`.

The legacy `SPECIAL_CELLS_LEGACY_CHOICE_FIXTURE` flag is also rejected by the
production validator. Special QA overrides and diagnostics already require an
exact `development`/`test` environment, explicit dev auth, and an allowlisted
QA user.

## Payment / entitlement red-team result

The public server bootstrap does not construct or mount a Telegram Stars
provider/webhook. The default and production-safe mode is disabled. The
server-side XTR service is only enabled by explicit dependency injection, and
its tests cover:

- server-derived product identity and price;
- XTR currency and amount validation;
- wrong-user/product/price/payload rejection;
- pre-checkout replay and stale invoice rejection;
- duplicate update, duplicate charge, idempotency and concurrent issuance;
- delayed success after local cancellation;
- refund-before-capture, partial/full refund, tombstone and entitlement
  revocation;
- provider failure, refund recovery and reconciliation.

The client callback and `stars_balance` are not payment authorities. No
production charge path is enabled by this branch.

## QA / fixture boundary

| Surface | Alpha RC rule | Result |
|---|---|---|
| `/__e2e/*` seed/corruption hooks | `E2E_SEED_HOOKS=true` plus exact `NODE_ENV=test` | PASS |
| `meta/_test/*` routes | exact `NODE_ENV=test` | PASS |
| Special cohort override | dev/test + dev auth + explicit allowlisted users | PASS |
| Special diagnostics | dev/test + explicit override | PASS |
| `X-User-Id` authentication | local/test only; Telegram auth remains required otherwise | PASS |
| `/users/:id/add-stars` | local/test-only route | PASS |
| production Stars | rejected at startup unless a future release changes the gate | PASS |

## Upload / amplification review

The bounded Alpha RC safeguards remain active:

- Express JSON body limit: 15 MiB;
- source data URL limit: 14,000,000 characters;
- decoded source image limit: 10 MiB;
- PNG dimensions/pixel count and structure are validated before persistence;
- supported MIME/signature checks reject malformed inputs;
- per-user creation budget defaults to 10 requests per 10 minutes;
- render retry budget defaults to 3 per hour;
- originals are owner-scoped and SHA-256 content-addressed;
- tiled payloads and render-outbox work are bounded and idempotent;
- original deletion is reference-aware.

Deployment-scale controls still require the target infrastructure: shared
rate-limit storage, device/IP reputation, perceptual-hash policy, worker
backpressure telemetry, storage lifecycle/retention, and alert ownership.
These are operational debt, not silently claimed as local proof.

## Secrets and logs

The tracked-artifact scan found only placeholders/test values in examples,
tests, and disposable CI infrastructure. No live bot token, payment secret,
private key, Telegram `initData`, or credential dump is committed. Payment
event persistence uses an allowlisted redacted provider shape; the global
error logger records method/path/error class rather than request bodies or
authorization headers.

## Configuration matrix

| Environment | Auth | Payments | QA / fixtures | Expected posture |
|---|---|---|---|---|
| DEV | optional `ALLOW_DEV_AUTH=true` | `internal_credits` or disabled | explicit QA flags allowed | disposable local only |
| TEST | explicit test auth | injected mock only | E2E hooks and test routes allowed | isolated ephemeral runtime |
| STAGING-LIKE | Telegram auth; dev auth denied | disabled | QA/fixture flags off | production-shaped, fail closed |
| PRODUCTION-LIKE | Telegram auth; production validator | disabled | QA/fixture flags off | safe to build/rehearse, no payment activation |
| PRODUCTION | Telegram auth + strict infrastructure | disabled in this RC | QA/fixture flags rejected | public deployment gate remains closed |

## Verification evidence

Executed on the Alpha RC integration worktree:

```text
node --test server/test/config.test.js
15 pass / 0 fail

node --test server/test/auth.integration.test.js server/test/api.integration.test.js
26 pass / 0 fail

node --test server/test/telegram-stars.test.js server/test/security-hardening.integration.test.js server/test/upload-abuse.integration.test.js
31 pass / 0 fail
```

The existing broader XTR, abuse, root, server, build, lint, and targeted E2E
evidence remains recorded in the Phase 5 and Alpha RC handoffs. Full public
Telegram Bot API, real Stars, deployment IAM, and distributed abuse controls
remain validation/operations debt.

## Release classification

No unresolved payment bypass, entitlement bypass, production fixture exposure,
or committed-secret finding remains in this pass. The changes are reversible
and bounded. Do not enable real Stars, dev auth, E2E hooks, or QA diagnostics
in a public deployment.

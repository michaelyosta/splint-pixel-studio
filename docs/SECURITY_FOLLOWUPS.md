# Security follow-ups

This index supersedes stale follow-up references. Historical evidence remains in [AUDIT_FINDINGS.md](AUDIT_FINDINGS.md); current adjudication is in [ADJUDICATED_AUDIT_2026-08-02.md](ADJUDICATED_AUDIT_2026-08-02.md), and implementation status/exit criteria are in [remediation/IMPLEMENTATION_PLAN.md](remediation/IMPLEMENTATION_PLAN.md).

## 2026-08-08 snapshot

The 2026-08-02 snapshot below is historical. Current local verification on `37180e0ca2b0e793ad42814d7a7f7df760b4872a` (`codex/tiled-player-1200`; baseline `origin/main` `68d751e1da35de3bfd92f6bec382f0af830ac502`): root tests 283/283 in an isolated run (one timing flake in `createBoundedAnnouncer` under parallel load; isolated 5/5); server aggregate 295 total, 229 passed, 65 environment-conditional skips, 1 known failure (`server/test/director.test.js`); lint 93/100; build green. Migrations are 001-022.

Updated implementation status:

- `resolved`: durable render outbox (migration 019), canonical server rendering, server-authoritative completion/media, transactional likes/comments, message idempotency/CAS, Telegram profile refresh, per-actor durable abuse counters for comments/messages, bounded feed DTOs, and tiled guidance/unlock contracts are implemented and locally test-covered.
- `partially_resolved`: universal per-route abuse policy, cloud IAM/retention, multi-instance staging calibration, full moderation operations, and physical WebView measurements still need external evidence.
- `needs_environment_validation`: Telegram WebView, HTTPS proxy, production credentials/monitoring, and target-runtime backup retention/restore operations.
- `strategic_decision_required`: enabling real Telegram Stars and choosing the product/payment support owner.

## 2026-08-02 RC verification snapshot (historical)

The current local evidence is code/test verified, not production verified: `npm test` is 201/201; server tests are 223 total with 167 passed, 56 skipped, 0 failed; E2E is 110 passed with 4 expected skips; lint is 89 warnings within the 100-warning budget; root and server dependency audits report 0 vulnerabilities. Dedicated disposable PostgreSQL 91/91 and MinIO/S3 2/2 suites, database/object restore, `/live`, and POSIX shutdown also passed. Telegram WebView, production credentials/IAM/retention, and target-runtime behavior remain environment validation gates.

## Current status (2026-08-02, historical)

- `resolved`: server-authoritative completion, canonical media metadata, transactional likes/comments, message idempotency/CAS, profile refresh and bounded feed DTOs are implemented and locally test-covered.
- `partially_resolved`: canonical retry recovery has no durable render outbox; cloud IAM/retention, multi-instance staging calibration, large-grid performance and full moderation operations still need external evidence.
- `needs_environment_validation`: Telegram WebView, HTTPS proxy, production credentials/monitoring, and target-runtime backup retention/restore operations.
- `strategic_decision_required`: enabling real Telegram Stars and choosing the product/payment support owner.

## Required follow-up evidence

1. Run the release-candidate workflow in the owner-controlled CI environment.
2. Execute Telegram initData/auth, pagehide recovery and public publish smoke tests in the real target WebView using [the manual package](remediation/TELEGRAM_WEBVIEW_VALIDATION.md).
3. Confirm production IAM, proxy, monitoring, backup retention and restore ownership before any public rollout.
4. Keep the payment-disabled kill-switch in force until real Telegram payment evidence and owner approval exist.

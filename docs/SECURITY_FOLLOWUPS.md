# Security follow-ups

This index supersedes stale follow-up references. Historical evidence remains in [AUDIT_FINDINGS.md](AUDIT_FINDINGS.md); current adjudication is in [ADJUDICATED_AUDIT_2026-08-02.md](ADJUDICATED_AUDIT_2026-08-02.md), and implementation status/exit criteria are in [remediation/IMPLEMENTATION_PLAN.md](remediation/IMPLEMENTATION_PLAN.md).

## 2026-08-02 RC verification snapshot

The current local evidence is code/test verified, not production verified: `npm test` is 201/201; server tests are 223 total with 167 passed, 56 skipped, 0 failed; E2E is 110 passed with 4 expected skips; lint is 89 warnings within the 100-warning budget; root and server dependency audits report 0 vulnerabilities. Dedicated disposable PostgreSQL 91/91 and MinIO/S3 2/2 suites, database/object restore, `/live`, and POSIX shutdown also passed. Telegram WebView, production credentials/IAM/retention, and target-runtime behavior remain environment validation gates.

## Current status

- `resolved`: server-authoritative completion, canonical media metadata, transactional likes/comments, message idempotency/CAS, profile refresh and bounded feed DTOs are implemented and locally test-covered.
- `partially_resolved`: canonical retry recovery has no durable render outbox; cloud IAM/retention, multi-instance staging calibration, large-grid performance and full moderation operations still need external evidence.
- `needs_environment_validation`: Telegram WebView, HTTPS proxy, production credentials/monitoring, and target-runtime backup retention/restore operations.
- `strategic_decision_required`: enabling real Telegram Stars and choosing the product/payment support owner.

## Required follow-up evidence

1. Run the release-candidate workflow in the owner-controlled CI environment.
2. Execute Telegram initData/auth, pagehide recovery and public publish smoke tests in the real target WebView using [the manual package](remediation/TELEGRAM_WEBVIEW_VALIDATION.md).
3. Confirm production IAM, proxy, monitoring, backup retention and restore ownership before any public rollout.
4. Keep the payment-disabled kill-switch in force until real Telegram payment evidence and owner approval exist.

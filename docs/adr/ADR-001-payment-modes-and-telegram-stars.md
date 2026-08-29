# ADR-001: payment modes and Telegram Stars gate

Status: accepted for public alpha; real Stars activation is deferred.  
Date: 2026-08-02

## Decision

The application exposes an explicit `PAYMENTS_MODE`:

- `disabled` — default public-alpha mode; paid actions fail closed with a stable `PAYMENTS_DISABLED` response.
- `internal_credits` — development/test ledger only; UI and API terminology says internal credits, not Telegram Stars.
- `telegram_stars` — future production mode. It is rejected unless Telegram bot payment webhook, support contact and refund contact are configured.

No endpoint, seed, demo credit or frontend path may imply that a Telegram purchase succeeded while this mode is disabled.

## Why

Real payments create irreversible financial, support, reconciliation and abuse obligations. A stable feature gate lets the social and creative alpha ship while the payment design is reviewed independently.

## Activation checklist

Before setting `PAYMENTS_MODE=telegram_stars`, the release owner must attach:

1. Telegram Bot API payment configuration and webhook verification evidence.
2. A tested idempotency/replay design for payment updates and application retries.
3. Refund/chargeback/support ownership and an auditable ledger reconciliation job.
4. Production database backup/restore evidence and alerting for payment state divergence.
5. Staging tests for duplicate, delayed, reordered, malformed and unknown payment events.
6. A kill-switch drill that returns the system to `disabled` without deleting ledger history.

Until all six are signed off, the value is a strategic decision blocker, not a code defect.

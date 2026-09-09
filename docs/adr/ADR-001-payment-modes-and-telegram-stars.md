# ADR-001: payment modes and Telegram Stars gate

Status: CANONICAL
Authority: Commerce activation decision record.
Decision recorded: 2026-08-02

Navigation: [../INDEX.md](../INDEX.md) · Current state: [../CURRENT_STATE.md](../CURRENT_STATE.md)
Detailed contract: [../COMMERCE_CONTRACT.md](../COMMERCE_CONTRACT.md)

## Decision

The application exposes an explicit `PAYMENTS_MODE`:

- `disabled` — production fail-closed mode; paid actions return a stable
  disabled response and do not grant entitlement.
- `internal_credits` — development/test ledger only; its terminology is not
  Telegram Stars and it cannot boot in production.
- `telegram_stars` — future production mode. This release rejects it during
  production configuration because the real Bot API adapter/webhook is not
  mounted.

No endpoint, seed, demo credit, invoice, frontend callback, or provider-shaped
test path may imply that a Telegram purchase succeeded while production
payments are disabled.

## Why

Real payments create irreversible financial, support, reconciliation, refund,
and abuse obligations. A stable feature gate lets the creative alpha operate
without crossing the economic boundary before the provider and operations
evidence are complete.

## Activation checklist

Before a future release can enable `PAYMENTS_MODE=telegram_stars`, the owner
must attach all of the following:

1. Telegram Bot API payment configuration and webhook verification evidence.
2. A tested idempotency/replay design for payment updates and retries.
3. Refund/chargeback/support ownership and an auditable ledger reconciliation job.
4. Production database and object-storage backup/restore evidence plus alerts
   for payment-state divergence.
5. Tests for duplicate, delayed, reordered, malformed, and unknown payment
   events.
6. A kill-switch drill returning the system to `disabled` without deleting
   ledger history.

All six are required. A passing local test or the presence of payment code is
not activation evidence. Marketplace purchase and payout require separate
decisions.

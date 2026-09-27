# Stars gate drill checklist

Status: CANONICAL
Authority: Operational drill procedure for the durable purchase gate.

Navigation: [INDEX.md](INDEX.md) · Current state: [CURRENT_STATE.md](CURRENT_STATE.md)
Commerce boundary: [COMMERCE_CONTRACT.md](COMMERCE_CONTRACT.md)
Lifecycle detail: [telegram-stars-xtr.md](telegram-stars-xtr.md)
Mode decision: [adr/ADR-001-payment-modes-and-telegram-stars.md](adr/ADR-001-payment-modes-and-telegram-stars.md)

This checklist does not activate commerce. It proves the gate works before
any activation decision. Public access stays closed until the
launch-hardening release is green, deployed, and this drill succeeds.

## Preconditions

- [ ] Release with the durable `disabled` / `controlled` / `public` gate is
      merged to `main`, CI green, deployed to production.
- [ ] Only product `col_premium-gallery` at the server-owned price (120 XTR)
      is configured. No extra products, no client-supplied prices.
- [ ] `PAYMENTS_MODE=telegram_stars_controlled` verified in production
      config. Telegram Test API is rejected in production.
- [ ] Drill owner and evidence location named. No real user funds are used
      for gate mechanics; the owned purchase/refund round-trip is a
      separate, explicitly approved step (see below).

## Drill sequence

Run in order, recording observed gate response at each step:

1. [ ] `controlled`: non-allowlisted user attempts purchase → denied by the
      user allowlist, no invoice, no entitlement. Allowlisted owner test
      account purchase flow reaches invoice; do NOT complete payment unless
      the separate owned round-trip was explicitly approved.
2. [ ] `disabled`: flip the hot gate to `disabled` without a code deploy.
      New purchases are blocked; capture, refund, and reconciliation paths
      remain available for already-created obligations.
3. [ ] Return to `controlled` without a code deploy, without deleting
      history. Verify the gate state reads back `controlled`.
4. [ ] Reconciliation: run the reconciler and confirm it reports divergence
      without silently granting entitlement.
5. [ ] Record results in a dated file under `docs/evidence/` and rewrite
      the Commerce section of `CURRENT_STATE.md`. Only then may a `public`
      activation be proposed as a separate explicit decision.

## Owned round-trip (separate approval)

- [ ] A real production `successful_payment` and refund with the owned
      account has NOT been performed; `TELEGRAM_STARS_PRODUCTION_ROUNDTRIP_PENDING`
      was waived only as a pre-launch requirement.
- [ ] The first live user transaction after any public activation is the
      canary and enters `TELEGRAM_STARS_FIRST_LIVE_TRANSACTION_MONITORING`.
- [ ] Never enable real payments, marketplace purchases, or payouts merely
      to make a test pass.

## Forbidden inferences

- Payment code present ≠ payments active.
- Invoice created/opened ≠ entitlement granted.
- `pre_checkout` received ≠ entitlement granted.
- Passing tests ≠ production activation.

## What this checklist does NOT change

- [COMMERCE_CONTRACT.md](COMMERCE_CONTRACT.md) keeps the economic boundary:
  server-resolved price → invoice → `pre_checkout` validation →
  `successful_payment` → server-authoritative entitlement, with idempotency,
  replay protection, refund handling, immutable ledger semantics,
  reconciliation, kill switches, and server-side authorization.
- Payout activation remains a separate decision from purchase activation.
- Browser/Telegram cross-platform readiness does not enable any commerce
  path; those remain disabled and fail-closed.

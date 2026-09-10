# Telegram Stars production launch gate

Status: READY_FOR_VALIDATION  
Authority: deferred operational gate for public Stars activation.

This document records a launch gate; it does not enable payments, change
production secrets, or replace direct Telegram evidence. The operational
status below is based on the current owner-provided production snapshot and
must be rechecked against the live deployment before any public release.

## Deferred gate

```text
TELEGRAM_STARS_PRODUCTION_ROUNDTRIP_PENDING
```

The gate blocks public Stars activation only. It does not block continued
Splint development, CI work, Store/entitlement UX, or other reversible product
changes.

Production remains in controlled mode with the existing allowlist. Global
Stars, payout, broader public access, Browser OIDC, and unrelated payment
security boundaries remain unchanged.

## Required evidence before public activation

- [ ] One controlled production purchase is completed intentionally.
- [ ] Telegram delivers a real `successful_payment` update.
- [ ] The backend persists the Telegram payment identifiers and creates one
      entitlement.
- [ ] Reopening the Mini App preserves the premium entitlement.
- [ ] Replaying the same production payment event is idempotent and does not
      create a second payment or entitlement.
- [ ] A real `refundStarPayment` operation succeeds through Telegram.
- [ ] Local payment and entitlement state after the refund matches the
      documented business rule.
- [ ] Reconciliation completes after the refund and is idempotent on rerun.

The production checkout screen being reachable, automated tests, mock/provider
tests, or a test-environment transaction cannot check these boxes by
themselves.

## Explicitly deferred

Telegram Test DC bootstrap was investigated and deferred after the official
test-account registration flow reached `PHONE_CODE_INVALID`; it is an
external infrastructure path, not a current development blocker. No further
number enumeration or Test DC work is planned in the current milestone.

The real production `successful_payment` and production refund have not been
performed because real Stars are intentionally not being purchased for this
stage. The marker
`STARS_CONTROLLED_ACTIVATION_READY` must not be emitted while the literal
production round-trip criterion remains open.


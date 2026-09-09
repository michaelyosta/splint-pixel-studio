# Commerce contract

Status: CANONICAL
Authority: Stable commerce architecture and fail-closed boundary.

Navigation: [INDEX.md](INDEX.md) · Current state: [CURRENT_STATE.md](CURRENT_STATE.md)

This document defines the economic boundary. It does not assert that any
payment, marketplace, or payout capability is active. Current activation is
owned by [CURRENT_STATE.md](CURRENT_STATE.md) and requires fresh direct
evidence plus an explicit release decision.

## Product and payment boundaries

- Telegram digital goods use Telegram Stars with currency `XTR`.
- A marketplace purchase is a buyer entitlement decision.
- A payout is a seller/platform settlement decision.
- Purchase activation and payout activation are separate decisions and must
  never be inferred from one another.
- The presence of payment code, a product price, an invoice, or a passing test
  does not activate production commerce.

## Server-authoritative order

The only valid entitlement sequence is:

```text
server-resolved product and price
→ invoice
→ pre_checkout validation
→ successful_payment from Telegram
→ server-authoritative entitlement
```

An invoice being created or opened, a pre-checkout query being received, a
frontend callback, or a client-supplied price never grants ownership.

`pre_checkout` validates the stored user, opaque invoice payload, currency
`XTR`, and exact server amount. `successful_payment` is the capture authority;
it must validate the same values and a unique, non-empty Telegram charge ID.

## Required safeguards

Any production provider implementation must preserve:

- idempotency for requests and provider updates;
- replay protection and normalized provider event keys;
- ownership and product/price validation on the server;
- durable immutable payment/ledger records;
- duplicate, delayed, reordered, malformed, and unknown event handling;
- partial and full refund handling;
- reconciliation that reports divergence without silently granting entitlement;
- support ownership and bounded case data;
- kill-switch return to `PAYMENTS_MODE=disabled` without deleting history.

The client can display an intent or a pending state, but it cannot be the
source of entitlement truth.

Cross-platform browser readiness does not change this boundary. Browser and
Telegram hosts share verified account identity and future entitlements, but
Stars checkout, marketplace purchase activation, and payout remain disabled
and fail-closed in this release. No browser payment UI or frontend callback
may grant an entitlement.

## Repository implementation boundary

The provider-shaped lifecycle is implemented in
`server/services/telegram-stars.js` and tested with a mock adapter. The webhook
factory in `server/routes/telegram-stars.js` is deliberately not mounted by
`server/index.js`. `server/config.js` rejects `PAYMENTS_MODE=telegram_stars`
and `PAYMENTS_MODE=internal_credits` in production in this release.

Local `internal_credits` is a development/test ledger only. The legacy ledger
details in [stars-transactions.md](stars-transactions.md) are historical
compatibility material and must not be described as Telegram Stars or live
commerce.

Detailed lifecycle and refund/reconciliation semantics are in
[telegram-stars-xtr.md](telegram-stars-xtr.md). The payment mode decision is
recorded in [adr/ADR-001-payment-modes-and-telegram-stars.md](adr/ADR-001-payment-modes-and-telegram-stars.md).

# Telegram Stars (XTR) vertical slice

Status: implemented as a provider-shaped, mock-only contract; production activation is intentionally deferred.

The XTR path is isolated from the existing internal-credits ledger. The state machine lives in
`server/services/telegram-stars.js`, the only shipped provider adapter is
`server/services/telegram-stars-mock-adapter.js`, and migration `026_telegram_stars_xtr.sql`
(plus its SQLite counterpart) creates the durable order, event, payment, entitlement, refund,
reconciliation, and support records.

`server/routes/telegram-stars.js` contains an unmounted webhook factory for
`/pre-checkout`, `/successful-payment`, and `/refund`. It requires the Telegram secret-token
header and delegates all decisions to the service; `server/index.js` deliberately does not mount it.

## Activation boundary

The service factory defaults to `enabled: false` and rejects every mutating operation with
`PAYMENTS_DISABLED`. A caller must explicitly inject an adapter and pass `enabled: true`; the
normal API bootstrap does neither. `PAYMENTS_MODE=disabled` remains the public-alpha default.
There is no Bot API client, real invoice sender, real refund client, or production webhook mounted
by this slice. The mock adapter records calls and can seed provider-shaped captures for tests.

The product route that eventually creates an order must resolve the price on the server from a
catalog, then pass that resolved amount to `createOrder`. A client callback, client price, image,
or local entitlement flag is never accepted as proof of payment. The durable invoice payload is an
opaque `splint:xtr:v1:<order-id>` value and contains no secret or user message.

## State and authority

```text
invoice_pending -> invoice_issued -> checkout_pending -> paid
       |                 |                  |             |
       +-----------------+------------------+             +--> partially_refunded -> refunded
       |                                                        |
       +----------------------> cancelled ---------------------+
```

`pre_checkout_query` verifies the stored user, opaque invoice payload, currency `XTR`, and exact
server amount. It records the decision and answers Telegram. A repeated query/update replays the
same decision without a state change. A cancelled order rejects new pre-checkout approval.

`successful_payment` is the capture authority. It verifies the same values and requires a non-empty
`telegram_payment_charge_id`, which is unique and immutable. In one database transaction it records
the payment, transitions the order to `paid`, and inserts exactly one active entitlement. Replayed
updates, duplicate charge IDs, and retries cannot create a second payment or entitlement. Any
amount/currency/payload/user mismatch is rejected.

If the client times out and cancels after Telegram has captured the payment, a delayed
`successful_payment` is still accepted as provider truth. The order records
`paid_after_cancelled=true`, and the entitlement is granted once; this anomaly is visible to
reconciliation and support. A client cancellation never grants access by itself.

## Refunds and support

Refunds are recorded against the immutable charge ID and an idempotent provider `refund_id`.
Provider refund requests first reserve their amount in `telegram_stars_refund_requests` while
holding the payment row lock, so two support retries cannot over-refund one remaining capture.
Partial refunds move the order to `partially_refunded` and keep the entitlement active. A full
refund moves it to `refunded` and revokes the entitlement. A refund larger than the uncaptured
remainder, a reused refund ID with different data, or a refund for another user is rejected.
`requestRefund` calls only the injected adapter and records the result; it cannot manufacture a
local refund when the provider call fails.

`buildTelegramStarsSupportContract()` exposes the `/paysupport` command, configured support and
refund contacts, and the accepted case fields. `openSupportCase` stores a bounded, idempotent case
without logging Telegram init data, bot tokens, or arbitrary raw update bodies.

## Reconciliation

`reconcile()` compares the provider adapter's captured-charge list with local payments and stores a
run plus immutable issue facts. It flags provider captures missing locally, local payments missing
from the provider list, duplicate charge IDs, amount/currency mismatches, and payload mismatches.
Reconciliation never auto-grants an entitlement and never silently changes an order; operators must
resolve a critical issue through the payment/support runbook.

## Test coverage

`server/test/telegram-stars.test.js` exercises disabled-by-default behavior, server pricing,
idempotent order retries, pre-checkout approval/rejection/replay, duplicate and delayed captures,
charge-ID reuse, partial/full refunds, support idempotency, and reconciliation anomalies. These are
mock/provider-contract tests only. They do not certify Telegram WebView, Telegram Bot API delivery,
real Stars balances, refund SLA, production credentials, or payment activation.

Before real activation, add a verified webhook signature/update-id gate, production Bot API adapter,
provider sandbox evidence, duplicate/reorder/timeout drills, support ownership, refund policy,
database/object restore evidence, reconciliation alerts, and a kill-switch drill back to
`PAYMENTS_MODE=disabled`.

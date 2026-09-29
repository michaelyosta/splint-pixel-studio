# Stars public activation — 2026-09-29

Status: dated evidence. Canonical: [../COMMERCE_CONTRACT.md](../COMMERCE_CONTRACT.md),
[../STARS_GATE_DRILL_CHECKLIST.md](../STARS_GATE_DRILL_CHECKLIST.md).
Run record template: [STARS_GATE_DRILL_2026-09-29.md](STARS_GATE_DRILL_2026-09-29.md).

## Safety-lock autopsy (precondition)

Before the drill, production gate read `DISABLED` v9 reason
`automatic_reconciliation_failure`. Direct production-DB inspection showed:
- Every non-completed reconciliation run in history failed as
  `provider_list_failed` (Telegram Bot API unreachable from the backend at
  that minute), 5 occurrences total, latest 2026-09-29T01:12:19Z.
- `telegram_stars_reconciliation_issues`: zero rows ever recorded.
- `telegram_stars_payments`: 0 rows. Orders: 2 cancelled, 1 invoice_issued.
- Reconciler completions resume every 60s once the provider is reachable.
Conclusion: transient provider unreachability, no ledger divergence, no money
movement. Fail-closed behaved as designed; the gate correctly waited for an
operator instead of self-recovering.

## Drill execution (Telegram Web, owner operator session, 2026-09-29)

- Gate read: `DISABLED` v9 `automatic_reconciliation_failure`.
- Non-allowlisted denial check: UNCOVERED single-session; covered by
  `server/test/telegram-stars-purchase-gate.test.js` (green in CI).
- Restore `controlled` via "Вернуть controlled": readback `CONTROLLED` v10
  `operator_controlled`. PASS.
- Invoice reach (owner account, Premium Gallery 120 XTR): Telegram native
  "Confirm Your Purchase … for 120 Stars?" sheet opened with correct
  product/price, then CANCELLED ("Покупка отменена"). No funds moved. PASS.
- Flip `disabled` via "Остановить покупки": readback `DISABLED` v11
  `operator_disabled`. PASS.
- Restore `controlled`: readback `CONTROLLED` v12 `operator_controlled`. PASS.
- Reconciler observation (~2.5 min, 2+ cycles): gate stayed `CONTROLLED` v12,
  no auto re-disable. PASS.

## Activation

- Explicit owner order (repeated) executed after the drill above.
- Flip `public` via "Открыть покупки всем" + `TELEGRAM_STARS_PUBLIC`:
  readback `PUBLIC` v13 `public_stars_activation`, both kill-switch buttons
  live. Screenshot on file (Profile Stars ops panel).
- Stability watch (~2.5 min post-flip): still `PUBLIC` v13, reconciler silent.
- Product allowlist unchanged: only `col_premium-gallery` at server-owned
  120 XTR. Public mode removes only the user allowlist.

## Standing orders from here

- `TELEGRAM_STARS_FIRST_LIVE_TRANSACTION_MONITORING`: the first live user
  `successful_payment` is the canary — verify entitlement grant, then refund
  path, before treating public commerce as routine.
- Any future `automatic_reconciliation_*` stop is a page-level event: read
  `telegram_stars_reconciliation_runs.error_message` first; `provider_list_failed`
  with zero issues rows means provider blip, not ledger divergence.
- Payouts remain a separate frozen decision.

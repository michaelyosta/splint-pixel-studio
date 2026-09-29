# Stars gate drill — run record (fill during execution)

Canonical procedure: [../STARS_GATE_DRILL_CHECKLIST.md](../STARS_GATE_DRILL_CHECKLIST.md).
Commerce boundary: [../COMMERCE_CONTRACT.md](../COMMERCE_CONTRACT.md).
This file does not activate commerce. Public access stays closed until this
drill succeeds and a separate explicit activation decision is recorded.

Operator UI path (Telegram Mini App, allowlisted operator account):
Профиль → own profile → section "Telegram Stars" (ОПЕРАЦИОННЫЙ КОНТРОЛЬ).
The section shows the live gate mode (`disabled` / `controlled` / `public`)
and the gate version. All flips below are hot (no code deploy, no history loss).

Preconditions (verify before starting):
- [ ] Backend serves the gate build (Render `splint-api`, any recent deploy;
      gate UI exists since PR #44).
- [ ] Only product `col_premium-gallery` at server-owned 120 XTR is configured.
- [ ] `PAYMENTS_MODE=telegram_stars_controlled` in production config.
- [ ] No real user funds in play. Owned purchase/refund round-trip is a
      SEPARATE explicitly approved step, not part of this drill.

Steps (record observed gate response for each):
1. [ ] `controlled` denial: non-allowlisted user attempts purchase →
      denied by user allowlist, no invoice, no entitlement.
      Observed: _______________________________________________
2. [ ] `controlled` invoice reach (owner allowlisted account only):
      flow reaches invoice; DO NOT complete payment.
      Observed: _______________________________________________
3. [ ] Flip to `disabled` via "Остановить покупки": new purchases blocked;
      capture/refund/reconciliation remain available.
      Observed: _______________________________________________
4. [ ] Flip back to `controlled` via "Вернуть controlled": reads back
      `controlled`, history intact.
      Observed: _______________________________________________
5. [ ] Reconciliation: server reconciler runs automatically every 60s
      (`TELEGRAM_STARS_RECONCILIATION_ENABLED=true`). Watch Render logs for
      one poll cycle; confirm it reports divergence (if any) WITHOUT granting
      entitlement.
      Observed: _______________________________________________

Result:
- Drill owner: ____________________ Date: __________
- Verdict (PASS / FAIL): __________
- Evidence kept at (outside Git): ____________________

Only after PASS may `public` activation be proposed as a separate explicit
decision ("Открыть покупки всем" + `TELEGRAM_STARS_PUBLIC` confirmation).
The first live user transaction after any public activation is the canary:
`TELEGRAM_STARS_FIRST_LIVE_TRANSACTION_MONITORING`.

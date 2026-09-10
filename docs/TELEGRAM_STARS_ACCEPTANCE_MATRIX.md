# Telegram Stars commerce acceptance matrix

Дата проверки: 2026-09-10

Документ фиксирует фактическое состояние controlled Stars commerce. Он не
заменяет реальную production-транзакцию и не разрешает публичный запуск.

## Матрица

| Требование | Доказательство | Статус |
| --- | --- | --- |
| Production остаётся в controlled mode | Production commit `f6a1936745bf786ddb7ca204d3154964576c8fff`; read-only `/health` и `/ready` вернули `200` | PASS |
| Allowlist закрывает commerce surface | Production без Telegram Mini App auth и с подставным `X-User-Id` вернул `401` на `/config` и `/orders`; unit/HTTP tests покрывают non-allowlisted user/product | PASS — negative smoke |
| Webhook authentication | Production POST webhook без секрета вернул `401 INVALID_WEBHOOK_SECRET`; route tests покрывают secret guard | PASS — negative smoke |
| Server-owned invoice price | Provider contract tests подтверждают цену из catalog resolver; client price не принимается | PASS — automated |
| `pre_checkout_query` validation | Tests покрывают XTR, amount, payload, user, order state, one-shot decision и replay | PASS — automated |
| `successful_payment` persistence | Tests покрывают Telegram charge identifiers, durable payment и entitlement transaction | PASS — automated only |
| Entitlement ровно один раз | Tests покрывают unique entitlement и повторную выдачу под replay/concurrency | PASS — automated only |
| Reopen premium access | Unlock and Store tests подтверждают server-derived entitlement после reload | PASS — automated only |
| Replay/idempotency | Повторный `successful_payment` и повторные refund/reconciliation paths покрыты provider/service tests | PASS — automated only |
| Refund | Full refund state machine and `refundStarPayment` adapter покрыты tests; вызов Telegram в production не выполнялся | PARTIAL |
| Reconciliation | Capture/refund mismatch, recovery и idempotent rerun покрыты tests; production provider reconciliation не выполнялся | PARTIAL |
| Telegram Test Environment E2E | Test DC bootstrap проверен; `auth.sendCode` достиг Telegram Test DC, но OTP flow завершился `PHONE_CODE_INVALID` | DEFERRED — external |
| Настоящий production `successful_payment` | Не выполнялся по прямому запрету на расходование реальных Stars | PENDING |
| Настоящий production refund | Не выполнялся по прямому запрету на расходование реальных Stars | PENDING |

## PR #40 и изоляция окружений

PR #40: <https://github.com/michaelyosta/splint-pixel-studio/pull/40>

На head `03597295c2ea18ca218badd5c6bb6e9d7d3282f6`:

- все 33 GitHub check’а завершились успешно;
- локальные targeted Stars/config/runtime tests: `40/40`;
- клиентские tests: `473/473`;
- серверные tests: `430 passed`, `67 skipped`, `0 failed`;
- `TELEGRAM_BOT_API_ENVIRONMENT=test` маршрутизируется в `/bot<TOKEN>/test/...`;
- production runtime отвергает test environment даже при `PAYMENTS_MODE=disabled`;
- test token и webhook secret в репозиторий, CI logs и отчёт не попадали.

PR не merge/deploy’нут: test environment не нужен для текущего production
runtime, а deferred launch-gate не должен превращаться в обязательный deploy.

## Ограничения и launch-gate

Не изменялись global Stars, payout, Browser OIDC, production webhook secret,
production bot token или production allowlist. Реальные деньги не тратились.

`TELEGRAM_STARS_PRODUCTION_ROUNDTRIP_PENDING` остаётся открытым. Перед
публичной активацией требуется controlled production purchase, настоящий
`successful_payment`, entitlement/reopen, replay/idempotency, реальный
`refundStarPayment` и reconciliation.

Test DC является проверенным и отложенным внешним инфраструктурным путём, а
не текущим блокером разработки продукта.

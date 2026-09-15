# Telegram Stars: финальный launch-аудит и remediation

Дата: 2026-09-15. База аудита: `origin/main` merge commit
`b029b40cee068ef4a3ff48e62b4f6bba4a4e6968`; исправления находятся в
`codex/stars-provider-recovery-fixes`. Документ фиксирует состояние кандидата
до production deploy. Итоговый GO требует зелёного CI, фактического deploy,
production kill-switch drill и проверки конфигурации.

Аудит выполнен по исходникам, официальному Bot API контракту, локальным SQLite
тестам и прежнему неразрушающему production smoke. Двухсоединительные
PostgreSQL race-тесты добавлены в CI gate, но для этого кандидата ещё не
выполнены. Это не Telegram payment E2E и не доказательство реального списания
либо возврата.

## 1. Audit verdict

Текущий pre-deploy verdict: **NO-GO — CI И PRODUCTION DRILL НЕ ЗАВЕРШЕНЫ**.

Все воспроизведённые P1 дефекты предыдущего NO-GO исправлены. Публичный gate
нельзя переводить в `public`, пока новая версия не прошла CI/deploy и оператор
не подтвердил, что `disabled -> controlled` работает без code deploy. После
этой проверки verdict может стать GO без изменения payment-кода.

## 2. Риски и severity

| ID | Severity | Вероятность / влияние | Можно запускать | Mitigation / статус |
| --- | --- | --- | --- | --- |
| A1 | P1 | Документированный `getStarTransactions` envelope раньше ломал reconciliation/refund recovery всегда. | Нет без исправления. | Исправлено: парсинг `result.transactions`, pagination/dedupe/direction/empty/malformed tests. |
| A2 | P1 | Старый env-only switch требовал restart и отключал webhook, создавая риск позднего capture без обработки. | Нет без исправления. | Исправлено: durable hot gate, fresh DB read, capture/refund/reconcile продолжаются в `disabled`, CAS/audit и cross-runtime PG test. |
| A3 | P1 | Поздний excess capture мог быть ACK без payment record и без штатного refund path. | Нет без исправления. | Исправлено: immutable capture inbox до projection, recovery state, automatic stop и operator recovery refund. |
| A4 | P1 | Native `message.refunded_payment` игнорировался; entitlement мог остаться active. | Нет без исправления. | Исправлено: native mapping, stable refund identity, reorder/idempotency tests, full refund revokes entitlement. |
| A5 | P1 | Конкурентный same-key refund мог вызвать provider дважды. | Нет без исправления. | Исправлено: atomic local claim; ambiguous result reconciles before retry; SQLite test утверждает один provider call, аналогичный two-connection PostgreSQL test ждёт CI. |
| A6 | P1 launch | HTTP 200 business failures и reconciliation divergence были недостаточно наблюдаемы. | Нет без исправления. | Исправлено: safe payment-event metrics/logs, minute reconciliation worker, automatic gate stop on provider/critical failure, dedicated webhook observability. |
| A7 | P2 | Broad env `telegram_stars` не был безопасным public switch. | Нет как механизм запуска. | Исправлено: production env остаётся controlled; DB `public` removes only user allowlist, product allowlist remains. |
| A8 | P2 | Shared rate bucket/10s adapter timeout могли сорвать Telegram pre-checkout SLA. | Условно. | Исправлено: dedicated 256 KiB ingress; валидный secret не rate-limited, неаутентифицированный трафик bounded; 2s lock + 3s statement + 5s provider budgets. |
| R1 | Residual | Owned production `successful_payment` и refund не выполнялись; вероятность неизвестна. Ошибка может затронуть первую live purchase. | Да, по явному risk acceptance владельца, только как monitored canary. | First-live monitoring, automatic reconciliation/stop, preserve evidence, grant or refund if delivery fails. |
| R2 | P2 | `getStarTransactions` full scan ограничен 10,000 rows / 30 seconds. Низкая вероятность при первом запуске, растёт с объёмом. | Да на текущем масштабе. | Следить за scan failures; gate автоматически закрывается. До роста объёма добавить durable cursor/windowed reconciliation. |
| R3 | P2 | Метрики процесса сбрасываются при restart и не являются биллинг-ledger. | Да. | Payments/events/inbox/reconciliation остаются durable в PostgreSQL; canary проверяется по DB + logs, метрики только оперативный сигнал. |

Нет открытого P0/P1 code blocker, способного известным образом привести к
списанию без recoverable evidence, двойной выдаче, двойному provider refund,
обходу auth/product guards или потере charge identifier.

## 3. Исправления перед запуском

- Bot API adapter приведён к текущему Telegram contract; `provider_token` для
  XTR invoice не отправляется.
- `successful_payment` сначала сохраняется в immutable capture inbox, затем
  атомарно проецируется в payment/order/entitlement.
- Любой projection conflict или critical reconciliation автоматически ставит
  purchase gate в `disabled`, сохраняя completed transactions.
- Добавлены native refund, one-owner refund claim, ambiguous recovery и
  отдельный recovery-refund для orphan capture.
- Повторная capture projection блокирует inbox и не выдаёт доступ во время
  recovery refund. Reconciliation проверяет payment/entitlement consistency.
- `/paysupport <описание>` сохраняет идемпотентное обращение зарегистрированного
  пользователя; bare command возвращает инструкцию. `telegram-stars-ops.mjs
  monitor` показывает counts, open support cases и последнюю покупку без PII.
- Public user access отделён от production env mode; единственный продукт и
  серверная цена остаются ограничены каталогом/allowlist.
- Webhook остаётся secret-authenticated, имеет отдельный rate/deadline budget;
  Test API environment явно запрещён production validator.
- Добавлены безопасные события и метрики без token, webhook secret, initData,
  raw payload, полного charge ID и лишнего PII.

## 4. Kill switch

Команды из secure production shell:

```text
npm run telegram-stars:gate -- status
npm run telegram-stars:gate -- set disabled --reason=<incident>
npm run telegram-stars:gate -- set controlled --reason=<recovery>
npm run telegram-stars:gate -- set public --reason=<release> --confirm-public=TELEGRAM_STARS_PUBLIC
```

Gate читается из БД для config/order/invoice/pre-checkout. `disabled` закрывает
только новые покупки; webhook capture, refund, order/support reads и
reconciliation остаются активны. Все изменения используют version CAS и
append-only audit. Production drill до deploy ещё не выполнен.

## 5. Monitoring plan

Оперативно наблюдаются: invoice created/failed, pre-checkout
accepted/rejected, successful payment, entitlement created, replay,
refund applied, reconciliation completed/failed, webhook/recovery errors и
unexpected HTTP 4xx/5xx. Durable источники — orders/events/payments,
capture inbox, entitlements, refund requests/refunds и reconciliation runs.

Worker запускает reconciliation через 10 секунд после старта и затем каждую
минуту (настраиваемо, 30 секунд–15 минут), не допускает overlap и автоматически
закрывает gate при provider failure либо critical mismatch.

Для первой live-транзакции оператор проверяет: настоящий capture, сохранённые
provider identifiers, один entitlement, reopen, отсутствие дублей и чистый
reconciliation. При divergence: немедленно `disabled`, evidence не удалять,
положенный доступ восстановить либо выполнить обоснованный refund, затем RCA.

## 6. Production configuration

До merge/deploy точное изменение отсутствует. Целевой безопасный инвариант:

- `PAYMENTS_MODE=telegram_stars_controlled`;
- `TELEGRAM_BOT_API_ENVIRONMENT=production` (явно либо production default);
- product allowlist содержит только `col_premium-gallery`;
- цена читается из опубликованного server catalog и остаётся 120 XTR;
- reconciliation worker включён;
- payout, Test API, Browser OIDC и secrets не изменяются.

Public activation выполняется изменением только durable gate
`controlled -> public`, а не env allowlist wildcard и не новым payment mode.

## 7. Статус публичной активации

До production drill: **NOT YET ACTIVATED**. Исторический
`TELEGRAM_STARS_PRODUCTION_ROUNDTRIP_PENDING` сознательно waived только как
pre-launch requirement; он не переписывается как пройденный E2E.

После GO и `public` gate активным launch status становится
`TELEGRAM_STARS_FIRST_LIVE_TRANSACTION_MONITORING`.

## 8. Первая live-транзакция

На момент pre-deploy отчёта не проверялась и не инициировалась. В ходе работ
реальные Stars не расходуются и owned refund не выполняется.

## 9. Открытые риски после запуска

- residual risk R1 отсутствия предварительного owned production round-trip;
- first-live canary требует ручной проверки reopen и durable DB evidence;
- reconciliation full-scan R2 потребует cursor/window design до большого
  transaction volume;
- success не разрешает payout, новые продукты, Test API либо Browser OIDC.

Официальные контракты: [Telegram Stars payment flow](https://core.telegram.org/bots/payments-stars)
и [Telegram Bot API](https://core.telegram.org/bots/api).

# Telegram Stars: финальный launch-аудит

Дата: 2026-09-15.

Объём: production Bot API, payment service, webhook, durable ledger,
entitlement/refund/reconciliation, release configuration и owner-only
операционный контроль.

## 1. Audit verdict

**GO — публичная активация выполнена с обязательным first-live canary
monitoring.**

Аудит проведён отдельным проверочным проходом по исходникам и миграциям,
локальным payment-тестам, PostgreSQL CI, полному CI PR #44, production deploy,
production health и фактическому owner-only runtime UI. P0/P1-блокеров, которые
известным образом приводят к списанию без recoverable evidence, двойной выдаче,
обходу auth/payment guards или потере payment identifiers, не осталось.

Отсутствие предварительной owned production-покупки и owned production refund
зафиксировано как сознательно принятый residual risk. Это не является
доказательством production payment E2E. Первая настоящая пользовательская
покупка — production canary.

## 2. Найденные риски и статус

| ID | Severity | Вероятность / влияние | Можно запускать | Mitigation / статус |
| --- | --- | --- | --- | --- |
| A1 | P1 | Неверный Bot API envelope раньше ломал reconciliation/refund recovery. | Нет до исправления. | Исправлено: `result.transactions`, bounded pagination, direction/dedupe/malformed tests. |
| A2 | P1 | Env-only switch требовал restart и мог оставить поздний capture без обработки. | Нет до исправления. | Исправлено: durable DB gate, fresh reads, CAS/audit, capture/refund/reconcile продолжают работу в `disabled`. |
| A3 | P1 | Late/excess capture мог быть подтверждён без payment record и recovery path. | Нет до исправления. | Исправлено: immutable capture inbox до projection, recovery state, automatic stop и recovery refund. |
| A4 | P1 | Native Telegram refund event мог оставить entitlement активным. | Нет до исправления. | Исправлено: native refund mapping, stable identity, full-refund revocation и replay tests. |
| A5 | P1 | Конкурентный refund мог вызвать provider дважды. | Нет до исправления. | Исправлено: atomic local claim, ambiguous-result reconciliation, PostgreSQL race test в CI. |
| A6 | P1 | HTTP 200 business failures и reconciliation divergence были недостаточно видимы. | Нет до исправления. | Исправлено: safe metrics/logs, reconciliation worker, automatic gate stop on critical failure. |
| A7 | P2 | Broad env `telegram_stars` был небезопасным public switch. | Да после исправления. | Production env остаётся controlled; public — только DB gate после серверных product/price checks. |
| A8 | P2 | Общий rate bucket и слишком короткий pre-checkout budget могли сорвать SLA. | Да после исправления. | Dedicated webhook ingress/limiter, lock/statement/provider budgets и negative tests. |
| R1 | Residual | Owned production `successful_payment`/refund не выполнены; риск первой live purchase неизвестен. | Да, только как canary под усиленным monitoring. | События и identifiers сохраняются durable; divergence останавливает новые покупки, evidence сохраняется. |
| R2 | P2 | Full `getStarTransactions` scan ограничен 10 000 строк / 30 сек. | Да на текущем масштабе. | Ошибки видимы и закрывают gate; до роста объёма добавить cursor/window reconciliation. |
| R3 | P2 | Process metrics сбрасываются при restart. | Да. | Биллинг-источник — durable PostgreSQL ledger/inbox; metrics только оперативный сигнал. |

Все P0/P1 code blockers закрыты. R1 — единственное существенное launch-условие
после активации: наблюдать первую live-транзакцию и не выдавать entitlement до
настоящего Telegram `successful_payment`.

## 3. Исправления перед запуском

- Invoice создаётся только для серверного allowlisted продукта и цены.
- `pre_checkout_query` проверяется с lock/statement/provider budgets; ошибка
  отвечает отказом и не выдаёт доступ.
- `successful_payment` сначала записывается в immutable capture inbox, затем
  атомарно проецируется в order/payment/entitlement.
- Projection conflict, orphan/late capture и критическая reconciliation
  divergence переводят gate в `disabled`; завершённые транзакции не удаляются.
- Повторный capture/replay не создаёт второй payment record или entitlement.
- Refund имеет one-owner reservation, stable local identity и recovery перед
  повтором неоднозначного provider результата.
- Native `refunded_payment` и полный refund отзывают entitlement согласно текущей
  бизнес-логике; reconciliation проверяет payment↔entitlement invariant.
- Webhook защищён timing-safe secret check и отдельным bounded ingress budget.
- Test API environment запрещён production validator; payout и Browser OIDC не
  менялись.

## 4. Проверка kill switch

Проверка выполнена в production через authenticated owner-only Telegram UI,
без deploy и без оплаты:

1. `controlled`, gate version 1 — исходное состояние.
2. Нажато «Остановить покупки»: UI показал `disabled`, version 2,
   `operator_disabled`; новые покупки закрыты.
3. Нажато «Вернуть controlled»: UI показал `controlled`, version 3,
   `operator_controlled`.
4. После drill публичная активация прошла отдельным подтверждённым owner-only
   действием: UI показал `public`, version 4, `public_stars_activation`.

Kill switch не требует code deploy: `disabled` блокирует новые invoice/order и
pre-checkout, но не удаляет и не изменяет уже завершённые payment records,
capture inbox, entitlements или refund evidence. Webhook capture, refund и
reconciliation остаются доступны для восстановления.

## 5. Monitoring plan для first-live canary

Наблюдать следующие события и счётчики:

- invoice created/failed;
- pre-checkout received/accepted/rejected;
- `successful_payment`;
- entitlement created;
- duplicate/replay result;
- refund applied/provider error;
- reconciliation completed/failed;
- webhook, capture, recovery и outbox errors;
- неожиданные HTTP 4xx/5xx.

Безопасный лог-контракт не пишет bot token, webhook secret, Telegram init data,
raw payload, полный charge identifier или лишний PII. Полные identifiers
остаются в защищённом durable ledger и в отчёт не выносятся.

При первом live capture проверить: настоящий `successful_payment`, сохранённые
`telegram_payment_charge_id` и связанные ids, ровно один entitlement, reopen,
отсутствие duplicate/replay side effects и чистый reconciliation. При
расхождении немедленно включить `disabled`, сохранить evidence, восстановить
положенный доступ либо выполнить обоснованный refund после RCA.

## 6. Точное production configuration change

Изменения environment variables и production secrets не выполнялись.
Production deploy выполнен из merged PR #44, commit
`2b285ed4e9430542615664c4a14cac6d10f6e6a7`; Render показал `Deploy succeeded`,
`0 applied, 31 skipped`, зарегистрированный controlled webhook, outbox worker,
reconciliation worker и `Your service is live`. `/ready` вернул HTTP 200.

Фактическая конфигурационная граница после активации:

- env `PAYMENTS_MODE` остаётся `telegram_stars_controlled`;
- production использует production Bot API environment (test environment не
  подключался);
- durable purchase gate: `controlled -> public`, version 4;
- product allowlist по-прежнему содержит только `col_premium-gallery`;
- серверная цена остаётся 120 XTR/Stars;
- reconciliation, outbox и webhook включены;
- global Stars, payout, Browser OIDC и production secrets не изменялись.

`public` снимает только user restriction для разрешённого продукта. Он не
превращает каталог в wildcard и не выдаёт доступ до `successful_payment`.

## 7. Статус публичной активации

**АКТИВИРОВАНО.** Production UI после перехода в Store показал:

- «Платный набор — Премиум-галерея»;
- `120 Stars · купить в Telegram`;
- «Покупка проходит через подтверждённый Telegram-поток»;
- enabled кнопки «Купить за 120 Stars» и «Восстановить покупку».

Оплата в рамках этой проверки не запускалась.

Исторический gate
`TELEGRAM_STARS_PRODUCTION_ROUNDTRIP_PENDING` не удалён: он отмечен как
consciously waived pre-launch requirement, а не как пройденный E2E.

Текущий operational status:

`TELEGRAM_STARS_FIRST_LIVE_TRANSACTION_MONITORING`

## 8. Результат первой live-транзакции

Первая настоящая пользовательская production-транзакция на момент отчёта ещё
не произошла. Поэтому production `successful_payment`, production refund,
реальные charge identifiers и canary reopen не заявляются как проверенные.
Owned production Stars намеренно не покупались; реальные деньги не расходовали.

## 9. Evidence и тесты

- PR #43 merged: [Harden Stars public launch safety and live monitoring](https://github.com/michaelyosta/splint-pixel-studio/pull/43).
- PR #44 merged: [Add owner-only Stars gate controls](https://github.com/michaelyosta/splint-pixel-studio/pull/44).
- PR #44 CI run: [34980002860](https://github.com/michaelyosta/splint-pixel-studio/actions/runs/34980002860) — все 24 E2E shards, 4 critical jobs, PostgreSQL, storage contract, verify и Pages pass.
- Локальные проверки: client `473/473`, server `451 pass / 70 skipped / 0 fail`, targeted Stars suites pass, lint pass, build pass, `git diff --check` pass.
- Production evidence: Render deploy `2b285ed4…` live, migration log, webhook/worker startup logs и `/ready=200`.
- Runtime evidence: owner-only UI transitions `controlled → disabled → controlled → public`, gate versions 1→4; Store показывает enabled purchase boundary для одного товара.
- Код и тесты: `server/services/telegram-stars-purchase-gate.js`,
  `server/services/telegram-stars.js`, `server/services/telegram-stars-runtime.js`,
  `server/routes/telegram-stars.js`, `server/observability.js` и соответствующие
  `server/test/telegram-stars*.test.js`.

## 10. Открытые риски после запуска

- R1: отсутствие предварительного owned production round-trip; первая live
  покупка требует canary monitoring.
- R2: bounded full-scan reconciliation до 10 000 transactions / 30 секунд.
- R3: operational metrics не заменяют durable ledger.
- Public activation не расширяет товары, не включает payout и не меняет
  Browser OIDC.

Официальные контракты: [Telegram Stars payment flow](https://core.telegram.org/bots/payments-stars)
и [Telegram Bot API](https://core.telegram.org/bots/api).

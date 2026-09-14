# Telegram Stars: независимый финальный launch-аудит

Дата: 2026-09-14. Проверен `origin/main` / PR #41 merge commit
`b029b40cee068ef4a3ff48e62b4f6bba4a4e6968`.
Аудит выполнен по исходникам, актуальному контракту Telegram, локальным тестам
и неразрушающим HTTP-проверкам production. Это не второй внешний reviewer,
не Telegram E2E и не доказательство реального списания/возврата.

## 1. Audit verdict: NO-GO

Публичную активацию остановить: обнаружены воспроизводимые P1 payment blockers.
Отсутствие owned production round-trip НЕ является причиной этого verdict.
Не требуется покупать Stars для воспроизведения найденных дефектов.

## 2. Риски и доказательства

Вероятности качественные: статистики live-платежей нет. «Всегда» означает
детерминированность при указанных входных условиях, не частоту этих условий.

| ID / severity | Проблема и вероятность | Пользовательское влияние | Запуск без исправления / mitigation |
| --- | --- | --- | --- |
| A1 / P1 | `telegram-stars-bot-api.js:listCapturedPayments` проверяет массив `result`, Telegram возвращает `{transactions: [...]}`. Всегда для документированного ответа. | Reconciliation и recovery неоднозначного refund завершаются ошибкой, включая пустую историю. | Нет. Разбирать envelope; контрактные тесты empty/multipage/capture/refund и recovery через настоящий адаптер. |
| A2 / P1 | Runtime фиксируется при старте; нет динамического purchase gate. Disabled runtime имеет `service:null`, index возвращает 503 всему webhook. Всегда при таком переключении. | Нельзя быстро закрыть новые оплаты, сохранив приём уже оплаченных событий и refund/recovery. | Нет. Отдельный durable hot gate для invoice/precheckout; webhook/capture/refund/reconcile должны продолжать работать. Проверить остановку на всех инстансах и поздний capture. |
| A3 / P1 | Просроченный checkout A заменяется B; B оплачен; поздний capture A отклоняется `PRODUCT_ALREADY_OWNED`. Webhook отвечает 200 без сохранения charge/event. Низкая/неизвестная частота задержанного события, детерминированная потеря локальной записи. | Второе списание не имеет локального payment record; штатный refund CLI не найдёт его. | Нет. Сначала надёжно сохранять каждое аутентифицированное списание, конфликт помещать в recovery inbox; отдельная модель excess capture/refund без второго entitlement. Не ACK до durable evidence. |
| A4 / P1 | Основной webhook не обрабатывает `message.refunded_payment`, возвращает `ignored:true`. Всегда для этого события. | При внешнем возврате либо падении после provider refund остаётся active entitlement и неверное состояние. | Нет. Нативный mapping с устойчивым refund identity, поддержка reorder и согласованная идемпотентность с requestRefund. |
| A5 / P1 | Два одинаковых refund request успевают зарезервироваться в `requested`; результат UPDATE в `submitted` не проверяется. Детерминированно при конкурентном interleaving. | Два provider-вызова; неоднозначный retry и локальный статус. Это НЕ доказательство двойного денежного возврата Telegram. | Нет. Атомарное claim/CAS: только победитель вызывает API; проигравший ждёт/reconciles. Тестировать crash и одинаковые/разные keys на PostgreSQL. |
| A6 / P1 launch requirement | Есть HTTP logs и DB audit rows, но нет полного payment-event monitoring, alert delivery и Stars reconciliation worker. Render outbox не является payment worker. | ACK 200 с бизнес-ошибкой неотличим от успеха по HTTP status; canary discrepancy может остаться незамеченной. | Нет по условиям запуска. Серверные события и алерты, проверка доставки, scheduler и ответственный за canary. |
| A7 / P2 | Global `telegram_stars` запрещён production validator; runtime и App config допускают только controlled. | Переключение env не открывает продажи безопасно: boot failure/скрытый checkout. | Публичный запуск невозможен. Отдельная end-to-end реализация public-user gate при сохранении product allowlist и kill switch. Не подставлять wildcard в user allowlist. |
| A8 / P2 | Global rate limiter стоит до webhook/observability; timeout Bot API 10s оставляет слишком мало времени из 10s precheckout SLA. | При нагрузке 429/timeout и отменённые checkout; часть отказов не попадает в requestObservability. | Исправить до public load: отдельный ограниченный provider ingress, метрики ранних отказов, deadline budget. Не отключать защиту без замены. |

Основные ссылки в коде: `server/services/telegram-stars.js` (createOrder,
preCheckout, successfulPayment, requestRefund, reconcile),
`server/services/telegram-stars-runtime.js`, `server/services/telegram-stars-bot-api.js`,
`server/routes/telegram-stars.js`, `server/index.js`, `server/config.js`, `src/App.jsx`.

### Что подтверждено положительно и где границы доказательства

- Invoice использует серверный опубликованный public premium catalog, XTR и
  серверную цену; client price не является authority. Durable invoice lease и
  одна открытая покупка на user/product уменьшают повторное создание.
- Precheckout сверяет владельца, сумму, валюту, TTL, статус и query identity.
  Второй новый query для занятого/оплаченного заказа отклоняется. Но текущая
  allowlist не перечитывается здесь; отзыв доступа не останавливает старый invoice.
- Entitlement создаётся внутри DB transaction успешного capture, не при invoice,
  precheckout или клиентском callback. Client дополнительно читает order/unlocks.
- Migrations 026–028: уникальные charge, order payment, provider update/event,
  active user/product, open user/product; identity immutability и FK RESTRICT.
  Эти ограничения защищают от дублей, но не заменяют сохранение excess capture A3.
- Unlock facts читают только active Stars entitlements; штатный локальный full
  refund отзывает entitlement. Reopen предусмотрен серверным чтением. Новый live
  authenticated reopen в этом аудите не выполнялся.
- HMAC Telegram auth, active user check, server-derived user identity и
  timing-safe webhook secret guard присутствуют. Browser auth не даёт Stars
  purchase через controlledUser. Production dev-ID spoof не проходит.
- Адаптер нормализует ошибки без token URL; safeProviderEvent ограничивает поля
  сохраняемого события. HTTP log всё ещё содержит user_id, а request_id поступает
  от клиента: в новой telemetry нужны bounded server IDs, не произвольный payload.
- Capture сохраняется синхронной транзакцией; отдельного payment outbox/inbox с
  recovery queue нет. Reconciliation обнаруживает, но не восстанавливает missing
  capture; повторный запуск создаёт новый run и дедуплицирует issue fingerprint.
- PostgreSQL locking просмотрен, но локальное воспроизведение использует SQLite.
  Production concurrency доказанной не считается. Нужны двухсоединительные
  PostgreSQL race tests, включая refund/capture lock ordering и transient retry.
- Native `/paysupport` не dispatch-ится payment webhook; наличие support UI/URL
  само по себе не доказывает работоспособность команды и обработки обращений.

## 3. Исправления перед запуском

В этом аудите runtime не исправлялся: состояние main сохранено для воспроизводимости.
Добавлен только автономный characterization script
`server/scripts/stars-launch-audit-repro.mjs` и этот отчёт. Скрипт утверждает наличие
известных дефектов, НЕ является зелёным acceptance-тестом. Fake token, локальный
HTTP server, in-memory SQLite, fake provider; внешних вызовов Telegram нет.

Команда: `node server/scripts/stars-launch-audit-repro.mjs`.
Результаты: A1, A2, A3, A4, A5 воспроизведены. Для A3 используются два ранее
одобренных checkout, продвижение часов на 16 минут и задержанный capture.
Для A5 barrier расположен между reservation commit и submission transaction.

Порядок remediation: A1/A4 provider contract; A3 capture inbox/recovery;
A5 refund ownership; A2 hot gate; A6 observability; затем A7 public mode и
полный повторный audit. Не смешивать изменения независимых контуров в один PR.

## 4. Kill switch

Проверка НЕ пройдена. Изменение env объекта не меняет существующий runtime.
Новый disabled runtime удаляет service, index отключает webhook целиком.
Не выполнялись production disable/restart и не отзывался webhook.
Будущий критерий: закрытие invoice + отрицательный новый precheckout на всех
инстансах в заранее измеренный короткий срок, без code deploy, при сохранении
capture/refund/reconcile; stale gate read должен запрещать новую оплату.

## 5. Monitoring plan (план, ещё НЕ готовая production-система)

До GO внедрить и проверить доставку сигналов:

| Сигнал | Источник / реакция |
| --- | --- |
| invoice created/failed | Серверный order ID, product ID, amount, environment, outcome. |
| precheckout received/accepted/rejected | Outcome code, latency/deadline, server correlation ID; не payload. |
| capture persisted / entitlement created / duplicate | Transaction commit outcome; unique charge хранить в защищённой БД, в telemetry opaque correlation. |
| capture without entitlement / unknown charge / conflict | Немедленный page и kill новых покупок; сохранить inbox и payment records. |
| refund submitted/applied/ambiguous | Durable request state; stale submitted/failed вызывает page, не blind retry. |
| reconciliation failed / mismatches | Регулярный bounded job; любой mismatch page, повторный запуск без бизнес-side-effects. |
| webhook 4xx/5xx/429 и ACK business rejection | Собирать до rate limiter и после handler; HTTP 200 не равно payment success. |
| outbox/job failure и backlog age | Отдельно render и будущая payment recovery queue; проверенный alert receiver. |

Для canary: после первого реального capture проверить payment identifiers в БД,
ровно один active entitlement, reopen через пользовательский read path,
отсутствие дублей и согласованный reconciliation. Не возвращать успешную покупку
ради теста. При mismatch остановить новые оплаты, сохранить evidence, безопасно
восстановить положенный доступ либо сделать refund; затем RCA и повторный GO.
Не публиковать token, webhook secret, initData, session, raw payload, Telegram
ID/username и полный charge ID в обычных логах. Не создавать бессрочный мониторинг
пока публичная активация остановлена.

## 6. Production configuration

Точное изменение: НИКАКОГО. Не выполнялись env write, deploy, merge, setWebhook,
платёж, refund, payout или изменение OIDC. Production credentials не читались.
Заявленная владельцем конфигурация: controlled, user 1269552743,
product col_premium-gallery, 120 Stars. Она не была заново прочитана у Render:
HTTP smoke не доказывает точные env, цену, allowlist или deploy SHA.
Просмотренный main использует обычный Bot API route, не `/test/`.

Production HTTP evidence, 2026-09-14 около 16:24–16:25 UTC:

- `https://splint-api.onrender.com/health`: 200, status ok.
- `/ready`: 200, database/object_storage/configuration ok.
- GET `/payments/telegram-stars/config` с неподписанным X-User-Id: 401.
- POST `/payments/telegram-stars/orders`, `{}`, тот же spoof: 401.
- POST `/payments/telegram-stars/webhook`, `{}`, без secret: 401 INVALID_WEBHOOK_SECRET.

Это negative auth smoke, не authenticated non-allowlist purchase и не payment E2E.

## 7. Публичная активация и launch gates

Публичные покупки НЕ открыты. Никакой ready-marker не выдан.
Исторический `TELEGRAM_STARS_PRODUCTION_ROUNDTRIP_PENDING` сохраняется в истории;
с 2026-09-14 его статус: **consciously waived pre-launch requirement** по явному
решению владельца. Реальные owned production purchase/refund НЕ выполнены.
Это принятие residual risk, не ослабление требования исправить P1 defects.

`TELEGRAM_STARS_FIRST_LIVE_TRANSACTION_MONITORING`: **NOT ENTERED — NO-GO**.
Новый статус определён, но не обозначает разрешение публичной активации до GO,
проверенного kill switch, monitoring и подтверждения production configuration.

## 8. Первая live-транзакция

Не инициировалась и не подтверждена. Новые live payment records не читались.
Не утверждаем, что пользовательская транзакция точно отсутствует: нет такой
операционной выборки. Реальные деньги в ходе аудита не расходовались.

## 9. Открытые риски / verification

Все A1–A8 остаются открыты; launch остановлен. Предварительный owned E2E и refund
остаются непроверенными и явно принятым residual risk. Test DC не исследовался.
PR #40 оставлен открытым, PR #41 merged; иных merge/deploy не выполнялось.
GitHub main CI run 34496411973: success, SHA b029b40 (проверено через gh).
Это существующий run, не новый run audit branch.

Локальные проверки: 60/60 Stars + config tests; 473/473 client tests;
полный server run: 492 tests, 425 pass, 67 skipped, 0 fail (224s).
Отдельный auth/unlock run: 37 pass, 0 fail. Skipped не считаются пройденными
production/PostgreSQL проверками. Build exit 0 (есть chunk-size warning),
lint exit 0 (существующий warning budget 100/100), git diff --check exit 0.
Browser E2E и authenticated production UI не запускались: они не исправляют
воспроизведённые provider/recovery blockers. Нельзя подменять ими live E2E.

### Официальные контракты (проверены 2026-09-14)

- [Telegram Stars payment flow](https://core.telegram.org/bots/payments-stars):
  выдача только после successful_payment, сохранение charge ID, 10s precheckout,
  ответственность за поддержку.
- [getStarTransactions](https://core.telegram.org/bots/api#getstartransactions) и
  [StarTransactions](https://core.telegram.org/bots/api#startransactions): envelope
  с полем transactions, не массив result.
- [RefundedPayment](https://core.telegram.org/bots/api#refundedpayment) и
  [refundStarPayment](https://core.telegram.org/bots/api#refundstarpayment): нативный
  refund event и API возврата по user ID / charge ID.

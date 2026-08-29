# Abuse control matrix

The controls below are layered: validation prevents malformed input, durable counters share budgets across API instances, transaction/CAS logic prevents state corruption, and moderation/reporting handles content that is syntactically valid but harmful.

| Surface | Threat | Current control | Response | Remaining validation |
|---|---|---|---|---|
| Auth | spoofed Telegram identity | HMAC + timing-safe hash + expiry/future skew checks | 401; banned account 403 | real Mini App smoke test |
| Progress | forged colors/full-map overwrite | bounded actions, server-derived colors, CAS, batch idempotency | 400/409; local retry | multi-device staging test |
| Completion | client data-URI forgery | canonical server PNG + media status | retryable 503 if upload fails | S3 failure injection |
| Public templates | checkerboard/fragmentation DoS | complexity metrics and public budget | 422 `TEMPLATE_TOO_COMPLEX` | tune against real catalog |
| Posts | spam/flood and duplicate publication | daily/cooldown quotas, one artwork publication, profanity/URL checks | 409/429/400 | load test with shared DB |
| Comments | flood, duplicate text, hidden-counter races | 20s cooldown, duplicate check, transactional counter and shared abuse budget | 400/429 | staging threshold calibration |
| Likes | duplicate/unlike races | unique constraint plus transactional aggregate update | idempotent state | PostgreSQL concurrency run |
| Messages | replay, quota exhaustion, pending buildup | idempotency fingerprint, sender/receiver/day quotas, pending cap, CAS reply/reject, expiry cleanup | 409/429/503 | staging multi-instance run |
| Reports | report spam and moderation race | uniqueness, daily reporter limit, audit log and auto-hide path | 409/429 | moderator operating drill |
| Media | path traversal/private object leak | safe storage keys, object metadata, public join gate, no private keys in DTO | 404/400 | S3 IAM and CDN test |

## Shared limiter rule

`abuse_counters` is PostgreSQL-backed and keyed by logical actor/scope/time bucket, so limits do not reset when a request moves between API instances. SQLite remains a dev-only approximation. Counters should be retained only for the configured short window and can be garbage-collected by bucket timestamp.

## Moderator response

Repeated `ABUSE_LIMITED`, report bursts, suspicious account creation or payment-like retries should produce a structured alert with actor id, route/scope, request id and timestamp—never message body or Telegram secrets. Moderators may hide content or ban the actor; payment mode remains controlled by release ownership.

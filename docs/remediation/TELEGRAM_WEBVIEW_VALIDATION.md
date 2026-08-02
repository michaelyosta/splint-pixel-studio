# Telegram WebView manual validation package

Status: `needs_environment_validation`

This package is intentionally a manual gate. It does not claim Telegram WebView, HTTPS `initData`, page suspension, proxy behavior, or real Telegram Stars are validated by local or disposable infrastructure tests. Do not enable real payments for this pass; the supported public-alpha posture remains `PAYMENTS_MODE=disabled`.

## Preconditions

- A staging deployment using the reviewed release-candidate commit.
- HTTPS with the real Telegram Mini App origin and a test bot configured by the release owner.
- A disposable staging database and object-storage bucket; never use production data.
- Browser DevTools or server request logs available without recording secrets.
- A test account and a second device/browser session for conflict checks.

## Matrix

| Scenario | Procedure | Evidence to record | Pass condition |
|---|---|---|---|
| Real authentication | Open the Mini App from Telegram on iOS and Android; sign in once per test account. | HTTP status and redacted user id only; no `initData` value. | Valid Telegram auth succeeds; missing, stale, or altered init data is rejected. |
| Save and reload | Paint a template, wait for the save indicator, force reload, and compare several cells. | Revision/batch ids from server logs, without user content. | Latest acknowledged state returns after reload with no silent loss. |
| Pagehide/background | Paint unsaved changes, background/close the WebView, reopen, and repeat with poor connectivity. | Client journal/replay outcome and final revision. | Pending state is either durably acknowledged or replayed once; no duplicate batch effect. |
| Completion integrity | Complete the same work from two sessions and retry after a network interruption. | Artwork id, render status, and response codes. | One canonical artwork is produced; client PNG cannot replace server rendering. |
| Publish/readiness | Attempt publish before and after canonical rendering becomes ready. | Response status and `render_status`. | Publish is rejected before `ready` and succeeds only after `ready`. |
| Feed/media | Open the feed on a mobile connection and inspect the response through staging tooling. | Payload byte size, item count, image URL shape. | Bounded DTO uses thumbnails; no base64 or private storage keys are exposed. |
| Social actions | Like/unlike, comment, reply, reject, and retry each action twice from two sessions. | Status codes and final counters. | Counters change only on real transitions; duplicate requests are idempotent. |
| Session expiry/proxy | Let auth/session expire and exercise the configured reverse proxy path. | Redacted status codes and proxy logs. | The app fails closed and does not accept development auth in production mode. |
| Payment posture | Inspect production configuration and UI copy; do not make a real purchase. | Configuration key names and screenshots with account data redacted. | Payments remain disabled; internal credits are not described as Telegram Stars. |

## Evidence handling

Record date, app commit, device/OS, Telegram client version, staging hostname class, scenario result, and any issue id. Redact bot tokens, `initData`, cookies, auth headers, user messages, personal identifiers, and exact host paths. Keep screenshots and videos outside Git and remove them from test artifacts after the retention window.

## Release-owner sign-off

The release owner must attach the redacted evidence and mark each row `pass`, `fail`, or `blocked`. A blocked Telegram/WebView row keeps the overall RC verdict partial. This package does not authorize deployment, BotFather changes, production-secret changes, or enabling Telegram Stars.

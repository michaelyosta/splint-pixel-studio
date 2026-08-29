# Telegram WebView manual validation package

Status: `needs_environment_validation`

## Validation pass addendum — 2026-08-03

This pass produced local and HTTPS smoke evidence, but did not produce real Telegram device evidence. The overall classification is `telegram_rc_partially_verified`; the release gate remains open for a real Telegram launch with real `initData` on Android and iOS.

| Test ID | Device | OS | Telegram version | Commit | Expected | Actual | Status | Evidence reference | Issue/commit |
|---|---|---|---|---|---|---|---|---|---|
| HTTPS-01 | Codex in-app browser, not Telegram | Windows host context | n/a | `7246358dd4fc958f8780ff24a7f8c1b617979e79` | HTTPS frontend/API ingress loads without mixed content | Ephemeral HTTPS Quick Tunnel loaded the frontend; `/api/live` and `/api/ready` returned 200; hostname intentionally omitted from Git | PASS — smoke only | 2026-08-03 browser smoke | none |
| AUTH-01 | Local API harness | Windows | n/a | same | Missing auth is rejected | Protected request without init data returned 401 | PASS — local | `server/test/auth.integration.test.js`; local 401 smoke | none |
| AUTH-02 | Local API harness | Windows | n/a | same | Altered, expired, and future-skewed init data are rejected | Automated auth suite passed invalid hash, expired `auth_date`, and future-skew cases | PASS — automated | `npm --prefix server test` | none |
| UI-01 | Codex in-app browser, not Telegram | Windows host context | n/a | same | Catalog/player canvas remains usable over HTTPS | Catalog loaded; 32×32 canvas painted the active cell; reload restored the acknowledged progress | PASS — synthetic/local auth | 2026-08-03 browser smoke | none |
| CANVAS-160 | Playwright Mobile iPhone emulation | Emulated iOS profile | n/a | same | 160×160 creator path computes, saves, and opens | Covered by the E2E run; the 160×160 test passed | PASS — emulation only | `npm run test:e2e` | none |
| E2E-13B | Playwright Mobile iPhone emulation | Emulated iOS profile | n/a | same | Selecting a completed color keeps a truthful active target | Full run had one failure at this case; isolated rerun passed 1/1 in 8.8s | BLOCKED — flaky/full-run follow-up, not reproduced | Full E2E plus targeted rerun | no source fix justified |
| DEVICE-ANDROID | Physical Android Telegram stable | Android | unavailable | same | Real Mini App launch with real init data and main flow | No physical Android Telegram session was available | BLOCKED | device validation required | release blocker |
| DEVICE-IOS | Physical iOS Telegram stable | iOS | unavailable | same | Real Mini App launch with real init data and main flow | No physical iOS Telegram session was available | BLOCKED | device validation required | release blocker |
| LIFECYCLE-01 | Physical Telegram devices | Android/iOS | unavailable | same | Background, foreground, reload, offline replay, and pagehide preserve durable progress | Not executable without physical Telegram WebView | BLOCKED | device validation required | release blocker |

Environment notes: Docker Desktop was unavailable, so disposable PostgreSQL/MinIO gates were not claimed. The local smoke used SQLite/local storage with development auth; it is not production-like Telegram authentication. No bot token, init data, credentials, personal data, screenshots, or temporary hostname is recorded here.

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

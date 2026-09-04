# Telegram iOS physical-evidence handoff — blocked

Date: 2026-09-04  
Worktree: `codex/telegram-ios-viewport-fix`  
Commit under review: `b6c5889` (`qa: add safe Telegram iOS diagnostic route preflight`)

## Terminal classification

`BLOCKED_PHYSICAL_EVIDENCE`

No physical Telegram iOS measurement was captured. No CSS or production change
is justified by this run.

## Current prerequisite probe

The probe was run from the isolated worktree and intentionally reported only
presence/absence, never secret values:

| Required input | Result | Consequence |
| --- | --- | --- |
| Physical iPhone connected/available to this host | Not detected; no iPhone/Apple Mobile Device WPD or USB entry | The required device capture cannot be performed here |
| iOS device bridge tooling (`idevice_id`, `iproxy`) | Not installed | No device-level fallback is available |
| Dedicated HTTPS diagnostic preview URL | Not supplied in `TELEGRAM_IOS_DIAGNOSTIC_URL` or equivalent public/staging variable | A Telegram Mini App cannot be pointed at the reviewed SHA |
| Dedicated Telegram test bot | No bot credential/configuration supplied | The required Mini App launch path is unavailable |
| Disposable staging backend/account | Not supplied | Authenticated isolated capture cannot be established |

The host probe saw only an unrelated Android handset (`Redmi Note 13`) and did
not treat it as an iOS substitute. No emulator, browser profile, PWA, normal
Telegram URL, or synthetic lifecycle event is counted as physical evidence.

## Safe local prerequisite check

The opt-in diagnostic route was checked separately using a disposable local
Vite preview:

```text
status=PASS
route=diagnostic-opt-in
protocol=http (loopback only)
staticPages=4/4
autoCycle=4/4
secretMarkers=none
retries=0
quarantine=0
```

This proves only that the diagnostic panel is reachable and safe on the local
preview. It does not prove Telegram, iOS, safe-area behavior, lifecycle
behavior, or navigation visibility.

## Required owner action to resume

Provide all of the following without production access:

1. one physical iPhone with Telegram iOS, including model, iOS build, Telegram
   build, and home-indicator state;
2. one stable HTTPS staging origin serving this exact diagnostic commit;
3. one dedicated Telegram test bot whose Mini App opens that origin;
4. one disposable staging backend/account and an agreed redacted evidence
   retention location.

After those inputs exist, run the capture sequence in
[`TELEGRAM_IOS_VIEWPORT_DIAGNOSTIC.md`](../TELEGRAM_IOS_VIEWPORT_DIAGNOSTIC.md):
cold launch, reopen, Catalog, Create, Profile, portrait/landscape, and
background/resume. Capture only the allowlisted measurements and the
`paint`/`hit` lines; never retain `initData`, identity, cookies, tokens, or
request payloads.

## Decision

Stop at `BLOCKED_PHYSICAL_EVIDENCE`. Do not classify a causal defect, propose a
CSS fix, or claim `TELEGRAM_IOS_NAV_FIXED` until the physical sequence produces
redacted measurements and the three navigation items pass on that same device.

# Operational readiness verification — 2026-10-02

Status: HISTORICAL
Current operational truth: [../CURRENT_STATE.md](../CURRENT_STATE.md).

## Owner validation

The owner confirmed ongoing real-phone use with gradual user expansion and a
working basic experience, while UX improvements continue. The owner also confirmed
a real purchase and refund of the sole Premium product and correct expanded access.
These are owner reports; the agents did not perform another transaction or claim
an independently recorded physical-device matrix.

## Provider observations

Neon Free: production branch, six-hour history, one manual snapshot from
2026-09-25 10:21:40 UTC (55.93 MB, no expiry), no snapshot schedule. R2 held about
2.2 GB Standard in EEUR, public access disabled, no bucket lock, default multipart
abort lifecycle and no configured external copy observed. These are provider facts,
not evidence of complete independent recurring protection.

Render splint-api: Free in Ohio, Auto-Deploy After CI Checks Pass. Empty health
path was safely changed to /ready and read back. The owner explicitly declined
the $7/month compute upgrade; no billing/secret/commerce configuration changed.
GitHub account preferences allow Actions notifications on GitHub and email for
failed workflows; actual delivery remains a separate drill.

## Tooling and isolated recovery

PostgreSQL safety guards validate checksum before connecting, require an explicit
recovery URL, reject the source (including Neon pooled/direct aliases) and restore
in one transaction. Temporary restricted pgpass files replace credential argv.
Object restores reject source targets, verify bytes/SHA-256 and log aggregates.
Windows archive security relies on restrictive operator-directory ACLs.

A disposable PostgreSQL 16 / Node 22.23.2 rehearsal applied 37 migrations, inserted
one synthetic marker, made a custom archive and restored into splint_recovery.
The second restore retained 37 migrations and marker MD5
85a822ff72d5e26949c28ac54f90aaaa. Source migration rerun applied zero.
Dump SHA-256: da041dd16b6d45a440ba260d37f4591abc46aaeac93fa2ad272df438fab5cc20.
All source/recovery data was synthetic. No production database was restored.

LocalStack S3 rehearsal archived three synthetic original/thumbnail/grid objects
(51 bytes), verified the manifest and restored to a distinct bucket twice with
matching SHA-256. Manifest SHA-256:
ba7e808c714e470f4a2b9a99181f4144e5d9854c40f90543a40d0126b4726794.
Old MinIO distribution was unavailable (Docker pull denied, official binary 410);
the RC fixture was moved to pinned LocalStack S3 and its AWS SDK seed runs from
server, where that dependency is installed. This changes test isolation only.

## Checks and monitoring

Server suite: 506 passed / 71 environment-gated skips / zero failures.
Focused recovery+monitoring guards: 27 passed / zero skipped.
Frontend baseline: 532 passed; the 15 added probe cases also pass independently.
Server syntax: 87 files. Lint: 93/100 warnings. Production build passes and retains
the released JS/CSS asset names. Server production audit: zero vulnerabilities
after patch-only Express 4.22.3 / body-parser 1.20.8 / qs 6.16.0 updates.
Independent Muse static review found no blocking recovery defect.

The new hourly public probe uses bounded one-attempt requests covering both headers
and body, capped assets, strict /ready and expected API binding. No credentials or
response bodies are recorded; untrusted URL credentials/queries are excluded.
Fresh live probe passed all seven checks in 697 ms. Timeouts observed earlier
remain observations of unknown cause, never automatically classified harmless.
Manual self-test is hermetic. A separate labelled synthetic alert drill must run
on the feature ref after workflow registration; it never contacts production.

## Evidence boundary

After the synthetic rehearsal, a fresh read-only production export used a
PostgreSQL 18.6 client with certificate/hostname verification. The archive is
14,303,696 bytes; SHA-256:
6b0122e67e0004e9a5c34e2793eeaf4fec6de6fcdc4a8712a981e685fe05e325.
An initial isolated restore rejected source-specific Neon role grants and rolled
back completely (zero public tables). Portable recovery now excludes source ACLs;
the operator must separately configure database privileges before cutover.
The repaired restore into a separate local target matched 37 migrations, 10 users,
10 progress records and zero ownerships. No production target was restored.

The fresh protected operator R2 archive contains 1,698 objects / 2,200,126,025 bytes
and verifies every checksum. Manifest SHA-256:
ffe715f1aba523a26fec231c7cec6e9b73e74bd42d9fd232ac39efe23f8785e0.
Three recovered byte samples match their archived SHA-256. Copies remain private
under current-user Windows ACLs; volume encryption was not independently verified.
The owner deferred daily automation after selecting the free local option; no
recurring local task, Neon upgrade or always-on hosting subscription was enabled.

This source does not claim recurring independent protection, complete provider
restore coverage, delivered email, a paid hosting upgrade or publication
of this operational branch. Remote CI/merge/deploy/drill receipts are recorded
separately when performed. Provider continuity work remains assigned to Luna.

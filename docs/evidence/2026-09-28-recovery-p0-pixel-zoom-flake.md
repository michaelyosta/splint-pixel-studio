# Recovery-p0 Pixel zoom flake - evidence 2026-09-28

Status: HISTORICAL evidence. Not current truth. Current truth lives in docs/CURRENT_STATE.md.

## Observation

- main run 36356532377 attempt 1, shard e2e (16/24): 1 failure.
- Failing test: [Mobile Pixel] e2e/recovery-p0.spec.js:33 cold root reopen restores the last artwork and resumable state.
- Failing assert: e2e/recovery-p0.spec.js:101 expect(afterColdReopen.zoom).toBeCloseTo(beforeColdReopen.zoom, 2).
- Same run, same test: Chromium PASS, Mobile iPhone PASS.
- Previous main run 36355307992 on 8287f09: completed success, zero failures.
- Failing commit 118928a contains docs plus workflow schedule only. Zero app-code changes, so it cannot change zoom behavior.
- Focused rerun of shard 16 only (gh run rerun --failed): attempt 2 completed success.
- Artifact: e2e-diagnostics-16.zip, artifact ID 10943832978, 14-day retention.

## Classification

- Transient flake candidate. Recorded as NON_BLOCKING_DEBT for the Splint goal.
- Evidence stands at 1 fail / 1 pass on identical SHA.
- Per docs/E2E_QUARANTINE_POLICY.md this single data point does not justify quarantine (needs owner plus restore criteria).
- Forbidden responses without new evidence: weakening the assert, adding sleeps or retries, widening tolerance, skipping the test.

## Next step if it recurs

- Capture status plus response body on the seed and reopen calls, then run shard 16 in isolation versus in shard order.
- Open a focused fix only with a second independent failure on the same assert.
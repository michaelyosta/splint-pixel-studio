# E2E quarantine policy

Status: CANONICAL
Authority: Stable policy for temporary test quarantine.

Navigation: [INDEX.md](INDEX.md) · Current state: [CURRENT_STATE.md](CURRENT_STATE.md)
Suite contract: [E2E_TEST_INVENTORY.md](E2E_TEST_INVENTORY.md)

Quarantine is an explicit, temporary exception for a proven flaky test. It is
not a way to make a release gate green.

A test may be quarantined only when all of the following are recorded in a
dated evidence/handoff document and the visible issue/reference:

1. The same test reproduces as flaky on the same code SHA with retries
   disabled.
2. The root cause cannot be safely corrected in the bounded workstream.
3. The test does not represent an unresolved release-critical product defect.
4. An owner, first-observed SHA, reproduction evidence, impact, and restore
   criteria are named.
5. The test remains runnable in the extended suite or a clearly visible
   quarantine job; it is never deleted or silently skipped.

The release-critical gate may not contain an unexplained quarantine. Review
each exception when its owner changes, at every release candidate, and when
restore criteria are met. Restore means removing the exception and obtaining
repeated PASS evidence while retries remain disabled.

Current quarantine count is not owned by this policy document. Check current
CI/evidence and update [CURRENT_STATE.md](CURRENT_STATE.md) only when direct
evidence supports a current claim.

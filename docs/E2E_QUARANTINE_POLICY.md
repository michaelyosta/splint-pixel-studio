# E2E quarantine policy

Quarantine is an explicit, temporary exception for a proven flaky test. It is
not a way to make a release gate green.

A test may be quarantined only when all of the following are recorded in the
run state and an issue/reference exists:

1. The test has reproduced as flaky on the same code SHA with retries disabled.
2. The root cause cannot be safely corrected in the current bounded wave.
3. The test does not represent an unresolved release-critical product defect.
4. An owner, first-observed SHA, reproduction evidence, impact and restore
   criteria are named.
5. The test remains runnable in the extended suite or a clearly visible
   quarantine job; it is never deleted or silently skipped.

The release-critical gate may not contain an unexplained quarantine. A
quarantine entry must be reviewed when its owner changes, at every release
candidate, and when the restore criteria are met. Restore means removing the
exception and obtaining repeated PASS evidence with retries still disabled.

Current state for this stabilization pass: **zero quarantined tests**. The 59
initial unexpected results were investigated as four causal clusters; none was
hidden by quarantine.

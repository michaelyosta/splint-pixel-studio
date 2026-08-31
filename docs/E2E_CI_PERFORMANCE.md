# E2E CI performance

Status: `TOPOLOGY MEASURED — exact-SHA run 33388276591 classified; weighted manifest selected, authoritative post-topology timing pending`

This document records the performance evidence from the frozen diagnostic and
the current CI shape. It does not treat low CPU utilization as a reason to
increase parallelism before isolation and failure causes are proven.

## Authority and measured baseline

- Frozen source SHA: `ab1adc3daaec6a1b4305952ab342f34e70759673`.
- Runtime: Node `v22.23.2`, npm `10.9.8`, Playwright `1.61.1`.
- Host: Windows, one Playwright worker, `fullyParallel=false`, retries `0`.
- Nominal matrix: 432 project cases from 39 specs / 146 logical tests.
- Wall-clock duration: `2 h 24 m 27.438 s`.
- Result: 302 passed, 59 unexpected, 71 skipped.

The project-result durations were Chromium `38 m 44.997 s`, Mobile iPhone
`35 m 19.747 s`, and Mobile Pixel `1 h 07 m 55.226 s`. Their sum is lower than
wall clock because it excludes some orchestration, server, and fixture time.

Focused clean runs on the same Node 22 procedure were:

| Scenario | Cases | Result | Duration |
|---|---:|---|---:|
| Mobile Pixel accessibility | 8 | 8 passed | 146.3 s |
| Mobile iPhone accessibility | 8 | 7 passed, 1 intentional skip | 137.4 s |
| Mobile Pixel 1200 representative | 2 | 2 passed | 119.0 s |
| Mobile Pixel tiled stroke | 2 | 2 passed | 216.3 s |

After integration SHA `70af41f05f65a3807c0d49747aeb4fa538e1ed31`, the modified
C2/C4 Mobile Pixel set (15 cases: guided, migration, glyph, low-zoom, and
stroke) passed `15/15` in `9.9 min`, with retries `0`. This is a targeted
post-fix measurement, not the full-suite gate.

On post-integration SHA `16fb30c` a mixed full Windows invocation completed in
`2 h 15 m 16.042 s` with `317` executed cases, `44` unexpected results, and
`71` skips. A fresh Chromium full invocation completed in `37 m 52.986 s`
with `4` unexpected results; all four exact tests then passed individually in
fresh invocations. These are retained as diagnostic history, not final proof.

The first post-fix expanded wave on SHA `16852a7` ran in 16 isolated shard
contexts and produced `364` passes, `71` expected skips and `3` unexpected
results. The three rows were independently reproduced and corrected or
classified in bounded follow-ups: creator WebKit worker/module sensitivity,
special-glyph mobile sensitivity, and the guided-player fixture selecting a
valid Fuse offer. The last pre-correction code/harness SHA was `7d16ed3`; the
bounded correction wave is committed at `e60e39c`.

The prior selected extended matrix used one evidence run per shard after those
bounded corrections: `367` passes, `71` expected skips, `0` unexpected and
`0` flaky. Review correctly identified that its timestamps did not prove one
complete post-correction run, so it is historical evidence only. A new
complete 16-shard matrix is required before final acceptance. Because the
Windows matrix is sequential, its sum is a runner-time proxy, not a GitHub
billing estimate.

The first complete post-correction matrix at SHA `70a93a5` completed all
16 shards in `1 h 14 m 24.606 s` with `366` passes, `71` skips, one
unexpected and zero flaky results. The single failure was the C12 legacy glyph
fixture seed defect. After the bounded fix at `9eaedea`, focused legacy
glyph checks passed Pixel `5/5` and Chromium+iPhone `2/2`; related tiled
glyph checks passed Chromium+Pixel `2/2`. A new complete matrix is required
on the corrected SHA.

The second complete matrix at SHA `958ec96` completed all 16 shards in
`1 h 18 m 03.624 s` with `365` passes, `71` skips, two unexpected and
zero flaky results. Both unexpected rows were browser-side loopback
`ERR_CONNECTION_REFUSED` events. After the C13 host-parity correction at
`b4105a3`, the two affected scenarios passed `5/5` each and the CI-mode
pair passed `2/2`. A new complete matrix is required on the corrected SHA.

Wave6 on SHA `f0c8d35` completed all 16 sequential shards with `365` passes,
`71` skips, `2` unexpected and `0` flaky results. Its summed wall proxy was
`63 m 41.141 s`, with the slowest shard at `10 m 20.586 s`. The Mobile iPhone
zone visual timeout retained WebKit creator worker-module errors. The Mobile
Pixel low-zoom failure retained `net::ERR_ABORTED` tile requests and exposed
a scheduled initial WORK-plan race. After the bounded correction at
`508d917`, focused low-zoom passed `5/5`; the zone matrix passed Chromium and
Pixel `4/4` and recorded two explicit WebKit capability skips. The final
complete matrix must still run on `508d917`.

The complete wave7 local diagnostic matrix on integration HEAD `9cba274`
completed all `16/16` sequential shards with `364` passes, `72` expected
skips, `2` unexpected and `0` flaky results. Recorded shard test durations
sum to `39 m 28.037 s`; the slowest shard test duration is `7 m 45.766 s`.
The two rows were one Chromium creator bootstrap timeout accompanied by
`index.css: net::ERR_NO_BUFFER_SPACE`, and one Pixel direct tile-read
`ETIMEDOUT`. They passed isolated targeted repeats (`10/10` and `5/5`), so
this run is environment-pressure evidence, not final acceptance. The CI
workflow now writes SHA/run/shard-scoped output and a machine-readable
fingerprint summary for every critical/full shard.

The PostgreSQL service gate was subsequently executed locally against a fresh
Docker `postgres:16` container using the same credentials and migration shape
as CI. Node `22.23.2` with npm `10.9.8` applied `28` migrations and the suite
completed with `100` passed, `0` failed and `0` skipped in `87.537 s`. The
container was removed after the run. The same PostgreSQL service gate also
passed in exact-SHA GitHub run `33388276591`; no production database was used.

The first GitHub PR validation run `33386651214` completed all jobs. Its 16
extended shards and 3 critical lanes stopped during the runtime guard before
Playwright, so it supplies setup/failure-map evidence but no test-duration
measurement. All failures shared the C16 npm path fingerprint. The verify job
passed the 455-test unit suite and failed only the strict lint budget at
`101/100` (C17); PostgreSQL and S3 contract jobs passed. The bounded correction
also adds manual workflow dispatch so final timing is measured against the
exact integration SHA rather than a pull-request merge ref.

## Exact-SHA GitHub pressure measurement

Run `33388276591` used exact SHA
`3a993d14da514fa564909d4461f66a81bab42357`, retries `0`, fail-fast `false`,
and independent fresh GitHub runner/runtime contexts. All jobs completed.

| Measurement | Value |
|---|---:|
| Workflow wall-clock | `24.8 min` |
| Extended runner-minutes | `103.667 min` across 16 jobs |
| Slowest extended job | shard 4, `24.18 min` |
| Critical runner-minutes | `18.633 min` across 3 jobs |
| Critical slowest job | Pixel, `8.32 min` |
| Extended result | `356 pass / 72 expected skip / 5 unexpected / 0 flaky` |
| Critical result | `66 pass / 0 unexpected / 0 flaky` |

The RED extended jobs were shard 3 (`12.57 min`, three failures), shard 4
(`24.18 min`, one failure) and shard 6 (`2.98 min`, one failure). The latter
still showed the same latency-growth signature in its server log and recovered
for the remaining tests. Fresh isolated repeats of all five representatives
passed: guided `3/3`, keyboard `3/3`, Bomb `3/3`, iPhone accessibility `5/5`,
and tiled glyph `5/5`.

## Static topology comparison and selected plan

The exact run's 438 nominal project cases were mapped to 146 logical test
groups. Playwright built-in sharding was then listed without running tests and
weighted with the historical per-test durations:

| Plan | Empty shards | Project cases | Projected slowest test workload |
|---|---:|---:|---:|
| Built-in 16 | 0 | 438 | `22.57 min` |
| Built-in 24 | 3 | 438 | `19.83 min` |
| Built-in 32 | 4 | 438 | `17.54 min` |
| Weighted logical groups / 16 | 0 | 438 | `9.84 min` |

The selected plan is deterministic weighted 16-shard allocation, not a higher
shard count: 24/32 did not split the dominant logical heavy cases and added
runner setup without improving the predicted lifetime enough. The complete
machine-readable plan is
`docs/E2E_SHARD_LOAD_MANIFEST.json`. Its preflight lists every generated shard
and proves `146/146` logical tests, `438/438` project cases, zero duplicate and
zero unmatched assignments before the matrix starts.

Historical request counts were not present in the prior Playwright JSON. The
new topology wave captures server `/metrics` before each fresh runtime is
torn down; summaries report request count, errors and average API latency, with
p95/max explicitly unavailable until a source supplies those aggregates.

## CPU and the apparent unused capacity

The observed CPU level of roughly 14–22% is compatible with the current
configuration: one browser worker spends substantial time waiting on page
lifecycle, HTTP/API responses, tile I/O, SQLite, and browser rendering. CPU is
therefore not the dominant measured bottleneck. Adding workers would mainly
increase concurrent server/database/tile pressure and could reproduce the
same cross-test contamination or resource contention in a less diagnosable
form.

During the long run the API process reached approximately 1.2 GB resident
memory, tile request time rose into the `0.8–3.6 s` range, and one tile request
took `20.161 s`. A stroke diagnostic still reported the expected 30 painted
cells, while post-action/tile requests continued. The earlier 16-way local
attempt produced `275 pass / 71 skip / 79 unexpected`, including connection
refusals and a worker exit under resource pressure. This points to I/O, server
pressure, and lifecycle/oracle behavior as the first optimization targets;
CPU headroom alone is not sufficient evidence for parallelization.

## Existing GitHub Actions evidence

The latest available run on production `main` (`dc01c103544ac953e97cb77fc501842f9dab5f1b`, run `33251937153`) is a valid Linux/Node 22 CI measurement, but it is RED. The 16 E2E jobs used approximately `101.77` aggregate runner minutes and `33.98` minutes wall-clock to the slowest shard. Two shards failed in `tiled-stroke-engine.spec.js`; this is diagnostic evidence, not a green baseline.

The supplied release-candidate run (`6ce8f60bdd673030bdbb705f2111c69bdfacf546`, run `33247780450`) was GREEN. Its 16 E2E jobs used approximately `86.03` aggregate runner minutes and `19.75` minutes wall-clock to the slowest shard. The difference is not a controlled before/after comparison because the tested SHAs and observed test behavior differ.

## Current GitHub Actions cost shape

The E2E job currently uses 16 fail-fast-disabled shards. Each shard performs:

1. checkout;
2. Node 22 setup and npm cache lookup;
3. root `npm ci`;
4. `npm --prefix server ci`;
5. Chromium and WebKit installation with dependencies;
6. one Playwright shard;
7. diagnostics artifact upload.

This means dependency and browser setup is repeated up to 16 times. The
workflow timeout is 120 minutes per shard. The selected post-stabilization
local measurement has all 16 shards below that limit. The two existing GitHub
runs above remain historical reference points; no GitHub run was created or
pushed for this un-deployed branch. The local Windows elapsed time must not be
presented as a GitHub billing estimate.

## Optimization decisions

Already justified and implemented in the lead harness change:

- Node 22 is the authoritative E2E runtime in CI and in the explicit local
  procedure.
- JSON results are emitted in CI.
- Failure traces and screenshots are retained for diagnostics.
- Failures are uploaded for every shard, including failed runs.

Not yet justified:

- increasing Playwright workers;
- reducing the shard count;
- moving to a shared browser/dependency cache architecture;
- adding generic retries;
- changing the server or database architecture.

Those choices require post-fix timings and failure-isolation evidence. The
release-critical gate target remains approximately 5–10 minutes wall-clock
when the three project jobs run in parallel. The Chromium/Pixel lanes were
below seven minutes locally; the workflow defines this as the `e2e-critical`
PR gate, with an explicit supported 14-test iPhone/WebKit smoke subset. The
separate `storage-s3-contract` job covers the object-storage path, while the
existing 16-shard `e2e` job remains the extended suite.

## Required next measurements

- per-shard wall-clock and setup/test durations from a valid CI run;
- slowest specs and shards after the bounded integration wave;
- repeated focused durations for the previously flaky input, lifecycle, and
  tiled clusters;
- release-critical gate wall-clock and full extended-suite wall-clock;
- one authoritative GitHub critical matrix and one complete post-correction
  16-shard extended matrix, without using retries to hide failures.

## Interpretation of low CPU utilization

The observed `14–22%` CPU is not evidence that additional workers are free:
the single worker is blocked on browser lifecycle, HTTP, SQLite, tile
rendering, and persistence. The run evidence includes API memory near `1.2 GB`,
a tile response near `20.16 s`, and slow progress/action requests. Increasing
workers would add concurrent mutable-server pressure, so it is not a justified
optimization until the extended sharded result proves isolation.

## Final local gate measurements

| Gate | Cases | Result | Duration |
|---|---:|---|---:|
| Release-critical, Chromium | 26 | 26 pass | 6 m 48.958 s |
| Release-critical, Mobile iPhone/WebKit smoke | 14 executable | 14 pass | 84.113 s |
| Release-critical, Mobile Pixel | 26 | 26 pass | 6 m 53.653 s |
| Extended, prior selected 16 shards | 367 executed + 71 expected skips | 0 unexpected, 0 flaky; historical only | slowest 11 m 56.614 s; sum 73 m 56.861 s |
| Extended, first complete post-correction 16 shards | 366 pass + 71 expected skips | 1 C12 unexpected, 0 flaky; diagnostic only | 1 h 14 m 24.606 s wall-clock |
| Extended, second complete post-correction 16 shards | 365 pass + 71 expected skips | 2 C13 unexpected, 0 flaky; diagnostic only | 1 h 18 m 03.624 s wall-clock |
| Extended, wave6 complete 16 shards | 365 pass + 71 expected skips | 2 harness unexpected, 0 flaky; diagnostic only | 63 m 41.141 s summed sequential wall proxy; slowest 10 m 20.586 s |
| Extended, wave7 complete local 16 shards | 364 pass + 72 expected skips | 2 environment-pressure unexpected, 0 flaky; diagnostic only | 39 m 28.037 s summed test-duration proxy; slowest shard 7 m 45.766 s |
| GitHub PR run 33386651214 | 16 extended + 3 critical jobs reached setup; 0 Playwright cases | C16 runtime guard failure across 19 lanes; C17 lint `101/100` | setup-only; no valid test timing |

The final critical matrix is compatible with the intended approximately 5–10
minute PR gate when the three project jobs run in parallel. The local
Chromium/Pixel lanes are about `6 m 49 s` and `6 m 54 s`; the iPhone emulation
lane is `2 m 39 s`. A live GitHub Actions wall-clock and billed-minute
measurement will be recorded from the exact pushed integration SHA; the
historical GitHub references above remain non-controlled comparisons.

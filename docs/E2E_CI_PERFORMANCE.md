# E2E CI performance

Status: `MEASURED — critical and extended E2E matrices green; PostgreSQL CI proof pending`

This document records the performance evidence from the frozen diagnostic and
the current CI shape. It does not treat low CPU utilization as a reason to
increase parallelism before isolation and failure causes are proven.

## Authority and measured baseline

- Frozen source SHA: `ab1adc3daaec6a1b4305952ab342f34e70759673`.
- Runtime: Node `v22.23.2`, npm `10.9.8`, Playwright `1.61.1`.
- Host: Windows, one Playwright worker, `fullyParallel=false`, retries `0`.
- Nominal matrix: 432 project cases from 38 specs / 144 logical tests.
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
fresh invocations. On final SHA `b6db4b6`, the release-critical matrix passed
Chromium `23/23`, Mobile iPhone `12/12` executable with `11` conditional skips,
and Mobile Pixel `23/23`, with retries `0`. The longest critical project run
was approximately `5.6 min`, which supports the 5–10 minute PR-gate target.
On stabilization SHA `b9a82d8`, the final extended matrix ran in 16 isolated
shard contexts with `361` executed cases, `71` expected skips, `0` unexpected
and `0` flaky. Every shard exited `0`. The sum of shard test durations was
`4,515.732 s` (`75 m 15.732 s`), and the slowest shard was `728.608 s`
(`12 m 08.608 s`). Because this local run was sequential, the sum is a
runner-time proxy; it is not a GitHub billing estimate. Expected CI wall-clock
remains bounded by the slowest parallel shard plus setup and artifact upload.

These focused results are evidence that a clean process is materially faster
and more reliable than the long mixed run for the selected scenarios. They are
not a claim that the entire suite is stable yet.

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
cells, while post-action/tile requests continued. This points to I/O, server
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
workflow timeout is 120 minutes per shard. The post-stabilization local
measurement has all 16 shards below that limit. The two existing GitHub runs
above remain historical reference points; no GitHub run was created or pushed
for this un-deployed branch. The local Windows elapsed time must not be
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
release-critical gate target remains approximately 5–10 minutes wall-clock if
the measured critical subset supports it. The measured three-project matrix
fits that target when run as independent jobs; the workflow now defines it as
the `e2e-critical` PR gate, while the existing 16-shard `e2e` job remains the
extended suite.

## Required next measurements

- per-shard wall-clock and setup/test durations from a valid CI run;
- slowest specs and shards after the bounded integration wave;
- repeated focused durations for the previously flaky input, lifecycle, and
  tiled clusters;
- release-critical gate wall-clock and full extended-suite wall-clock;
- before/after comparison without using retries to hide failures.

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
| Release-critical, Chromium | 23 | 23 pass | 6 m 11.139 s |
| Release-critical, Mobile iPhone | 12 executable + 11 conditional skips | 12 pass | 1 m 20.157 s |
| Release-critical, Mobile Pixel | 23 | 23 pass | 6 m 11.395 s |
| Extended, 16 shards | 361 executed + 71 expected skips | 0 unexpected, 0 flaky | slowest 12 m 08.608 s; sum 75 m 15.732 s |

The critical matrix is compatible with the intended approximately 5–10 minute
PR gate when the three project jobs run in parallel. A live GitHub Actions
wall-clock and billed-minute measurement still requires a future push or PR,
which this stabilization pass intentionally did not perform.

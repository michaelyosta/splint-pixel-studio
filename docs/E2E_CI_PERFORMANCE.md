# E2E CI performance

Status: `MEASURED BASELINE — targeted post-fix PASS; full-suite comparison pending`

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
workflow timeout is 120 minutes per shard. Post-stabilization measurements are
still pending; the two existing runs above are historical reference points,
not evidence that this branch is stable. The local Windows elapsed time must
not be presented as a GitHub billing estimate.

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
the measured critical subset supports it; the final duration and shard shape
will be recorded only after the critical suite is defined and verified.

## Required next measurements

- per-shard wall-clock and setup/test durations from a valid CI run;
- slowest specs and shards after the bounded integration wave;
- repeated focused durations for the previously flaky input, lifecycle, and
  tiled clusters;
- release-critical gate wall-clock and full extended-suite wall-clock;
- before/after comparison without using retries to hide failures.

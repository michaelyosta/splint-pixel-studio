# Public-alpha benchmark record

This record separates measured evidence from unsupported product claims.

The historical renderer/browser measurements are retained in [GRID_BENCHMARK.md](../GRID_BENCHMARK.md). They show that the current algorithm becomes materially expensive for large and highly fragmented grids; they do not certify Telegram WebView or a production device fleet.

The release candidate adds:

- server complexity metrics and adversarial checkerboard/fragmentation fixtures;
- a worker path for image-to-template generation with a main-thread fallback;
- bounded feed/message page sizes and compact DTOs;
- explicit media/payload metadata for later staging measurement.

Required staging measurements before raising grid limits: p50/p95 template generation, p50/p95 first Canvas render, save latency and retry rate, peak browser memory, feed payload size, media object read latency, and error rates on the target mobile WebView. Until those values are attached to a run, the supported public-alpha size remains the configured 160×160 ceiling.

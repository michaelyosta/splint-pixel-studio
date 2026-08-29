# Verification snapshot

Run on 2026-08-15 in `C:\Users\misa\Desktop\Splint-Recovery-Eval` after repair commit `a92f919` (cherry-pick of `551fe72`) and before the evaluator evidence commit.

## Automated checks

- `npm test`: 378 passed, 0 failed, 0 skipped.
- Focused evaluator/pipeline/worker tests: 36 passed, 0 failed.
- `npm run lint`: passed at the existing 98/100 warning budget; no evaluator warning was added.
- `npm run build`: passed; existing >500 kB bundle warning remains.
- `git diff --check`: passed.
- Artifact reconciliation: 14/14 classic 192/512 output hashes match the prior baseline; all 7 source SHA-256 values validated; all 14 paintable producer metric audits match final cells.

## Deterministic memory contract benchmark

Command:

```text
npm run benchmark:pixelization-memory -- --sizes 192,512,1200
```

- 192: measured; build 345.7 ms; post-quality RSS 68.8 MB.
- 512: measured; build 899.5 ms; post-quality RSS 106.6 MB.
- 1200: explicitly limited in 0.2 ms with `PAINTABLE_RESOLUTION_LIMIT`.

This benchmark mocks browser decode/PNG compression and is allocation-contract evidence only. It is not a physical iPhone memory/performance claim; timings and RSS are a single local process snapshot.

## Human gates

- Artistic pixel-art quality and whether the edge-recall tradeoff is desirable.
- Number readability at a zoomed mobile creation preview, not the whole-art 320-pixel panel.
- Paint feel/effort with actual strokes and Smart targets.
- Physical Safari/iPhone resource behavior.

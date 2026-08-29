# Pixelization routing recommendation

Policy: `pixelization-routing-v1`
Source run: `091a9c683919a1a0808f1af6d58cb9d9b6272b28` (2026-08-20T17:11:39.295Z)

> This is an evidence-only routing suggestion. It does not change the creator default, and it does not prove artistic quality or mobile paint feel.

## Contract

- Recommendations are per exact logical resolution; render/preview scale is reported separately and cannot create logical cells.
- `classic` is the safe fallback when the candidate is unavailable or a guardrail regresses.
- `paintable` is only provisional when effort improves by at least 10% and no configured guardrail regresses.
- `human-review` means the fallback is classic while the candidate remains useful as an explicit comparison, not an automatic winner.

## Matrix

| Artwork | Logical size | Recommendation | Status | Reasons |
| --- | ---: | --- | --- | --- |
| animal-iguana-venezuela | 192×192 | classic | human-review | effort-regression, boundary-fragmentation-increase |
| animal-iguana-venezuela | 512×512 | classic | human-review | edge-recall-drop |
| gradient-golden-gate-fog | 192×192 | classic | human-review | edge-recall-drop |
| gradient-golden-gate-fog | 512×512 | classic | human-review | edge-recall-drop |
| illustration-paint-brush | 192×192 | paintable | provisional-positive | effort-improvement-within-guardrails |
| illustration-paint-brush | 512×512 | classic | human-review | edge-recall-drop |
| landscape-utah-dunes | 192×192 | classic | human-review | boundary-fragmentation-increase |
| landscape-utah-dunes | 512×512 | paintable | provisional-positive | effort-improvement-within-guardrails |
| object-palm-wine-cup | 192×192 | classic | human-review | effort-regression |
| object-palm-wine-cup | 512×512 | classic | human-review | edge-precision-drop |
| portrait-jessica-meir | 192×192 | classic | human-review | edge-recall-drop |
| portrait-jessica-meir | 512×512 | classic | human-review | edge-recall-drop |
| silhouette-rat | 192×192 | classic | human-review | edge-recall-drop |
| silhouette-rat | 512×512 | classic | human-review | edge-recall-drop |

## Counts

- classic fallback: 12
- paintable provisional-positive: 2
- unavailable rows: 0
- human-review rows: 12

## Interpretation

The recommendation is intentionally conservative. A candidate can reduce predicted manual effort and still fall back to classic when edge recall or another structural guardrail regresses. The next safe step is visual/mobile review of the rows marked `human-review`, not an automatic creator default switch.

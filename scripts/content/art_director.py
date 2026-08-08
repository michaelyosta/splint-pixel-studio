"""Splint Content Art Director — Conversion Quality Engine.

CYCLE 4 architecture shift: the factory produces *valid files* faster than
it understands which are *good*. This module inverts the funnel:

    source
      -> is this inherently good for number coloring?        (SOURCE QUALITY)
      -> best crop (subject-aware, drop dead background)     (SUBJECT CROP)
      -> best conversion strategy (edge-preserving palette)  (CONVERSION QUALITY)
      -> best ONE or TWO resolutions per artwork family      (RESOLUTION SELECTION)
      -> visual QA flags + playtest estimate                  (GAME QUALITY)
      -> catalog approval (all three gates high)

Key model change: a source is ONE artwork family. Size variants (g48/g64/g96)
are NOT separate catalog entries; the director picks the 1-2 resolutions
where the artwork actually gains something.
"""

from __future__ import annotations

import sys
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "scripts" / "content"))

from content_lib import (  # noqa: E402
    _rgb_to_lab,
    _lab_distance,
    analyze_regions,
    convert_template,
    palette_separation,
    playability_score,
    source_structure_metrics,
)

# Grid tiers per content tier (mirrors import_source.py TIER_GRIDS).
TIER_GRIDS = {
    "small": [12, 16, 24, 32],
    "medium": [48, 64, 96, 128, 192],
    "large": [256, 384, 512, 600],
    "masterpiece": [800, 1024, 1200],
}

GRID_SIZES = [12, 16, 24, 32, 48, 64, 96, 128, 192, 256, 384, 512, 600, 800, 1024, 1200]


# ---------------------------------------------------------------------------
# SUBJECT-AWARE CROP
# ---------------------------------------------------------------------------

def subject_bbox(source_path, thumb: int = 256, pad_ratio: float = 0.08, min_cover: float = 0.06):
    """Find the bounding box of the visually interesting subject.

    Uses local luminance variance (detail density) as a saliency proxy:
    museum objects on blank stands, flowers on gray mounts, framed artworks
    with dead matting all have a low-detail surround. Returns the bbox in
    original-image coordinates, or None when the subject fills the frame.
    """
    from PIL import Image

    img = Image.open(source_path).convert("L")
    orig_w, orig_h = img.size
    scale = thumb / max(orig_w, orig_h)
    small = img.resize((max(1, int(orig_w * scale)), max(1, int(orig_h * scale))), Image.Resampling.BOX)
    arr = np.asarray(small, dtype=np.float32)
    h, w = arr.shape

    # Local 3x3 variance = detail density.
    padded = np.pad(arr, 1, mode="edge")
    windows = np.lib.stride_tricks.sliding_window_view(padded, (3, 3))
    detail = windows.var(axis=(2, 3))

    # Detail threshold: strong structure only, with an absolute floor so a
    # large blank surround (white museum mount) can't drag the quantile to 0
    # and make the mask cover everything.
    thr = max(float(np.quantile(detail, 0.75)), 40.0)
    mask = detail >= thr
    if mask.sum() < 8:
        return None  # essentially no structure anywhere

    # Column/row projections to find the dense core.
    col_density = mask.mean(axis=0)
    row_density = mask.mean(axis=1)
    core_thr = max(col_density.max() * 0.15, 0.01)

    cols = np.nonzero(col_density >= core_thr)[0]
    rows = np.nonzero(row_density >= core_thr)[0]
    if cols.size == 0 or rows.size == 0:
        return None

    x0, x1 = cols.min(), cols.max()
    y0, y1 = rows.min(), rows.max()

    # If subject already covers most of the frame, no crop needed.
    if (x1 - x0) >= w * 0.85 and (y1 - y0) >= h * 0.85:
        return None

    # Padding (relative to bbox size), clamped to image bounds.
    px = int((x1 - x0) * pad_ratio)
    py = int((y1 - y0) * pad_ratio)
    x0, x1 = max(0, x0 - px), min(w, x1 + px)
    y0, y1 = max(0, y0 - py), min(h, y1 + py)

    # Map back to original coordinates.
    return {
        "x": int(x0 / scale),
        "y": int(y0 / scale),
        "w": int((x1 - x0) / scale),
        "h": int((y1 - y0) / scale),
    }


def crop_to_subject(image, bbox):
    """Crop a PIL image to the subject bbox (squares it up minimally)."""
    from PIL import Image

    w, h = bbox["w"], bbox["h"]
    side = max(w, h)
    # Expand the shorter side symmetrically to make a square-ish crop.
    cx = bbox["x"] + w // 2
    cy = bbox["y"] + h // 2
    x0 = max(0, cx - side // 2)
    y0 = max(0, cy - side // 2)
    x0 = min(x0, image.width - side)
    y0 = min(y0, image.height - side)
    x0 = max(0, x0)
    y0 = max(0, y0)
    return image.crop((x0, y0, x0 + side, y0 + side))


# ---------------------------------------------------------------------------
# EDGE PRESERVATION
# ---------------------------------------------------------------------------

def edge_preservation(source_path, template, bbox=None):
    """How much of the source's LARGE-SCALE structure survives conversion (0..1).

    Compares edge maps at a fixed coarse scale (64x64) regardless of grid
    size. This measures composition-level preservation — silhouettes, major
    contours, large color blocks. Micro-texture (brush strokes, paper grain,
    woodblock hatching) is deliberately NOT scored: losing it is a feature
    (players do not want to fill 5,000 hatching cells), not a defect.
    """
    from PIL import Image

    grid = template["width"]
    coarse = 64
    img = Image.open(source_path).convert("L")
    if bbox:
        img = crop_to_subject(img, bbox)
    img = img.resize((coarse, coarse), Image.Resampling.BOX)
    src = np.asarray(img, dtype=np.float32)

    # Source coarse edges: strong local gradient at composition scale.
    gx = np.abs(np.diff(src, axis=1))
    gy = np.abs(np.diff(src, axis=0))
    src_edges = (gx[:-1, :] + gy[:, :-1]) > 30  # (63, 63)

    # Template: downscale cell grid to the same coarse scale, then edges.
    cells = np.asarray(template["cells"], dtype=np.int32).reshape(grid, grid)
    from PIL import Image as Im

    cell_img = Im.fromarray(cells.astype(np.uint8))
    coarse_cells = np.asarray(cell_img.resize((coarse, coarse), Im.Resampling.NEAREST), dtype=np.int32)
    tx = coarse_cells[:, :-1] != coarse_cells[:, 1:]
    ty = coarse_cells[:-1, :] != coarse_cells[1:, :]
    tpl_edges = tx[:-1, :] | ty[:, :-1]

    if src_edges.sum() == 0:
        return 0.0
    overlap = (src_edges & tpl_edges).sum()
    precision = overlap / max(1, tpl_edges.sum())
    recall = overlap / max(1, src_edges.sum())
    if precision + recall == 0:
        return 0.0
    return 2 * precision * recall / (precision + recall)


# ---------------------------------------------------------------------------
# BACKGROUND / DEAD-SPACE ECONOMY
# ---------------------------------------------------------------------------

def background_ratio(template):
    """Fraction of the frame that is near-blank (single dominant region)."""
    regions = analyze_regions(template["width"], template["height"], template["cells"])
    return regions["largest_region_ratio"]


# ---------------------------------------------------------------------------
# THREE-GATE QUALITY MODEL
# ---------------------------------------------------------------------------

def source_quality(source_path, grid_size: int = 128) -> dict:
    """Gate 1: is the SOURCE inherently good for number coloring?

    Rewards: strong structure (contrast in sane band), clean composition
    (subject fills frame), meaningful edges. Punishes: flat gradients,
    noise, dead matting/background dominance. Contrast is measured AFTER
    the subject crop so a flower on a white museum mount isn't penalized
    for the mount's blankness.
    """
    structure = source_structure_metrics(source_path, min(grid_size, 256))
    bbox = subject_bbox(source_path)
    contrast = structure["source_contrast"]

    # Measure contrast on the cropped subject when a crop exists.
    if bbox is not None:
        from PIL import Image

        img = Image.open(source_path).convert("L")
        img = crop_to_subject(img, bbox)
        img = img.resize((min(grid_size, 256), min(grid_size, 256)), Image.Resampling.BOX)
        arr = np.asarray(img, dtype=np.float32)
        n = arr.shape[0]
        padded = np.pad(arr, 1, mode="edge")
        windows = np.lib.stride_tricks.sliding_window_view(padded, (3, 3))
        contrast = float(windows.var(axis=(2, 3))[1 : n + 1, 1 : n + 1].mean())

    score = 70.0
    notes = []
    # Contrast band calibrated in CYCLE 2: good artwork 150-800. Native pixel
    # art (16-64px sprites) is flat by design — flat colors ARE the medium,
    # so the floor drops with the source's own size.
    src_px = max(source_size(source_path))
    contrast_floor = 60 if src_px >= 256 else 25 if src_px >= 64 else 12
    contrast_ceil = 1200 if src_px >= 256 else 800
    if contrast < contrast_floor:
        score -= 35
        notes.append("flat/low-contrast source")
    elif contrast > contrast_ceil:
        score -= 25
        notes.append("noisy source")
    else:
        score += min(15, contrast / 40)

    if bbox is None:
        score += 8  # subject fills frame
    else:
        area = (bbox["w"] * bbox["h"]) / (source_size(source_path)[0] * source_size(source_path)[1])
        if area < 0.25:
            score -= 20
            notes.append(f"subject only {area:.0%} of frame (dead background)")
        elif area < 0.5:
            score -= 8
            notes.append(f"subject {area:.0%} of frame")

    if structure["edge_ratio"] < 0.02:
        score -= 15
        notes.append("almost no edges at grid resolution")

    return {"score": round(max(0, min(100, score)), 1), "notes": notes, "bbox": bbox,
            "structure": structure, "cropped_contrast": round(contrast, 1)}


def conversion_quality(source_path, template, bbox=None) -> dict:
    """Gate 2: did THIS conversion keep the artwork's structure and palette?"""
    edges = edge_preservation(source_path, template, bbox)
    sep = palette_separation(template["palette"])
    background = background_ratio(template)

    score = 60.0
    notes = []
    score += edges * 30

    # Edge loss matters only when the source actually HAS edges to lose.
    # Diffuse subjects (nebulae, watercolors) have low edge maps by nature;
    # punishing them here would discard exactly the masterpiece tier.
    structure = source_structure_metrics(source_path, min(template["width"], 256))
    source_edges = structure["edge_ratio"]
    if source_edges > 0.08 and edges < 0.20:
        notes.append(f"edges smeared (preservation {edges:.2f})")
        score -= 15
    elif source_edges > 0.08 and edges < 0.35:
        notes.append(f"moderate edge loss ({edges:.2f})")
    elif source_edges <= 0.08:
        # Diffuse source: structure survives if regions are coherent.
        regions = analyze_regions(template["width"], template["height"], template["cells"])
        if regions["tiny_component_ratio"] > 0.25:
            notes.append("fragmented despite diffuse source")
            score -= 10

    if sep["min_lab_distance"] < 12:
        score -= 20
        notes.append("indistinguishable palette colors")
    else:
        score += min(10, sep["min_lab_distance"] / 4)

    # A large dominant region is a FEATURE of good coloring material (the
    # subject's body, a sky, a wall) — not dead space. Only truly degenerate
    # frames (a near-empty mount) are flagged, and those are caught by the
    # richness gate upstream. Note, don't gate.
    if background > 0.9:
        notes.append(f"frame nearly empty ({background:.0%} one region)")

    return {"score": round(max(0, min(100, score)), 1), "notes": notes,
            "edge_preservation": round(edges, 3),
            "min_lab_distance": sep["min_lab_distance"],
            "background_ratio": round(background, 3)}


def game_quality(template, source_path=None) -> dict:
    """Gate 3: is it pleasant to actually color?

    Wraps the existing playability model (region structure, difficulty,
    smart-engine friendliness) and adds palette-appeal (chroma): colors that
    are dull gray-green/beige clusters give little perceptual reward.
    """
    from content_lib import _hex_to_rgb

    play = playability_score(
        template["width"], template["height"], template["palette"], template["cells"],
        source_path=source_path,
    )
    # Palette appeal: mean chroma (max-min of RGB channels). Dull palettes
    # (museum beige/gray) score low; vibrant coloring palettes score high.
    chromas = []
    for hex_color in template["palette"]:
        r, g, b = _hex_to_rgb(hex_color)
        chromas.append(max(r, g, b) - min(r, g, b))
    mean_chroma = float(np.mean(chromas)) if chromas else 0.0
    chroma_score = min(15, mean_chroma / 12)

    # Palette appeal is a NOTE, not a gate: museum art (indigo/cream ukiyo-e)
    # has low chroma yet is excellent coloring material. Punishing it here
    # would filter out exactly the masterpiece tier.
    base = play["score"]
    score = base
    notes = list(play.get("rejection_signals", []))
    if mean_chroma < 25:
        notes.append(f"dull palette (mean chroma {mean_chroma:.0f})")

    return {
        "score": round(score, 1),
        "playability_score": play["score"],
        "difficulty": play["difficulty"],
        "estimated_taps": play["estimated_taps"],
        "chroma": round(mean_chroma, 1),
        "notes": notes,
    }


def source_size(source_path):
    from PIL import Image

    with Image.open(source_path) as im:
        return im.size


# ---------------------------------------------------------------------------
# RESOLUTION SELECTION (artwork family)
# ---------------------------------------------------------------------------

def _subject_size(source_path, bbox):
    """Native pixel size of the subject: bbox, else the source itself."""
    from PIL import Image

    with Image.open(source_path) as im:
        w, h = im.size
    if bbox:
        return max(bbox["w"], bbox["h"])
    return max(w, h)


def select_resolutions(source_path, tier: str = None, *, min_gate: float = 62.0) -> list[dict]:
    """Pick the best ONE or TWO resolutions for a source.

    Tries the FULL grid range (not just the tier's slice) because the best
    resolution for an artwork is content-dependent: a woodblock print with
    fine hatching peaks at 384-512 while a bold poster shines at 1200. The
    tier only biases the starting range; the gates decide.

    Grids are anchored to the subject's native size: a 348px sprite does not
    become a 16px thumbnail (information destroyed) nor a 1200px upscale
    (nothing gained); a 16px tile does not become a 192px stretch.

    Keeps only resolutions that (a) pass the gates and (b) add something
    over the previous smaller size — a bigger grid that just inflates the
    same simple picture is discarded.
    """
    # Full range, tier-biased order: try the tier's sizes first (most likely
    # to be right), then scan outward for surprises.
    tier_grids = TIER_GRIDS.get(tier, TIER_GRIDS["medium"]) if tier else [48, 64, 96, 128, 192]
    rest = [g for g in GRID_SIZES if g not in tier_grids]
    grids = tier_grids + rest

    sq0 = source_quality(source_path, 128)
    bbox0 = sq0.get("bbox")
    subject_px = _subject_size(source_path, bbox0)

    candidates = []
    for grid in grids:
        palette_size = _palette_for(grid)
        sq = source_quality(source_path, grid)
        bbox = sq.get("bbox")
        template = convert_template(source_path, grid, palette_size, crop=bbox)
        cq = conversion_quality(source_path, template, bbox)
        gq = game_quality(template, source_path)
        # Gate = min(Source, Conversion): structure must survive. Game quality
        # informs difficulty/notes but does NOT gate resolution choice — a
        # per10k signal on a 600px print with intact structure is "long
        # session", not "bad artwork".
        gate_score = min(sq["score"], cq["score"])

        # Native-size anchoring: grids far below or above the subject's own
        # pixel size destroy or invent nothing — they cannot be the pick.
        if grid < subject_px * 0.18:
            gate_score = min(gate_score, 45.0)  # crushed thumbnail
        elif grid > subject_px * 1.6 and subject_px < 300:
            gate_score = min(gate_score, 45.0)  # stretched tiny sprite

        # Richness: a big grid must carry real content, not just more cells
        # of the same simple picture. taps_per_10k measures structure density.
        taps_per_10k = gq["estimated_taps"] / (grid * grid) * 10_000
        # Content-aware minimum: below this density the artwork is "just
        # bigger", above it we trust the grid carries real structure.
        # (Relative richness is decided in the family step below; here we
        # only floor out absurdly empty grids.)
        min_density = 25 if grid >= 384 else 15 if grid >= 96 else 10
        rich = taps_per_10k >= min_density
        if not rich:
            gate_score = min(gate_score, 50.0)  # cannot be the family pick
        candidates.append({
            "grid": grid,
            "gate_score": round(gate_score, 1),
            "source_quality": sq["score"],
            "conversion_quality": cq["score"],
            "game_quality": gq["score"],
            "sq_notes": sq["notes"],
            "cq_notes": cq["notes"],
            "gq_notes": gq["notes"],
            "edge_preservation": cq["edge_preservation"],
            "background_ratio": cq["background_ratio"],
            "chroma": gq["chroma"],
            "difficulty": gq["difficulty"],
            "estimated_taps": gq["estimated_taps"],
            "taps_per_10k": round(taps_per_10k, 1),
            "template": template,
            "bbox": bbox,
            "subject_px": subject_px,
        })

    passing = [c for c in candidates if c["gate_score"] >= min_gate]
    if not passing:
        return []
    passing.sort(key=lambda c: (-c["gate_score"], -c["grid"]))
    best = passing[0]
    best_gate = best["gate_score"]
    best_taps10k = best["taps_per_10k"]

    # Family = resolutions whose gate holds within tolerance AND whose
    # structure density doesn't collapse vs the best (a bigger grid that
    # just inflates the same picture loses density — that's "same giraffe,
    # more cells"). Prefer the largest such grid.
    family = [
        c for c in passing
        if c["gate_score"] >= best_gate - 3.0
        and c["taps_per_10k"] >= best_taps10k * 0.35
    ]
    family.sort(key=lambda c: (-c["grid"], -c["gate_score"]))
    primary = family[0] if family else best

    chosen = [primary]
    # Second slot: a smaller quick-win size if it passes comfortably and the
    # primary is big (so players have a session-length choice).
    if primary["grid"] >= 192:
        for c in passing:
            if c["grid"] <= 128 and c["gate_score"] >= min_gate + 2:
                chosen.append(c)
                break
    return chosen


def _palette_for(grid: int) -> int:
    return {
        12: 8, 16: 8, 24: 10, 32: 10, 48: 12, 64: 12, 96: 14, 128: 16,
        192: 18, 256: 20, 384: 24, 512: 28, 600: 28, 800: 32, 1024: 32, 1200: 36,
    }[grid]

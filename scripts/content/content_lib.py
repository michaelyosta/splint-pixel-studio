"""Splint Content Factory — core library.

Headless content acquisition, licensing, conversion and playability
scoring for Splint Pixel Studio coloring templates.

Design principles
-----------------
* Reuses the production conversion algorithm (server/scripts/build-catalog-assets.py)
  and ports the small-region cleanup from src/lib/pixelColoring.js so derived
  templates match what Splint actually renders.
* Production behavior is NOT modified: this package is a separate content
  factory that produces templates in the same JSON shape.
* Strict provenance: every derived asset links DERIVED -> SOURCE -> LICENSE.
"""

from __future__ import annotations

import hashlib
import io
import json
import re
import time
import urllib.parse
import urllib.request
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

# ---------------------------------------------------------------------------
# License taxonomy
# ---------------------------------------------------------------------------

LICENSE_VERDICTS = {
    "APPROVED_CC0",
    "APPROVED_PUBLIC_DOMAIN",
    "APPROVED_CUSTOM_LICENSE",
    "APPROVED_CC_BY",
    "REVIEW_REQUIRED",
    "REJECTED",
}

# Production-ready pool: CC0 and Public Domain only.
# CC-BY requires a real attribution system inside Splint (credits UI, license
# screen). Until that exists, CC-BY assets stay in the review pool.
PRODUCTION_READY_VERDICTS = {"APPROVED_CC0", "APPROVED_PUBLIC_DOMAIN"}

LICENSE_METADATA = {
    "CC0": {
        "full_name": "CC0 1.0 Universal",
        "url": "https://creativecommons.org/publicdomain/zero/1.0/",
        "commercial_use": True,
        "derivative_use": True,
        "redistribution": True,
        "attribution_required": False,
        "verdict": "APPROVED_CC0",
    },
    "CC_BY_4.0": {
        "full_name": "Creative Commons Attribution 4.0 International",
        "url": "https://creativecommons.org/licenses/by/4.0/",
        "commercial_use": True,
        "derivative_use": True,
        "redistribution": True,
        "attribution_required": True,
        "verdict": "APPROVED_CC_BY",
    },
    "CC_BY_3.0": {
        "full_name": "Creative Commons Attribution 3.0 Unported",
        "url": "https://creativecommons.org/licenses/by/3.0/",
        "commercial_use": True,
        "derivative_use": True,
        "redistribution": True,
        "attribution_required": True,
        "verdict": "APPROVED_CC_BY",
    },
    "CC_BY_SA": {
        "full_name": "Creative Commons Attribution-ShareAlike",
        "url": "https://creativecommons.org/licenses/by-sa/4.0/",
        "commercial_use": True,
        "derivative_use": True,
        "redistribution": True,
        "attribution_required": True,
        "verdict": "REVIEW_REQUIRED",  # share-alike contaminates derived catalog
    },
    "CC_BY_NC": {
        "full_name": "Creative Commons Attribution-NonCommercial",
        "url": "https://creativecommons.org/licenses/by-nc/4.0/",
        "commercial_use": False,
        "derivative_use": True,
        "redistribution": True,
        "attribution_required": True,
        "verdict": "REJECTED",
    },
    "OGA_BY": {
        "full_name": "OpenGameArt.org Attribution license",
        "url": "https://opengameart.org/content/oga-by-3-0",
        "commercial_use": True,
        "derivative_use": True,
        "redistribution": True,
        "attribution_required": True,
        "verdict": "APPROVED_CC_BY",
    },
    "PUBLIC_DOMAIN": {
        "full_name": "Public Domain",
        "url": None,
        "commercial_use": True,
        "derivative_use": True,
        "redistribution": True,
        "attribution_required": False,
        "verdict": "APPROVED_PUBLIC_DOMAIN",
    },
}

# ---------------------------------------------------------------------------
# Pipeline stages
# ---------------------------------------------------------------------------

STAGES = (
    "DISCOVERED",
    "DOWNLOADED",
    "LICENSE_VERIFIED",
    "CONVERTED",
    "QUALITY_REVIEW",
    "APPROVED",
    "REJECTED",
)

DIFFICULTY_TIERS = ("VERY_EASY", "EASY", "NORMAL", "HARD", "EXPERT", "MASTERPIECE")

CONTENT_ROLES = (
    "FTUE",
    "QUICK_WIN",
    "MAIN_PATH",
    "COLLECTION_FILLER",
    "HERO",
    "CHALLENGE",
    "RELAXING",
    "MASTERY",
    "MASTERPIECE",
)

PIPELINE_VERSION = "1.0.0"

GRID_TIERS = {
    "small": [12, 16, 24, 32],
    "medium": [48, 64, 96, 128, 192],
    "large": [256, 384, 512, 600],
    "masterpiece": [800, 1024, 1200],
}

# ---------------------------------------------------------------------------
# Downloader (untrusted input handling)
# ---------------------------------------------------------------------------

MAX_DOWNLOAD_BYTES = 50 * 1024 * 1024  # 50 MB hard cap
MAX_IMAGE_PIXELS = 60_000_000  # decompression-bomb guard (PIL default is 89M)
ALLOWED_CONTENT_TYPES = {
    "image/png",
    "image/jpeg",
    "image/jpg",
    "image/webp",
    "image/gif",
    "image/bmp",
    "image/tiff",
    "application/octet-stream",  # some asset hosts serve PNGs as octet-stream
}

_REQUEST_HEADERS = {
    "User-Agent": "SplintContentFactory/1.0 (content acquisition; contact: splint-pixel-studio)",
    "Accept": "image/*,application/octet-stream",
}


class DownloadError(Exception):
    pass


class ImageValidationError(Exception):
    pass


def safe_filename(name: str, fallback: str = "asset") -> str:
    """Sanitize a filename: keep [a-z0-9._-], collapse separators."""
    cleaned = re.sub(r"[^A-Za-z0-9._-]+", "-", name).strip(".-")
    cleaned = re.sub(r"-{2,}", "-", cleaned)
    return cleaned[:120] or fallback


def sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def download_file(url: str, dest_dir: Path, max_bytes: int = MAX_DOWNLOAD_BYTES, timeout: int = 60) -> dict:
    """Download `url` into `dest_dir` with security checks.

    Returns provenance dict: {filename, path, bytes, sha256, content_type, final_url, fetched_at}.
    Raises DownloadError on size/type/transport failure.
    """
    dest_dir.mkdir(parents=True, exist_ok=True)
    request = urllib.request.Request(url, headers=_REQUEST_HEADERS)
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            final_url = response.geturl()
            content_type = response.headers.get("Content-Type", "").split(";")[0].strip().lower()
            content_length = response.headers.get("Content-Length")
            if content_length and int(content_length) > max_bytes:
                raise DownloadError(f"content-length {content_length} exceeds limit {max_bytes}")
            data = response.read(max_bytes + 1)
    except urllib.error.HTTPError as exc:
        raise DownloadError(f"HTTP {exc.code} for {url}") from exc
    except urllib.error.URLError as exc:
        raise DownloadError(f"URL error for {url}: {exc.reason}") from exc
    except TimeoutError as exc:
        raise DownloadError(f"timeout for {url}") from exc

    if len(data) > max_bytes:
        raise DownloadError(f"downloaded {len(data)} bytes exceeds limit {max_bytes}")

    # Guess extension from URL when content type is not actionable.
    ext = {"image/png": ".png", "image/jpeg": ".jpg", "image/webp": ".webp", "image/gif": ".gif", "image/bmp": ".bmp", "image/tiff": ".tif"}.get(
        content_type
    )
    if ext is None:
        ext = Path(urllib.parse.urlparse(final_url).path).suffix.lower() or ".bin"
        if ext not in {".png", ".jpg", ".jpeg", ".webp", ".gif", ".bmp", ".tif", ".tiff"}:
            ext = ".bin"

    name = safe_filename(Path(urllib.parse.urlparse(url).path).name)
    if not name or name == ".bin":
        name = f"asset{ext}"
    elif not name.endswith(ext) and ext != ".bin":
        name = f"{name}{ext}"

    dest = dest_dir / name
    dest.write_bytes(data)
    return {
        "filename": name,
        "path": str(dest),
        "bytes": len(data),
        "sha256": sha256_bytes(data),
        "content_type": content_type,
        "final_url": final_url,
        "fetched_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
    }


def validate_image_file(path: Path, max_pixels: int = MAX_IMAGE_PIXELS) -> dict:
    """Open an image, verify it is a real raster, return dimensions/mode.

    Raises ImageValidationError for malformed files, decompression bombs or
    unusable modes. Never executes any downloaded content.
    """
    try:
        from PIL import Image

        with Image.open(path) as im:
            im.load()
            width, height = im.size
            if width * height > max_pixels:
                raise ImageValidationError(
                    f"image {width}x{height} exceeds {max_pixels} pixels (decompression bomb guard)"
                )
            if im.mode not in ("RGB", "RGBA", "L", "P"):
                raise ImageValidationError(f"unsupported image mode {im.mode}")
            if width < 12 or height < 12:
                raise ImageValidationError(f"image too small: {width}x{height}")
            return {"width": width, "height": height, "mode": im.mode, "format": im.format}
    except ImageValidationError:
        raise
    except Exception as exc:  # noqa: BLE001 - PIL raises many exception types
        raise ImageValidationError(f"cannot decode image: {exc}") from exc


# ---------------------------------------------------------------------------
# Conversion (production parity + cleanup)
# ---------------------------------------------------------------------------

def convert_template(
    source_path: Path,
    grid_size: int,
    palette_size: int,
    *,
    crop: dict | None = None,
    enhance: float = 1.08,
    cleanup: bool = True,
) -> dict:
    """Convert a source image into a Splint template.

    Mirrors server/scripts/build-catalog-assets.py (enhance -> BOX resize ->
    MAXCOVERAGE quantize, palette ordered by luminance) and optionally applies
    the small-region cleanup ported from src/lib/pixelColoring.js.

    Returns {width, height, palette, cells, preview_bytes...} where cells is a
    list of palette indices. Deterministic for the same input.
    """
    from PIL import Image, ImageEnhance, ImageFilter

    if grid_size not in [12, 16, 24, 32, 48, 64, 96, 128, 192, 256, 384, 512, 600, 800, 1024, 1200]:
        raise ValueError(f"unsupported grid size {grid_size}")

    source = Image.open(source_path).convert("RGB")
    if crop:
        source = apply_crop(source, crop)

    # Large/masterpiece grids need texture suppression (paper grain, brush
    # strokes) before downscale; plain BOX resize would bake the noise into
    # thousands of micro-regions. Median filter removes speckle while keeping
    # edges — the flat color regions ukiyo-e/posters are famous for survive.
    if grid_size >= 384:
        source = source.filter(ImageFilter.MedianFilter(size=3))

    source = ImageEnhance.Color(source).enhance(enhance)
    source = ImageEnhance.Contrast(source).enhance(enhance)
    pixel = source.resize((grid_size, grid_size), Image.Resampling.BOX)

    quantized = pixel.quantize(colors=palette_size, method=Image.Quantize.MAXCOVERAGE, dither=Image.Dither.NONE)
    raw_palette = quantized.getpalette()[: palette_size * 3]
    palette = [tuple(raw_palette[i : i + 3]) for i in range(0, len(raw_palette), 3)]
    order = sorted(range(len(palette)), key=lambda i: sum(palette[i]))
    remap = {old: new for new, old in enumerate(order)}
    ordered_palette = [palette[i] for i in order]
    cells = [remap[value] for value in quantized.get_flattened_data()]

    if cleanup:
        cells, ordered_palette = _cleanup_regions(cells, grid_size, grid_size, ordered_palette)
        cells, ordered_palette = _merge_close_palette_colors(cells, ordered_palette)

    return {
        "width": grid_size,
        "height": grid_size,
        "palette": [f"#{r:02x}{g:02x}{b:02x}" for r, g, b in ordered_palette],
        "cells": cells,
    }


def _merge_close_palette_colors(cells, palette, min_lab_distance: float = 12.0):
    """Merge palette colors that are visually indistinguishable (LAB < threshold).

    MAXCOVERAGE quantization can produce near-duplicate shades (e.g. two
    grays at LAB distance 7) — for a coloring game those are two colors the
    player cannot tell apart. Repeatedly merge the closest pair until all
    remaining colors are separated by at least `min_lab_distance` or the
    palette is exhausted.
    """
    result = list(cells)
    palette = [list(color) for color in palette]
    palette_lab = [_rgb_to_lab(tuple(color)) for color in palette]

    def min_pair():
        best = (float("inf"), None, None)
        for i in range(len(palette_lab)):
            for j in range(i + 1, len(palette_lab)):
                dist = _lab_distance(palette_lab[i], palette_lab[j])
                if dist < best[0]:
                    best = (dist, i, j)
        return best

    while len(palette) > 2:
        dist, i, j = min_pair()
        if dist >= min_lab_distance:
            break
        # Merge j into i: recolor cells, drop j.
        for index, color in enumerate(result):
            if color == j:
                result[index] = i
            elif color > j:
                result[index] = color - 1
        del palette[j]
        del palette_lab[j]

    return result, [tuple(color) for color in palette]


def apply_crop(image, crop: dict):
    """Apply a crop in the shape of imageCrop.js: {scale, offsetX, offsetY}."""
    from PIL import Image

    width, height = image.size
    scale = max(1.0, float(crop.get("scale", 1.0)))
    crop_size = int(min(width, height) / scale)
    cx = int(width / 2 + float(crop.get("offsetX", 0.0)))
    cy = int(height / 2 + float(crop.get("offsetY", 0.0)))
    sx = max(0, min(width - crop_size, cx - crop_size // 2))
    sy = max(0, min(height - crop_size, cy - crop_size // 2))
    return image.crop((sx, sy, sx + crop_size, sy + crop_size))


def _rgb_to_lab(rgb):
    r, g, b = [channel / 255.0 for channel in rgb]
    linear = [
        value / 12.92 if value <= 0.04045 else ((value + 0.055) / 1.055) ** 2.4 for value in (r, g, b)
    ]
    x = (linear[0] * 0.4124 + linear[1] * 0.3576 + linear[2] * 0.1805) / 0.95047
    y = linear[0] * 0.2126 + linear[1] * 0.7152 + linear[2] * 0.0722
    z = (linear[0] * 0.0193 + linear[1] * 0.1192 + linear[2] * 0.9505) / 1.08883
    pivot = lambda value: value ** (1 / 3) if value > 0.008856 else 7.787 * value + 16 / 116
    fx, fy, fz = pivot(x), pivot(y), pivot(z)
    return (116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz))


def _lab_distance(a, b):
    return sum((x - y) ** 2 for x, y in zip(a, b)) ** 0.5


def _cleanup_regions(cells, width, height, palette):
    """Port of pixelColoring.js cleanUpSmallRegions + smoothCells.

    Two passes of connected-component analysis; regions smaller than
    total/500 that are not high-contrast (LAB distance < 28) get merged
    into their most favorable boundary neighbor.
    """
    total = width * height
    min_region_size = max(1, total // 500)
    palette_lab = [_rgb_to_lab(rgb) for rgb in palette]
    result = list(cells)

    for _pass in range(2):
        visited = [False] * total
        replacements = []
        for start in range(total):
            if visited[start]:
                continue
            color = result[start]
            component = []
            boundary = {}
            stack = [start]
            visited[start] = True
            while stack:
                index = stack.pop()
                component.append(index)
                x, y = index % width, index // width
                for nx, ny in ((x - 1, y), (x + 1, y), (x, y - 1), (x, y + 1)):
                    if nx < 0 or nx >= width or ny < 0 or ny >= height:
                        continue
                    neighbour = ny * width + nx
                    neighbour_color = result[neighbour]
                    if neighbour_color == color:
                        if not visited[neighbour]:
                            visited[neighbour] = True
                            stack.append(neighbour)
                    else:
                        boundary[neighbour_color] = boundary.get(neighbour_color, 0) + 1
            if len(component) > min_region_size or not boundary:
                continue
            nearest_distance = min(
                (_lab_distance(palette_lab[color], palette_lab[candidate]) for candidate in boundary),
                default=float("inf"),
            )
            if nearest_distance >= 28:
                continue  # high-contrast tiny regions are intentional features
            replacement, best = color, float("-inf")
            for candidate, shared_edges in boundary.items():
                score = shared_edges * 18 - _lab_distance(palette_lab[color], palette_lab[candidate])
                if score > best:
                    best, replacement = score, candidate
            if replacement != color:
                replacements.append((component, replacement))
        if not replacements:
            break
        for component, replacement in replacements:
            for index in component:
                result[index] = replacement

    return result, palette


# ---------------------------------------------------------------------------
# Playability scoring
# ---------------------------------------------------------------------------

def analyze_regions(width: int, height: int, cells: list[int]) -> dict:
    """Connected-component analysis of the template grid (4-connectivity).

    Returns region statistics used by the playability model:
    component_count, singleton_count/ratio, tiny (2-3) ratios,
    largest_region_ratio, median_region_size, per-color fragmentation.
    """
    import numpy as np
    from scipy import ndimage

    grid = np.asarray(cells, dtype=np.int32).reshape(height, width)
    color_count = int(grid.max()) + 1
    total = width * height

    labeled = np.zeros_like(grid, dtype=np.int32)
    next_label = 1
    for color in range(color_count):
        mask = grid == color
        if not mask.any():
            continue
        structure = np.array([[0, 1, 0], [1, 1, 1], [0, 1, 0]], dtype=np.uint8)
        labels, count = ndimage.label(mask, structure=structure)
        labels[labels > 0] += next_label - 1
        next_label += count
        labeled[mask] = labels[mask]

    region_sizes = np.bincount(labeled.ravel())[1:]  # drop background 0
    if region_sizes.size == 0:
        region_sizes = np.array([total], dtype=np.int64)

    singletons = int((region_sizes == 1).sum())
    tiny = int(((region_sizes >= 2) & (region_sizes <= 3)).sum())
    small = int(region_sizes[region_sizes <= 3].sum())
    components = int(region_sizes.size)
    largest = int(region_sizes.max()) if components else total
    median = int(np.median(region_sizes)) if components else total

    per_color = {}
    for color in range(color_count):
        per_color[str(color)] = int((grid == color).sum())

    return {
        "component_count": components,
        "component_count_per_10k": round(components / total * 10_000, 2),
        "singleton_count": singletons,
        "singleton_ratio": round(singletons / total, 5),
        "tiny_component_count": tiny,
        "tiny_component_ratio": round(tiny / components, 5) if components else 0.0,
        "small_region_cell_ratio": round(small / total, 5),
        "largest_region_ratio": round(largest / total, 5),
        "median_region_size": median,
        "region_fragmentation": round(components / total, 5),
    }


def palette_separation(palette_hex: list[str]) -> dict:
    """Minimum pairwise LAB distance across the palette (color distinguishability)."""
    labs = [_rgb_to_lab(_hex_to_rgb(hex_color)) for hex_color in palette_hex]
    min_distance = float("inf")
    for i in range(len(labs)):
        for j in range(i + 1, len(labs)):
            min_distance = min(min_distance, _lab_distance(labs[i], labs[j]))
    return {
        "min_lab_distance": round(min_distance, 2) if labs else 0.0,
        "palette_size": len(palette_hex),
    }


def _hex_to_rgb(hex_color: str) -> tuple:
    hex_color = hex_color.lstrip("#")
    return tuple(int(hex_color[i : i + 2], 16) for i in (0, 2, 4))


def source_structure_metrics(source_path, grid_size: int) -> dict:
    """Measure the SOURCE image's suitability.

    * source_contrast: mean local (3x3) luminance variance measured at full
      resolution (thumbnail 256px) — flat sources (gradients) score ~0,
      pure noise scores >1500, recognisable artwork sits in 100..800.
    * grid_contrast: same metric at grid resolution (BOX-averaged).
    * edge_ratio: fraction of grid cells with a strong luminance edge.
    Calibrated in CYCLE 2 against production assets (157-360 full contrast)
    and synthetic noise (2155) / gradient (0.7).
    """
    from PIL import Image

    import numpy as np

    def _local_variance(arr: np.ndarray) -> float:
        n = arr.shape[0]
        padded = np.pad(arr, 1, mode="edge")
        windows = np.lib.stride_tricks.sliding_window_view(padded, (3, 3))
        local_var = windows.var(axis=(2, 3))
        return float(local_var[1 : n + 1, 1 : n + 1].mean())

    img = Image.open(source_path).convert("L")
    full = img.copy()
    full.thumbnail((256, 256))
    full_arr = np.asarray(full, dtype=np.float32)
    full_contrast = _local_variance(full_arr)

    grid = img.resize((grid_size, grid_size), Image.Resampling.BOX)
    grid_arr = np.asarray(grid, dtype=np.float32)
    grid_contrast = _local_variance(grid_arr)

    edges_y = np.abs(np.diff(grid_arr, axis=0)) > 24  # shape (n-1, n)
    edges_x = np.abs(np.diff(grid_arr, axis=1)) > 24  # shape (n, n-1)
    edges = edges_y[:, :-1] | edges_x[:-1, :]  # both (n-1, n-1)
    edge_ratio = float(edges.mean())

    return {
        "source_contrast": round(full_contrast, 2),
        "grid_contrast": round(grid_contrast, 2),
        "edge_ratio": round(edge_ratio, 4),
    }


def _grid_tier(width: int, height: int) -> str:
    total = width * height
    if total <= 32 * 32:
        return "small"
    if total <= 192 * 192:
        return "medium"
    if total <= 512 * 512:
        return "large"
    return "masterpiece"


# Experimentally calibrated in CYCLE 2 against 6 production templates
# (known good, full-resolution contrast 157-360), synthetic bad samples
# (gradient: ~0.7, noise: ~2155) and 9 museum artworks (Cleveland CC0,
# good = per10k 30-250, tiny 0.15-0.25).
TIER_LIMITS = {
    "small": {"singleton": 0.10, "tiny": 0.32, "per10k": 2000, "contrast_min": 60.0, "contrast_max": 1200.0},
    "medium": {"singleton": 0.07, "tiny": 0.28, "per10k": 900, "contrast_min": 60.0, "contrast_max": 1200.0},
    "large": {"singleton": 0.05, "tiny": 0.26, "per10k": 350, "contrast_min": 60.0, "contrast_max": 1200.0},
    "masterpiece": {"singleton": 0.04, "tiny": 0.25, "per10k": 260, "contrast_min": 60.0, "contrast_max": 1200.0},
}


def playability_score(
    width: int,
    height: int,
    palette: list[str],
    cells: list[int],
    *,
    smart_engine: bool = True,
    source_path=None,
) -> dict:
    """Composite playability score (0..100) with difficulty estimate.

    Signals:
    * region structure (singletons, tiny regions, fragmentation) — tier-relative
    * palette separation (min pairwise LAB distance)
    * color efficiency (used colors / palette)
    * source structure: flat or noisy sources are rejected (needs source_path)
    * estimated taps (component_count) and density
    * smart-engine friendliness (dense actionable targets, no micro-islands)
    """
    regions = analyze_regions(width, height, cells)
    palette_info = palette_separation(palette)
    total = width * height
    tier = _grid_tier(width, height)
    limits = TIER_LIMITS[tier]

    color_used = len(set(cells))
    color_efficiency = color_used / len(palette) if palette else 0.0

    # --- sub-scores (each 0..1) -------------------------------------------------
    singleton_penalty = min(1.0, regions["singleton_ratio"] / limits["singleton"])
    tiny_penalty = min(1.0, regions["tiny_component_ratio"] / limits["tiny"])
    fragmentation_penalty = min(1.0, regions["component_count_per_10k"] / limits["per10k"])
    dead_area_penalty = min(1.0, max(0.0, regions["largest_region_ratio"] - 0.45) * 2.5)
    separation_penalty = 1.0 if palette_info["min_lab_distance"] < 12 else max(0.0, (24 - palette_info["min_lab_distance"]) / 24)
    efficiency_penalty = 0.0 if color_efficiency >= 0.5 else 0.5 * (0.5 - color_efficiency) * 2

    # Source structure: flat (gradient) and noisy sources are not playable.
    source_penalty = 0.0
    if source_path is not None:
        try:
            structure = source_structure_metrics(source_path, min(width, height))
            contrast = structure["source_contrast"]
            if contrast < limits["contrast_min"]:
                source_penalty = max(source_penalty, 0.75 * (1.0 - contrast / limits["contrast_min"]))
            if contrast > limits["contrast_max"]:
                source_penalty = max(source_penalty, 0.75 * min(1.0, (contrast - limits["contrast_max"]) / limits["contrast_max"]))
        except Exception:  # noqa: BLE001 - metric is advisory
            pass

    taps_per_10k = regions["component_count"] / total * 10_000
    cost_ok = taps_per_10k < limits["per10k"]
    cost_penalty = 0.0 if cost_ok else min(1.0, (taps_per_10k - limits["per10k"]) / limits["per10k"])

    structure_score = 1.0 - max(singleton_penalty, tiny_penalty, fragmentation_penalty * 0.7, dead_area_penalty * 0.5)
    palette_score = 1.0 - separation_penalty
    efficiency_score = 1.0 - efficiency_penalty
    gameplay_score = 1.0 - cost_penalty
    source_score = 1.0 - source_penalty

    if smart_engine:
        smart_penalty = min(1.0, fragmentation_penalty * 1.2)
        gameplay_score *= 1.0 - 0.25 * smart_penalty

    raw = (
        structure_score * 0.3
        + palette_score * 0.15
        + efficiency_score * 0.1
        + gameplay_score * 0.25
        + source_score * 0.2
    ) * 100
    # Hard cap: a source that is flat or noisy at full resolution cannot be a
    # good coloring template, regardless of how clean the grid regions look.
    if source_penalty >= 0.5:
        raw = min(raw, 45.0)
    score = round(max(0.0, min(100.0, raw)), 1)

    difficulty = estimate_difficulty(width, height, regions, palette_info, color_efficiency, source_penalty)

    return {
        "score": score,
        "difficulty": difficulty,
        "regions": regions,
        "palette": palette_info,
        "color_efficiency": round(color_efficiency, 3),
        "estimated_taps": regions["component_count"],
        "smart_engine_friendly": bool(score >= 60 and regions["tiny_component_ratio"] < 0.25),
        "rejection_signals": _rejection_signals(width, height, regions, palette_info, source_penalty),
    }


def _rejection_signals(width, height, regions, palette_info, source_penalty=0.0) -> list[str]:
    signals = []
    tier = _grid_tier(width, height)
    limits = TIER_LIMITS[tier]
    if regions["singleton_ratio"] > limits["singleton"]:
        signals.append(f"singleton_ratio {regions['singleton_ratio']:.4f} > {limits['singleton']}")
    if regions["tiny_component_ratio"] > limits["tiny"]:
        signals.append(f"tiny_component_ratio {regions['tiny_component_ratio']:.3f} > {limits['tiny']}")
    if palette_info["min_lab_distance"] < 12:
        signals.append(f"palette min LAB distance {palette_info['min_lab_distance']:.1f} < 12 (indistinguishable colors)")
    per_10k = regions["component_count_per_10k"]
    if per_10k > limits["per10k"]:
        signals.append(f"component_count_per_10k {per_10k:.1f} > {limits['per10k']}")
    if source_penalty > 0.2:
        signals.append("source structure poor (flat or noisy at grid resolution)")
    return signals


def estimate_difficulty(width, height, regions, palette_info, color_efficiency, source_penalty=0.0) -> str:
    """Difficulty is NOT derived from cell count alone.

    Combines grid scale, region fragmentation, palette separation and
    source structure. Thresholds calibrated in CYCLE 2 against production
    templates (known-good difficulty labels) and synthetic bad samples.
    """
    total = width * height
    per_10k = regions["component_count_per_10k"]
    tiny = regions["tiny_component_ratio"]
    if source_penalty > 0.4:
        return "NORMAL"  # bad source: confusing but not necessarily hard

    if total <= 32 * 32:
        if per_10k < 900 and tiny < 0.22:
            return "VERY_EASY"
        if per_10k < 1400:
            return "EASY"
        return "NORMAL"
    if total <= 64 * 64:
        if per_10k < 600 and tiny < 0.2:
            return "EASY"
        return "NORMAL"
    if total <= 192 * 192:
        if per_10k < 350:
            return "NORMAL"
        return "HARD"
    if total <= 512 * 512:
        if per_10k < 120:
            return "HARD"
        return "EXPERT"
    if per_10k < 80 and tiny < 0.2:
        return "MASTERPIECE"
    return "EXPERT"


# ---------------------------------------------------------------------------
# Provenance / manifest helpers
# ---------------------------------------------------------------------------

def now_utc() -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())


SOURCE_REQUIRED_FIELDS = (
    "source_asset_id",
    "source_title",
    "source_creator",
    "source_institution",
    "source_url",
    "download_url",
    "license_type",
    "license_url",
    "accessed_at",
    "public_domain_status",
    "attribution_required",
    "commercial_use",
    "derivative_use",
    "redistribution_constraints",
    "license_verdict",
)

DERIVED_REQUIRED_FIELDS = (
    "derived_asset_id",
    "source_asset_id",
    "grid_width",
    "grid_height",
    "palette_size",
    "state",
)


def validate_source_record(record: dict) -> list[str]:
    """Return a list of schema violations for a source manifest record."""
    errors = []
    for field in SOURCE_REQUIRED_FIELDS:
        if field not in record or record[field] in (None, ""):
            errors.append(f"missing required field: {field}")
    verdict = record.get("license_verdict")
    if verdict is not None and verdict not in LICENSE_VERDICTS:
        errors.append(f"invalid license_verdict: {verdict}")
    state = record.get("state")
    if state is not None and state not in STAGES:
        errors.append(f"invalid state: {state}")
    if record.get("download_url"):
        parsed = urllib.parse.urlparse(record["download_url"])
        if parsed.scheme not in ("http", "https"):
            errors.append(f"bad download_url scheme: {parsed.scheme}")
    return errors


def validate_derived_record(record: dict) -> list[str]:
    errors = []
    for field in DERIVED_REQUIRED_FIELDS:
        if field not in record or record[field] in (None, ""):
            errors.append(f"missing required field: {field}")
    state = record.get("state")
    if state is not None and state not in STAGES:
        errors.append(f"invalid state: {state}")
    if record.get("state") == "APPROVED":
        template = record.get("template")
        if not template:
            errors.append("approved asset lacks template")
        elif not template.get("palette") or not template.get("cells"):
            errors.append("approved asset template lacks palette/cells")
    return errors


def load_jsonl(path) -> list[dict]:
    path = Path(path)
    if not path.exists():
        return []
    with open(path, encoding="utf-8") as handle:
        return [json.loads(line) for line in handle if line.strip()]


def save_jsonl(path, records: list[dict]) -> None:
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w", encoding="utf-8") as handle:
        for record in records:
            handle.write(json.dumps(record, ensure_ascii=False) + "\n")

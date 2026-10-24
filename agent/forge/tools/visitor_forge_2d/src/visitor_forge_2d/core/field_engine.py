"""A7 Field Engine V1.

Deterministic scalar/directional fields for structured 2D authoring.
Fields are ordinary Pillow images so they can be inspected, cached and wired
through graph recipes without hidden renderer state.
"""
from __future__ import annotations

import math
from typing import Sequence

from PIL import Image, ImageFilter

FIELD_ENGINE_CONTRACT = "A7_FIELD_ENGINE_V1"


def _clamp01(value: float) -> float:
    return max(0.0, min(1.0, float(value)))


def sample_scalar(field: Image.Image | None, x: float, y: float, default: float = 0.0) -> float:
    if field is None:
        return float(default)
    image = field if field.mode == "L" else field.convert("L")
    ix = max(0, min(image.width - 1, round(float(x))))
    iy = max(0, min(image.height - 1, round(float(y))))
    return image.getpixel((ix, iy)) / 255.0


def sample_direction_deg(field: Image.Image | None, x: float, y: float, default: float = 0.0) -> float:
    return (sample_scalar(field, x, y, default / 360.0) * 360.0) % 360.0


def radial_density(size: Sequence[int], lobes: Sequence[dict], *, power: float = 1.5) -> Image.Image:
    """Build a union of soft elliptical density lobes in [0,255]."""
    width, height = int(size[0]), int(size[1])
    if width <= 0 or height <= 0:
        raise ValueError("field size must be positive")
    if not lobes:
        raise ValueError("radial_density requires at least one lobe")
    exponent = max(0.05, float(power))
    out = Image.new("L", (width, height), 0)
    pixels = out.load()
    normalized = []
    for lobe in lobes:
        center, radius = lobe.get("center"), lobe.get("radius")
        if not isinstance(center, Sequence) or len(center) != 2 or not isinstance(radius, Sequence) or len(radius) != 2:
            raise ValueError("density lobe needs center[x,y] and radius[rx,ry]")
        rx, ry = float(radius[0]), float(radius[1])
        if rx <= 0 or ry <= 0:
            raise ValueError("density lobe radii must be positive")
        normalized.append((float(center[0]), float(center[1]), rx, ry, _clamp01(lobe.get("weight", 1.0))))
    for y in range(height):
        for x in range(width):
            value = 0.0
            for cx, cy, rx, ry, weight in normalized:
                d = math.hypot((x - cx) / rx, (y - cy) / ry)
                if d < 1.0:
                    local = ((1.0 - d) ** exponent) * weight
                    value = max(value, local)
            pixels[x, y] = round(_clamp01(value) * 255)
    return out


def linear_depth(size: Sequence[int], start: Sequence[float], end: Sequence[float]) -> Image.Image:
    """Project pixels onto a start->end axis and normalize to [0,255]."""
    width, height = int(size[0]), int(size[1])
    sx, sy = float(start[0]), float(start[1])
    ex, ey = float(end[0]), float(end[1])
    dx, dy = ex - sx, ey - sy
    denom = dx * dx + dy * dy
    if denom <= 1e-9:
        raise ValueError("linear_depth start and end must differ")
    out = Image.new("L", (width, height), 0)
    pixels = out.load()
    for y in range(height):
        for x in range(width):
            t = ((x - sx) * dx + (y - sy) * dy) / denom
            pixels[x, y] = round(_clamp01(t) * 255)
    return out


def direction_to_point(size: Sequence[int], point: Sequence[float], *, offset_deg: float = 0.0) -> Image.Image:
    """Encode a per-pixel direction-to-target as angle/360 in an L image."""
    width, height = int(size[0]), int(size[1])
    tx, ty = float(point[0]), float(point[1])
    out = Image.new("L", (width, height), 0)
    pixels = out.load()
    for y in range(height):
        for x in range(width):
            angle = (math.degrees(math.atan2(ty - y, tx - x)) + float(offset_deg)) % 360.0
            pixels[x, y] = round(angle / 360.0 * 255)
    return out


def mask_from_alpha(source: Image.Image, *, threshold: int = 1, blur_radius: float = 0.0,
                    expand_px: int = 0, invert: bool = False) -> Image.Image:
    """Turn alpha into a reusable scalar mask with optional dilation and blur."""
    alpha = source.getchannel("A") if source.mode == "RGBA" else source.convert("L")
    threshold = max(0, min(255, int(threshold)))
    mask = alpha.point(lambda px: 255 if px >= threshold else 0)
    expand = max(0, int(expand_px))
    if expand:
        # Pillow MaxFilter requires an odd kernel.
        size = expand * 2 + 1
        mask = mask.filter(ImageFilter.MaxFilter(size))
    if float(blur_radius) > 0.0:
        mask = mask.filter(ImageFilter.GaussianBlur(float(blur_radius)))
    if invert:
        mask = mask.point(lambda px: 255 - px)
    return mask


def distance_to_mask(mask: Image.Image, *, max_distance: float = 32.0, threshold: int = 128,
                     proximity: bool = True) -> Image.Image:
    """Approximate Euclidean distance to non-zero mask pixels via a chamfer pass.

    When proximity=True the result is 1 at the mask and falls to 0 at
    max_distance. Otherwise it increases from 0 to 1 with distance.
    """
    src = mask if mask.mode == "L" else mask.convert("L")
    width, height = src.size
    limit = max(0.001, float(max_distance))
    inf = limit + width + height + 8.0
    dist = [[0.0 if src.getpixel((x, y)) >= int(threshold) else inf for x in range(width)] for y in range(height)]
    diag = math.sqrt(2.0)
    for y in range(height):
        for x in range(width):
            best = dist[y][x]
            if x > 0: best = min(best, dist[y][x - 1] + 1.0)
            if y > 0: best = min(best, dist[y - 1][x] + 1.0)
            if x > 0 and y > 0: best = min(best, dist[y - 1][x - 1] + diag)
            if x + 1 < width and y > 0: best = min(best, dist[y - 1][x + 1] + diag)
            dist[y][x] = best
    for y in range(height - 1, -1, -1):
        for x in range(width - 1, -1, -1):
            best = dist[y][x]
            if x + 1 < width: best = min(best, dist[y][x + 1] + 1.0)
            if y + 1 < height: best = min(best, dist[y + 1][x] + 1.0)
            if x + 1 < width and y + 1 < height: best = min(best, dist[y + 1][x + 1] + diag)
            if x > 0 and y + 1 < height: best = min(best, dist[y + 1][x - 1] + diag)
            dist[y][x] = best
    out = Image.new("L", (width, height), 0)
    pixels = out.load()
    for y in range(height):
        for x in range(width):
            normalized = _clamp01(dist[y][x] / limit)
            value = 1.0 - normalized if proximity else normalized
            pixels[x, y] = round(value * 255)
    return out


def multiply_fields(*fields: Image.Image) -> Image.Image:
    if not fields:
        raise ValueError("multiply_fields requires at least one field")
    size = fields[0].size
    converted = [field if field.mode == "L" else field.convert("L") for field in fields]
    if any(field.size != size for field in converted):
        raise ValueError("field sizes must match")
    out = Image.new("L", size, 0)
    pixels = out.load()
    sources = [field.load() for field in converted]
    for y in range(size[1]):
        for x in range(size[0]):
            value = 1.0
            for source in sources:
                value *= source[x, y] / 255.0
            pixels[x, y] = round(_clamp01(value) * 255)
    return out

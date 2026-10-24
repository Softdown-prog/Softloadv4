"""A7 Material Engine V2.

Generic deterministic masked relief/material treatment. Geometry remains
separate from material: a trunk, wall, roof or stone can all reuse the same
masked shading primitive with different parameters.
"""
from __future__ import annotations

import math
import random
from typing import Sequence

from PIL import Image, ImageFilter

MATERIAL_ENGINE_CONTRACT = "A7_MATERIAL_ENGINE_V2"


def _clamp(value: float, lo: float, hi: float) -> float:
    return max(lo, min(hi, float(value)))


def _smooth_noise(size: tuple[int, int], seed: int, cell_px: int) -> Image.Image:
    width, height = size
    cell = max(3, int(cell_px))
    grid_w = max(2, width // cell + 2)
    grid_h = max(2, height // cell + 2)
    rng = random.Random(int(seed))
    small = Image.new("L", (grid_w, grid_h), 128)
    px = small.load()
    for y in range(grid_h):
        for x in range(grid_w):
            px[x, y] = rng.randrange(0, 256)
    return small.resize((width, height), Image.Resampling.BICUBIC)


def _directional_grain(size: tuple[int, int], seed: int, *, axis: str, scale_px: int) -> Image.Image:
    width, height = size
    scale = max(2, int(scale_px))
    rng = random.Random(int(seed))
    if axis == "vertical":
        small_w = max(2, width // scale + 2)
        small_h = max(3, height // max(2, scale // 2) + 2)
    elif axis == "horizontal":
        small_w = max(3, width // max(2, scale // 2) + 2)
        small_h = max(2, height // scale + 2)
    else:
        raise ValueError("grain axis must be vertical or horizontal")
    small = Image.new("L", (small_w, small_h), 128)
    px = small.load()
    for y in range(small_h):
        for x in range(small_w):
            px[x, y] = rng.randrange(40, 216)
    return small.resize((width, height), Image.Resampling.BICUBIC).filter(ImageFilter.GaussianBlur(0.6))


def masked_relief_material(
    image: Image.Image,
    mask: Image.Image,
    *,
    seed: int = 1,
    light_direction: Sequence[float] = (-0.8, -0.45),
    relief_strength: float = 0.22,
    edge_shade: float = 0.16,
    coarse_px: int = 13,
    coarse_amount: float = 0.11,
    grain_axis: str = "vertical",
    grain_scale_px: int = 7,
    grain_amount: float = 0.10,
    fine_amount: float = 0.025,
) -> Image.Image:
    """Apply broad relief, edge shading and directional grain within a mask.

    The mask gradient acts as a cheap 2D surface normal near silhouettes and
    junctions. Low-frequency noise supplies material breakup; directional grain
    adds controlled anisotropy useful for bark/wood while still being generic.
    Alpha and geometry are preserved exactly.
    """
    if image.mode != "RGBA":
        raise ValueError("masked relief material requires RGBA input")
    material_mask = mask if mask.mode == "L" else mask.convert("L")
    if material_mask.size != image.size:
        raise ValueError("material mask must match image size")
    if len(light_direction) != 2:
        raise ValueError("light_direction must be [x,y]")

    lx, ly = float(light_direction[0]), float(light_direction[1])
    length = math.hypot(lx, ly)
    if length <= 1e-8:
        lx, ly = -0.8, -0.45
        length = math.hypot(lx, ly)
    lx, ly = lx / length, ly / length

    relief_strength = _clamp(relief_strength, 0.0, 0.6)
    edge_shade = _clamp(edge_shade, 0.0, 0.5)
    coarse_amount = _clamp(coarse_amount, 0.0, 0.4)
    grain_amount = _clamp(grain_amount, 0.0, 0.35)
    fine_amount = _clamp(fine_amount, 0.0, 0.15)

    normal_source = material_mask.filter(ImageFilter.GaussianBlur(1.15))
    eroded = material_mask.filter(ImageFilter.MinFilter(3))
    coarse = _smooth_noise(image.size, int(seed), int(coarse_px))
    grain = _directional_grain(image.size, int(seed) + 13007, axis=str(grain_axis), scale_px=int(grain_scale_px))
    rng = random.Random(int(seed) + 65537)

    src = image.load()
    dst_image = image.copy()
    dst = dst_image.load()
    m = material_mask.load()
    n = normal_source.load()
    e = eroded.load()
    c = coarse.load()
    g = grain.load()
    width, height = image.size

    for y in range(height):
        ym = max(0, y - 1)
        yp = min(height - 1, y + 1)
        for x in range(width):
            weight = m[x, y] / 255.0
            if weight <= 0.0:
                continue
            xm = max(0, x - 1)
            xp = min(width - 1, x + 1)
            gx = (n[xp, y] - n[xm, y]) / 255.0
            gy = (n[x, yp] - n[x, ym]) / 255.0
            normal_light = (gx * lx + gy * ly) * relief_strength
            edge = max(0.0, (m[x, y] - e[x, y]) / 255.0)
            edge_term = -edge * edge_shade
            coarse_term = (c[x, y] / 255.0 - 0.5) * coarse_amount
            grain_term = (g[x, y] / 255.0 - 0.5) * grain_amount
            fine_term = (rng.random() - 0.5) * fine_amount
            delta = (normal_light + edge_term + coarse_term + grain_term + fine_term) * weight
            mult = 1.0 + delta
            r, gg, b, a = src[x, y]
            dst[x, y] = (
                round(_clamp(r * mult, 0, 255)),
                round(_clamp(gg * mult, 0, 255)),
                round(_clamp(b * mult, 0, 255)),
                a,
            )
    return dst_image

"""Reusable deterministic flower brushes for Visitor Forge 2D.

These primitives are intentionally small and composable. Flower renderers can
combine them into beds, planters and groundcover while keeping output seeded,
reviewable and independent from image-generation services.
"""
from __future__ import annotations

import math
import random
from typing import Iterable

from PIL import Image, ImageChops, ImageDraw

WORK_SCALE = 4


def _hex(value: str) -> tuple[int, int, int]:
    return tuple(int(value[i:i + 2], 16) for i in (1, 3, 5))


def flower_rosette(
    layer: Image.Image,
    rng: random.Random,
    center: tuple[float, float],
    petal_colors: Iterable[str],
    center_color: str,
    *,
    petals: int = 8,
    radius: float = 3.2,
    squash: float = .72,
    alpha: int = 245,
) -> None:
    """Paint a compact radial bloom with overlapping elliptical petals."""
    colors = tuple(petal_colors)
    if not colors:
        raise ValueError("flower_rosette needs petal colors")
    cx, cy = center
    draw = ImageDraw.Draw(layer, "RGBA")
    count = max(4, petals)
    phase = rng.uniform(-.18, .18)
    for i in range(count):
        a = math.tau * i / count + phase
        length = radius * rng.uniform(.84, 1.12)
        width = radius * rng.uniform(.34, .52)
        px = (cx + math.cos(a) * radius * .45) * WORK_SCALE
        py = (cy + math.sin(a) * radius * .45 * squash) * WORK_SCALE
        rx = width * WORK_SCALE
        ry = length * .48 * squash * WORK_SCALE
        draw.ellipse((px-rx, py-ry, px+rx, py+ry), fill=(*_hex(colors[i % len(colors)]), alpha))
    core = radius * .34 * WORK_SCALE
    x, y = cx * WORK_SCALE, cy * WORK_SCALE
    draw.ellipse((x-core, y-core, x+core, y+core), fill=(*_hex(center_color), min(255, alpha+8)))


def flower_star(
    layer: Image.Image,
    rng: random.Random,
    center: tuple[float, float],
    color: str,
    center_color: str,
    *,
    points: int = 6,
    radius: float = 3.5,
    inner: float = .42,
    alpha: int = 245,
) -> None:
    """Paint a crisp star-shaped bloom that survives gameplay-scale downsampling."""
    cx, cy = center
    phase = rng.uniform(-.22, .22)
    verts = []
    count = max(5, points)
    for i in range(count * 2):
        r = radius if i % 2 == 0 else radius * inner
        a = phase - math.pi / 2 + math.pi * i / count
        verts.append(((cx + math.cos(a)*r)*WORK_SCALE, (cy + math.sin(a)*r*.82)*WORK_SCALE))
    draw = ImageDraw.Draw(layer, "RGBA")
    draw.polygon(verts, fill=(*_hex(color), alpha))
    core = radius * .28 * WORK_SCALE
    x, y = cx*WORK_SCALE, cy*WORK_SCALE
    draw.ellipse((x-core, y-core, x+core, y+core), fill=(*_hex(center_color), 255))


def flower_bud(
    layer: Image.Image,
    center: tuple[float, float],
    color: str,
    *,
    radius: float = 1.5,
    alpha: int = 230,
) -> None:
    """Small unopened bud used to break repetition among full blooms."""
    cx, cy = center
    draw = ImageDraw.Draw(layer, "RGBA")
    rx = radius * .72 * WORK_SCALE
    ry = radius * 1.05 * WORK_SCALE
    x, y = cx*WORK_SCALE, cy*WORK_SCALE
    draw.ellipse((x-rx, y-ry, x+rx, y+ry), fill=(*_hex(color), alpha))


def stem_curve(
    layer: Image.Image,
    p0: tuple[float, float],
    p1: tuple[float, float],
    p2: tuple[float, float],
    color: str,
    *,
    width: float = .85,
    alpha: int = 225,
    samples: int = 24,
) -> None:
    """Quadratic curved flower stem."""
    pts = []
    for i in range(samples + 1):
        t = i / samples
        u = 1.0 - t
        x = u*u*p0[0] + 2*u*t*p1[0] + t*t*p2[0]
        y = u*u*p0[1] + 2*u*t*p1[1] + t*t*p2[1]
        pts.append((x*WORK_SCALE, y*WORK_SCALE))
    ImageDraw.Draw(layer, "RGBA").line(pts, fill=(*_hex(color), alpha), width=max(1, round(width*WORK_SCALE)))


def leaf_pair_small(
    layer: Image.Image,
    rng: random.Random,
    center: tuple[float, float],
    color: str,
    *,
    length: float = 4.0,
    width: float = 1.6,
    angle: float = 0.0,
    alpha: int = 215,
) -> None:
    """Two small pointed leaves attached around a stem point."""
    cx, cy = center
    draw = ImageDraw.Draw(layer, "RGBA")
    for side in (-1, 1):
        a = angle + side * rng.uniform(.62, .92)
        tip = (cx + math.cos(a)*length, cy + math.sin(a)*length)
        nx, ny = -math.sin(a)*width, math.cos(a)*width
        pts = [
            (cx*WORK_SCALE, cy*WORK_SCALE),
            ((cx+nx)*WORK_SCALE, (cy+ny)*WORK_SCALE),
            (tip[0]*WORK_SCALE, tip[1]*WORK_SCALE),
            ((cx-nx)*WORK_SCALE, (cy-ny)*WORK_SCALE),
        ]
        draw.polygon(pts, fill=(*_hex(color), alpha))


def clip_to_mask(layer: Image.Image, mask: Image.Image) -> None:
    """Keep a flower/foliage layer inside an authored bed mask."""
    layer.putalpha(ImageChops.multiply(layer.getchannel("A"), mask))

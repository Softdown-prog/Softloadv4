"""Deterministic flowering-tree brushes for Visitor Forge 2D.

The primitives in this module are intentionally reusable.  They encode the
visual lessons from the approved Ipe Amarelo reference: many small blossom
clusters, readable wood windows, warm-gold depth and bright lemon highlights.
"""
from __future__ import annotations

import math
import random
from typing import Iterable

from PIL import Image, ImageChops, ImageDraw

WORK_SCALE = 4


def _hex(value: str) -> tuple[int, int, int]:
    return tuple(int(value[i:i + 2], 16) for i in (1, 3, 5))


def flower_cluster_small_round(
    layer: Image.Image,
    rng: random.Random,
    mask: Image.Image,
    center: tuple[float, float],
    radius: tuple[float, float],
    palette: Iterable[str],
    *,
    count: int = 46,
    highlight_color: str | None = None,
    shadow_color: str | None = None,
    blossom_style: str = "round",
) -> None:
    """Paint many tiny rounded blossoms clipped to one authored crown mass."""
    colors = tuple(palette)
    if not colors:
        raise ValueError("flower cluster needs at least one palette color")
    cx, cy = center
    rx, ry = radius
    px = mask.load()
    draw = ImageDraw.Draw(layer, "RGBA")
    for _ in range(max(1, count)):
        x = cx + rng.uniform(-.96, .96) * rx
        y = cy + rng.uniform(-.94, .94) * ry
        ix, iy = round(x * WORK_SCALE), round(y * WORK_SCALE)
        if not (0 <= ix < mask.width and 0 <= iy < mask.height) or px[ix, iy] < 205:
            continue
        roll = rng.random()
        if highlight_color and y < cy - ry * .06 and roll < .24:
            color = highlight_color
        elif shadow_color and y > cy + ry * .16 and roll < .20:
            color = shadow_color
        else:
            color = colors[rng.randrange(len(colors))]
        r = rng.uniform(1.5, 3.25) * WORK_SCALE
        squash = rng.uniform(.72, 1.0)
        xw, yw = x * WORK_SCALE, y * WORK_SCALE
        if blossom_style == "petalled":
            # Five separate lobes and a warm throat remain readable at sprite scale.
            r *= 0.75
            phase = rng.uniform(0, math.tau)
            for petal in range(5):
                angle = phase + petal * math.tau / 5
                ox, oy = math.cos(angle) * r * 0.58, math.sin(angle) * r * 0.58 * squash
                pr = r * 0.52
                draw.ellipse((xw+ox-pr, yw+oy-pr*squash, xw+ox+pr, yw+oy+pr*squash), fill=(*_hex(color), 248))
            throat = r * 0.22
            draw.ellipse((xw-throat, yw-throat, xw+throat, yw+throat), fill=(*_hex(shadow_color or color), 235))
        else:
            draw.ellipse((xw-r, yw-r*squash, xw+r, yw+r*squash), fill=(*_hex(color), rng.randint(205, 248)))
    layer.putalpha(ImageChops.multiply(layer.getchannel("A"), mask))


def flower_spray(
    layer: Image.Image,
    rng: random.Random,
    center: tuple[float, float],
    palette: Iterable[str],
    *,
    radius: float = 10.0,
    blossoms: int = 11,
    highlight_color: str | None = None,
) -> None:
    """Edge spray used to break silhouette rhythm into small flowering tufts."""
    colors = tuple(palette)
    if not colors:
        raise ValueError("flower spray needs at least one palette color")
    draw = ImageDraw.Draw(layer, "RGBA")
    cx, cy = center
    for i in range(max(3, blossoms)):
        angle = math.tau * i / max(3, blossoms) + rng.uniform(-.24, .24)
        distance = radius * rng.uniform(.18, .95)
        x = (cx + math.cos(angle) * distance) * WORK_SCALE
        y = (cy + math.sin(angle) * distance * .72) * WORK_SCALE
        color = highlight_color if highlight_color and math.sin(angle) < -.15 and rng.random() < .35 else colors[rng.randrange(len(colors))]
        r = rng.uniform(1.35, 2.55) * WORK_SCALE
        draw.ellipse((x-r, y-r*.78, x+r, y+r*.78), fill=(*_hex(color), rng.randint(210, 248)))


def blossom_gap_windows(mask: Image.Image, rng: random.Random, center: tuple[float, float], radius: tuple[float, float], *, count: int = 3) -> None:
    """Cut small negative-space windows so branches remain visible through bloom."""
    draw = ImageDraw.Draw(mask)
    cx, cy = center
    rx, ry = radius
    for _ in range(max(0, count)):
        angle = rng.uniform(0.0, math.tau)
        distance = rng.uniform(.34, .76)
        x = (cx + math.cos(angle) * rx * distance) * WORK_SCALE
        y = (cy + math.sin(angle) * ry * distance) * WORK_SCALE
        crx = rng.uniform(rx * .07, rx * .14) * WORK_SCALE
        cry = rng.uniform(ry * .07, ry * .14) * WORK_SCALE
        draw.ellipse((x-crx, y-cry, x+crx, y+cry), fill=0)

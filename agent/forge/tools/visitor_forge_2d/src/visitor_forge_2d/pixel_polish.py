"""Deterministic native-pixel cleanup for A7 Forge 2D.

The pass never resizes, blurs, interpolates or antialiases.  It only repairs two
small topology defects that commonly appear after procedural composition:

* isolated opaque pixels with no opaque neighbour in the 8-neighbourhood;
* one-pixel transparent pinholes completely enclosed by opaque pixels.

This is intentionally conservative.  Shape tips, diagonal clusters and authored
single-pixel details that touch the silhouette remain untouched.
"""

from __future__ import annotations

from collections import Counter
from typing import Any

from PIL import Image


PIXEL_POLISH_CONTRACT = "A7_FORGE_2D_PIXEL_POLISH_V1"
PIXEL_POLISH_PROFILES = ("off", "conservative")


def _neighbours8(x: int, y: int, width: int, height: int):
    for dy in (-1, 0, 1):
        for dx in (-1, 0, 1):
            if dx == 0 and dy == 0:
                continue
            nx = x + dx
            ny = y + dy
            if 0 <= nx < width and 0 <= ny < height:
                yield nx, ny


def _majority_opaque_color(source: Image.Image, x: int, y: int) -> tuple[int, int, int, int] | None:
    colors: list[tuple[int, int, int, int]] = []
    width, height = source.size
    for nx, ny in _neighbours8(x, y, width, height):
        color = source.getpixel((nx, ny))
        if color[3] > 0:
            colors.append(color)
    if not colors:
        return None
    counts = Counter(colors)
    # Stable tie-breaker: frequency, then RGBA tuple.
    return max(counts.items(), key=lambda item: (item[1], item[0]))[0]


def polish_native_pixel_art(image: Image.Image, profile: str = "conservative") -> tuple[Image.Image, dict[str, Any]]:
    """Return a polished copy and a small audit report.

    The operation is deterministic and RGBA-only.  Conservative mode performs
    one simultaneous pass so one repair cannot trigger another repair during
    the same frame.
    """
    if image.mode != "RGBA":
        raise ValueError("pixel polish requires RGBA input")
    if profile not in PIXEL_POLISH_PROFILES:
        raise ValueError(f"pixel polish profile must be one of {PIXEL_POLISH_PROFILES}")

    source = image.copy()
    report: dict[str, Any] = {
        "contract": PIXEL_POLISH_CONTRACT,
        "profile": profile,
        "isolatedPixelsRemoved": 0,
        "pinholesFilled": 0,
        "changedPixels": 0,
    }
    if profile == "off":
        return source, report

    width, height = source.size
    alpha = source.getchannel("A")
    repairs: dict[tuple[int, int], tuple[int, int, int, int]] = {}

    for y in range(height):
        for x in range(width):
            opaque = alpha.getpixel((x, y)) > 0
            neighbour_alpha = [
                alpha.getpixel((nx, ny)) > 0
                for nx, ny in _neighbours8(x, y, width, height)
            ]
            opaque_count = sum(neighbour_alpha)

            if opaque and opaque_count == 0:
                repairs[(x, y)] = (0, 0, 0, 0)
                report["isolatedPixelsRemoved"] += 1
                continue

            # Require all eight neighbours. Border pixels can never be pinholes.
            if not opaque and len(neighbour_alpha) == 8 and opaque_count == 8:
                fill = _majority_opaque_color(source, x, y)
                if fill is not None:
                    repairs[(x, y)] = fill
                    report["pinholesFilled"] += 1

    polished = source.copy()
    for point, color in repairs.items():
        polished.putpixel(point, color)

    report["changedPixels"] = len(repairs)
    return polished, report

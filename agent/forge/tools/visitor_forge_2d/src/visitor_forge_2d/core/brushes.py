"""Reusable deterministic raster brushes for Visitor Forge 2D.

These are intentionally small composable drawing primitives, not full asset
renderers. Species renderers combine them into crowns, branches and finish
passes while keeping the CH 2D pipeline deterministic and reviewable.
"""
from __future__ import annotations

import math
import random
from typing import Iterable

from PIL import Image, ImageChops, ImageDraw, ImageFilter

WORK_SCALE = 4


def _hex(value: str) -> tuple[int, int, int]:
    return tuple(int(value[i:i + 2], 16) for i in (1, 3, 5))


def leaf_cluster_round(mask: Image.Image, rng: random.Random, cx: float, cy: float, rx: float, ry: float, *, lobes: int = 14, jitter: float = 0.18, fill: int = 255) -> None:
    points = []
    for i in range(max(8, lobes)):
        angle = math.tau * i / max(8, lobes)
        radial = 1.0 + rng.uniform(-jitter, jitter)
        points.append((round((cx + math.cos(angle) * rx * radial) * WORK_SCALE), round((cy + math.sin(angle) * ry * radial) * WORK_SCALE)))
    ImageDraw.Draw(mask).polygon(points, fill=fill)


def leaf_cluster_broadleaf(mask: Image.Image, rng: random.Random, cx: float, cy: float, rx: float, ry: float, *, satellites: int = 4, fill: int = 255) -> None:
    leaf_cluster_round(mask, rng, cx, cy, rx, ry, lobes=13, jitter=.23, fill=fill)
    for _ in range(max(0, satellites)):
        angle = rng.uniform(0.0, math.tau)
        distance = rng.uniform(.34, .70)
        sx = cx + math.cos(angle) * rx * distance
        sy = cy + math.sin(angle) * ry * distance
        leaf_cluster_round(mask, rng, sx, sy, rx * rng.uniform(.22, .40), ry * rng.uniform(.22, .42), lobes=rng.randint(8, 11), jitter=.27, fill=fill)


def maple_leaf_points(x: float, y: float, size: float, angle: float, *, work_scale: int = WORK_SCALE) -> list[tuple[float, float]]:
    radii = (1.00, .46, .83, .41, .72, .35, .72, .41, .83, .46)
    points = []
    for index, radius in enumerate(radii):
        theta = angle - math.pi / 2 + index * math.tau / len(radii)
        points.append(((x + math.cos(theta) * size * radius) * work_scale, (y + math.sin(theta) * size * radius * .86) * work_scale))
    return points


def leaf_cluster_maple(layer: Image.Image, rng: random.Random, mask: Image.Image, center: tuple[float, float], radius: tuple[float, float], palette: Iterable[str], *, count: int | None = None, highlight_color: str | None = None, shadow_color: str | None = None) -> None:
    cx, cy = center
    rx, ry = radius
    colors = tuple(palette)
    if not colors:
        raise ValueError("maple brush needs at least one palette color")
    pixels = mask.load()
    draw = ImageDraw.Draw(layer, "RGBA")
    target = count if count is not None else max(30, round((rx * ry) / 5.7))
    for _ in range(target):
        x = cx + rng.uniform(-.94, .94) * rx
        y = cy + rng.uniform(-.92, .92) * ry
        ix, iy = round(x * WORK_SCALE), round(y * WORK_SCALE)
        if not (0 <= ix < mask.width and 0 <= iy < mask.height) or pixels[ix, iy] < 210:
            continue
        roll = rng.random()
        if highlight_color and y < cy and roll < .16:
            color = highlight_color
        elif shadow_color and y > cy + ry * .15 and roll < .24:
            color = shadow_color
        else:
            color = colors[rng.randrange(len(colors))]
        draw.polygon(maple_leaf_points(x, y, rng.uniform(2.7, 5.1), rng.uniform(-.58, .58)), fill=(*_hex(color), rng.randint(178, 242)))
    layer.putalpha(ImageChops.multiply(layer.getchannel("A"), mask))


def leaf_lanceolate_points(x: float, y: float, length: float, width: float, angle: float) -> list[tuple[float, float]]:
    """Return a tapered long-leaf polygon for mango/tropical broadleaf families."""
    ca, sa = math.cos(angle), math.sin(angle)
    def pt(dx: float, dy: float) -> tuple[float, float]:
        return ((x + dx * ca - dy * sa) * WORK_SCALE, (y + dx * sa + dy * ca) * WORK_SCALE)
    return [pt(-length * .46, 0), pt(-length * .12, -width * .50), pt(length * .34, -width * .20), pt(length * .52, 0), pt(length * .34, width * .20), pt(-length * .12, width * .50)]


def leaf_cluster_lanceolate(layer: Image.Image, rng: random.Random, mask: Image.Image, center: tuple[float, float], radius: tuple[float, float], palette: Iterable[str], *, count: int = 24, droop: float = .38, highlight_color: str | None = None) -> None:
    """Long pointed leaves constrained to one crown group."""
    cx, cy = center
    rx, ry = radius
    colors = tuple(palette)
    if not colors:
        raise ValueError("lanceolate brush needs at least one palette color")
    px = mask.load()
    draw = ImageDraw.Draw(layer, "RGBA")
    for _ in range(max(1, count)):
        x = cx + rng.uniform(-.90, .90) * rx
        y = cy + rng.uniform(-.86, .86) * ry
        ix, iy = round(x * WORK_SCALE), round(y * WORK_SCALE)
        if not (0 <= ix < mask.width and 0 <= iy < mask.height) or px[ix, iy] < 200:
            continue
        base = rng.uniform(-.95, .95)
        angle = base + abs(base) * droop + rng.uniform(-.16, .16)
        color = highlight_color if highlight_color and y < cy and rng.random() < .18 else colors[rng.randrange(len(colors))]
        draw.polygon(leaf_lanceolate_points(x, y, rng.uniform(5.2, 8.6), rng.uniform(1.6, 2.8), angle), fill=(*_hex(color), rng.randint(185, 242)))
    layer.putalpha(ImageChops.multiply(layer.getchannel("A"), mask))


def leaf_rosette_droop(layer: Image.Image, rng: random.Random, center: tuple[float, float], palette: Iterable[str], *, leaves: int = 9, radius: float = 9.0, highlight_color: str | None = None) -> None:
    """Radial drooping rosette for grouped tropical crowns."""
    colors = tuple(palette)
    if not colors:
        raise ValueError("rosette brush needs at least one palette color")
    draw = ImageDraw.Draw(layer, "RGBA")
    cx, cy = center
    for i in range(max(4, leaves)):
        a = math.tau * i / max(4, leaves) + rng.uniform(-.13, .13)
        x = cx + math.cos(a) * radius * .22
        y = cy + math.sin(a) * radius * .12
        color = highlight_color if highlight_color and i < leaves // 3 else colors[rng.randrange(len(colors))]
        draw.polygon(leaf_lanceolate_points(x, y, radius * rng.uniform(.72, 1.05), radius * rng.uniform(.18, .28), a + .30 * math.sin(a)), fill=(*_hex(color), rng.randint(190, 245)))


def branch_tapered(mask: Image.Image, p0: tuple[float, float], p1: tuple[float, float], p2: tuple[float, float], w0: float, w1: float, *, samples: int = 48, fill: int = 255) -> None:
    draw = ImageDraw.Draw(mask)
    for i in range(samples + 1):
        t = i / samples
        u = 1.0 - t
        x = u*u*p0[0] + 2*u*t*p1[0] + t*t*p2[0]
        y = u*u*p0[1] + 2*u*t*p1[1] + t*t*p2[1]
        width = (w0 + (w1 - w0) * t) * WORK_SCALE
        r = max(1.0, width * .5)
        x *= WORK_SCALE; y *= WORK_SCALE
        draw.ellipse((x-r, y-r, x+r, y+r), fill=fill)


def bark_highlight_strokes(layer: Image.Image, rng: random.Random, p0: tuple[float, float], p1: tuple[float, float], p2: tuple[float, float], color: str, *, strokes: int = 5, width: float = 1.2, alpha: int = 145) -> None:
    """Thin deterministic bark highlights that follow branch curvature."""
    draw = ImageDraw.Draw(layer, "RGBA")
    for s in range(max(1, strokes)):
        pts = []
        start = rng.uniform(.06, .24)
        end = rng.uniform(.66, .94)
        lateral = (s - (strokes - 1) / 2) * width * .55
        for i in range(18):
            t = start + (end-start) * i / 17
            u = 1-t
            x = u*u*p0[0] + 2*u*t*p1[0] + t*t*p2[0] + lateral
            y = u*u*p0[1] + 2*u*t*p1[1] + t*t*p2[1]
            pts.append((x*WORK_SCALE, y*WORK_SCALE))
        draw.line(pts, fill=(*_hex(color), alpha), width=max(1, round(width*WORK_SCALE)))


def interior_occlusion_patch(mask: Image.Image, rng: random.Random, cx: float, cy: float, rx: float, ry: float, *, strength: int = 150) -> None:
    leaf_cluster_round(mask, rng, cx, cy, rx, ry, lobes=11, jitter=.22, fill=strength)
    mask.paste(mask.filter(ImageFilter.GaussianBlur(.35 * WORK_SCALE)))


def edge_breakup_stamp(mask: Image.Image, rng: random.Random, cx: float, cy: float, radius: float, *, count: int = 8, fill: int = 255) -> None:
    draw = ImageDraw.Draw(mask)
    for _ in range(max(1, count)):
        angle = rng.uniform(0.0, math.tau)
        distance = rng.uniform(radius * .56, radius * .98)
        x = (cx + math.cos(angle)*distance)*WORK_SCALE
        y = (cy + math.sin(angle)*distance)*WORK_SCALE
        r = rng.uniform(radius*.08, radius*.18)*WORK_SCALE
        draw.ellipse((x-r,y-r,x+r,y+r), fill=fill)


def silhouette_gap_cutter(mask: Image.Image, rng: random.Random, cx: float, cy: float, rx: float, ry: float, *, count: int = 3) -> None:
    draw = ImageDraw.Draw(mask)
    for _ in range(max(0, count)):
        angle = rng.uniform(0.0, math.tau)
        x = (cx + math.cos(angle)*rx*rng.uniform(.72,1.02))*WORK_SCALE
        y = (cy + math.sin(angle)*ry*rng.uniform(.72,1.02))*WORK_SCALE
        crx = rng.uniform(rx*.08, rx*.17)*WORK_SCALE
        cry = rng.uniform(ry*.08, ry*.18)*WORK_SCALE
        draw.ellipse((x-crx,y-cry,x+crx,y+cry), fill=0)

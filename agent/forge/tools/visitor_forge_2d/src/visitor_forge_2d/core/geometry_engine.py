"""A7 Geometry Engine V1.

Continuous 2D geometry primitives for authored game assets.

The first primitive is a tapered ribbon/path.  It exists specifically so
organic and structural strokes (trunks, branches, stems, cracks, pipes,
curbs, rivers, cables...) do not need to be faked by repeating bitmap stamps.
"""
from __future__ import annotations

import math
from typing import Sequence

from PIL import Image, ImageChops, ImageDraw

GEOMETRY_CONTRACT = "A7_GEOMETRY_ENGINE_V1"


def _clamp(value: float, lo: float, hi: float) -> float:
    return max(lo, min(hi, value))


def _rgba(value: str | Sequence[int], alpha: int = 255) -> tuple[int, int, int, int]:
    if isinstance(value, str):
        text = value.lstrip("#")
        if len(text) not in (6, 8):
            raise ValueError("geometry colors must use #RRGGBB or #RRGGBBAA")
        rgb = tuple(int(text[i:i + 2], 16) for i in (0, 2, 4))
        out_alpha = int(text[6:8], 16) if len(text) == 8 else alpha
        return rgb[0], rgb[1], rgb[2], out_alpha
    if len(value) not in (3, 4):
        raise ValueError("geometry colors require RGB or RGBA channels")
    channels = [int(_clamp(int(channel), 0, 255)) for channel in value]
    if len(channels) == 3:
        channels.append(alpha)
    return tuple(channels)  # type: ignore[return-value]


def _unit(dx: float, dy: float) -> tuple[float, float]:
    length = math.hypot(dx, dy)
    if length <= 1e-9:
        return 0.0, 0.0
    return dx / length, dy / length


def _normals(points: Sequence[Sequence[float]]) -> list[tuple[float, float]]:
    normals: list[tuple[float, float]] = []
    for index, point in enumerate(points):
        x, y = map(float, point)
        if index == 0:
            nx, ny = map(float, points[1])
            tx, ty = _unit(nx - x, ny - y)
        elif index == len(points) - 1:
            px, py = map(float, points[index - 1])
            tx, ty = _unit(x - px, y - py)
        else:
            px, py = map(float, points[index - 1])
            nx, ny = map(float, points[index + 1])
            ax, ay = _unit(x - px, y - py)
            bx, by = _unit(nx - x, ny - y)
            tx, ty = _unit(ax + bx, ay + by)
            if abs(tx) + abs(ty) <= 1e-9:
                tx, ty = bx, by
        normals.append((-ty, tx))
    return normals


def _path_widths(path: dict, points: Sequence[Sequence[float]]) -> list[float]:
    authored = path.get("widths")
    if authored is not None:
        if not isinstance(authored, Sequence) or len(authored) != len(points):
            raise ValueError("tapered path widths must match the number of points")
        widths = [max(0.25, float(value)) for value in authored]
        return widths

    start = max(0.25, float(path.get("widthStart", path.get("width", 1.0))))
    end = max(0.25, float(path.get("widthEnd", start)))
    cumulative = [0.0]
    for a, b in zip(points, points[1:]):
        ax, ay = map(float, a)
        bx, by = map(float, b)
        cumulative.append(cumulative[-1] + math.hypot(bx - ax, by - ay))
    total = cumulative[-1]
    if total <= 1e-9:
        return [start for _ in points]
    return [start + (end - start) * (distance / total) for distance in cumulative]


def _ribbon(points: Sequence[Sequence[float]], widths: Sequence[float]) -> list[tuple[float, float]]:
    normals = _normals(points)
    left: list[tuple[float, float]] = []
    right: list[tuple[float, float]] = []
    for point, width, normal in zip(points, widths, normals):
        x, y = map(float, point)
        nx, ny = normal
        radius = float(width) * 0.5
        left.append((x + nx * radius, y + ny * radius))
        right.append((x - nx * radius, y - ny * radius))
    return left + list(reversed(right))


def _draw_ribbon(draw: ImageDraw.ImageDraw, points: Sequence[Sequence[float]], widths: Sequence[float],
                 color: tuple[int, int, int, int], *, start_cap: str = "round", end_cap: str = "round") -> None:
    polygon = _ribbon(points, widths)
    draw.polygon(polygon, fill=color)
    # Rounded joins/caps remove the wedge-shaped gaps that otherwise appear at
    # sharp turns in a polyline ribbon.
    for index, (point, width) in enumerate(zip(points, widths)):
        if (index == 0 and start_cap == "butt") or (index == len(points)-1 and end_cap == "butt"):
            continue
        x, y = map(float, point)
        radius = float(width) * 0.5
        draw.ellipse((x - radius, y - radius, x + radius, y + radius), fill=color)


def _cap_clip_mask(size: tuple[int, int], points, *, start_cap: str, end_cap: str) -> Image.Image:
    """Clip butt ends to their tangent planes, including nearby round joins."""
    mask = Image.new("L", size, 255)
    draw = ImageDraw.Draw(mask)
    extent = (size[0] + size[1]) * 4.0
    for end, style in ((False, start_cap), (True, end_cap)):
        if style != "butt":
            continue
        point = points[-1] if end else points[0]
        neighbor = points[-2] if end else points[1]
        # Direction outward from the endpoint toward the part to discard.
        ux,uy = _unit(point[0]-neighbor[0],point[1]-neighbor[1])
        if ux == uy == 0:
            continue
        nx,ny = -uy,ux
        x,y = point
        draw.polygon([(x+nx*extent,y+ny*extent), (x-nx*extent,y-ny*extent),
                      (x-nx*extent+ux*extent,y-ny*extent+uy*extent),
                      (x+nx*extent+ux*extent,y+ny*extent+uy*extent)], fill=0)
    return mask


def draw_tapered_paths(canvas: Image.Image, paths: Sequence[dict], *, supersample: int = 4) -> dict:
    """Alpha-composite anti-aliased tapered paths onto ``canvas``.

    Each path accepts ``points`` and either ``widthStart``/``widthEnd`` or one
    width per point in ``widths``.  Optional ``outline``/``outlineWidth`` draws
    a wider ribbon first, keeping the geometry continuous instead of stamping
    bark or other texture repeatedly along a line.
    """
    if canvas.mode != "RGBA":
        raise ValueError("Geometry Engine V1 canvas must be RGBA")
    supersample = max(1, min(8, int(supersample)))
    scale = float(supersample)
    layer = Image.new("RGBA", (canvas.width * supersample, canvas.height * supersample), (0, 0, 0, 0))
    draw = ImageDraw.Draw(layer, "RGBA")
    path_count = 0
    point_count = 0

    for path in paths:
        if not isinstance(path, dict):
            raise ValueError("tapered paths must be objects")
        raw_points = path.get("points", [])
        if not isinstance(raw_points, Sequence) or len(raw_points) < 2:
            raise ValueError("tapered path requires at least two points")
        points = [(float(point[0]) * scale, float(point[1]) * scale) for point in raw_points]
        widths = [width * scale for width in _path_widths(path, raw_points)]
        start_cap, end_cap = path.get("startCap", "round"), path.get("endCap", "round")
        if start_cap not in {"round", "butt"} or end_cap not in {"round", "butt"}:
            raise ValueError("tapered path caps must be round or butt")
        fill = _rgba(path.get("fill", path.get("color", "#FFFFFF")))
        outline = path.get("outline")
        outline_width = max(0.0, float(path.get("outlineWidth", 0.0))) * scale

        path_layer = Image.new("RGBA", layer.size) if "butt" in {start_cap, end_cap} else None
        path_draw = ImageDraw.Draw(path_layer, "RGBA") if path_layer is not None else draw
        if outline is not None and outline_width > 0.0:
            outer_widths = [width + outline_width * 2.0 for width in widths]
            _draw_ribbon(path_draw, points, outer_widths, _rgba(outline), start_cap=start_cap, end_cap=end_cap)
        _draw_ribbon(path_draw, points, widths, fill, start_cap=start_cap, end_cap=end_cap)
        if path_layer is not None:
            clip = _cap_clip_mask(layer.size, points, start_cap=start_cap, end_cap=end_cap)
            path_layer.putalpha(ImageChops.multiply(path_layer.getchannel("A"), clip))
            layer.alpha_composite(path_layer)
        path_count += 1
        point_count += len(points)

    if supersample != 1:
        layer = layer.resize(canvas.size, Image.Resampling.LANCZOS)
    canvas.alpha_composite(layer)
    return {
        "contract": GEOMETRY_CONTRACT,
        "pathCount": path_count,
        "pointCount": point_count,
        "supersample": supersample,
    }

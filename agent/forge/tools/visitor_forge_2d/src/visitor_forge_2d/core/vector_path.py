"""A7 Vector Path V1.

General deterministic 2D vector geometry for the A7 Draw Engine.

The path-command model (move/line/quad/cubic/close and multiple contours) is
informed by mature vector APIs such as Skia's SkPath. Skia is BSD licensed, but
this module is an independent Python/Pillow implementation written for A7.
"""
from __future__ import annotations

from dataclasses import dataclass
import math
from typing import Mapping, Sequence

from PIL import Image, ImageDraw

VECTOR_PATH_CONTRACT = "A7_VECTOR_PATH_V1"
_MAX_FLATTEN_DEPTH = 12

Point = tuple[float, float]


def _point(value: Sequence[float], name: str) -> Point:
    if not isinstance(value, Sequence) or len(value) != 2:
        raise ValueError(f"{name} must be [x, y]")
    x, y = float(value[0]), float(value[1])
    if not math.isfinite(x) or not math.isfinite(y):
        raise ValueError(f"{name} coordinates must be finite")
    return x, y


def _rgba(value: str | Sequence[int] | None) -> tuple[int, int, int, int] | None:
    if value is None:
        return None
    if isinstance(value, str):
        text = value.lstrip("#")
        if len(text) not in (6, 8):
            raise ValueError("vector colors must use #RRGGBB or #RRGGBBAA")
        r, g, b = (int(text[i:i + 2], 16) for i in (0, 2, 4))
        a = int(text[6:8], 16) if len(text) == 8 else 255
        return r, g, b, a
    if len(value) not in (3, 4):
        raise ValueError("vector colors require RGB or RGBA channels")
    channels = [max(0, min(255, int(channel))) for channel in value]
    if len(channels) == 3:
        channels.append(255)
    return tuple(channels)  # type: ignore[return-value]


def _distance_to_line(point: Point, start: Point, end: Point) -> float:
    px, py = point
    ax, ay = start
    bx, by = end
    dx, dy = bx - ax, by - ay
    length2 = dx * dx + dy * dy
    if length2 <= 1e-18:
        return math.hypot(px - ax, py - ay)
    t = ((px - ax) * dx + (py - ay) * dy) / length2
    qx, qy = ax + t * dx, ay + t * dy
    return math.hypot(px - qx, py - qy)


def _mid(a: Point, b: Point) -> Point:
    return (a[0] + b[0]) * 0.5, (a[1] + b[1]) * 0.5


def _flatten_quad(p0: Point, p1: Point, p2: Point, tolerance: float, depth: int = 0) -> list[Point]:
    if depth >= _MAX_FLATTEN_DEPTH or _distance_to_line(p1, p0, p2) <= tolerance:
        return [p2]
    p01 = _mid(p0, p1)
    p12 = _mid(p1, p2)
    p012 = _mid(p01, p12)
    return (
        _flatten_quad(p0, p01, p012, tolerance, depth + 1)
        + _flatten_quad(p012, p12, p2, tolerance, depth + 1)
    )


def _flatten_cubic(
    p0: Point,
    p1: Point,
    p2: Point,
    p3: Point,
    tolerance: float,
    depth: int = 0,
) -> list[Point]:
    flatness = max(_distance_to_line(p1, p0, p3), _distance_to_line(p2, p0, p3))
    if depth >= _MAX_FLATTEN_DEPTH or flatness <= tolerance:
        return [p3]
    p01 = _mid(p0, p1)
    p12 = _mid(p1, p2)
    p23 = _mid(p2, p3)
    p012 = _mid(p01, p12)
    p123 = _mid(p12, p23)
    p0123 = _mid(p012, p123)
    return (
        _flatten_cubic(p0, p01, p012, p0123, tolerance, depth + 1)
        + _flatten_cubic(p0123, p123, p23, p3, tolerance, depth + 1)
    )


@dataclass(frozen=True)
class AffineTransform:
    """Simple authored transform: scale -> rotate around origin -> translate."""

    scale_x: float = 1.0
    scale_y: float = 1.0
    rotate_deg: float = 0.0
    translate_x: float = 0.0
    translate_y: float = 0.0
    origin_x: float = 0.0
    origin_y: float = 0.0

    @classmethod
    def from_spec(cls, spec: Mapping | None) -> "AffineTransform":
        if not spec:
            return cls()
        if not isinstance(spec, Mapping):
            raise ValueError("vector transform must be an object")
        scale = spec.get("scale", [1.0, 1.0])
        if isinstance(scale, (int, float)):
            sx = sy = float(scale)
        else:
            sx, sy = _point(scale, "transform.scale")
        translate = _point(spec.get("translate", [0.0, 0.0]), "transform.translate")
        origin = _point(spec.get("origin", [0.0, 0.0]), "transform.origin")
        return cls(
            scale_x=sx,
            scale_y=sy,
            rotate_deg=float(spec.get("rotateDeg", 0.0)),
            translate_x=translate[0],
            translate_y=translate[1],
            origin_x=origin[0],
            origin_y=origin[1],
        )

    def apply(self, point: Point) -> Point:
        x = (point[0] - self.origin_x) * self.scale_x
        y = (point[1] - self.origin_y) * self.scale_y
        angle = math.radians(self.rotate_deg)
        c, s = math.cos(angle), math.sin(angle)
        rx = x * c - y * s
        ry = x * s + y * c
        return (
            rx + self.origin_x + self.translate_x,
            ry + self.origin_y + self.translate_y,
        )


@dataclass(frozen=True)
class FlattenedContour:
    points: tuple[Point, ...]
    closed: bool


def flatten_commands(
    commands: Sequence[Mapping],
    *,
    tolerance: float = 0.35,
    transform: AffineTransform | None = None,
) -> tuple[list[FlattenedContour], int]:
    """Flatten path verbs into deterministic polylines."""
    if not isinstance(commands, Sequence) or not commands:
        raise ValueError("vector path requires a non-empty commands list")
    tolerance = max(0.02, float(tolerance))
    transform = transform or AffineTransform()

    contours: list[FlattenedContour] = []
    current: list[Point] = []
    current_point: Point | None = None
    start_point: Point | None = None
    command_count = 0

    def finish(closed: bool = False) -> None:
        nonlocal current
        if current:
            transformed = tuple(transform.apply(point) for point in current)
            contours.append(FlattenedContour(transformed, closed))
        current = []

    for raw in commands:
        if not isinstance(raw, Mapping):
            raise ValueError("vector path commands must be objects")
        op = str(raw.get("op", "")).lower()
        command_count += 1

        if op == "move":
            finish(False)
            current_point = _point(raw.get("to", []), "move.to")
            start_point = current_point
            current = [current_point]
        elif op == "line":
            if current_point is None:
                raise ValueError("line command requires a preceding move")
            current_point = _point(raw.get("to", []), "line.to")
            current.append(current_point)
        elif op == "quad":
            if current_point is None:
                raise ValueError("quad command requires a preceding move")
            control = _point(raw.get("control", []), "quad.control")
            end = _point(raw.get("to", []), "quad.to")
            current.extend(_flatten_quad(current_point, control, end, tolerance))
            current_point = end
        elif op == "cubic":
            if current_point is None:
                raise ValueError("cubic command requires a preceding move")
            c1 = _point(raw.get("control1", []), "cubic.control1")
            c2 = _point(raw.get("control2", []), "cubic.control2")
            end = _point(raw.get("to", []), "cubic.to")
            current.extend(_flatten_cubic(current_point, c1, c2, end, tolerance))
            current_point = end
        elif op == "close":
            if current_point is None or start_point is None or not current:
                raise ValueError("close command requires an open contour")
            finish(True)
            current_point = None
            start_point = None
        else:
            raise ValueError(f"unsupported vector path op: {op}")

    finish(False)
    return contours, command_count


def _draw_round_cap(draw: ImageDraw.ImageDraw, point: Point, radius: float, fill: tuple[int, int, int, int]) -> None:
    x, y = point
    draw.ellipse((x - radius, y - radius, x + radius, y + radius), fill=fill)


def draw_vector_paths(canvas: Image.Image, paths: Sequence[Mapping], *, supersample: int = 4) -> dict:
    """Draw filled/stroked vector paths onto an RGBA canvas."""
    if canvas.mode != "RGBA":
        raise ValueError("Vector Path V1 canvas must be RGBA")
    if not isinstance(paths, Sequence):
        raise ValueError("vector paths must be a sequence")

    supersample = max(1, min(8, int(supersample)))
    ss = float(supersample)
    layer = Image.new("RGBA", (canvas.width * supersample, canvas.height * supersample), (0, 0, 0, 0))
    draw = ImageDraw.Draw(layer, "RGBA")

    path_count = 0
    contour_count = 0
    command_count = 0
    flattened_points = 0

    for spec in paths:
        if not isinstance(spec, Mapping):
            raise ValueError("each vector path must be an object")
        transform = AffineTransform.from_spec(spec.get("transform"))
        contours, commands = flatten_commands(
            spec.get("commands", []),
            tolerance=float(spec.get("tolerance", 0.35)),
            transform=transform,
        )
        fill = _rgba(spec.get("fill"))
        stroke = _rgba(spec.get("stroke"))
        stroke_width = max(0.0, float(spec.get("strokeWidth", 1.0))) * ss
        cap = str(spec.get("cap", "round")).lower()
        if cap not in {"round", "butt"}:
            raise ValueError("vector path cap must be 'round' or 'butt'")

        for contour in contours:
            scaled = [(x * ss, y * ss) for x, y in contour.points]
            if len(scaled) < 2:
                continue
            if fill is not None and contour.closed and len(scaled) >= 3:
                draw.polygon(scaled, fill=fill)
            if stroke is not None and stroke_width > 0.0:
                points = scaled + ([scaled[0]] if contour.closed else [])
                draw.line(points, fill=stroke, width=max(1, round(stroke_width)), joint="curve")
                if cap == "round" and not contour.closed:
                    radius = stroke_width * 0.5
                    _draw_round_cap(draw, scaled[0], radius, stroke)
                    _draw_round_cap(draw, scaled[-1], radius, stroke)
            contour_count += 1
            flattened_points += len(scaled)

        path_count += 1
        command_count += commands

    if supersample != 1:
        layer = layer.resize(canvas.size, Image.Resampling.LANCZOS)
    canvas.alpha_composite(layer)
    return {
        "contract": VECTOR_PATH_CONTRACT,
        "pathCount": path_count,
        "contourCount": contour_count,
        "commandCount": command_count,
        "flattenedPointCount": flattened_points,
        "supersample": supersample,
    }

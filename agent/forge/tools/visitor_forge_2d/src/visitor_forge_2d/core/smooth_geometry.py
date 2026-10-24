"""Deterministic smooth closed-shape expansion for Visitor Forge 2D.

Scene recipes may author ``primitive: smooth_polygon`` control points.  This
module expands those controls to a bounded Catmull-Rom polygon before the core
scene composer validates/rasterizes the scene.  It gives boats, signs, rocks,
piers and decorative props curved silhouettes without adding a second raster
backend.
"""
from __future__ import annotations

from copy import deepcopy
import math

_MAX_CONTROLS = 64
_MAX_SAMPLES_PER_SEGMENT = 16


def _point(value: object, label: str) -> tuple[float, float]:
    if not isinstance(value, list) or len(value) != 2:
        raise ValueError(f"{label} must be [x, y]")
    x, y = value
    if isinstance(x, bool) or isinstance(y, bool) or not isinstance(x, (int, float)) or not isinstance(y, (int, float)):
        raise ValueError(f"{label} must contain numbers")
    if not math.isfinite(float(x)) or not math.isfinite(float(y)):
        raise ValueError(f"{label} must contain finite numbers")
    return float(x), float(y)


def sample_closed_catmull_rom(points: list, samples_per_segment: int = 6,
                               tension: float = 0.5) -> list[list[float]]:
    """Return a deterministic closed spline sampled as polygon vertices."""
    if not isinstance(points, list) or not 4 <= len(points) <= _MAX_CONTROLS:
        raise ValueError(f"smooth_polygon.points must contain 4..{_MAX_CONTROLS} controls")
    if type(samples_per_segment) is not int or not 2 <= samples_per_segment <= _MAX_SAMPLES_PER_SEGMENT:
        raise ValueError(f"smooth_polygon.samplesPerSegment must be 2..{_MAX_SAMPLES_PER_SEGMENT}")
    if isinstance(tension, bool) or not isinstance(tension, (int, float)) or not 0.0 <= float(tension) <= 1.0:
        raise ValueError("smooth_polygon.tension must be 0..1")
    controls = [_point(p, "smooth_polygon.points") for p in points]
    # Cardinal/Catmull-Rom tangent scale.  0.5 is classic Catmull-Rom.
    s = float(tension)
    out: list[list[float]] = []
    n = len(controls)
    for i in range(n):
        p0 = controls[(i - 1) % n]
        p1 = controls[i]
        p2 = controls[(i + 1) % n]
        p3 = controls[(i + 2) % n]
        m1 = (s * (p2[0] - p0[0]), s * (p2[1] - p0[1]))
        m2 = (s * (p3[0] - p1[0]), s * (p3[1] - p1[1]))
        for j in range(samples_per_segment):
            t = j / samples_per_segment
            t2, t3 = t * t, t * t * t
            h00 = 2*t3 - 3*t2 + 1
            h10 = t3 - 2*t2 + t
            h01 = -2*t3 + 3*t2
            h11 = t3 - t2
            x = h00*p1[0] + h10*m1[0] + h01*p2[0] + h11*m2[0]
            y = h00*p1[1] + h10*m1[1] + h01*p2[1] + h11*m2[1]
            out.append([round(x, 4), round(y, 4)])
    return out


def _expand_shape(node: dict) -> dict:
    result = deepcopy(node)
    if result.get("primitive") == "smooth_polygon":
        points = result.get("points")
        samples = result.pop("samplesPerSegment", 6)
        tension = result.pop("tension", 0.5)
        result["points"] = sample_closed_catmull_rom(points, samples, tension)
        result["primitive"] = "polygon"
    return result


def _expand_node(node: object) -> object:
    if not isinstance(node, dict):
        return deepcopy(node)
    result = _expand_shape(node)
    if isinstance(result.get("clip"), dict):
        result["clip"] = _expand_shape(result["clip"])
    if isinstance(result.get("children"), list):
        result["children"] = [_expand_node(child) for child in result["children"]]
    return result


def expand_recipe(recipe: dict) -> dict:
    """Expand every smooth polygon in layers, symbols and clip masks."""
    if not isinstance(recipe, dict):
        raise ValueError("recipe must be an object")
    result = deepcopy(recipe)
    if isinstance(result.get("layers"), list):
        result["layers"] = [_expand_node(node) for node in result["layers"]]
    symbols = result.get("symbols")
    if isinstance(symbols, dict):
        result["symbols"] = {name: [_expand_node(node) for node in nodes]
                             for name, nodes in symbols.items()}
    return result

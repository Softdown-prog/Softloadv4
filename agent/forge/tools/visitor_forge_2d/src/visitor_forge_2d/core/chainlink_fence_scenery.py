"""Deterministic chain-link fence family for City Horizon.

The source concept is used only as visual intent. The generator draws original
2D geometry and never samples pixels from the reference image.
"""
from __future__ import annotations

import hashlib
import json
import math
from pathlib import Path

from PIL import Image, ImageDraw

from .exporter import alpha_safe_resize

CONTRACT = "CH_2D_FENCE_SCENERY_V1"
VARIANT = "chainlink"
SCALE = 4
DIRECTIONS = {"east": (64.0, 32.0), "south": (-64.0, 32.0)}


def _color(value: object, label: str) -> tuple[int, int, int, int]:
    if not isinstance(value, str) or len(value) != 7 or not value.startswith("#"):
        raise ValueError(f"{label} must be #RRGGBB")
    return tuple(int(value[i:i + 2], 16) for i in (1, 3, 5)) + (255,)


def _number(value: object, label: str, low: float, high: float) -> float:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise ValueError(f"{label} must be numeric")
    result = float(value)
    if not math.isfinite(result) or not low <= result <= high:
        raise ValueError(f"{label} must be between {low} and {high}")
    return result


def validate_recipe(recipe: dict) -> dict:
    if not isinstance(recipe, dict) or recipe.get("contract") != CONTRACT:
        raise ValueError(f"Fence recipe must declare {CONTRACT}")
    if recipe.get("variant") != VARIANT:
        raise ValueError(f"Chain-link recipe must declare variant {VARIANT!r}")
    if recipe.get("camera") != {
        "contract": "CH_CAMERA_V1", "tile": [128, 64], "yawDeg": 45, "elevationDeg": 30,
    }:
        raise ValueError("Chain-link fence requires exact CH_CAMERA_V1")
    if recipe.get("canvas") != [192, 128] or recipe.get("anchor") != [96, 64]:
        raise ValueError("Chain-link modules require canvas [192,128] and anchor [96,64]")
    geometry = recipe.get("geometry")
    palette = recipe.get("palette")
    if not isinstance(geometry, dict) or not isinstance(palette, dict):
        raise ValueError("Chain-link recipe requires geometry and palette objects")
    checked = {
        "height": _number(geometry.get("heightPx"), "heightPx", 18, 48),
        "mesh_spacing": _number(geometry.get("meshSpacingPx"), "meshSpacingPx", 4, 12),
        "post_width": _number(geometry.get("postWidthPx"), "postWidthPx", 2, 10),
        "rail_width": _number(geometry.get("railWidthPx"), "railWidthPx", 1, 6),
    }
    for key in ("metal", "metalHighlight", "metalShadow", "mesh", "meshShadow", "groundShadow"):
        checked[key] = _color(palette.get(key), f"palette.{key}")
    return checked


def _pt(point: tuple[float, float]) -> tuple[int, int]:
    return round(point[0] * SCALE), round(point[1] * SCALE)


def _line(draw: ImageDraw.ImageDraw, points: list[tuple[float, float]],
          fill: tuple[int, int, int, int], width: float) -> None:
    draw.line([_pt(point) for point in points], fill=fill,
              width=max(1, round(width * SCALE)), joint="curve")


def _ellipse(draw: ImageDraw.ImageDraw, box: tuple[float, float, float, float],
             fill: tuple[int, int, int, int]) -> None:
    draw.ellipse(tuple(round(value * SCALE) for value in box), fill=fill)


def _mix(a: tuple[float, float], b: tuple[float, float], t: float) -> tuple[float, float]:
    return a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t


def _draw_post(draw: ImageDraw.ImageDraw, point: tuple[float, float], cfg: dict) -> None:
    x, y = point
    height = cfg["height"]
    width = cfg["post_width"]
    _line(draw, [(x, y - 1), (x, y - height - 5)], cfg["metalShadow"], width + 2)
    _line(draw, [(x, y - 1), (x, y - height - 5)], cfg["metal"], width)
    _line(draw, [(x - 0.8, y - 2), (x - 0.8, y - height - 4)], cfg["metalHighlight"], 0.8)
    radius = max(2.0, width * 0.7)
    _ellipse(draw, (x - radius, y - height - 8, x + radius, y - height - 3), cfg["metalShadow"])
    _ellipse(draw, (x - radius + 1, y - height - 7, x + radius - 1, y - height - 4),
             cfg["metalHighlight"])


def _draw_mesh(draw: ImageDraw.ImageDraw, p0: tuple[float, float], p1: tuple[float, float],
               cfg: dict, start: float = 0.0, end: float = 1.0) -> None:
    height = cfg["height"]
    low = 4.0
    q0, q1 = _mix(p0, p1, start), _mix(p0, p1, end)
    count = max(4, int(math.dist(q0, q1) / cfg["mesh_spacing"]))
    for index in range(-count, count * 2 + 1):
        a = index / count
        b = (index + 1) / count
        if not (0.0 <= a <= 1.0 or 0.0 <= b <= 1.0):
            continue
        a_clamped, b_clamped = max(0.0, min(1.0, a)), max(0.0, min(1.0, b))
        low_a, low_b = _mix(q0, q1, a_clamped), _mix(q0, q1, b_clamped)
        _line(draw, [(low_a[0], low_a[1] - low), (low_b[0], low_b[1] - height + 2)],
              cfg["meshShadow"], 1.4)
        _line(draw, [(low_a[0] - 0.25, low_a[1] - low),
                     (low_b[0] - 0.25, low_b[1] - height + 2)], cfg["mesh"], 0.65)
        _line(draw, [(low_b[0], low_b[1] - low), (low_a[0], low_a[1] - height + 2)],
              cfg["meshShadow"], 1.4)
        _line(draw, [(low_b[0] + 0.25, low_b[1] - low),
                     (low_a[0] + 0.25, low_a[1] - height + 2)], cfg["mesh"], 0.65)


def _draw_segment(draw: ImageDraw.ImageDraw, p0: tuple[float, float],
                  p1: tuple[float, float], cfg: dict) -> None:
    height = cfg["height"]
    _line(draw, [(p0[0] + 2, p0[1] + 4), (p1[0] + 2, p1[1] + 4)],
          (*cfg["groundShadow"][:3], 55), 4)
    _draw_mesh(draw, p0, p1, cfg)
    for rise in (height, 4.0):
        _line(draw, [(p0[0], p0[1] - rise), (p1[0], p1[1] - rise)],
              cfg["metalShadow"], cfg["rail_width"] + 1.5)
        _line(draw, [(p0[0], p0[1] - rise), (p1[0], p1[1] - rise)],
              cfg["metal"], cfg["rail_width"])
        _line(draw, [(p0[0], p0[1] - rise - 0.5), (p1[0], p1[1] - rise - 0.5)],
              cfg["metalHighlight"], 0.55)


def _draw_gate(draw: ImageDraw.ImageDraw, p0: tuple[float, float],
               p1: tuple[float, float], cfg: dict) -> None:
    height = cfg["height"]
    _line(draw, [(p0[0] + 2, p0[1] + 4), (p1[0] + 2, p1[1] + 4)],
          (*cfg["groundShadow"][:3], 55), 4)
    for start, end in ((0.0, 0.5), (0.5, 1.0)):
        q0, q1 = _mix(p0, p1, start), _mix(p0, p1, end)
        _draw_mesh(draw, p0, p1, cfg, start, end)
        for rise in (height, 4.0):
            _line(draw, [(q0[0], q0[1] - rise), (q1[0], q1[1] - rise)],
                  cfg["metalShadow"], 3.6)
            _line(draw, [(q0[0], q0[1] - rise), (q1[0], q1[1] - rise)], cfg["metal"], 2.4)
        for point in (q0, q1):
            _line(draw, [(point[0], point[1] - 4), (point[0], point[1] - height)],
                  cfg["metalShadow"], 3.7)
            _line(draw, [(point[0], point[1] - 4), (point[0], point[1] - height)],
                  cfg["metal"], 2.4)
    middle = _mix(p0, p1, 0.5)
    _line(draw, [(middle[0] - 3, middle[1] - height * 0.48),
                 (middle[0] + 3, middle[1] - height * 0.48)], cfg["metalShadow"], 2.2)
    _line(draw, [(middle[0] - 2.5, middle[1] - height * 0.48 - 0.4),
                 (middle[0] + 2.5, middle[1] - height * 0.48 - 0.4)],
          cfg["metalHighlight"], 0.8)


def _module(recipe: dict, cfg: dict, direction: str, kind: str) -> Image.Image:
    canvas = tuple(recipe["canvas"])
    work = Image.new("RGBA", (canvas[0] * SCALE, canvas[1] * SCALE))
    draw = ImageDraw.Draw(work)
    p0 = tuple(recipe["anchor"])
    vector = DIRECTIONS[direction]
    p1 = (p0[0] + vector[0], p0[1] + vector[1])
    if kind == "segment":
        _draw_segment(draw, p0, p1, cfg)
    elif kind == "gate":
        _draw_gate(draw, p0, p1, cfg)
    elif kind == "post":
        _draw_post(draw, p0, cfg)
    else:
        raise ValueError(f"Unknown chain-link module kind {kind!r}")
    return alpha_safe_resize(work, canvas)


def export_chainlink_fence_scenery(recipe_path: Path, output_dir: Path) -> dict:
    raw = recipe_path.read_bytes()
    recipe = json.loads(raw)
    cfg = validate_recipe(recipe)
    output_dir.mkdir(parents=True, exist_ok=True)
    outputs: dict[str, str] = {}
    for direction in DIRECTIONS:
        for kind in ("segment", "gate"):
            image = _module(recipe, cfg, direction, kind)
            path = output_dir / f"{recipe['id']}_{kind}_{direction}.png"
            image.save(path, format="PNG", optimize=False)
            outputs[f"{kind}_{direction}"] = str(path)
    post = _module(recipe, cfg, "east", "post")
    post_path = output_dir / f"{recipe['id']}_post.png"
    post.save(post_path, format="PNG", optimize=False)
    outputs["post"] = str(post_path)
    metadata = {
        "contract": CONTRACT,
        "variant": VARIANT,
        "id": recipe["id"],
        "camera": recipe["camera"],
        "canvas": recipe["canvas"],
        "anchor": recipe["anchor"],
        "segmentVectors": {name: list(vector) for name, vector in DIRECTIONS.items()},
        "composition": "chain-link segment sprites plus one post per occupied fence vertex",
        "gate": "two-leaf chain-link segment with latch; topology remains owned by FenceManager",
        "recipeSha256": hashlib.sha256(raw).hexdigest(),
        "outputs": outputs,
        "artApproved": False,
        "runtimePromotion": False,
    }
    metadata_path = output_dir / f"{recipe['id']}_metadata.json"
    metadata_path.write_text(json.dumps(metadata, indent=2) + "\n", encoding="utf-8")
    return {**metadata, "metadata": str(metadata_path)}

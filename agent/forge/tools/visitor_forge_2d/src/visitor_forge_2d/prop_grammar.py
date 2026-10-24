"""Parametric prop grammars for Visitor Forge 2D.

The scene composer is a low-level renderer.  This module sits one level above it
and turns bounded semantic parameters (pier length, width, ladder, boat size,
etc.) into deterministic CH_2D_SCENE_RECIPE_V4 geometry.  It intentionally
keeps the vocabulary small and explicit so agents can author many props without
hand-editing every point while preserving CH_CAMERA_V1 and review gates.
"""
from __future__ import annotations

import copy
import math

SCENE_CONTRACT = "CH_2D_SCENE_RECIPE_V4"
GRAMMAR_CONTRACT = "CH_2D_PROP_GRAMMAR_V1"


def _point_add(a: tuple[float, float], b: tuple[float, float]) -> tuple[float, float]:
    return a[0] + b[0], a[1] + b[1]


def _point_scale(a: tuple[float, float], factor: float) -> tuple[float, float]:
    return a[0] * factor, a[1] * factor


def _round_point(p: tuple[float, float]) -> list[float]:
    return [round(p[0], 2), round(p[1], 2)]


def _validate_bool(value: object, label: str) -> bool:
    if type(value) is not bool:
        raise ValueError(f"{label} must be true or false")
    return value


def _validate_int(value: object, label: str, low: int, high: int) -> int:
    if type(value) is not int or not low <= value <= high:
        raise ValueError(f"{label} must be {low}..{high}")
    return value


def _camera() -> dict:
    return {
        "contract": "CH_CAMERA_V1",
        "tile": [128, 64],
        "yawDeg": 45,
        "elevationDeg": 30,
        "projection": "orthographic_dimetric",
    }


def build_pier_recipe(
    asset_id: str,
    seed: int,
    *,
    length_tiles: int = 3,
    width_tiles: int = 1,
    ladder: bool = True,
    cleats: bool = True,
    railing: bool = False,
) -> dict:
    """Build one dock/pier scene from tile-like dimensions instead of raw points."""
    length_tiles = _validate_int(length_tiles, "lengthTiles", 2, 4)
    width_tiles = _validate_int(width_tiles, "widthTiles", 1, 2)
    ladder = _validate_bool(ladder, "ladder")
    cleats = _validate_bool(cleats, "cleats")
    railing = _validate_bool(railing, "railing")

    # Tuned to CH_CAMERA_V1 screen-space: one semantic length module advances
    # mostly right/down, while one width module advances right/up.
    long_v = (40.0 * length_tiles, 13.0 * length_tiles)
    wide_v = (35.0 * width_tiles, -19.0 * width_tiles)
    center = (128.0, 115.0)
    half_sum = _point_scale(_point_add(long_v, wide_v), 0.5)
    p0 = (center[0] - half_sum[0], center[1] - half_sum[1])
    p1 = _point_add(p0, wide_v)
    p2 = _point_add(p1, long_v)
    p3 = _point_add(p0, long_v)
    drop = (0.0, 9.0)
    p0d, p2d, p3d = _point_add(p0, drop), _point_add(p2, drop), _point_add(p3, drop)

    long_angle = math.degrees(math.atan2(long_v[1], long_v[0]))
    seam_angle = math.degrees(math.atan2(wide_v[1], wide_v[0]))
    deck = [_round_point(p) for p in (p0, p1, p2, p3)]
    front_face = [_round_point(p) for p in (p0, p3, p3d, p0d)]
    right_face = [_round_point(p) for p in (p3, p2, p2d, p3d)]

    xs = [p[0] for p in (p0, p1, p2, p3)]
    ys = [p[1] for p in (p0, p1, p2, p3)]
    shadow = [max(8, min(xs) - 12), max(8, max(ys) - 2), min(248, max(xs) + 16), min(186, max(ys) + 31)]

    post_symbol = [{
        "type": "shape", "primitive": "rounded_rect", "box": [-4, -22, 4, 8], "radius": 1.8,
        "material": {"type": "wood", "light": "#A9693E", "dark": "#4C2B1C", "grainAngleDeg": 88,
                     "grainSpacing": 4.0, "grainColor": "#26140D46"},
        "effects": {"ambientOcclusion": {"width": 1.5, "strength": 0.24},
                    "bevel": {"width": 0.9, "strength": 0.28},
                    "outline": {"width": 0.38, "color": "#321D14B8"}},
    }]
    cleat_symbol = [{
        "type": "shape", "primitive": "capsule", "box": [-5, -1.5, 5, 1.5], "radius": 1.5,
        "material": {"type": "painted_metal", "base": "#596269", "highlight": "#C0C8CB"},
        "effects": {"bevel": {"width": 0.55, "strength": 0.25},
                    "outline": {"width": 0.28, "color": "#2B30349A"}},
    }]

    layers: list[dict] = [
        {"type": "shape", "primitive": "ellipse", "box": [round(v, 2) for v in shadow],
         "material": {"type": "solid", "color": "#1119233E"}, "role": "ground_shadow"},
    ]

    # Structural posts are placed before the deck so the top surface occludes them naturally.
    for point in (p0d, p3d, p2d):
        layers.append({"type": "symbol", "symbol": "support_post",
                       "transform": {"translate": _round_point(point)}, "role": "support_post"})

    layers.extend([
        {"type": "shape", "primitive": "polygon", "points": front_face,
         "material": {"type": "wood", "light": "#8A5533", "dark": "#432519",
                      "grainAngleDeg": round(long_angle, 2), "grainSpacing": 5.1, "grainColor": "#22120C40"},
         "effects": {"shadow": {"offset": [4, 7], "blur": 3, "color": "#10151B78"},
                     "ambientOcclusion": {"width": 2.3, "strength": 0.24},
                     "outline": {"width": 0.42, "color": "#2E1A12B8"}}, "role": "front_fascia"},
        {"type": "shape", "primitive": "polygon", "points": right_face,
         "material": {"type": "wood", "light": "#9C6139", "dark": "#4B2A1B",
                      "grainAngleDeg": round(seam_angle, 2), "grainSpacing": 4.8, "grainColor": "#27150D3A"},
         "effects": {"ambientOcclusion": {"width": 2.0, "strength": 0.22},
                     "outline": {"width": 0.4, "color": "#2F1A12B0"}}, "role": "right_fascia"},
        {"type": "shape", "primitive": "polygon", "points": deck,
         "material": {"type": "wood", "light": "#C58A53", "dark": "#744329",
                      "grainAngleDeg": round(long_angle, 2), "grainSpacing": 4.5, "grainColor": "#3B211542"},
         "effects": {"ambientOcclusion": {"width": 1.7, "strength": 0.16},
                     "bevel": {"width": 0.9, "strength": 0.27},
                     "outline": {"width": 0.42, "color": "#3A2418B0"}}, "role": "deck"},
    ])

    # Fine highlight/shadow strokes stay clipped to the deck.
    def along(t: float, w: float = 0.5) -> tuple[float, float]:
        return (p0[0] + long_v[0] * t + wide_v[0] * w,
                p0[1] + long_v[1] * t + wide_v[1] * w)

    layers.append({
        "type": "clip_group", "clip": {"primitive": "polygon", "points": deck}, "role": "deck_detail",
        "children": [
            {"type": "shape", "primitive": "line", "points": [_round_point(along(0.08, 0.28)), _round_point(along(0.92, 0.28))],
             "width": 0.65, "material": {"type": "solid", "color": "#F1C18830"}},
            {"type": "shape", "primitive": "line", "points": [_round_point(along(0.12, 0.70)), _round_point(along(0.88, 0.70))],
             "width": 0.55, "material": {"type": "solid", "color": "#3A201624"}},
        ],
    })

    if cleats:
        for t in (0.34, 0.72):
            layers.append({"type": "symbol", "symbol": "cleat",
                           "transform": {"translate": _round_point(along(t, 0.56)), "rotateDeg": round(long_angle, 2)},
                           "role": "cleat"})

    if ladder:
        base = along(1.02, 0.78)
        rail1 = (base[0] - 5, base[1] - 6), (base[0] + 4, base[1] + 19)
        rail2 = (base[0] + 1, base[1] - 8), (base[0] + 10, base[1] + 17)
        layers.extend([
            {"type": "shape", "primitive": "line", "points": [_round_point(rail1[0]), _round_point(rail1[1])], "width": 2.0,
             "material": {"type": "painted_metal", "base": "#596269", "highlight": "#BBC3C6"},
             "effects": {"outline": {"width": 0.25, "color": "#30363A96"}}, "role": "ladder"},
            {"type": "shape", "primitive": "line", "points": [_round_point(rail2[0]), _round_point(rail2[1])], "width": 2.0,
             "material": {"type": "painted_metal", "base": "#596269", "highlight": "#BBC3C6"},
             "effects": {"outline": {"width": 0.25, "color": "#30363A96"}}, "role": "ladder"},
        ])
        for step in (0.34, 0.68):
            ax = rail1[0][0] + (rail1[1][0] - rail1[0][0]) * step
            ay = rail1[0][1] + (rail1[1][1] - rail1[0][1]) * step
            bx = rail2[0][0] + (rail2[1][0] - rail2[0][0]) * step
            by = rail2[0][1] + (rail2[1][1] - rail2[0][1]) * step
            layers.append({"type": "shape", "primitive": "line", "points": [[round(ax,2),round(ay,2)],[round(bx,2),round(by,2)]],
                           "width": 1.2, "material": {"type": "painted_metal", "base": "#5C666C", "highlight": "#C2C8CA"},
                           "role": "ladder"})

    if railing:
        rail_start, rail_end = along(0.05, 0.98), along(0.95, 0.98)
        for t in (0.08, 0.5, 0.92):
            q = along(t, 0.98)
            layers.append({"type": "shape", "primitive": "line",
                           "points": [[round(q[0],2), round(q[1]+1,2)], [round(q[0],2), round(q[1]-15,2)]],
                           "width": 2.1, "material": {"type": "wood", "light": "#B47847", "dark": "#5A321F",
                                                                             "grainAngleDeg": 90, "grainSpacing": 4.0},
                           "effects": {"bevel": {"width": 0.55, "strength": 0.22}}, "role": "railing"})
        layers.append({"type": "shape", "primitive": "line",
                       "points": [[round(rail_start[0],2),round(rail_start[1]-14,2)], [round(rail_end[0],2),round(rail_end[1]-14,2)]],
                       "width": 2.3, "material": {"type": "wood", "light": "#C08A55", "dark": "#603721",
                                                                         "grainAngleDeg": round(long_angle,2), "grainSpacing": 4.0},
                       "effects": {"bevel": {"width": 0.55, "strength": 0.22}}, "role": "railing"})

    recipe = {
        "contract": SCENE_CONTRACT,
        "id": asset_id,
        "canvas": [256, 192],
        "anchor": [128, 166],
        "seed": seed,
        "camera": _camera(),
        "lighting": {"direction": [-1, -1], "shadowOffset": [4, 6]},
        "finish": {"edgeBreakupPx": 0.42, "surfaceVariation": 0.04, "brushStamps": 14, "brushOpacity": 0.055},
        "validation": {"minimumOpaqueHeightPx": 58, "maximumOpaqueHeightPx": 184},
        "symbols": {"support_post": post_symbol, "cleat": cleat_symbol},
        "layers": layers,
        "finishRegions": [
            {"style": "plank_seams", "mask": {"primitive": "polygon", "points": deck},
             "stamps": max(7, length_tiles * 4 + 1), "opacity": 0.18, "angleDeg": round(seam_angle, 2)},
            {"style": "wood_wear", "mask": {"primitive": "polygon", "points": deck},
             "stamps": 28 + length_tiles * 3, "opacity": 0.09, "angleDeg": round(long_angle, 2)},
            {"style": "edge_wear", "mask": {"primitive": "polygon", "points": deck},
             "stamps": 22 + width_tiles * 3, "opacity": 0.10, "angleDeg": 0},
            {"style": "grime", "mask": {"primitive": "polygon", "points": front_face},
             "stamps": 12, "opacity": 0.075, "angleDeg": 0},
        ],
        "propGrammar": {
            "contract": GRAMMAR_CONTRACT,
            "archetype": "pier",
            "parameters": {"lengthTiles": length_tiles, "widthTiles": width_tiles,
                           "ladder": ladder, "cleats": cleats, "railing": railing},
        },
    }
    return recipe


def _scale_pair(value: list[float], origin: tuple[float, float], factor: float) -> list[float]:
    return [round(origin[0] + (float(value[0]) - origin[0]) * factor, 3),
            round(origin[1] + (float(value[1]) - origin[1]) * factor, 3)]


def _scale_node(node: dict, origin: tuple[float, float], factor: float, *, local: bool = False) -> None:
    node_origin = (0.0, 0.0) if local else origin
    if isinstance(node.get("points"), list):
        node["points"] = [_scale_pair(p, node_origin, factor) for p in node["points"]]
    if isinstance(node.get("box"), list) and len(node["box"]) == 4:
        x0, y0, x1, y1 = node["box"]
        p0 = _scale_pair([x0, y0], node_origin, factor); p1 = _scale_pair([x1, y1], node_origin, factor)
        node["box"] = [p0[0], p0[1], p1[0], p1[1]]
    if isinstance(node.get("center"), list):
        node["center"] = _scale_pair(node["center"], node_origin, factor)
    if isinstance(node.get("radius"), (int, float)):
        node["radius"] = round(float(node["radius"]) * factor, 3)
    elif isinstance(node.get("radius"), list) and len(node["radius"]) == 2:
        node["radius"] = [round(float(v) * factor, 3) for v in node["radius"]]
    if isinstance(node.get("width"), (int, float)):
        node["width"] = round(float(node["width"]) * factor, 3)
    transform = node.get("transform")
    if isinstance(transform, dict) and isinstance(transform.get("translate"), list):
        transform["translate"] = _scale_pair(transform["translate"], node_origin, factor)
    if node.get("type") == "scatter" and isinstance(node.get("spread"), list):
        node["spread"] = [round(float(v) * factor, 3) for v in node["spread"]]
    if isinstance(node.get("clip"), dict):
        _scale_node(node["clip"], node_origin, factor, local=local)
    if isinstance(node.get("children"), list):
        for child in node["children"]:
            _scale_node(child, node_origin, factor, local=local)


def configure_rowboat_recipe(template: dict, *, size: str = "medium", oar: bool = True, seats: int = 2) -> dict:
    """Derive bounded rowboat variants while keeping the approved V4 art grammar."""
    if size not in ("small", "medium", "large"):
        raise ValueError("rowboat size must be small, medium or large")
    oar = _validate_bool(oar, "oar")
    seats = _validate_int(seats, "seats", 1, 2)
    recipe = copy.deepcopy(template)
    if recipe.get("contract") != SCENE_CONTRACT:
        raise ValueError("rowboat grammar requires CH_2D_SCENE_RECIPE_V4 template")
    factor = {"small": 0.84, "medium": 1.0, "large": 1.14}[size]
    anchor = tuple(float(v) for v in recipe["anchor"])
    if factor != 1.0:
        for node in recipe.get("layers", []):
            _scale_node(node, anchor, factor, local=False)
        for nodes in recipe.get("symbols", {}).values():
            for node in nodes:
                _scale_node(node, (0.0, 0.0), factor, local=True)
        for region in recipe.get("finishRegions", []):
            if isinstance(region.get("mask"), dict):
                _scale_node(region["mask"], anchor, factor, local=False)
        validation = recipe.get("validation", {})
        for key in ("minimumOpaqueHeightPx", "maximumOpaqueHeightPx"):
            if isinstance(validation.get(key), (int, float)):
                validation[key] = round(float(validation[key]) * factor)
    layers = recipe.get("layers", [])
    if not oar:
        layers[:] = [node for node in layers if node.get("role") != "oar"]
    seat_instances = [node for node in layers if node.get("type") == "symbol" and node.get("symbol") == "seat"]
    if seats == 1 and len(seat_instances) > 1:
        keep = seat_instances[len(seat_instances) // 2]
        layers[:] = [node for node in layers if not (node.get("type") == "symbol" and node.get("symbol") == "seat") or node is keep]
    recipe["propGrammar"] = {"contract": GRAMMAR_CONTRACT, "archetype": "rowboat",
                             "parameters": {"size": size, "oar": oar, "seats": seats}}
    return recipe

"""A7 Art Planner V1.

The planner turns a semantic plant intent plus one canonical Structural Plant V1
skeleton into ordinary CH_2D_GRAPH_RECIPE_V2 recipes. It does not paint pixels
itself and deliberately stays separate from species-specific renderers.

An AI/LLM can author the intent later; this module is the deterministic execution
contract that makes such plans reproducible and testable.
"""
from __future__ import annotations

import copy
import colorsys
import math
import re
from typing import Any

from .field_graph import FIELD_GRAPH_CONTRACT, validate_recipe
from .flower_cluster_engine import FLOWER_CLUSTER_CONTRACT
from .plant_structure import (
    CARDINAL_VIEWS,
    PLANT_STRUCTURE_CONTRACT,
    PlantProjection,
    PlantStructure,
    generate_plant_structure,
    project_four_views,
)

ART_PLANNER_CONTRACT = "A7_ART_PLANNER_V1"
PLANT_INTENT_CONTRACT = "A7_PLANT_INTENT_V1"
_SAFE = re.compile(r"[^a-z0-9_-]+")

_SPECIES_PROFILES: dict[str, dict[str, Any]] = {
    "generic_broadleaf": {
        "trunkHeight": 1.0,
        "trunkWidth": 0.115,
        "crownStart": 0.46,
        "primaryCount": 6,
        "secondaryPerPrimary": 2,
        "primaryLength": [0.46, 0.70],
        "secondaryLength": [0.22, 0.38],
        "primaryRise": [0.18, 0.34],
        "secondaryRise": [0.08, 0.20],
        "asymmetry": 0.16,
    },
    "ipe_amarelo": {
        "trunkHeight": 1.18,
        "trunkWidth": 0.16,
        "crownStart": 0.43,
        "primaryCount": 4,
        "secondaryPerPrimary": 2,
        "secondaryPattern": [3, 2, 3, 2],
        "primaryLength": [0.44, 0.64],
        "secondaryLength": [0.23, 0.36],
        "primaryRise": [0.30, 0.48],
        "primaryRiseRatioMin": 0.50,
        "secondaryRise": [0.12, 0.25],
        "primaryForkSpread": [0.06, 0.30],
        "primaryForkAngleDeg": [52.0, 74.0],
        "secondaryAttach": [0.34, 0.76],
        "secondaryContinuationDeg": [4.0, 14.0],
        "secondaryLateralFanDeg": [27.0, 48.0],
        "visibleWood": 0.34,
        "radialJitterDeg": 18,
        "bend": 0.15,
        "asymmetry": 0.20,
    },
    "mangueira": {
        "trunkHeight": 0.93,
        "trunkWidth": 0.13,
        "crownStart": 0.37,
        "primaryCount": 7,
        "secondaryPerPrimary": 2,
        "primaryLength": [0.54, 0.80],
        "secondaryLength": [0.24, 0.42],
        "primaryRise": [0.12, 0.28],
        "secondaryRise": [0.06, 0.18],
        "radialJitterDeg": 24,
        "bend": 0.17,
        "asymmetry": 0.22,
    },
}

_GREEN_REAR = ["#244B30", "#2C5936", "#35643C"]
_GREEN_MID = ["#315E38", "#3B6D3F", "#477A46"]
_GREEN_FRONT = ["#39703F", "#478348", "#559250"]


def _safe_id(value: str) -> str:
    text = _SAFE.sub("_", value.strip().lower()).strip("_")
    return text or "plant"


def _clamp(value: float, lo: float, hi: float) -> float:
    return max(lo, min(hi, value))


def normalize_plant_intent(intent: dict) -> dict:
    if not isinstance(intent, dict):
        raise ValueError("plant intent must be an object")
    if intent.get("contract") not in (None, PLANT_INTENT_CONTRACT):
        raise ValueError(f"plant intent must declare {PLANT_INTENT_CONTRACT}")
    species = _safe_id(str(intent.get("species", "generic_broadleaf")))
    if species not in _SPECIES_PROFILES:
        species = "generic_broadleaf"
    flowering = intent.get("flowering", {})
    if not isinstance(flowering, dict):
        flowering = {}
    return {
        "contract": PLANT_INTENT_CONTRACT,
        "id": _safe_id(str(intent.get("id", f"{species}_planner"))),
        "species": species,
        "age": str(intent.get("age", "adult")).lower(),
        "crown": str(intent.get("crown", "wide_irregular")).lower(),
        "style": str(intent.get("style", "classic_tycoon_pre_rendered")),
        "flowering": {
            "amount": _clamp(float(flowering.get("amount", 0.0)), 0.0, 1.0),
            "color": str(flowering.get("color", "#F3C62F")),
            "leafRetention": _clamp(float(flowering.get("leafRetention", 0.14 if species == "ipe_amarelo" else 1.0)), 0.0, 1.0),
        },
        "seed": int(intent.get("seed", 1)),
        "canvas": list(intent.get("canvas", [256, 320])),
        "anchor": list(intent.get("anchor", [128, 310])),
    }


def profile_from_intent(intent: dict) -> dict:
    normalized = normalize_plant_intent(intent)
    profile = copy.deepcopy(_SPECIES_PROFILES[normalized["species"]])
    crown = normalized["crown"]
    if "wide" in crown:
        profile["primaryLength"] = [value * 1.10 for value in profile["primaryLength"]]
        profile["secondaryLength"] = [value * 1.08 for value in profile["secondaryLength"]]
        profile["asymmetry"] = max(profile.get("asymmetry", 0.16), 0.19)
    if "compact" in crown:
        profile["primaryLength"] = [value * 0.86 for value in profile["primaryLength"]]
        profile["secondaryLength"] = [value * 0.86 for value in profile["secondaryLength"]]
    if normalized["age"] in {"young", "juvenile"}:
        profile["primaryCount"] = max(4, int(profile["primaryCount"]) - 1)
        profile["secondaryPerPrimary"] = 1
        profile.pop("secondaryPattern", None)
        profile["trunkWidth"] *= 0.82
    elif normalized["age"] in {"old", "mature_old"}:
        profile["trunkWidth"] *= 1.14
        profile["asymmetry"] = min(0.30, profile.get("asymmetry", 0.16) + 0.05)
    return profile


def _bounds_from_terminals(terminals: tuple[tuple[float, float], ...], canvas: list[int]) -> list[int]:
    """Safe center bounds keep supersampled clusters inside the asset canvas."""
    safe_x, safe_top, safe_bottom = 34, 30, 28
    if not terminals:
        return [safe_x, safe_top, canvas[0] - safe_x, canvas[1] - safe_bottom]
    xs = [point[0] for point in terminals]
    ys = [point[1] for point in terminals]
    left = max(safe_x, int(min(xs) - 34))
    top = max(safe_top, int(min(ys) - 30))
    right = min(canvas[0] - safe_x, int(max(xs) + 34))
    bottom = min(canvas[1] - safe_bottom, int(max(ys) + 34))
    if right <= left:
        left, right = safe_x, canvas[0] - safe_x
    if bottom <= top:
        top, bottom = safe_top, canvas[1] - safe_bottom
    return [left, top, right, bottom]


def _crown_lobes(projection: PlantProjection, intent: dict) -> list[dict]:
    terminals = list(projection.terminals)
    if not terminals:
        return [{"center": [projection.anchor[0], projection.anchor[1] - 150], "radius": [62, 48], "weight": 1.0}]
    crown = normalize_plant_intent(intent)["crown"]
    wide = 1.12 if "wide" in crown else 1.0
    lobes = []
    for index, (x, y) in enumerate(terminals):
        scale = 0.92 + (index % 3) * 0.07
        lobes.append({
            "center": [round(x, 2), round(y, 2)],
            "radius": [round(37 * wide * scale, 2), round(29 * scale, 2)],
            "weight": round(0.82 + (index % 4) * 0.05, 2),
        })
    mean_x = sum(point[0] for point in terminals) / len(terminals)
    mean_y = sum(point[1] for point in terminals) / len(terminals)
    lobes.append({"center": [round(mean_x, 2), round(mean_y + 10, 2)], "radius": [round(64 * wide, 2), 46], "weight": 0.76})
    return lobes


def _flower_lobes(projection: PlantProjection, amount: float) -> list[dict]:
    """Flowering zones stay near terminal branch tips instead of filling the crown."""
    strength = _clamp(float(amount), 0.0, 1.0)
    lobes = []
    for index, (x, y) in enumerate(projection.terminals):
        variation = 0.90 + (index % 3) * 0.08
        lobes.append({
            "center": [round(x, 2), round(y, 2)],
            "radius": [round((18.0 + 16.0 * strength) * variation, 2), round((14.0 + 10.0 * strength) * variation, 2)],
            "weight": round(0.72 + 0.25 * strength, 2),
        })
    return lobes


def _flower_palette(normalized: dict) -> dict:
    color = normalized["flowering"]["color"]
    if not re.fullmatch(r"#[0-9a-fA-F]{6}", color):
        raise ValueError("flowering.color must be #RRGGBB")
    rgb = tuple(int(color[i:i + 2], 16) / 255 for i in (1, 3, 5))
    h, saturation, value = colorsys.rgb_to_hsv(*rgb)
    def tone(value_scale, saturation_scale=1.0):
        shadow_hue = h - 0.045 * max(0.0, 1.0 - value_scale) if 0.10 <= h <= 0.20 else h
        channels = colorsys.hsv_to_rgb(shadow_hue % 1, min(1, saturation * saturation_scale), min(1, value * value_scale))
        return "#" + "".join(f"{round(channel * 255):02X}" for channel in channels)
    return {
        "backTop": tone(0.86), "backBottom": tone(0.52),
        "midTop": color.upper(), "midBottom": tone(0.72),
        "frontTop": tone(1.10, 0.90), "highlight": tone(1.20, 0.58),
        "occlusion": tone(0.36, 0.82),
    }


def _wood_paths(projection: PlantProjection) -> list[dict]:
    return [
        {key: value for key, value in path.items() if key not in {"branchId", "parentId", "order"}}
        for path in projection.paths
    ]


def _rear_cluster() -> dict:
    return {"members": [
        {
            "type": "brush", "offset": [0, 0],
            "brushes": ["foliage_v2/foliage_mass_01.png", "foliage_v2/foliage_mass_02.png"],
            "scale": [0.82, 1.10], "aspect": [0.82, 1.20], "rotationDeg": [-24, 24],
            "opacity": [170, 210], "tints": _GREEN_REAR, "value": [0.88, 1.0],
        },
        {
            "type": "brush", "offset": [-8, -2],
            "brushes": ["foliage_v2/foliage_cluster_01.png", "foliage_v2/foliage_cluster_02.png"],
            "scale": [0.60, 0.78], "aspect": [0.88, 1.14], "rotationDeg": [-28, 28],
            "opacity": [178, 220], "tints": _GREEN_MID, "value": [0.90, 1.02],
        },
        {
            "type": "brush", "offset": [9, 3],
            "brushes": ["foliage_v2/foliage_cluster_01.png", "foliage_v2/foliage_cluster_02.png"],
            "scale": [0.58, 0.76], "aspect": [0.88, 1.14], "rotationDeg": [-28, 28],
            "opacity": [178, 220], "tints": _GREEN_MID, "value": [0.90, 1.02],
        },
    ]}


def _meso_cluster() -> dict:
    """Compound asymmetric foliage mass used only to unify the crown interior."""
    return {"members": [
        {
            "type": "brush", "offset": [-2, 1],
            "brushes": ["foliage_v2/foliage_mass_01.png", "foliage_v2/foliage_mass_02.png"],
            "scale": [0.78, 1.04], "aspect": [0.72, 1.34], "rotationDeg": [-34, 34],
            "opacity": [132, 168], "tints": _GREEN_MID, "value": [0.91, 1.01],
        },
        {
            "type": "brush", "offset": [11, -4],
            "brushes": ["foliage_v2/foliage_mass_01.png", "foliage_v2/foliage_mass_02.png"],
            "scale": [0.50, 0.72], "aspect": [0.70, 1.38], "rotationDeg": [-42, 42],
            "opacity": [122, 158], "tints": _GREEN_REAR, "value": [0.88, 0.98],
        },
        {
            "type": "brush", "offset": [-12, -5],
            "brushes": ["foliage_v2/foliage_cluster_01.png", "foliage_v2/foliage_cluster_02.png"],
            "scale": [0.48, 0.70], "aspect": [0.78, 1.28], "rotationDeg": [-38, 38],
            "opacity": [172, 214], "tints": _GREEN_MID, "value": [0.92, 1.03],
        },
        {
            "type": "brush", "offset": [-5, 9],
            "brushes": ["foliage_v2/foliage_cluster_01.png", "foliage_v2/foliage_cluster_02.png"],
            "scale": [0.42, 0.64], "aspect": [0.80, 1.24], "rotationDeg": [-46, 46],
            "opacity": [178, 222], "tints": _GREEN_MID, "value": [0.94, 1.04],
        },
        {
            "type": "brush", "offset": [12, 7],
            "brushes": ["foliage_v2/foliage_edge_01.png", "foliage_v2/foliage_edge_02.png"],
            "scale": [0.34, 0.54], "aspect": [0.84, 1.22], "rotationDeg": [-52, 52],
            "opacity": [188, 228], "tints": _GREEN_FRONT, "value": [0.96, 1.06],
        },
    ]}


def _front_cluster() -> dict:
    return {"members": [
        {
            "type": "brush", "offset": [0, 0],
            "brushes": ["foliage_v2/foliage_mass_01.png", "foliage_v2/foliage_mass_02.png"],
            "scale": [0.64, 0.84], "aspect": [0.86, 1.16], "rotationDeg": [-22, 22],
            "opacity": [138, 178], "tints": _GREEN_MID, "value": [0.94, 1.04],
        },
        {
            "type": "brush", "offset": [-7, -4],
            "brushes": ["foliage_v2/foliage_cluster_01.png", "foliage_v2/foliage_cluster_02.png"],
            "scale": [0.58, 0.78], "aspect": [0.88, 1.14], "rotationDeg": [-30, 30],
            "opacity": [228, 255], "tints": _GREEN_FRONT, "hueJitterDeg": 3,
            "saturation": [0.95, 1.05], "value": [0.96, 1.09],
        },
        {
            "type": "brush", "offset": [7, -2],
            "brushes": ["foliage_v2/foliage_cluster_01.png", "foliage_v2/foliage_cluster_02.png"],
            "scale": [0.58, 0.78], "aspect": [0.88, 1.14], "rotationDeg": [-30, 30],
            "opacity": [228, 255], "tints": _GREEN_FRONT, "hueJitterDeg": 3,
            "saturation": [0.95, 1.05], "value": [0.96, 1.09],
        },
    ]}


def build_plant_graph_recipe(intent: dict, structure: PlantStructure, projection: PlantProjection) -> dict:
    """Compile semantic plant intent into an ordinary Graph V2 recipe."""
    normalized = normalize_plant_intent(intent)
    canvas, anchor, seed = normalized["canvas"], normalized["anchor"], normalized["seed"]
    view = projection.view
    terminals = projection.terminals
    bounds = _bounds_from_terminals(terminals, canvas)
    terminal_count = max(1, len(terminals))
    flowering = normalized["flowering"]
    flowering_amount = flowering["amount"]
    has_flowers = flowering_amount >= 0.2
    paths = _wood_paths(projection)
    center_x = sum(point[0] for point in terminals) / terminal_count if terminals else anchor[0]
    center_y = sum(point[1] for point in terminals) / terminal_count if terminals else anchor[1] - 150

    # Heavily flowering trees keep foliage as structure/support, not as the dominant surface.
    foliage_factor = (1.0 - flowering_amount) ** 2 + flowering_amount * flowering["leafRetention"]

    nodes: list[dict] = [
        {"id": "base", "type": "canvas", "params": {"color": [0, 0, 0, 0]}},
        {"id": "wood_structure", "type": "tapered_path", "inputs": {"image": "base"}, "params": {"supersample": 4, "paths": paths}},
        {"id": "wood_mask", "type": "field_alpha_mask", "inputs": {"source": "wood_structure"}, "params": {"threshold": 10, "expandPx": 1, "blurRadius": 0.7}},
        {"id": "branch_proximity", "type": "field_distance", "inputs": {"field": "wood_mask"}, "params": {"maxDistance": 54, "threshold": 64, "proximity": True}},
        {"id": "crown_density", "type": "field_radial_density", "params": {"power": 0.74, "lobes": _crown_lobes(projection, normalized)}},
        {"id": "structured_density", "type": "field_multiply", "inputs": {"a_crown": "crown_density", "b_branch": "branch_proximity"}},
        {"id": "rear_core_density", "type": "field_multiply", "inputs": {"a": "structured_density", "b": "structured_density"}},
        {"id": "depth", "type": "field_linear_depth", "params": {"start": [anchor[0], max(0, bounds[1])], "end": [anchor[0], min(canvas[1] - 1, bounds[3])]}},
        {"id": "direction", "type": "field_direction_to_point", "params": {"point": [round(center_x, 2), round(center_y, 2)], "offsetDeg": 180}},
        {"id": "rear_canvas", "type": "canvas", "params": {"color": [0, 0, 0, 0]}},
        {
            "id": "rear_foliage", "type": "field_cluster_scatter",
            "inputs": {"image": "rear_canvas", "density": "rear_core_density", "depth": "depth", "direction": "direction", "distance": "branch_proximity"},
            "params": {
                "count": max(1, round(terminal_count * 0.85 * foliage_factor)), "bounds": bounds,
                "minDistance": 14.0, "maxAttempts": 32000, "scale": [0.90, 1.14],
                "rotationDeg": [-14, 14], "mirrorXProbability": 0.5,
                "mappings": {"scale_mul": {"base": 1.0, "inputs": {"density": [[0.0, -0.04], [1.0, 0.14]], "depth": [[0.0, -0.03], [1.0, 0.05]]}}},
                "cluster": _rear_cluster(),
            },
        },
        {"id": "wood_visible", "type": "tapered_path", "inputs": {"image": "rear_foliage"}, "params": {"supersample": 4, "paths": paths}},
        {
            "id": "wood_material", "type": "image_masked_relief_material",
            "inputs": {"image": "wood_visible", "mask": "wood_mask"},
            "params": {
                "lightDirection": [-0.9, -0.35], "reliefStrength": 0.33, "edgeShade": 0.16,
                "coarsePx": 11, "coarseAmount": 0.15, "grainAxis": "vertical",
                "grainScalePx": 6, "grainAmount": 0.15, "fineAmount": 0.025, "seedOffset": 97,
            },
        },
        {"id": "meso_canvas", "type": "canvas", "params": {"color": [0, 0, 0, 0]}},
        {
            "id": "meso_foliage", "type": "field_cluster_scatter",
            "inputs": {"image": "meso_canvas", "density": "rear_core_density", "avoid": "wood_mask", "depth": "depth", "direction": "direction", "distance": "branch_proximity"},
            "params": {
                "count": max(1, round(terminal_count * 0.52 * foliage_factor)), "bounds": bounds,
                "minDistance": 16.0, "maxAttempts": 30000, "scale": [0.92, 1.18],
                "rotationDeg": [-30, 30], "mirrorXProbability": 0.5,
                "mappings": {"scale_mul": {"base": 1.0, "inputs": {"density": [[0.0, -0.08], [1.0, 0.10]], "depth": [[0.0, -0.04], [1.0, 0.04]]}}},
                "cluster": _meso_cluster(),
            },
        },
        {"id": "meso_shadow", "type": "image_contact_occlusion", "inputs": {"base": "wood_material", "occluder": "meso_foliage"}, "params": {"radius": 2.0, "strength": 0.16, "offset": [0, 1], "color": "#132018", "expandPx": 0, "baseAlphaOnly": True}},
        {"id": "meso_composite", "type": "image_composite", "inputs": {"base": "meso_shadow", "layer": "meso_foliage"}, "params": {"opacity": 1.0}},
        {"id": "front_canvas", "type": "canvas", "params": {"color": [0, 0, 0, 0]}},
        {
            "id": "front_foliage", "type": "field_cluster_scatter",
            "inputs": {"image": "front_canvas", "density": "structured_density", "avoid": "wood_mask", "depth": "depth", "direction": "direction", "distance": "branch_proximity"},
            "params": {
                "count": max(1, round(terminal_count * 1.45 * foliage_factor)), "bounds": bounds,
                "minDistance": 10.5, "maxAttempts": 36000, "scale": [0.78, 1.06],
                "rotationDeg": [-14, 14], "mirrorXProbability": 0.5,
                "mappings": {"scale_mul": {"base": 0.98, "inputs": {"density": [[0.0, -0.06], [1.0, 0.15]], "depth": [[0.0, -0.03], [1.0, 0.08]]}}},
                "cluster": _front_cluster(),
            },
        },
        {"id": "front_shadow", "type": "image_contact_occlusion", "inputs": {"base": "meso_composite", "occluder": "front_foliage"}, "params": {"radius": 2.4, "strength": 0.25, "offset": [0, 2], "color": "#101B13", "expandPx": 1, "baseAlphaOnly": True}},
        {"id": "front_composite", "type": "image_composite", "inputs": {"base": "front_shadow", "layer": "front_foliage"}, "params": {"opacity": 1.0}},
        {"id": "detail_canvas", "type": "canvas", "params": {"color": [0, 0, 0, 0]}},
        {
            "id": "detail_foliage", "type": "field_mapped_scatter",
            "inputs": {"image": "detail_canvas", "density": "structured_density", "avoid": "wood_mask", "depth": "depth", "direction": "direction", "distance": "branch_proximity"},
            "params": {
                "brushes": ["foliage_v2/foliage_edge_01.png", "foliage_v2/foliage_edge_02.png"],
                "count": max(1, round(terminal_count * 1.20 * foliage_factor)),
                "bounds": bounds, "minDistance": 5.0, "maxAttempts": 28000,
                "scale": [0.44, 0.64], "aspect": [0.88, 1.14], "rotationDeg": [-28, 28],
                "opacity": [220, 255], "tints": _GREEN_FRONT, "hueJitterDeg": 3,
                "saturation": [0.96, 1.06], "value": [0.98, 1.08],
                "mappings": {
                    "scale_mul": {"base": 0.98, "inputs": {"density": [[0.0, -0.08], [1.0, 0.12]]}},
                    "opacity_mul": {"base": 1.0, "inputs": {"depth": [[0.0, -0.10], [1.0, 0.02]]}},
                },
            },
        },
        {"id": "detail_shadow", "type": "image_contact_occlusion", "inputs": {"base": "front_composite", "occluder": "detail_foliage"}, "params": {"radius": 1.6, "strength": 0.14, "offset": [0, 1], "color": "#122016", "expandPx": 0, "baseAlphaOnly": True}},
        {"id": "detail_composite", "type": "image_composite", "inputs": {"base": "detail_shadow", "layer": "detail_foliage"}, "params": {"opacity": 1.0}},
    ]

    # Dense blossom crowns need a warm connected rear mass; leaf retention
    # controls green surfaces independently of this flowering support.
    if has_flowers and flowering_amount >= 0.5:
        palette = _flower_palette(normalized)
        rear = next(node for node in nodes if node["id"] == "rear_foliage")
        rear["type"] = "field_flower_clusters"
        rear["inputs"] = {"image": "rear_canvas", "density": "structured_density", "depth": "depth"}
        rear["params"] = {
            "count": max(12, round(terminal_count * 2.2 * flowering_amount)),
            "bounds": bounds, "minDistance": 7.0, "maxAttempts": 40000,
            "radiusX": [13.0, 19.0], "radiusY": [10.0, 14.0],
            "blossomStyle": "petalled", "blossomDensity": 1.1,
            "gapWindows": [1, 2], "edgeSprayProbability": 0.25,
            "palette": {**palette, "midTop": palette["backTop"], "frontTop": palette["midTop"], "highlight": palette["frontTop"]},
        }


    finish_input = "detail_composite"
    if has_flowers:
        nodes.extend([
            {"id": "flower_density", "type": "field_radial_density", "params": {"power": 0.85, "lobes": _flower_lobes(projection, flowering_amount)}},
            {"id": "flower_canvas", "type": "canvas", "params": {"color": [0, 0, 0, 0]}},
            {
                "id": "flower_clusters", "type": "field_flower_clusters",
                "inputs": {"image": "flower_canvas", "density": "flower_density", "avoid": "wood_mask", "depth": "depth"},
                "params": {
                    "count": max(8, round(terminal_count * (0.6 + flowering_amount * 4.4))),
                    "bounds": bounds, "minDistance": 6.0, "maxAttempts": 40000,
                    "radiusX": [7.0, 12.0], "radiusY": [5.5, 9.0],
                    "blossomStyle": "petalled", "blossomDensity": 1.45, "gapWindows": [2, 3], "edgeSprayProbability": 0.46,
                    "palette": _flower_palette(normalized),
                },
            },
            {"id": "flower_shadow", "type": "image_contact_occlusion", "inputs": {"base": "detail_composite", "occluder": "flower_clusters"}, "params": {"radius": 1.5, "strength": 0.15, "offset": [0, 1], "color": "#4B3617", "expandPx": 0, "baseAlphaOnly": True}},
            {"id": "flower_composite", "type": "image_composite", "inputs": {"base": "flower_shadow", "layer": "flower_clusters"}, "params": {"opacity": 1.0}},
        ])
        finish_input = "flower_composite"

    nodes.extend([
        {"id": "finish", "type": "image_local_contrast", "inputs": {"image": finish_input}, "params": {"radius": 1.2, "amount": 0.28, "globalContrast": 1.02}},
        {"id": "out", "type": "output", "inputs": {"image": "finish"}},
    ])

    recipe = {
        "contract": FIELD_GRAPH_CONTRACT,
        "id": f"{_safe_id(normalized['id'])}_{view}",
        "canvas": canvas,
        "anchor": anchor,
        "seed": seed,
        "camera": {
            "contract": "CH_CAMERA_V1", "projection": "orthographic_dimetric", "tile": [128, 64],
            "yawDeg": 45, "elevationDeg": 30, "worldHeightScreenVertical": True,
        },
        "planner": {
            "contract": ART_PLANNER_CONTRACT,
            "intentContract": PLANT_INTENT_CONTRACT,
            "structureContract": PLANT_STRUCTURE_CONTRACT,
            "species": normalized["species"], "view": view, "style": normalized["style"],
            "branchIds": list(projection.branch_ids), "terminalCount": len(terminals),
            "floweringAmount": flowering_amount,
            "leafRetention": flowering["leafRetention"],
            "rearCanopySurface": "blossoms" if has_flowers and flowering_amount >= 0.5 else "leaves",
            "flowerPlacement": "terminal_density" if has_flowers else "none",
            "flowerEngineContract": FLOWER_CLUSTER_CONTRACT if has_flowers else None,
            "foliageComposition": "rear_meso_front_detail",
            "mesoFoliage": "compound_asymmetric_internal",
            "temporaryFlowerProxy": False,
        },
        "graph": {"seed": seed, "nodes": nodes},
    }
    validate_recipe(recipe)
    return recipe


def plan_plant_four_views(intent: dict) -> tuple[PlantStructure, dict[str, dict]]:
    normalized = normalize_plant_intent(intent)
    canvas = tuple(int(v) for v in normalized["canvas"])
    anchor = tuple(int(v) for v in normalized["anchor"])
    if len(canvas) != 2 or min(canvas) <= 0:
        raise ValueError("plant intent canvas must contain two positive integers")
    if len(anchor) != 2:
        raise ValueError("plant intent anchor must contain two integers")
    structure = generate_plant_structure(normalized["seed"], profile_from_intent(normalized))
    # Fit one shared scale across all rotations; never stretch each sprite separately.
    previews = project_four_views(structure, canvas=canvas, anchor=anchor, scale=1.0)
    padding = 42.0
    scale_limits = []
    for projection in previews.values():
        for path in projection.paths:
            for x, y in path["points"]:
                dx, dy = x - anchor[0], y - anchor[1]
                if dx < 0: scale_limits.append((anchor[0] - padding) / -dx)
                if dx > 0: scale_limits.append((canvas[0] - anchor[0] - padding) / dx)
                if dy < 0: scale_limits.append((anchor[1] - padding) / -dy)
    if not scale_limits or min(scale_limits) <= 0:
        raise ValueError("plant canvas and anchor must leave room for the crown")
    scale = min(scale_limits)
    # The intent anchor marks the foot, whereas projected paths start at the
    # trunk centerline. Reserve its round cap so thick trunks keep that foot.
    root_cap = math.ceil(structure.branches[0].width_start * scale * 0.64 / 2 + 2)
    path_anchor = (anchor[0], anchor[1] - root_cap)
    projections = project_four_views(structure, canvas=canvas, anchor=path_anchor, scale=scale)
    recipes = {view: build_plant_graph_recipe(normalized, structure, projections[view]) for view in CARDINAL_VIEWS}
    for recipe in recipes.values():
        recipe["planner"]["projectionScale"] = round(scale, 6)
    return structure, recipes

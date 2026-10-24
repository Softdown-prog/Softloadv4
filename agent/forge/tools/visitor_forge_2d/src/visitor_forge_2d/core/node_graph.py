"""A7 Node Graph V1: deterministic data-driven 2D composition."""
from __future__ import annotations

import copy
import hashlib
import re

from PIL import Image, ImageEnhance

from .brush_engine_v2 import BRUSH_CONTRACT, BrushEngineV2
from .brush_engine_v3 import BRUSH_V3_CONTRACT, BrushEngineV3
from .brush_option_bindings import BRUSH_OPTION_BINDINGS_CONTRACT
from .cluster_engine import CLUSTER_CONTRACT, ClusterEngineV1
from .dab_density import DAB_DENSITY_CONTRACT
from .distribution_engine import DISTRIBUTION_CONTRACT, DistributionEngineV1
from .dynamics_mapping import DYNAMICS_MAPPING_CONTRACT
from .geometry_engine import GEOMETRY_CONTRACT, draw_tapered_paths
from .mapped_brush_engine import MAPPED_BRUSH_CONTRACT, MappedBrushEngineV1
from .sensor_context import SENSOR_CONTEXT_CONTRACT
from .vector_path import VECTOR_PATH_CONTRACT, draw_vector_paths

GRAPH_CONTRACT = "CH_2D_GRAPH_RECIPE_V1"
_SAFE_ID = re.compile(r"[a-z0-9][a-z0-9_-]*\Z")
SUPPORTED_NODE_TYPES = {
    "canvas",
    "brush_scatter",
    "path_brush",
    "dynamic_scatter",
    "dynamic_path_brush",
    "mapped_dynamic_scatter",
    "tapered_path",
    "vector_path",
    "spaced_scatter",
    "cluster_scatter",
    "blend",
    "levels",
    "output",
}


def validate_recipe(recipe: dict) -> None:
    if not isinstance(recipe, dict) or recipe.get("contract") != GRAPH_CONTRACT:
        raise ValueError(f"graph recipe must declare {GRAPH_CONTRACT}")
    asset_id = recipe.get("id")
    if not isinstance(asset_id, str) or not _SAFE_ID.fullmatch(asset_id):
        raise ValueError("graph id must use lowercase letters, digits, _ or -")
    canvas, anchor = recipe.get("canvas"), recipe.get("anchor")
    if not isinstance(canvas, list) or len(canvas) != 2 or any(type(v) is not int or v <= 0 for v in canvas):
        raise ValueError("graph canvas must contain two positive integer pixels")
    if not isinstance(anchor, list) or len(anchor) != 2 or any(type(v) is not int or v < 0 or v > limit for v, limit in zip(anchor, canvas)):
        raise ValueError("graph anchor must lie inside canvas")
    camera = recipe.get("camera", {})
    if camera.get("contract") != "CH_CAMERA_V1" or camera.get("tile") != [128, 64] or camera.get("yawDeg", 45) != 45 or camera.get("elevationDeg", 30) != 30:
        raise ValueError("graph recipe requires CH_CAMERA_V1, tile 128x64, yaw 45, elevation 30")
    graph = recipe.get("graph")
    nodes = graph.get("nodes") if isinstance(graph, dict) else None
    if not isinstance(nodes, list) or not nodes:
        raise ValueError("graph.nodes must be a non-empty list")
    seen, outputs = set(), 0
    for node in nodes:
        if not isinstance(node, dict):
            raise ValueError("each graph node must be an object")
        node_id, node_type = node.get("id"), node.get("type")
        if not isinstance(node_id, str) or not _SAFE_ID.fullmatch(node_id) or node_id in seen:
            raise ValueError("graph node ids must be unique safe ids")
        if node_type not in SUPPORTED_NODE_TYPES:
            raise ValueError(f"unsupported graph node type: {node_type}")
        inputs = node.get("inputs", {})
        if not isinstance(inputs, dict):
            raise ValueError(f"node {node_id} inputs must be an object")
        for dependency in inputs.values():
            if dependency not in seen:
                raise ValueError(f"node {node_id} references unavailable node {dependency}")
        if node_type == "output":
            outputs += 1
            if "image" not in inputs:
                raise ValueError("output node requires inputs.image")
        if node_type == "cluster_scatter" and not isinstance(node.get("params", {}).get("cluster"), dict):
            raise ValueError("cluster_scatter requires params.cluster")
        if node_type == "mapped_dynamic_scatter" and not isinstance(node.get("params", {}).get("mappings"), dict):
            raise ValueError("mapped_dynamic_scatter requires params.mappings")
        if node_type == "vector_path" and not isinstance(node.get("params", {}).get("paths", []), list):
            raise ValueError("vector_path requires params.paths as a list")
        seen.add(node_id)
    if outputs != 1:
        raise ValueError("graph must contain exactly one output node")


def _input_image(results: dict[str, Image.Image], node: dict, key: str = "image") -> Image.Image:
    dependency = node.get("inputs", {}).get(key)
    if dependency is None:
        raise ValueError(f"{node['id']} requires inputs.{key}")
    return results[dependency].copy()


def _dynamic_kwargs(params: dict) -> dict:
    return {
        "scale": params.get("scale", [1.0, 1.0]),
        "aspect": params.get("aspect", [1.0, 1.0]),
        "rotation_deg": params.get("rotationDeg", [0.0, 0.0]),
        "opacity": params.get("opacity", [255, 255]),
        "tints": params.get("tints", ["#FFFFFF"]),
        "mirror_x_probability": float(params.get("mirrorXProbability", 0.0)),
        "mirror_y_probability": float(params.get("mirrorYProbability", 0.0)),
        "hue_jitter_deg": float(params.get("hueJitterDeg", 0.0)),
        "saturation": params.get("saturation", [1.0, 1.0]),
        "value": params.get("value", [1.0, 1.0]),
    }


def execute(recipe: dict) -> tuple[Image.Image, dict]:
    validate_recipe(recipe)
    graph = recipe["graph"]
    seed = int(graph.get("seed", recipe.get("seed", 1)))
    results: dict[str, Image.Image] = {}
    node_stats: dict[str, dict] = {}
    final = None

    for node_index, node in enumerate(graph["nodes"]):
        node_id, node_type = node["id"], node["type"]
        params = copy.deepcopy(node.get("params", {}))

        if node_type == "canvas":
            image = Image.new("RGBA", tuple(recipe["canvas"]), tuple(params.get("color", [0, 0, 0, 0])))
            stats = {"type": node_type}

        elif node_type == "brush_scatter":
            image = _input_image(results, node)
            local = BrushEngineV2(seed + node_index * 104729 + int(params.get("seedOffset", 0)))
            stamps = local.scatter_regions(
                image,
                params.get("brushes", []),
                params.get("regions", []),
                int(params.get("count", 0)),
                scale=params.get("scale", [1.0, 1.0]),
                rotation_deg=params.get("rotationDeg", [0.0, 360.0]),
                opacity=params.get("opacity", [255, 255]),
                tints=params.get("tints", ["#FFFFFF"]),
            )
            stats = {"type": node_type, "stampCount": len(stamps), "brushes": list(params.get("brushes", []))}

        elif node_type == "path_brush":
            image = _input_image(results, node)
            local = BrushEngineV2(seed + node_index * 130363 + int(params.get("seedOffset", 0)))
            stamps = local.stroke_paths(
                image,
                params["brush"],
                params.get("paths", []),
                spacing=float(params.get("spacing", 4.0)),
                scale=params.get("scale", [1.0, 1.0]),
                opacity=params.get("opacity", [255, 255]),
                tints=params.get("tints", ["#FFFFFF"]),
                follow_tangent=bool(params.get("followTangent", True)),
                rotation_jitter_deg=float(params.get("rotationJitterDeg", 0.0)),
            )
            stats = {"type": node_type, "stampCount": len(stamps), "brush": params["brush"]}

        elif node_type == "dynamic_scatter":
            image = _input_image(results, node)
            local = BrushEngineV3(seed + node_index * 32452843 + int(params.get("seedOffset", 0)))
            stamps = local.scatter_regions(
                image,
                params.get("brushes", []),
                params.get("regions", []),
                int(params.get("count", 0)),
                **_dynamic_kwargs(params),
            )
            stats = {
                "type": node_type,
                "stampCount": len(stamps),
                "brushes": list(params.get("brushes", [])),
                "brushContract": BRUSH_V3_CONTRACT,
            }

        elif node_type == "dynamic_path_brush":
            image = _input_image(results, node)
            local = BrushEngineV3(seed + node_index * 49979687 + int(params.get("seedOffset", 0)))
            dynamics = _dynamic_kwargs(params)
            actual_density = float(params.get("dabsPerActualRadius", 0.0))
            basic_density = float(params.get("dabsPerBasicRadius", 0.0))
            basic_radius = params.get("basicRadiusPx")
            stamps = local.stroke_paths(
                image,
                params["brush"],
                params.get("paths", []),
                spacing=float(params.get("spacing", 8.0)),
                spacing_jitter=float(params.get("spacingJitter", 0.0)),
                follow_tangent=bool(params.get("followTangent", True)),
                dabs_per_actual_radius=actual_density,
                dabs_per_basic_radius=basic_density,
                basic_radius_px=None if basic_radius is None else float(basic_radius),
                **dynamics,
            )
            stats = {
                "type": node_type,
                "stampCount": len(stamps),
                "brush": params["brush"],
                "spacing": float(params.get("spacing", 8.0)),
                "spacingJitter": float(params.get("spacingJitter", 0.0)),
                "dabsPerActualRadius": actual_density,
                "dabsPerBasicRadius": basic_density,
                "radiusAwareSpacing": actual_density > 0.0 or basic_density > 0.0,
                "brushContract": BRUSH_V3_CONTRACT,
                "dabDensityContract": DAB_DENSITY_CONTRACT,
            }

        elif node_type == "mapped_dynamic_scatter":
            image = _input_image(results, node)
            local = MappedBrushEngineV1(seed + node_index * 86028121 + int(params.get("seedOffset", 0)))
            stamps, mapping_stats = local.scatter_regions(
                image,
                params.get("brushes", []),
                params.get("regions", []),
                int(params.get("count", 0)),
                mappings=params.get("mappings", {}),
                dynamics=_dynamic_kwargs(params),
            )
            stats = {
                "type": node_type,
                "brushes": list(params.get("brushes", [])),
                **mapping_stats,
            }

        elif node_type == "tapered_path":
            image = _input_image(results, node)
            geometry_stats = draw_tapered_paths(
                image,
                params.get("paths", []),
                supersample=int(params.get("supersample", 4)),
            )
            stats = {"type": node_type, **geometry_stats}

        elif node_type == "vector_path":
            image = _input_image(results, node)
            vector_stats = draw_vector_paths(
                image,
                params.get("paths", []),
                supersample=int(params.get("supersample", 4)),
            )
            stats = {"type": node_type, **vector_stats}

        elif node_type == "spaced_scatter":
            image = _input_image(results, node)
            local = DistributionEngineV1(seed + node_index * 15485863 + int(params.get("seedOffset", 0)))
            stamps, distribution_stats = local.scatter_spaced(
                image,
                params.get("brushes", []),
                params.get("regions", []),
                int(params.get("count", 0)),
                min_distance=float(params.get("minDistance", 0.0)),
                scale=params.get("scale", [1.0, 1.0]),
                rotation_deg=params.get("rotationDeg", [0.0, 360.0]),
                opacity=params.get("opacity", [255, 255]),
                tints=params.get("tints", ["#FFFFFF"]),
                max_attempts=params.get("maxAttempts"),
            )
            stats = {
                "type": node_type,
                "stampCount": len(stamps),
                "brushes": list(params.get("brushes", [])),
                **distribution_stats,
            }

        elif node_type == "cluster_scatter":
            image = _input_image(results, node)
            local = ClusterEngineV1(seed + node_index * 67867967 + int(params.get("seedOffset", 0)))
            cluster_stats = local.scatter_clusters(
                image,
                params["cluster"],
                params.get("regions", []),
                int(params.get("count", 0)),
                min_distance=float(params.get("minDistance", 0.0)),
                scale=params.get("scale", [1.0, 1.0]),
                rotation_deg=params.get("rotationDeg", [0.0, 360.0]),
                mirror_x_probability=float(params.get("mirrorXProbability", 0.5)),
                max_attempts=params.get("maxAttempts"),
            )
            stats = {"type": node_type, **cluster_stats}

        elif node_type == "blend":
            base = _input_image(results, node, "base")
            over = _input_image(results, node, "over")
            opacity = max(0, min(255, int(params.get("opacity", 255))))
            if opacity != 255:
                over.putalpha(over.getchannel("A").point(lambda a: round(a * opacity / 255)))
            base.alpha_composite(over)
            image = base
            stats = {"type": node_type, "opacity": opacity}

        elif node_type == "levels":
            image = _input_image(results, node)
            alpha, rgb = image.getchannel("A"), image.convert("RGB")
            contrast = float(params.get("contrast", 1.0))
            brightness = float(params.get("brightness", 1.0))
            if abs(contrast - 1.0) > 1e-6:
                rgb = ImageEnhance.Contrast(rgb).enhance(contrast)
            if abs(brightness - 1.0) > 1e-6:
                rgb = ImageEnhance.Brightness(rgb).enhance(brightness)
            image = rgb.convert("RGBA")
            image.putalpha(alpha)
            stats = {"type": node_type, "contrast": contrast, "brightness": brightness}

        elif node_type == "output":
            image = _input_image(results, node)
            final = image.copy()
            stats = {"type": node_type}

        else:
            raise ValueError(f"unsupported graph node type: {node_type}")

        results[node_id], node_stats[node_id] = image, stats

    assert final is not None
    node_types = {node["type"] for node in graph["nodes"]}
    radius_aware = any(
        node["type"] == "dynamic_path_brush"
        and (
            float(node.get("params", {}).get("dabsPerActualRadius", 0.0)) > 0.0
            or float(node.get("params", {}).get("dabsPerBasicRadius", 0.0)) > 0.0
        )
        for node in graph["nodes"]
    )
    metadata = {
        "contract": GRAPH_CONTRACT,
        "brushContract": BRUSH_CONTRACT,
        "brushDynamicsContract": BRUSH_V3_CONTRACT,
        "mappedBrushContract": MAPPED_BRUSH_CONTRACT,
        "sensorContextContract": SENSOR_CONTEXT_CONTRACT,
        "brushOptionBindingsContract": BRUSH_OPTION_BINDINGS_CONTRACT,
        "dynamicsMappingContract": DYNAMICS_MAPPING_CONTRACT,
        "dabDensityContract": DAB_DENSITY_CONTRACT,
        "geometryContract": GEOMETRY_CONTRACT,
        "vectorPathContract": VECTOR_PATH_CONTRACT,
        "distributionContract": DISTRIBUTION_CONTRACT,
        "clusterContract": CLUSTER_CONTRACT,
        "id": recipe["id"],
        "canvas": recipe["canvas"],
        "anchor": recipe["anchor"],
        "seed": seed,
        "nodeCount": len(graph["nodes"]),
        "nodes": node_stats,
        "pixelSha256": hashlib.sha256(final.tobytes()).hexdigest(),
        "camera": recipe["camera"],
        "critic": {
            "nodeGraph": True,
            "bitmapBrushTips": True,
            "assetSpecificRenderer": False,
            "deterministic": True,
            "continuousGeometry": "tapered_path" in node_types,
            "vectorGeometry": "vector_path" in node_types,
            "minimumDistanceDistribution": "spaced_scatter" in node_types or "cluster_scatter" in node_types,
            "brushDynamics": bool({"dynamic_scatter", "dynamic_path_brush", "mapped_dynamic_scatter", "cluster_scatter"} & node_types),
            "mappedDynamics": "mapped_dynamic_scatter" in node_types,
            "genericSensorContext": "mapped_dynamic_scatter" in node_types,
            "radiusAwareDabDensity": radius_aware,
            "hierarchicalClusters": "cluster_scatter" in node_types,
        },
    }
    return final, metadata

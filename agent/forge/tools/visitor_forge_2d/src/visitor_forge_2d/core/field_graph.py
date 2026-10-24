"""A7 Node Graph V2: field-aware deterministic 2D composition.

V2 is additive: V1 remains available for old recipes. This executor introduces
field nodes and field-conditioned brush/cluster placement without changing V1 output.
"""
from __future__ import annotations

import copy
import hashlib
import re

from PIL import Image, ImageEnhance

from .field_brush_engine import FIELD_BRUSH_CONTRACT, FieldBrushEngineV1
from .field_cluster_engine import FIELD_CLUSTER_CONTRACT, FieldClusterEngineV1
from .field_engine import (
    FIELD_ENGINE_CONTRACT,
    direction_to_point,
    distance_to_mask,
    linear_depth,
    mask_from_alpha,
    multiply_fields,
    radial_density,
)
from .field_mass_engine import FIELD_MASS_CONTRACT, paint_field_mass
from .flower_cluster_engine import FLOWER_CLUSTER_CONTRACT, FlowerClusterEngineV1
from .geometry_engine import GEOMETRY_CONTRACT, draw_tapered_paths
from .image_processing import (
    IMAGE_PROCESSING_CONTRACT,
    alpha_cleanup,
    depth_lighting,
    local_contrast,
    masked_material_variation,
)
from .layer_engine import LAYER_ENGINE_CONTRACT, composite, contact_occlusion
from .material_engine import MATERIAL_ENGINE_CONTRACT, masked_relief_material
from .vector_path import VECTOR_PATH_CONTRACT, draw_vector_paths

FIELD_GRAPH_CONTRACT = "CH_2D_GRAPH_RECIPE_V2"
_SAFE_ID = re.compile(r"[a-z0-9][a-z0-9_-]*\Z")
# Legacy recipes use position-derived randomness. Compilers that insert nodes
# can freeze these values without changing existing renders.
_NODE_SEED_STRIDES = {
    "field_mass_fill": 15485863, "field_mapped_scatter": 982451653,
    "field_cluster_scatter": 961748941, "field_flower_clusters": 86028121,
    "image_masked_material": 32452843, "image_masked_relief_material": 49979687,
}


def freeze_node_seeds(recipe: dict) -> None:
    """Assign explicit seeds in place before editing a graph's node order."""
    seed = int(recipe.get("graph", {}).get("seed", recipe.get("seed", 1)))
    for index,node in enumerate(recipe["graph"]["nodes"]):
        stride = _NODE_SEED_STRIDES.get(node["type"])
        if stride is not None:
            node.setdefault("seed", seed + index * stride)


def _node_seed(seed: int, node: dict, index: int) -> int:
    return int(node.get("seed", seed + index * _NODE_SEED_STRIDES[node["type"]])) + int(node.get("params", {}).get("seedOffset", 0))


SUPPORTED_NODE_TYPES = {
    "canvas",
    "tapered_path",
    "vector_path",
    "field_radial_density",
    "field_alpha_mask",
    "field_distance",
    "field_linear_depth",
    "field_direction_to_point",
    "field_multiply",
    "field_mass_fill",
    "field_mapped_scatter",
    "field_cluster_scatter",
    "field_flower_clusters",
    "image_alpha_cleanup",
    "image_depth_light",
    "image_masked_material",
    "image_masked_relief_material",
    "image_local_contrast",
    "image_composite",
    "image_contact_occlusion",
    "levels",
    "output",
}


def validate_recipe(recipe: dict) -> None:
    if not isinstance(recipe, dict) or recipe.get("contract") != FIELD_GRAPH_CONTRACT:
        raise ValueError(f"graph recipe must declare {FIELD_GRAPH_CONTRACT}")
    asset_id = recipe.get("id")
    if not isinstance(asset_id, str) or not _SAFE_ID.fullmatch(asset_id):
        raise ValueError("graph id must use lowercase letters, digits, _ or -")
    canvas, anchor = recipe.get("canvas"), recipe.get("anchor")
    if not isinstance(canvas, list) or len(canvas) != 2 or any(type(v) is not int or v <= 0 for v in canvas):
        raise ValueError("graph canvas must contain two positive integer pixels")
    if not isinstance(anchor, list) or len(anchor) != 2 or any(type(v) is not int or v < 0 or v > limit for v, limit in zip(anchor, canvas)):
        raise ValueError("graph anchor must lie inside canvas")
    camera = recipe.get("camera", {})
    if not isinstance(camera, dict) or camera.get("contract") != "CH_CAMERA_V1" or camera.get("tile") != [128, 64] or camera.get("yawDeg", 45) != 45 or camera.get("elevationDeg", 30) != 30:
        raise ValueError("graph recipe requires CH_CAMERA_V1, tile 128x64, yaw 45, elevation 30")
    graph = recipe.get("graph")
    nodes = graph.get("nodes") if isinstance(graph, dict) else None
    if not isinstance(nodes, list) or not nodes:
        raise ValueError("graph.nodes must be a non-empty list")
    seen: set[str] = set()
    outputs = 0
    for node in nodes:
        if not isinstance(node, dict):
            raise ValueError("each graph node must be an object")
        node_id, node_type = node.get("id"), node.get("type")
        if not isinstance(node_id, str) or not _SAFE_ID.fullmatch(node_id) or node_id in seen:
            raise ValueError("graph node ids must be unique safe ids")
        if node_type not in SUPPORTED_NODE_TYPES:
            raise ValueError(f"unsupported V2 graph node type: {node_type}")
        if "seed" in node and (not isinstance(node["seed"], int) or isinstance(node["seed"], bool)):
            raise ValueError(f"node {node_id} seed must be an integer")
        inputs = node.get("inputs", {})
        if not isinstance(node.get("params", {}), dict):
            raise ValueError(f"node {node_id} params must be an object")
        if not isinstance(inputs, dict):
            raise ValueError(f"node {node_id} inputs must be an object")
        for dependency in inputs.values():
            if not isinstance(dependency, str) or dependency not in seen:
                raise ValueError(f"node {node_id} references unavailable node {dependency}")
        if node_type == "output":
            outputs += 1
            if "image" not in inputs:
                raise ValueError("output requires inputs.image")
        if node_type in {"tapered_path", "vector_path", "levels"} and "image" not in inputs:
            raise ValueError(f"{node_type} requires inputs.image")
        if node_type == "field_alpha_mask" and "source" not in inputs:
            raise ValueError("field_alpha_mask requires inputs.source")
        if node_type == "field_distance" and "field" not in inputs:
            raise ValueError("field_distance requires inputs.field")
        if node_type == "field_multiply" and not inputs:
            raise ValueError("field_multiply requires at least one input field")
        if node_type in {"field_mapped_scatter", "field_cluster_scatter"}:
            if "image" not in inputs or "density" not in inputs:
                raise ValueError(f"{node_type} requires inputs.image and inputs.density")
            if not isinstance(node.get("params", {}).get("mappings", {}), dict):
                raise ValueError(f"{node_type} params.mappings must be an object")
        if node_type == "field_cluster_scatter" and not isinstance(node.get("params", {}).get("cluster"), dict):
            raise ValueError("field_cluster_scatter requires params.cluster")
        if node_type == "field_flower_clusters":
            if "image" not in inputs or "density" not in inputs:
                raise ValueError("field_flower_clusters requires inputs.image and inputs.density")
            if not isinstance(node.get("params", {}).get("palette", {}), dict):
                raise ValueError("field_flower_clusters params.palette must be an object")
        if node_type == "field_mass_fill" and ("image" not in inputs or "density" not in inputs):
            raise ValueError("field_mass_fill requires inputs.image and inputs.density")
        if node_type == "image_depth_light" and ("image" not in inputs or "depth" not in inputs):
            raise ValueError("image_depth_light requires inputs.image and inputs.depth")
        if node_type in {"image_masked_material", "image_masked_relief_material"} and ("image" not in inputs or "mask" not in inputs):
            raise ValueError(f"{node_type} requires inputs.image and inputs.mask")
        if node_type == "image_composite" and ("base" not in inputs or "layer" not in inputs):
            raise ValueError("image_composite requires inputs.base and inputs.layer")
        if node_type == "image_contact_occlusion" and ("base" not in inputs or "occluder" not in inputs):
            raise ValueError("image_contact_occlusion requires inputs.base and inputs.occluder")
        if node_type in {"image_alpha_cleanup", "image_local_contrast"} and "image" not in inputs:
            raise ValueError(f"{node_type} requires inputs.image")
        seen.add(node_id)
    if outputs != 1:
        raise ValueError("graph must contain exactly one output node")


def _copy_input(results: dict[str, Image.Image], node: dict, key: str) -> Image.Image:
    dependency = node.get("inputs", {}).get(key)
    if dependency is None:
        raise ValueError(f"{node['id']} requires inputs.{key}")
    return results[dependency].copy()


def _optional_input(results: dict[str, Image.Image], node: dict, key: str) -> Image.Image | None:
    dependency = node.get("inputs", {}).get(key)
    return None if dependency is None else results[dependency].copy()


def _dynamics(params: dict) -> dict:
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
    seed = int(recipe.get("graph", {}).get("seed", recipe.get("seed", 1)))
    results: dict[str, Image.Image] = {}
    node_stats: dict[str, dict] = {}
    final: Image.Image | None = None

    for index, node in enumerate(recipe["graph"]["nodes"]):
        node_id, node_type = node["id"], node["type"]
        params = copy.deepcopy(node.get("params", {}))

        if node_type == "canvas":
            image = Image.new("RGBA", tuple(recipe["canvas"]), tuple(params.get("color", [0, 0, 0, 0])))
            stats = {"type": node_type}

        elif node_type == "tapered_path":
            image = _copy_input(results, node, "image")
            stats = {"type": node_type, **draw_tapered_paths(image, params.get("paths", []), supersample=int(params.get("supersample", 4)))}

        elif node_type == "vector_path":
            image = _copy_input(results, node, "image")
            stats = {"type": node_type, **draw_vector_paths(image, params.get("paths", []), supersample=int(params.get("supersample", 4)))}

        elif node_type == "field_radial_density":
            image = radial_density(recipe["canvas"], params.get("lobes", []), power=float(params.get("power", 1.5)))
            stats = {"type": node_type, "contract": FIELD_ENGINE_CONTRACT, "fieldKind": "density"}

        elif node_type == "field_alpha_mask":
            source = _copy_input(results, node, "source")
            image = mask_from_alpha(
                source,
                threshold=int(params.get("threshold", 1)),
                blur_radius=float(params.get("blurRadius", 0.0)),
                expand_px=int(params.get("expandPx", 0)),
                invert=bool(params.get("invert", False)),
            )
            stats = {"type": node_type, "contract": FIELD_ENGINE_CONTRACT, "fieldKind": "mask"}

        elif node_type == "field_distance":
            source = _copy_input(results, node, "field")
            image = distance_to_mask(
                source,
                max_distance=float(params.get("maxDistance", 32.0)),
                threshold=int(params.get("threshold", 128)),
                proximity=bool(params.get("proximity", True)),
            )
            stats = {"type": node_type, "contract": FIELD_ENGINE_CONTRACT, "fieldKind": "distance"}

        elif node_type == "field_linear_depth":
            image = linear_depth(recipe["canvas"], params.get("start", [0, 0]), params.get("end", [0, recipe["canvas"][1] - 1]))
            stats = {"type": node_type, "contract": FIELD_ENGINE_CONTRACT, "fieldKind": "depth"}

        elif node_type == "field_direction_to_point":
            image = direction_to_point(recipe["canvas"], params.get("point", [recipe["canvas"][0] / 2, recipe["canvas"][1] / 2]), offset_deg=float(params.get("offsetDeg", 0.0)))
            stats = {"type": node_type, "contract": FIELD_ENGINE_CONTRACT, "fieldKind": "direction"}

        elif node_type == "field_multiply":
            fields = [_copy_input(results, node, key) for key in sorted(node.get("inputs", {}))]
            image = multiply_fields(*fields)
            stats = {"type": node_type, "contract": FIELD_ENGINE_CONTRACT, "fieldKind": "scalar", "inputCount": len(fields)}

        elif node_type == "field_mass_fill":
            image = _copy_input(results, node, "image")
            mass_stats = paint_field_mass(
                image,
                _copy_input(results, node, "density"),
                depth_field=_optional_input(results, node, "depth"),
                color=params.get("color", "#315E36"),
                threshold=float(params.get("threshold", 0.16)),
                feather=float(params.get("feather", 0.10)),
                opacity=int(params.get("opacity", 220)),
                close_px=int(params.get("closePx", 2)),
                edge_noise=float(params.get("edgeNoise", 0.10)),
                noise_cell_px=int(params.get("noiseCellPx", 18)),
                depth_shade=float(params.get("depthShade", 0.22)),
                seed=_node_seed(seed, node, index),
            )
            stats = {"type": node_type, **mass_stats}

        elif node_type == "field_mapped_scatter":
            image = _copy_input(results, node, "image")
            engine = FieldBrushEngineV1(_node_seed(seed, node, index))
            stamps, field_stats = engine.scatter(
                image,
                params.get("brushes", []),
                int(params.get("count", 0)),
                density_field=_copy_input(results, node, "density"),
                avoid_field=_optional_input(results, node, "avoid"),
                depth_field=_optional_input(results, node, "depth"),
                direction_field=_optional_input(results, node, "direction"),
                distance_field=_optional_input(results, node, "distance"),
                bounds=params.get("bounds"),
                min_distance=float(params.get("minDistance", 0.0)),
                mappings=params.get("mappings", {}),
                dynamics=_dynamics(params),
                max_attempts=params.get("maxAttempts"),
            )
            stats = {"type": node_type, **field_stats}

        elif node_type == "field_cluster_scatter":
            image = _copy_input(results, node, "image")
            engine = FieldClusterEngineV1(_node_seed(seed, node, index))
            cluster_stats = engine.scatter(
                image,
                params["cluster"],
                int(params.get("count", 0)),
                density_field=_copy_input(results, node, "density"),
                avoid_field=_optional_input(results, node, "avoid"),
                depth_field=_optional_input(results, node, "depth"),
                direction_field=_optional_input(results, node, "direction"),
                distance_field=_optional_input(results, node, "distance"),
                bounds=params.get("bounds"),
                min_distance=float(params.get("minDistance", 0.0)),
                scale=params.get("scale", [1.0, 1.0]),
                rotation_deg=params.get("rotationDeg", [-15.0, 15.0]),
                mirror_x_probability=float(params.get("mirrorXProbability", 0.5)),
                mappings=params.get("mappings", {}),
                max_attempts=params.get("maxAttempts"),
            )
            stats = {"type": node_type, **cluster_stats}

        elif node_type == "field_flower_clusters":
            image = _copy_input(results, node, "image")
            engine = FlowerClusterEngineV1(_node_seed(seed, node, index))
            flower_stats = engine.scatter(
                image,
                _copy_input(results, node, "density"),
                avoid_field=_optional_input(results, node, "avoid"),
                depth_field=_optional_input(results, node, "depth"),
                count=int(params.get("count", 12)),
                bounds=params.get("bounds"),
                min_distance=float(params.get("minDistance", 10.0)),
                radius_x=params.get("radiusX", [11.0, 16.0]),
                radius_y=params.get("radiusY", [8.0, 12.0]),
                palette=params.get("palette", {}),
                blossom_density=float(params.get("blossomDensity", 1.0)),
                blossom_style=str(params.get("blossomStyle", "round")),
                gap_windows=params.get("gapWindows", [2, 3]),
                edge_spray_probability=float(params.get("edgeSprayProbability", 0.42)),
                max_attempts=int(params.get("maxAttempts", 24000)),
            )
            stats = {"type": node_type, **flower_stats}

        elif node_type == "image_alpha_cleanup":
            image = alpha_cleanup(
                _copy_input(results, node, "image"),
                close_px=int(params.get("closePx", 1)),
                open_px=int(params.get("openPx", 0)),
                feather_radius=float(params.get("featherRadius", 0.35)),
                fill_color=params.get("fillColor"),
                fill_strength=float(params.get("fillStrength", 0.75)),
            )
            stats = {"type": node_type, "contract": IMAGE_PROCESSING_CONTRACT, "operation": "alpha_cleanup"}

        elif node_type == "image_depth_light":
            image = depth_lighting(
                _copy_input(results, node, "image"),
                _copy_input(results, node, "depth"),
                strength=float(params.get("strength", 0.18)),
                bias=float(params.get("bias", 0.0)),
                preserve_alpha=bool(params.get("preserveAlpha", True)),
            )
            stats = {"type": node_type, "contract": IMAGE_PROCESSING_CONTRACT, "operation": "depth_lighting"}

        elif node_type == "image_masked_material":
            image = masked_material_variation(
                _copy_input(results, node, "image"),
                _copy_input(results, node, "mask"),
                seed=_node_seed(seed, node, index),
                coarse_px=int(params.get("coarsePx", 11)),
                coarse_amount=float(params.get("coarseAmount", 0.13)),
                fine_amount=float(params.get("fineAmount", 0.035)),
                vertical_light=float(params.get("verticalLight", 0.05)),
            )
            stats = {"type": node_type, "contract": IMAGE_PROCESSING_CONTRACT, "operation": "masked_material"}

        elif node_type == "image_masked_relief_material":
            image = masked_relief_material(
                _copy_input(results, node, "image"),
                _copy_input(results, node, "mask"),
                seed=_node_seed(seed, node, index),
                light_direction=params.get("lightDirection", [-0.8, -0.45]),
                relief_strength=float(params.get("reliefStrength", 0.22)),
                edge_shade=float(params.get("edgeShade", 0.16)),
                coarse_px=int(params.get("coarsePx", 13)),
                coarse_amount=float(params.get("coarseAmount", 0.11)),
                grain_axis=str(params.get("grainAxis", "vertical")),
                grain_scale_px=int(params.get("grainScalePx", 7)),
                grain_amount=float(params.get("grainAmount", 0.10)),
                fine_amount=float(params.get("fineAmount", 0.025)),
            )
            stats = {"type": node_type, "contract": MATERIAL_ENGINE_CONTRACT, "operation": "masked_relief_material"}

        elif node_type == "image_composite":
            image = composite(
                _copy_input(results, node, "base"),
                _copy_input(results, node, "layer"),
                opacity=float(params.get("opacity", 1.0)),
            )
            stats = {"type": node_type, "contract": LAYER_ENGINE_CONTRACT, "operation": "composite"}

        elif node_type == "image_contact_occlusion":
            image = contact_occlusion(
                _copy_input(results, node, "base"),
                _copy_input(results, node, "occluder"),
                radius=float(params.get("radius", 3.0)),
                strength=float(params.get("strength", 0.28)),
                offset=params.get("offset", [0, 2]),
                color=params.get("color", "#102016"),
                expand_px=int(params.get("expandPx", 1)),
                base_alpha_only=bool(params.get("baseAlphaOnly", True)),
            )
            stats = {"type": node_type, "contract": LAYER_ENGINE_CONTRACT, "operation": "contact_occlusion"}

        elif node_type == "image_local_contrast":
            image = local_contrast(
                _copy_input(results, node, "image"),
                radius=float(params.get("radius", 1.4)),
                amount=float(params.get("amount", 0.55)),
                global_contrast=float(params.get("globalContrast", 1.0)),
            )
            stats = {"type": node_type, "contract": IMAGE_PROCESSING_CONTRACT, "operation": "local_contrast"}

        elif node_type == "levels":
            image = _copy_input(results, node, "image")
            alpha = image.getchannel("A")
            contrast = float(params.get("contrast", 1.0))
            brightness = float(params.get("brightness", 1.0))
            rgb = local_contrast(image, amount=0.0, global_contrast=contrast).convert("RGB")
            if abs(brightness - 1.0) > 1e-6:
                rgb = ImageEnhance.Brightness(rgb).enhance(brightness)
            image = rgb.convert("RGBA")
            image.putalpha(alpha)
            stats = {"type": node_type, "contrast": contrast, "brightness": brightness}

        elif node_type == "output":
            image = _copy_input(results, node, "image")
            if image.mode != "RGBA":
                raise ValueError("V2 output must resolve to RGBA artwork, not a field")
            final = image.copy()
            stats = {"type": node_type}

        else:
            raise ValueError(f"unsupported V2 graph node type: {node_type}")

        results[node_id] = image
        node_stats[node_id] = stats

    assert final is not None
    node_types = {node["type"] for node in recipe["graph"]["nodes"]}
    field_aware = bool({"field_mapped_scatter", "field_cluster_scatter", "field_flower_clusters"} & node_types)
    metadata = {
        "contract": FIELD_GRAPH_CONTRACT,
        "fieldContract": FIELD_ENGINE_CONTRACT,
        "fieldBrushContract": FIELD_BRUSH_CONTRACT,
        "fieldClusterContract": FIELD_CLUSTER_CONTRACT,
        "fieldMassContract": FIELD_MASS_CONTRACT,
        "flowerClusterContract": FLOWER_CLUSTER_CONTRACT,
        "imageProcessingContract": IMAGE_PROCESSING_CONTRACT,
        "layerEngineContract": LAYER_ENGINE_CONTRACT,
        "materialEngineContract": MATERIAL_ENGINE_CONTRACT,
        "geometryContract": GEOMETRY_CONTRACT,
        "vectorPathContract": VECTOR_PATH_CONTRACT,
        "id": recipe["id"],
        "canvas": recipe["canvas"],
        "anchor": recipe["anchor"],
        "seed": seed,
        "nodeCount": len(recipe["graph"]["nodes"]),
        "nodes": node_stats,
        "pixelSha256": hashlib.sha256(final.tobytes()).hexdigest(),
        "camera": recipe["camera"],
        "critic": {
            "nodeGraphV2": True,
            "fieldAwareDistribution": field_aware,
            "fieldConditionedClusters": "field_cluster_scatter" in node_types,
            "fieldConditionedFlowers": "field_flower_clusters" in node_types,
            "densityField": "field_radial_density" in node_types,
            "avoidMask": "field_alpha_mask" in node_types,
            "distanceField": "field_distance" in node_types,
            "directionField": "field_direction_to_point" in node_types,
            "depthField": "field_linear_depth" in node_types,
            "coherentMass": "field_mass_fill" in node_types,
            "alphaCleanup": "image_alpha_cleanup" in node_types,
            "depthLighting": "image_depth_light" in node_types,
            "maskedMaterial": "image_masked_material" in node_types,
            "maskedReliefMaterial": "image_masked_relief_material" in node_types,
            "layerComposite": "image_composite" in node_types,
            "contactOcclusion": "image_contact_occlusion" in node_types,
            "localContrast": "image_local_contrast" in node_types,
            "assetSpecificRenderer": False,
            "deterministic": True,
        },
    }
    return final, metadata

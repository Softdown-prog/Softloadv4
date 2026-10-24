"""Small deterministic production workers around the existing 2D renderers.

Workers prepare review artifacts and machine checks. They never approve art or
copy a candidate into the game's runtime catalog.
"""
from __future__ import annotations

import hashlib
import json
import re
from pathlib import Path

from PIL import Image

from .core import (
    fence_scenery,
    flower_bed_scenery,
    flower_bed_scenery_v2,
    flowering_tree_scenery,
    organic_scenery,
    red_mapple_scenery,
    scene_composer,
    scene_composer_v2,
    scene_composer_v3,
    scene_composer_v4,
    shape_recipe,
    structured_broadleaf_scenery,
)

SHAPE_CONTRACT = "CH_2D_SHAPE_RECIPE_V1"
SCENE_CONTRACT = "CH_2D_SCENE_RECIPE_V1"
SCENE_V2_CONTRACT = "CH_2D_SCENE_RECIPE_V2"
SCENE_V3_CONTRACT = "CH_2D_SCENE_RECIPE_V3"
SCENE_V4_CONTRACT = "CH_2D_SCENE_RECIPE_V4"
ORGANIC_CONTRACT = "CH_2D_ORGANIC_SCENERY_V1"
FENCE_CONTRACT = "CH_2D_FENCE_SCENERY_V1"
_SAFE_ID = re.compile(r"[a-z0-9][a-z0-9_-]*\Z")


def _validate_camera(recipe: dict, label: str) -> None:
    camera = recipe.get("camera", {})
    if (not isinstance(camera, dict) or camera.get("contract") != "CH_CAMERA_V1" or
        camera.get("tile") != [128, 64] or
        camera.get("yawDeg", 45) != 45 or camera.get("elevationDeg", 30) != 30):
        raise ValueError(f"{label} requires CH_CAMERA_V1, 128x64, yaw 45 and elevation 30")


def validate_recipe(recipe: dict) -> str:
    """Recipe worker: reject invalid IDs, geometry and camera before writing."""
    supported = (SHAPE_CONTRACT, SCENE_CONTRACT, SCENE_V2_CONTRACT, SCENE_V3_CONTRACT,
                 SCENE_V4_CONTRACT, ORGANIC_CONTRACT, FENCE_CONTRACT)
    if not isinstance(recipe, dict) or recipe.get("contract") not in supported:
        raise ValueError("worker needs a supported 2D shape, scene, organic scenery or fence recipe")
    asset_id = recipe.get("id")
    if not isinstance(asset_id, str) or not _SAFE_ID.fullmatch(asset_id):
        raise ValueError("recipe id must use lowercase letters, digits, _ or -")
    canvas, anchor = recipe.get("canvas"), recipe.get("anchor")
    if (not isinstance(canvas, list) or len(canvas) != 2 or
        any(type(value) is not int or value <= 0 for value in canvas)):
        raise ValueError("canvas must be two positive integer pixels")
    if (not isinstance(anchor, list) or len(anchor) != 2 or
        any(type(value) is not int or value < 0 or value > limit
            for value, limit in zip(anchor, canvas))):
        raise ValueError("anchor must lie within the canvas")
    if recipe["contract"] == SHAPE_CONTRACT:
        return "shape"
    if recipe["contract"] == SCENE_CONTRACT:
        _validate_camera(recipe, "scene recipe")
        scene_composer._validate_recipe(recipe)
        return "scene"
    if recipe["contract"] == SCENE_V2_CONTRACT:
        _validate_camera(recipe, "scene v2 recipe")
        scene_composer_v2.validate_recipe(recipe)
        return "scene_v2"
    if recipe["contract"] == SCENE_V3_CONTRACT:
        _validate_camera(recipe, "scene v3 recipe")
        scene_composer_v3.validate_recipe(recipe)
        return "scene_v3"
    if recipe["contract"] == SCENE_V4_CONTRACT:
        _validate_camera(recipe, "scene v4 recipe")
        scene_composer_v4.validate_recipe(recipe)
        return "scene_v4"
    if recipe["contract"] == FENCE_CONTRACT:
        fence_scenery.validate_recipe(recipe)
        return "fence"
    _validate_camera(recipe, "organic scenery")
    if recipe.get("sceneryType") == "flower_bed":
        return "flower_bed"
    if recipe.get("sceneryType") == "flower_bed_v2":
        if not isinstance(recipe.get("flowerStyle"), dict):
            raise ValueError("flower_bed_v2 requires flowerStyle")
        return "flower_bed_v2"
    if recipe.get("sceneryType") == "red_mapple":
        if recipe.get("crownStyle") != "broadleaf":
            raise ValueError("red_mapple scenery requires crownStyle broadleaf")
        if not isinstance(recipe.get("mapleStyle"), dict):
            raise ValueError("red_mapple scenery requires mapleStyle")
        return "red_mapple"
    if recipe.get("sceneryType") == "flowering_tree":
        if recipe.get("crownStyle") != "broadleaf":
            raise ValueError("flowering_tree scenery requires crownStyle broadleaf")
        if not isinstance(recipe.get("floweringStyle"), dict):
            raise ValueError("flowering_tree scenery requires floweringStyle")
        if not isinstance(recipe.get("trunkBranches"), list) or len(recipe["trunkBranches"]) < 2:
            raise ValueError("flowering_tree scenery requires authored trunkBranches")
        return "flowering_tree"
    if recipe.get("sceneryType") == "structured_broadleaf":
        if recipe.get("crownStyle") != "broadleaf":
            raise ValueError("structured_broadleaf scenery requires crownStyle broadleaf")
        if not isinstance(recipe.get("broadleafStructure"), dict):
            raise ValueError("structured_broadleaf scenery requires broadleafStructure")
        if not isinstance(recipe.get("trunkBranches"), list) or len(recipe["trunkBranches"]) < 3:
            raise ValueError("structured_broadleaf scenery requires at least three authored trunkBranches")
        return "structured_broadleaf"
    if recipe.get("sceneryType") is not None:
        raise ValueError("unknown organic sceneryType")
    return "conifer_or_broadleaf"


def audit_export(recipe: dict, result: dict, kind: str) -> dict:
    """Alpha/anchor worker and camera-review worker inspect actual output files."""
    with Image.open(result["png"]) as source:
        source.load()
        if source.format != "PNG" or source.mode != "RGBA" or list(source.size) != recipe["canvas"]:
            raise ValueError("rendered sprite must be PNG RGBA at the authored canvas size")
        bounds = source.getchannel("A").getbbox()
    if bounds is None:
        raise ValueError("rendered sprite is fully transparent")
    metadata = json.loads(Path(result["metadata"]).read_text(encoding="utf-8"))
    if metadata.get("anchor") != recipe["anchor"] or metadata.get("bounds") != list(bounds):
        raise ValueError("render metadata does not match the sprite bounds or anchor")
    height = bounds[3] - bounds[1]
    limits = recipe.get("validation", {})
    if height < limits.get("minimumOpaqueHeightPx", 1) or height > limits.get("maximumOpaqueHeightPx", float("inf")):
        raise ValueError(f"opaque height {height}px is outside the recipe limits")
    with Image.open(result["review"]) as review:
        review.verify()
    if kind != "shape":
        with Image.open(result["isometricReview"]) as isometric:
            isometric.verify()
        if metadata.get("camera", {}).get("contract") != "CH_CAMERA_V1":
            raise ValueError("isometric export lost its camera contract")
    return {"bounds": list(bounds), "opaqueHeightPx": height,
            "cameraReview": result.get("isometricReview"), "alpha": "RGBA",
            "critic": metadata.get("critic")}


def run_workers(recipe_path: Path, output_root: Path) -> dict:
    """Run recipe, render, audit and provenance workers for one recipe."""
    raw = recipe_path.read_bytes()
    recipe = json.loads(raw)
    kind = validate_recipe(recipe)
    folder = output_root / recipe["id"]
    if kind == "shape":
        result = shape_recipe.export_shape_recipe(recipe_path, folder)
    elif kind == "scene":
        result = scene_composer.export(recipe_path, folder)
    elif kind == "scene_v2":
        result = scene_composer_v2.export(recipe_path, folder)
    elif kind == "scene_v3":
        result = scene_composer_v3.export(recipe_path, folder)
    elif kind == "scene_v4":
        result = scene_composer_v4.export(recipe_path, folder)
    elif kind == "fence":
        result = fence_scenery.export_fence_scenery(recipe_path, folder)
    elif kind == "flower_bed":
        result = flower_bed_scenery.export(recipe_path, folder)
    elif kind == "flower_bed_v2":
        result = flower_bed_scenery_v2.export(recipe_path, folder)
    elif kind == "red_mapple":
        result = red_mapple_scenery.export(recipe_path, folder)
    elif kind == "flowering_tree":
        result = flowering_tree_scenery.export(recipe_path, folder)
    elif kind == "structured_broadleaf":
        result = structured_broadleaf_scenery.export(recipe_path, folder)
    else:
        result = organic_scenery.export(recipe_path, folder)
    audit = audit_export(recipe, result, kind)
    report = {
        "status": "review_ready", "id": recipe["id"], "kind": kind,
        "workers": ["recipe", "render", "alpha_anchor"] +
                   (["camera_review"] if kind != "shape" else []) +
                   (["visual_critic"] if audit.get("critic") is not None else []) + ["provenance"],
        "recipe": str(recipe_path), "recipeSha256": hashlib.sha256(raw).hexdigest(),
        "png": result["png"], "review": result["review"],
        "isometricReview": result.get("isometricReview"),
        "pngSha256": hashlib.sha256(Path(result["png"]).read_bytes()).hexdigest(),
        "audit": audit, "artApproved": False, "runtimePromotion": False,
    }
    report_path = folder / "worker_report.json"
    report_path.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    return {**report, "report": str(report_path)}

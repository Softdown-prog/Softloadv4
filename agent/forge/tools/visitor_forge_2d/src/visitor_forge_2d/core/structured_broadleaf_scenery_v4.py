"""Volumetric broadleaf V4: canopy skirt + apex refinement.

Builds on V3 and specifically closes the exposed mechanical branch fork near
the lower crown while restoring a more rounded top silhouette. The added
masses remain separate connected groups, so this does not reintroduce a single
canopy blob.
"""
from __future__ import annotations

import hashlib
import json
import math
import random
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter

from . import organic_scenery as organic
from . import structured_broadleaf_scenery_v3 as v3

CONTRACT = v3.CONTRACT
CAMERA_CONTRACT = v3.CAMERA_CONTRACT
ROTATION_CONTRACT = v3.ROTATION_CONTRACT
WORK_SCALE = v3.WORK_SCALE
VALID_VIEWS = v3.VALID_VIEWS
DEFAULT_YAWS = v3.DEFAULT_YAWS
VIEW_PHASE = v3.VIEW_PHASE


def _groups(recipe: dict, rng: random.Random, view: str):
    groups, branch_count = v3._groups(recipe, rng, view)
    cx, cy, rx, ry, density = v3._structure(recipe)
    phase = VIEW_PHASE[view]
    root = math.sqrt(density)

    # One apex group rounds the roof line and prevents the flat polygonal top.
    groups.append({
        "depth": 1,
        "source": "apex",
        "x": cx + math.cos(phase + .4) * rx * .018 + rng.uniform(-1.0, 1.0),
        "y": cy - ry * .57 + rng.uniform(-.8, .8),
        "rx": rx * .30 * root,
        "ry": ry * .23 * root,
    })

    # Lower-front skirt hides the synthetic Y-shaped branch fork while leaving
    # small natural valleys between foliage families.
    skirt = (
        (-.30, .31, .28, .21),
        (0.00, .36, .31, .22),
        (.30, .31, .28, .21),
    )
    for i, (ox, oy, sx, sy) in enumerate(skirt):
        a = phase + i * .73
        groups.append({
            "depth": 2,
            "source": "skirt",
            "x": cx + ox * rx + math.cos(a) * rx * .010 + rng.uniform(-.8, .8),
            "y": cy + oy * ry + math.sin(a) * ry * .006 + rng.uniform(-.6, .6),
            "rx": rx * sx * root,
            "ry": ry * sy * root,
        })

    groups.sort(key=lambda g: (g["depth"], g["y"]))
    return groups, branch_count


def render(recipe: dict, view: str = "south"):
    if recipe.get("contract") != CONTRACT:
        raise ValueError(f"recipe must declare {CONTRACT}")
    camera = recipe.get("camera", {})
    if camera.get("contract") != CAMERA_CONTRACT or camera.get("tile") != [128, 64]:
        raise ValueError("structured broadleaf v4 requires CH_CAMERA_V1 on 128x64")
    if view not in VALID_VIEWS:
        raise ValueError(f"view must be one of {VALID_VIEWS}")
    if recipe.get("crownStyle") != "broadleaf":
        raise ValueError("structured broadleaf v4 requires crownStyle broadleaf")

    canvas = recipe.get("canvas", [256, 320])
    anchor = recipe.get("anchor", [canvas[0] // 2, canvas[1] - 9])
    seed = int(recipe.get("seed", 1))
    rng = random.Random(seed ^ (0xB4A91 + int(round(VIEW_PHASE[view] * 1000))))
    W, H = canvas[0] * WORK_SCALE, canvas[1] * WORK_SCALE
    palette = recipe["palette"]
    work = Image.new("RGBA", (W, H))

    shadow = Image.new("L", (W, H))
    sw = int(recipe.get("shadowWidth", round(canvas[0] * .42)))
    ImageDraw.Draw(shadow).ellipse(
        ((anchor[0] - sw // 2) * WORK_SCALE, (anchor[1] - 7) * WORK_SCALE,
         (anchor[0] + sw // 2) * WORK_SCALE, (anchor[1] + 4) * WORK_SCALE),
        fill=96,
    )
    shadow = shadow.filter(ImageFilter.GaussianBlur(2.0 * WORK_SCALE))
    sh = Image.new("RGBA", (W, H), (*organic._hex(palette["ground_shadow"]), 0))
    sh.putalpha(shadow)
    work.alpha_composite(sh)

    organic._draw_trunk_and_bark(work, recipe, palette, W, H)

    cx, cy, _rx, _ry, density = v3._structure(recipe)
    groups, branch_count = _groups(recipe, rng, view)
    leaves = 0
    for group in groups:
        leaves += v3._paint_mass(work, rng, palette, group, (cx, cy))

    frame = organic._alpha_safe_resize(work, tuple(canvas))
    bounds = frame.getchannel("A").getbbox()
    return frame, {
        "contract": CONTRACT,
        "id": recipe["id"],
        "canvas": canvas,
        "anchor": anchor,
        "bounds": list(bounds),
        "seed": seed,
        "crownStyle": "broadleaf",
        "sceneryType": "structured_broadleaf",
        "authoringMode": "branch_guided_volumetric_groups_v4",
        "view": view,
        "yawDeg": int(recipe.get("rotation", {}).get("yawDeg", {}).get(view, DEFAULT_YAWS[view])),
        "camera": camera,
        "critic": {
            "singleCanopyBlob": False,
            "depthBands": 3,
            "macroMassCount": len(groups),
            "branchDerivedMassCount": branch_count,
            "explicitLeafCount": leaves,
            "canopySkirtGroups": 3,
            "apexGroups": 1,
            "detachedEdgeStamps": False,
            "punchedGapCutters": False,
            "foregroundBranchOverlay": False,
            "randomFinalGrain": False,
            "density": density,
        },
        "runtimePromotion": False,
        "artApproved": False,
    }


def export(recipe_path: Path, output_dir: Path):
    raw = recipe_path.read_bytes()
    recipe = json.loads(raw)
    output_dir.mkdir(parents=True, exist_ok=True)
    stem = recipe["id"]
    views = recipe.get("rotation", {}).get("views", ["south"])
    slots = {}
    first_meta = None
    for view in views:
        frame, meta = render(recipe, view)
        first_meta = first_meta or meta
        source = output_dir / f"{stem}_{view}_source.png"
        final = output_dir / f"{stem}_{view}.png"
        frame.save(source)
        final.write_bytes(source.read_bytes())
        organic.review_board(frame).save(output_dir / f"{stem}_{view}_review.png")
        organic.isometric_board(frame, meta["anchor"],
            f"CH_CAMERA_V1 / {view} / yaw {meta['yawDeg']} / 128x64").save(
                output_dir / f"{stem}_{view}_isometric_review.png")
        slots[view] = {
            "path": str(final), "source": str(source), "yawDeg": meta["yawDeg"],
            "sha256": hashlib.sha256(final.read_bytes()).hexdigest(), "finish": None,
        }

    canonical_view = "south" if "south" in slots else views[0]
    canonical = output_dir / f"{stem}.png"
    canonical.write_bytes(Path(slots[canonical_view]["path"]).read_bytes())
    final_frame = Image.open(canonical).convert("RGBA")
    review = output_dir / f"{stem}_review.png"
    iso = output_dir / f"{stem}_isometric_review.png"
    organic.review_board(final_frame).save(review)
    organic.isometric_board(final_frame, first_meta["anchor"]).save(iso)

    manifest = {
        "contract": ROTATION_CONTRACT, "id": stem,
        "mode": recipe.get("rotation", {}).get("mode", "procedural_quarter_turns"),
        "lightingSpace": recipe.get("rotation", {}).get("lightingSpace", "screen_camera_relative"),
        "generatedViews": True, "views": slots,
    }
    manifest_path = output_dir / f"{stem}_rotation.json"
    manifest_path.write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    meta = dict(first_meta)
    meta.update({
        "recipe": str(recipe_path), "recipeSha256": hashlib.sha256(raw).hexdigest(),
        "png": str(canonical), "review": str(review), "isometricReview": str(iso),
        "rotationManifest": str(manifest_path), "views": slots,
    })
    report = output_dir / f"{stem}.json"
    report.write_text(json.dumps(meta, indent=2) + "\n", encoding="utf-8")
    return {
        "png": str(canonical), "review": str(review), "isometricReview": str(iso),
        "metadata": str(report), "rotationManifest": str(manifest_path),
        "views": {view: slot["path"] for view, slot in slots.items()},
    }

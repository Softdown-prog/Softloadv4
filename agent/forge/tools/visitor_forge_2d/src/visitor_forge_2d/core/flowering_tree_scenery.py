"""Procedural flowering broadleaf renderer for Visitor Forge 2D.

This family is derived from the approved Ipe Amarelo reference bundle.  It is
not a copy of the source PNG: the source informs a reusable grammar composed of
open branching, medium negative space and many small blossom clusters.
"""
from __future__ import annotations

import hashlib
import json
import math
import random
from pathlib import Path

from PIL import Image, ImageChops, ImageDraw, ImageFilter

from . import brushes
from . import flowering_brushes
from . import organic_scenery as organic

CONTRACT = organic.CONTRACT
CAMERA_CONTRACT = organic.CAMERA_CONTRACT
ROTATION_CONTRACT = organic.ROTATION_CONTRACT
WORK_SCALE = organic.WORK_SCALE
VALID_VIEWS = organic.VALID_VIEWS
DEFAULT_YAWS = organic.DEFAULT_YAWS
VIEW_PHASE = organic.VIEW_PHASE


def _flower_groups(recipe: dict, rng: random.Random, view: str):
    cfg = recipe["floweringStyle"]
    phase = VIEW_PHASE[view]
    steps = tuple(float(v) for v in cfg.get("branchFlowerSteps", [.55, .74, .91, 1.05]))
    branches = recipe.get("trunkBranches", [])[1:]
    if not branches:
        raise ValueError("flowering tree renderer requires authored trunkBranches")

    groups = []
    for index, branch in enumerate(branches):
        p0 = tuple(map(float, branch["p0"]))
        p1 = tuple(map(float, branch.get("p1", branch["p0"])))
        p2 = tuple(map(float, branch["p2"]))
        for step_index, along in enumerate(steps):
            x, y = organic._quad(p0, p1, p2, along)
            x += math.sin(phase + index * .79 + step_index * .61) * 2.5 + rng.uniform(-2.0, 2.0)
            y += math.cos(phase + index * .53 + step_index * .44) * 1.6 + rng.uniform(-1.5, 1.5)
            scale = rng.uniform(.88, 1.14)
            groups.append((y, x, 13.0 * scale, 9.8 * scale))

    for x, y, rx, ry in cfg.get("interiorGroups", []):
        groups.append((
            float(y) + math.sin(phase) * 1.1,
            float(x) + math.cos(phase) * 1.5,
            float(rx) * rng.uniform(.94, 1.06),
            float(ry) * rng.uniform(.94, 1.06),
        ))
    groups.sort()
    return groups


def _paint_group(work: Image.Image, rng: random.Random, palette: dict, center, radius, *, edge_spray: bool):
    cx, cy = center
    rx, ry = radius
    W, H = work.size

    mask = Image.new("L", (W, H))
    brushes.leaf_cluster_broadleaf(mask, rng, cx, cy, rx, ry, satellites=4, fill=255)
    brushes.edge_breakup_stamp(mask, rng, cx, cy, max(rx, ry), count=7, fill=255)
    flowering_brushes.blossom_gap_windows(mask, rng, (cx, cy), (rx, ry), count=2 if rx < 15 else 3)

    organic._composite(work, mask, palette["mid_top"], palette["mid_bottom"], right_shade=.07)

    shade = Image.new("L", (W, H))
    brushes.interior_occlusion_patch(shade, rng, cx + rx*.16, cy + ry*.23, rx*.62, ry*.42, strength=108)
    shade = ImageChops.multiply(shade, mask)
    organic._composite(work, shade, palette["occlusion"], palette["back_bottom"])

    blossoms = Image.new("RGBA", (W, H))
    flowering_brushes.flower_cluster_small_round(
        blossoms,
        rng,
        mask,
        (cx, cy),
        (rx, ry),
        (palette["back_top"], palette["mid_top"], palette["front_top"]),
        count=max(40, round((rx * ry) / 4.1)),
        highlight_color=palette["highlight"],
        shadow_color=palette["back_bottom"],
    )
    work.alpha_composite(blossoms)

    if edge_spray:
        spray = Image.new("RGBA", (W, H))
        flowering_brushes.flower_spray(
            spray,
            rng,
            (cx - rx*.30, cy - ry*.36),
            (palette["mid_top"], palette["front_top"]),
            radius=max(6.0, rx*.55),
            blossoms=8,
            highlight_color=palette["highlight"],
        )
        work.alpha_composite(spray)


def _visible_branch_pass(work: Image.Image, recipe: dict, palette: dict):
    W, H = work.size
    mask = Image.new("L", (W, H))
    for index, branch in enumerate(recipe.get("trunkBranches", [])[1:]):
        if index % 3 == 1:
            continue
        p0 = tuple(map(float, branch["p0"]))
        p1 = tuple(map(float, branch.get("p1", branch["p0"])))
        p2 = tuple(map(float, branch["p2"]))
        brushes.branch_tapered(
            mask, p0, p1, p2,
            max(1.1, float(branch.get("w0", 3.0)) * .46),
            max(.5, float(branch.get("w1", 1.0)) * .68),
            samples=34, fill=118,
        )
    if mask.getbbox():
        organic._composite(work, mask, palette["trunk_light"], palette["trunk_bottom"], right_shade=.08)


def render(recipe: dict, view: str = "south"):
    if recipe.get("contract") != CONTRACT:
        raise ValueError(f"recipe must declare {CONTRACT}")
    camera = recipe.get("camera", {})
    if camera.get("contract") != CAMERA_CONTRACT or camera.get("tile") != [128, 64]:
        raise ValueError("flowering tree scenery requires CH_CAMERA_V1 on the 128x64 grid")
    if view not in VALID_VIEWS:
        raise ValueError(f"view must be one of {VALID_VIEWS}")
    if not isinstance(recipe.get("floweringStyle"), dict):
        raise ValueError("flowering tree scenery requires floweringStyle")

    canvas = recipe.get("canvas", [256, 320])
    anchor = recipe.get("anchor", [128, 311])
    seed = int(recipe.get("seed", 1))
    rng = random.Random(seed ^ (0x7919 + int(round(VIEW_PHASE[view] * 1000))))
    W, H = canvas[0] * WORK_SCALE, canvas[1] * WORK_SCALE
    palette = recipe["palette"]
    work = Image.new("RGBA", (W, H))

    shadow = Image.new("L", (W, H))
    sw = int(recipe.get("shadowWidth", 108))
    ImageDraw.Draw(shadow).ellipse(
        ((anchor[0]-sw//2)*WORK_SCALE, (anchor[1]-8)*WORK_SCALE,
         (anchor[0]+sw//2)*WORK_SCALE, (anchor[1]+4)*WORK_SCALE), fill=118)
    shadow = shadow.filter(ImageFilter.GaussianBlur(2.4 * WORK_SCALE))
    sh = Image.new("RGBA", (W, H), (*organic._hex(palette["ground_shadow"]), 0))
    sh.putalpha(shadow)
    work.alpha_composite(sh)

    organic._draw_trunk_and_bark(work, recipe, palette, W, H)

    groups = _flower_groups(recipe, rng, view)
    for idx, (y, x, rx, ry) in enumerate(groups):
        _paint_group(work, rng, palette, (x, y), (rx, ry), edge_spray=(idx % 3 == 0))

    _visible_branch_pass(work, recipe, palette)

    frame = organic._alpha_safe_resize(work, tuple(canvas))
    frame = organic._final_raster_pass(frame, rng, palette, recipe)
    bounds = frame.getchannel("A").getbbox()
    return frame, {
        "contract": CONTRACT,
        "id": recipe["id"],
        "canvas": canvas,
        "anchor": anchor,
        "bounds": list(bounds),
        "seed": seed,
        "crownStyle": "broadleaf",
        "sceneryType": "flowering_tree",
        "authoringMode": "shared_brush_flowering_groups",
        "brushes": [
            "leaf_cluster_broadleaf",
            "flower_cluster_small_round",
            "flower_spray",
            "branch_tapered",
            "interior_occlusion_patch",
            "edge_breakup_stamp",
            "blossom_gap_windows",
        ],
        "view": view,
        "yawDeg": int(recipe.get("rotation", {}).get("yawDeg", {}).get(view, DEFAULT_YAWS[view])),
        "camera": camera,
        "runtimePromotion": False,
        "artApproved": False,
    }


def export(recipe_path: Path, output_dir: Path):
    raw = recipe_path.read_bytes()
    recipe = json.loads(raw)
    output_dir.mkdir(parents=True, exist_ok=True)
    stem = recipe["id"]
    rotation = recipe.get("rotation", {})
    views = rotation.get("views", ["south"])
    if not views or any(view not in VALID_VIEWS for view in views):
        raise ValueError(f"rotation views must be a non-empty subset of {VALID_VIEWS}")

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
        organic.isometric_board(frame, meta["anchor"], f"CH_CAMERA_V1 / {view} / yaw {meta['yawDeg']} / 128x64").save(output_dir / f"{stem}_{view}_isometric_review.png")
        slots[view] = {
            "path": str(final), "source": str(source), "yawDeg": meta["yawDeg"],
            "sha256": hashlib.sha256(final.read_bytes()).hexdigest(), "finish": None,
        }

    canonical_view = "south" if "south" in slots else views[0]
    canonical = output_dir / f"{stem}.png"
    canonical.write_bytes(Path(slots[canonical_view]["path"]).read_bytes())
    with Image.open(canonical) as image:
        final_frame = image.convert("RGBA")
    review = output_dir / f"{stem}_review.png"
    iso = output_dir / f"{stem}_isometric_review.png"
    organic.review_board(final_frame).save(review)
    organic.isometric_board(final_frame, first_meta["anchor"]).save(iso)

    manifest = {
        "contract": ROTATION_CONTRACT,
        "id": stem,
        "mode": rotation.get("mode", "procedural_quarter_turns"),
        "lightingSpace": rotation.get("lightingSpace", "screen_camera_relative"),
        "generatedViews": True,
        "views": slots,
    }
    manifest_path = output_dir / f"{stem}_rotation.json"
    manifest_path.write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")

    meta = dict(first_meta)
    meta.update({
        "recipe": str(recipe_path),
        "recipeSha256": hashlib.sha256(raw).hexdigest(),
        "png": str(canonical),
        "review": str(review),
        "isometricReview": str(iso),
        "rotationManifest": str(manifest_path),
        "views": slots,
    })
    report = output_dir / f"{stem}.json"
    report.write_text(json.dumps(meta, indent=2) + "\n", encoding="utf-8")
    return {
        "png": str(canonical),
        "review": str(review),
        "isometricReview": str(iso),
        "metadata": str(report),
        "rotationManifest": str(manifest_path),
        "views": {view: slot["path"] for view, slot in slots.items()},
    }

"""Species renderer for the City Horizon Red Mapple family.

This renderer uses the shared Visitor Forge 2D brush library so the Red Mapple
becomes the first production tree family built from reusable foliage, branch,
occlusion and silhouette primitives instead of species-local drawing code.
"""
from __future__ import annotations

import hashlib
import json
import math
import random
from pathlib import Path

from PIL import Image, ImageChops, ImageDraw, ImageFilter

from . import brushes
from . import organic_scenery as organic

CONTRACT = organic.CONTRACT
CAMERA_CONTRACT = organic.CAMERA_CONTRACT
ROTATION_CONTRACT = organic.ROTATION_CONTRACT
WORK_SCALE = organic.WORK_SCALE
VALID_VIEWS = organic.VALID_VIEWS
DEFAULT_YAWS = organic.DEFAULT_YAWS
VIEW_PHASE = organic.VIEW_PHASE


def _paint_leaf_group(work, rng, palette, center, radius, *, light_bias=0.0):
    """Paint one layered maple foliage group with shared Forge 2D brushes."""
    cx, cy = center
    rx, ry = radius
    W, H = work.size

    # 1) authored medium-scale foliage mass
    mask = Image.new("L", (W, H))
    brushes.leaf_cluster_broadleaf(
        mask, rng, cx, cy, rx, ry,
        satellites=5,
        fill=255,
    )

    # 2) contour breakup + controlled negative space
    brushes.edge_breakup_stamp(
        mask, rng, cx, cy, max(rx, ry),
        count=max(5, round((rx + ry) / 5)),
        fill=255,
    )
    brushes.silhouette_gap_cutter(
        mask, rng, cx, cy, rx, ry,
        count=2 if rx < 15 else 3,
    )

    # Dark underpainting gives depth while preserving gaps between groups.
    top = organic._mix_color(palette["mid_top"], palette["front_top"], .42 + light_bias)
    bottom = organic._mix_color(palette["mid_bottom"], palette["back_bottom"], .36)
    organic._composite(work, mask, top, bottom, right_shade=.08)

    # 3) reusable interior occlusion brush
    shade = Image.new("L", (W, H))
    brushes.interior_occlusion_patch(
        shade, rng,
        cx + rx * .20,
        cy + ry * .24,
        rx * .62,
        ry * .42,
        strength=112,
    )
    shade = ImageChops.multiply(shade, mask)
    organic._composite(work, shade, palette["occlusion"], palette["back_bottom"])

    # 4) many small maple leaves constrained to the group silhouette
    leaves = Image.new("RGBA", (W, H))
    brushes.leaf_cluster_maple(
        leaves,
        rng,
        mask,
        (cx, cy),
        (rx, ry),
        (
            palette["mid_top"],
            palette["front_top"],
            palette["front_bottom"],
            palette["leaf_shadow_top"],
        ),
        count=max(42, round((rx * ry) / 4.5)),
        highlight_color=palette["highlight"],
        shadow_color=palette["leaf_shadow_bottom"],
    )
    leaves.putalpha(ImageChops.multiply(leaves.getchannel("A"), mask))
    work.alpha_composite(leaves)


def _group_positions(recipe, rng, view):
    cfg = recipe["mapleStyle"]
    cx, cy = map(float, cfg.get("center", [128, 126]))
    phase = VIEW_PHASE[view]
    branches = recipe.get("trunkBranches", [])[1:]
    if not branches:
        raise ValueError("red_mapple renderer requires authored trunkBranches")

    steps = tuple(float(v) for v in cfg.get("branchLeafSteps", [.58, .82, 1.03]))
    groups = []
    for index, branch in enumerate(branches):
        p0 = tuple(map(float, branch["p0"]))
        p1 = tuple(map(float, branch.get("p1", branch["p0"])))
        p2 = tuple(map(float, branch["p2"]))
        for step, along in enumerate(steps):
            x, y = organic._quad(p0, p1, p2, along)
            x += math.sin(phase + index * 1.37 + step * .7) * 2.6 + rng.uniform(-2.2, 2.2)
            y += math.cos(phase + index * .91 + step * .6) * 1.4 + rng.uniform(-1.8, 1.8)
            size = rng.uniform(.88, 1.12)
            height_factor = max(.70, min(1.12, (y - 54) / 120))
            groups.append((
                y,
                x,
                12.8 * size * height_factor,
                9.6 * size * height_factor,
            ))

    # Interior connector groups keep the crown readable as one tree without
    # returning to the old opaque generic broadleaf blob.
    interior = (
        (cx - 20, cy - 38, 16, 11),
        (cx + 2, cy - 43, 16, 11),
        (cx + 23, cy - 23, 17, 12),
        (cx - 28, cy - 10, 17, 12),
        (cx + 1, cy - 8, 18, 13),
        (cx - 11, cy + 15, 17, 12),
        (cx + 19, cy + 12, 16, 11),
    )
    for x, y, rx, ry in interior:
        groups.append((
            y + math.sin(phase) * 1.2,
            x + math.cos(phase) * 1.8,
            rx * rng.uniform(.94, 1.06),
            ry * rng.uniform(.94, 1.06),
        ))
    groups.sort()
    return groups


def _draw_visible_twigs(work, recipe, palette):
    """Overlay a few thin shared-primitive twigs so wood survives dense foliage."""
    W, H = work.size
    mask = Image.new("L", (W, H))
    branches = recipe.get("trunkBranches", [])[1:]
    for index, branch in enumerate(branches):
        if index % 2:
            continue
        p0 = tuple(map(float, branch["p0"]))
        p1 = tuple(map(float, branch.get("p1", branch["p0"])))
        p2 = tuple(map(float, branch["p2"]))
        brushes.branch_tapered(
            mask, p0, p1, p2,
            max(1.2, float(branch.get("w0", 3.0)) * .52),
            max(.55, float(branch.get("w1", 1.2)) * .72),
            samples=36,
            fill=120,
        )
    if mask.getbbox():
        organic._composite(work, mask, palette["trunk_light"], palette["trunk_bottom"], right_shade=.10)


def render(recipe, view="south"):
    if recipe.get("contract") != CONTRACT:
        raise ValueError(f"recipe must declare {CONTRACT}")
    camera = recipe.get("camera", {})
    if camera.get("contract") != CAMERA_CONTRACT or camera.get("tile") != [128, 64]:
        raise ValueError("Red Mapple scenery requires CH_CAMERA_V1 on the 128x64 grid")
    if view not in VALID_VIEWS:
        raise ValueError(f"view must be one of {VALID_VIEWS}")

    canvas = recipe.get("canvas", [256, 320])
    anchor = recipe.get("anchor", [128, 308])
    seed = int(recipe.get("seed", 1))
    phase_seed = int(round(VIEW_PHASE[view] * 1000))
    rng = random.Random(seed ^ (0x5A17 + phase_seed))
    W, H = canvas[0] * WORK_SCALE, canvas[1] * WORK_SCALE
    palette = recipe["palette"]
    work = Image.new("RGBA", (W, H))

    shadow = Image.new("L", (W, H))
    sw = int(recipe.get("shadowWidth", 92))
    ImageDraw.Draw(shadow).ellipse(
        ((anchor[0] - sw // 2) * WORK_SCALE, (anchor[1] - 8) * WORK_SCALE,
         (anchor[0] + sw // 2) * WORK_SCALE, (anchor[1] + 4) * WORK_SCALE), fill=126)
    shadow = shadow.filter(ImageFilter.GaussianBlur(2.3 * WORK_SCALE))
    sh = Image.new("RGBA", (W, H), (*organic._hex(palette["ground_shadow"]), 0))
    sh.putalpha(shadow)
    work.alpha_composite(sh)

    organic._draw_trunk_and_bark(work, recipe, palette, W, H)

    groups = _group_positions(recipe, rng, view)
    for y, x, rx, ry in groups:
        light_bias = .08 if x < canvas[0] * .50 and y < canvas[1] * .43 else 0.0
        _paint_leaf_group(work, rng, palette, (x, y), (rx, ry), light_bias=light_bias)

    # A selective twig pass restores branch readability after foliage paint.
    _draw_visible_twigs(work, recipe, palette)

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
        "sceneryType": "red_mapple",
        "authoringMode": "shared_brush_maple_leaf_groups",
        "brushes": [
            "leaf_cluster_broadleaf",
            "leaf_cluster_maple",
            "branch_tapered",
            "interior_occlusion_patch",
            "edge_breakup_stamp",
            "silhouette_gap_cutter",
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

"""Volumetric branch-guided broadleaf renderer for Visitor Forge 2D.

V3 keeps the branch-guided construction from V2 but restores readable depth.
It builds three explicit foliage depth bands (rear/mid/front), uses connected
irregular masses with no punched holes or detached edge stamps, and paints a
limited number of leaves large enough to survive gameplay 1x.
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


def _clamp(value: float, lo: float, hi: float) -> float:
    return max(lo, min(hi, value))


def _structure(recipe: dict):
    cfg = recipe.get("broadleafStructure", {})
    cx, cy = map(float, cfg.get("center", [recipe["anchor"][0], recipe["anchor"][1] * .52]))
    rx, ry = map(float, cfg.get("radius", [recipe["canvas"][0] * .38, recipe["canvas"][1] * .27]))
    density = _clamp(float(cfg.get("density", 1.0)), .72, 1.30)
    return cx, cy, rx, ry, density


def _connected_mass_mask(size, rng, cx, cy, rx, ry, lobes=18):
    """One connected scalloped mass. Secondary lobes always overlap the core."""
    mask = Image.new("L", size)
    draw = ImageDraw.Draw(mask)
    points = []
    for i in range(max(12, lobes)):
        a = math.tau * i / max(12, lobes)
        radial = 1.0 + rng.uniform(-.13, .13)
        points.append(((cx + math.cos(a) * rx * radial) * WORK_SCALE,
                       (cy + math.sin(a) * ry * radial) * WORK_SCALE))
    draw.polygon(points, fill=255)
    # Embedded lobes break the contour without producing floating circles.
    for angle in (-2.55, -1.65, -.65, .35, 1.30, 2.25):
        a = angle + rng.uniform(-.12, .12)
        lx = cx + math.cos(a) * rx * rng.uniform(.60, .72)
        ly = cy + math.sin(a) * ry * rng.uniform(.58, .70)
        lrx = rx * rng.uniform(.26, .34)
        lry = ry * rng.uniform(.24, .32)
        draw.ellipse(((lx-lrx)*WORK_SCALE, (ly-lry)*WORK_SCALE,
                      (lx+lrx)*WORK_SCALE, (ly+lry)*WORK_SCALE), fill=255)
    return mask.filter(ImageFilter.MaxFilter(3))


def _groups(recipe: dict, rng: random.Random, view: str):
    cx, cy, rx, ry, density = _structure(recipe)
    phase = VIEW_PHASE[view]
    branches = recipe.get("trunkBranches", [])
    if len(branches) < 3:
        raise ValueError("structured broadleaf v3 requires authored trunkBranches")

    groups = []
    branch_count = 0

    # Rear masses: broad, dark support volumes behind the crown.
    rear_layout = [
        (-.46, -.11, .31, .24), (-.19, -.37, .33, .25),
        (.13, -.40, .34, .25), (.43, -.15, .31, .24),
        (-.27, .16, .32, .25), (.08, .12, .35, .26), (.38, .16, .30, .24),
    ]
    for i, (ox, oy, sx, sy) in enumerate(rear_layout):
        a = phase + i * .57
        groups.append({
            "depth": 0, "source": "rear",
            "x": cx + ox*rx + math.cos(a)*rx*.014 + rng.uniform(-1.3, 1.3),
            "y": cy + oy*ry + math.sin(a)*ry*.010 + rng.uniform(-1.0, 1.0),
            "rx": rx*sx*math.sqrt(density), "ry": ry*sy*math.sqrt(density),
        })

    # Mid masses are branch driven. They provide identity and preserve structure.
    for bi, branch in enumerate(branches[1:]):
        p0 = tuple(map(float, branch["p0"]))
        p1 = tuple(map(float, branch.get("p1", branch["p0"])))
        p2 = tuple(map(float, branch["p2"]))
        for si, t in enumerate((.72, 1.00)):
            x, y = organic._quad(p0, p1, p2, t)
            a = phase + bi*.74 + si*.49
            groups.append({
                "depth": 1, "source": "branch",
                "x": x + math.cos(a)*rx*.016 + rng.uniform(-1.5, 1.5),
                "y": y + math.sin(a)*ry*.010 + rng.uniform(-1.0, 1.0),
                "rx": rx*(.245 if si == 0 else .275)*math.sqrt(density)*rng.uniform(.95, 1.06),
                "ry": ry*(.205 if si == 0 else .225)*math.sqrt(density)*rng.uniform(.95, 1.06),
            })
            branch_count += 1

    # Front cap masses are fewer and smaller, so highlights read as local volume.
    front_layout = [
        (-.34, -.18, .25, .20), (-.05, -.27, .27, .21),
        (.28, -.16, .25, .20), (-.22, .10, .25, .20),
        (.12, .08, .27, .21), (.34, .13, .23, .19),
    ]
    for i, (ox, oy, sx, sy) in enumerate(front_layout):
        a = phase + i*.69
        groups.append({
            "depth": 2, "source": "front",
            "x": cx + ox*rx + math.cos(a)*rx*.012 + rng.uniform(-1.1, 1.1),
            "y": cy + oy*ry + math.sin(a)*ry*.008 + rng.uniform(-.8, .8),
            "rx": rx*sx*math.sqrt(density), "ry": ry*sy*math.sqrt(density),
        })

    groups.sort(key=lambda g: (g["depth"], g["y"]))
    return groups, branch_count


def _paint_leaves(work, mask, rng, palette, group, crown_center):
    cx, cy = group["x"], group["y"]
    rx, ry = group["rx"], group["ry"]
    crown_cx, crown_cy = crown_center
    px = mask.load()
    layer = Image.new("RGBA", mask.size)
    draw = ImageDraw.Draw(layer, "RGBA")

    if group["depth"] == 0:
        target = max(8, min(20, round(rx*ry/18)))
    elif group["depth"] == 1:
        target = max(14, min(34, round(rx*ry/12)))
    else:
        target = max(18, min(42, round(rx*ry/10)))

    painted = 0
    for _ in range(target * 5):
        if painted >= target:
            break
        x = cx + rng.uniform(-.88, .88)*rx
        y = cy + rng.uniform(-.84, .84)*ry
        ix, iy = round(x*WORK_SCALE), round(y*WORK_SCALE)
        if not (0 <= ix < mask.width and 0 <= iy < mask.height) or px[ix, iy] < 220:
            continue
        lit = x < crown_cx + rx*.10 and y < crown_cy + ry*.06
        roll = rng.random()
        if group["depth"] == 0:
            color = palette["mid_bottom"] if roll < .65 else palette["back_top"]
        elif lit and roll < .16:
            color = palette["highlight"]
        elif lit and roll < .58:
            color = palette["front_top"]
        elif y > cy + ry*.18 and roll < .45:
            color = palette["front_bottom"]
        else:
            color = palette["mid_top"]
        outward = math.atan2(y-crown_cy, x-crown_cx)*.18
        organic._draw_leaflet(draw, x, y,
                              rng.uniform(4.8, 7.2), rng.uniform(1.8, 2.8),
                              outward + rng.uniform(-.58, .58), color,
                              rng.randint(182, 230))
        painted += 1
    layer.putalpha(ImageChops.multiply(layer.getchannel("A"), mask))
    work.alpha_composite(layer)
    return painted


def _paint_mass(work, rng, palette, group, crown_center):
    mask = _connected_mass_mask(work.size, rng, group["x"], group["y"], group["rx"], group["ry"])
    depth = group["depth"]
    if depth == 0:
        top = organic._mix_color(palette["back_top"], palette["mid_top"], .28)
        bottom = palette["back_bottom"]
        shade_strength = 64
    elif depth == 1:
        top = organic._mix_color(palette["mid_top"], palette["front_top"], .28)
        bottom = organic._mix_color(palette["mid_bottom"], palette["front_bottom"], .24)
        shade_strength = 58
    else:
        top = organic._mix_color(palette["mid_top"], palette["front_top"], .52)
        bottom = organic._mix_color(palette["mid_bottom"], palette["front_bottom"], .40)
        shade_strength = 48
    organic._composite(work, mask, top, bottom, right_shade=.055)

    # Lower-right local shadow gives separation between overlapping masses.
    shade = Image.new("L", work.size)
    brushes.interior_occlusion_patch(shade, rng,
        group["x"] + group["rx"]*.18, group["y"] + group["ry"]*.25,
        group["rx"]*.48, group["ry"]*.34, strength=shade_strength)
    shade = ImageChops.multiply(shade, mask)
    organic._composite(work, shade, palette["occlusion"], palette["back_bottom"])

    # Only mid/front groups get a compact highlight cap.
    if depth > 0:
        light = Image.new("L", work.size)
        brushes.leaf_cluster_round(light, rng,
            group["x"]-group["rx"]*.20, group["y"]-group["ry"]*.22,
            group["rx"]*.32, group["ry"]*.24, lobes=10, jitter=.12,
            fill=40 if depth == 1 else 56)
        light = ImageChops.multiply(light, mask)
        organic._composite(work, light, palette["highlight"], top, right_shade=.015)

    return _paint_leaves(work, mask, rng, palette, group, crown_center)


def render(recipe: dict, view: str = "south"):
    if recipe.get("contract") != CONTRACT:
        raise ValueError(f"recipe must declare {CONTRACT}")
    camera = recipe.get("camera", {})
    if camera.get("contract") != CAMERA_CONTRACT or camera.get("tile") != [128, 64]:
        raise ValueError("structured broadleaf v3 requires CH_CAMERA_V1 on 128x64")
    if view not in VALID_VIEWS:
        raise ValueError(f"view must be one of {VALID_VIEWS}")
    if recipe.get("crownStyle") != "broadleaf":
        raise ValueError("structured broadleaf v3 requires crownStyle broadleaf")

    canvas = recipe.get("canvas", [256, 320])
    anchor = recipe.get("anchor", [canvas[0]//2, canvas[1]-9])
    seed = int(recipe.get("seed", 1))
    rng = random.Random(seed ^ (0x93C51 + int(round(VIEW_PHASE[view]*1000))))
    W, H = canvas[0]*WORK_SCALE, canvas[1]*WORK_SCALE
    palette = recipe["palette"]
    work = Image.new("RGBA", (W, H))

    shadow = Image.new("L", (W, H))
    sw = int(recipe.get("shadowWidth", round(canvas[0]*.42)))
    ImageDraw.Draw(shadow).ellipse(((anchor[0]-sw//2)*WORK_SCALE, (anchor[1]-7)*WORK_SCALE,
                                    (anchor[0]+sw//2)*WORK_SCALE, (anchor[1]+4)*WORK_SCALE), fill=96)
    shadow = shadow.filter(ImageFilter.GaussianBlur(2.0*WORK_SCALE))
    sh = Image.new("RGBA", (W, H), (*organic._hex(palette["ground_shadow"]), 0))
    sh.putalpha(shadow)
    work.alpha_composite(sh)

    # Wood remains behind all foliage.
    organic._draw_trunk_and_bark(work, recipe, palette, W, H)

    cx, cy, _rx, _ry, density = _structure(recipe)
    groups, branch_count = _groups(recipe, rng, view)
    leaves = 0
    for group in groups:
        leaves += _paint_mass(work, rng, palette, group, (cx, cy))

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
        "authoringMode": "branch_guided_volumetric_groups_v3",
        "view": view,
        "yawDeg": int(recipe.get("rotation", {}).get("yawDeg", {}).get(view, DEFAULT_YAWS[view])),
        "camera": camera,
        "critic": {
            "singleCanopyBlob": False,
            "depthBands": 3,
            "macroMassCount": len(groups),
            "branchDerivedMassCount": branch_count,
            "explicitLeafCount": leaves,
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
        slots[view] = {"path": str(final), "source": str(source),
                       "yawDeg": meta["yawDeg"],
                       "sha256": hashlib.sha256(final.read_bytes()).hexdigest(),
                       "finish": None}

    canonical_view = "south" if "south" in slots else views[0]
    canonical = output_dir / f"{stem}.png"
    canonical.write_bytes(Path(slots[canonical_view]["path"]).read_bytes())
    with Image.open(canonical) as image:
        final_frame = image.convert("RGBA")
    review = output_dir / f"{stem}_review.png"
    iso = output_dir / f"{stem}_isometric_review.png"
    organic.review_board(final_frame).save(review)
    organic.isometric_board(final_frame, first_meta["anchor"]).save(iso)

    manifest = {"contract": ROTATION_CONTRACT, "id": stem,
                "mode": recipe.get("rotation", {}).get("mode", "procedural_quarter_turns"),
                "lightingSpace": recipe.get("rotation", {}).get("lightingSpace", "screen_camera_relative"),
                "generatedViews": True, "views": slots}
    manifest_path = output_dir / f"{stem}_rotation.json"
    manifest_path.write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")

    meta = dict(first_meta)
    meta.update({"recipe": str(recipe_path),
                 "recipeSha256": hashlib.sha256(raw).hexdigest(),
                 "png": str(canonical), "review": str(review),
                 "isometricReview": str(iso),
                 "rotationManifest": str(manifest_path), "views": slots})
    report = output_dir / f"{stem}.json"
    report.write_text(json.dumps(meta, indent=2) + "\n", encoding="utf-8")
    return {"png": str(canonical), "review": str(review),
            "isometricReview": str(iso), "metadata": str(report),
            "rotationManifest": str(manifest_path),
            "views": {view: slot["path"] for view, slot in slots.items()}}

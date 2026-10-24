"""Crisp clustered broadleaf V5 for Visitor Forge 2D.

V5 addresses the remaining flat/rubbery crown problem from V4.  Instead of
letting many large translucent masses merge into a plate, it uses smaller
explicit depth clusters, stronger local tonal separation and nearly opaque
leaf primitives that survive gameplay 1x.
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
from . import structured_broadleaf_scenery_v3 as v3

CONTRACT = v3.CONTRACT
CAMERA_CONTRACT = v3.CAMERA_CONTRACT
ROTATION_CONTRACT = v3.ROTATION_CONTRACT
WORK_SCALE = v3.WORK_SCALE
VALID_VIEWS = v3.VALID_VIEWS
DEFAULT_YAWS = v3.DEFAULT_YAWS
VIEW_PHASE = v3.VIEW_PHASE


def _structure(recipe: dict):
    cfg = recipe.get("broadleafStructure", {})
    cx, cy = map(float, cfg.get("center", [recipe["anchor"][0], recipe["anchor"][1] * .55]))
    rx, ry = map(float, cfg.get("radius", [recipe["canvas"][0] * .39, recipe["canvas"][1] * .27]))
    density = max(.78, min(1.18, float(cfg.get("density", 1.0))))
    return cx, cy, rx, ry, density


def _cluster_mask(size, rng, cx, cy, rx, ry, *, lobes=16):
    """Connected scalloped cluster; no detached edge dots or punched holes."""
    mask = Image.new("L", size)
    draw = ImageDraw.Draw(mask)
    points = []
    for i in range(max(12, lobes)):
        a = math.tau * i / max(12, lobes)
        radial = 1.0 + rng.uniform(-.16, .16)
        points.append(((cx + math.cos(a) * rx * radial) * WORK_SCALE,
                       (cy + math.sin(a) * ry * radial) * WORK_SCALE))
    draw.polygon(points, fill=255)
    # Embedded lobes overlap the core so the silhouette is organic but connected.
    for a0 in (-2.65, -1.75, -.82, .10, 1.05, 2.05):
        a = a0 + rng.uniform(-.11, .11)
        lx = cx + math.cos(a) * rx * rng.uniform(.57, .68)
        ly = cy + math.sin(a) * ry * rng.uniform(.55, .67)
        lrx = rx * rng.uniform(.22, .31)
        lry = ry * rng.uniform(.20, .29)
        draw.ellipse(((lx-lrx)*WORK_SCALE, (ly-lry)*WORK_SCALE,
                      (lx+lrx)*WORK_SCALE, (ly+lry)*WORK_SCALE), fill=255)
    return mask.filter(ImageFilter.MaxFilter(3))


def _groups(recipe: dict, rng: random.Random, view: str):
    cx, cy, rx, ry, density = _structure(recipe)
    phase = VIEW_PHASE[view]
    root = math.sqrt(density)
    branches = recipe.get("trunkBranches", [])
    if len(branches) < 3:
        raise ValueError("structured broadleaf v5 requires authored trunkBranches")

    groups = []
    branch_count = 0

    # Rear support volumes: fewer and smaller than V4 so they do not merge into
    # a single green plate.
    rear = (
        (-.46, -.10, .27, .22), (-.19, -.39, .28, .22),
        (.13, -.43, .29, .22), (.43, -.14, .27, .22),
        (-.31, .19, .28, .22), (.03, .17, .30, .23), (.36, .18, .27, .22),
    )
    for i, (ox, oy, sx, sy) in enumerate(rear):
        a = phase + i * .57
        groups.append({
            "depth": 0, "source": "rear",
            "x": cx + ox*rx + math.cos(a)*rx*.012 + rng.uniform(-1.1, 1.1),
            "y": cy + oy*ry + math.sin(a)*ry*.008 + rng.uniform(-.8, .8),
            "rx": rx*sx*root, "ry": ry*sy*root,
        })

    # Branch-driven mid volumes retain botanical structure without exposing the
    # mechanical wood skeleton.  Two clusters per branch are enough at 1x.
    for bi, branch in enumerate(branches[1:]):
        p0 = tuple(map(float, branch["p0"]))
        p1 = tuple(map(float, branch.get("p1", branch["p0"])))
        p2 = tuple(map(float, branch["p2"]))
        for si, t in enumerate((.72, 1.00)):
            x, y = organic._quad(p0, p1, p2, t)
            a = phase + bi*.73 + si*.49
            groups.append({
                "depth": 1, "source": "branch",
                "x": x + math.cos(a)*rx*.012 + rng.uniform(-1.1, 1.1),
                "y": y + math.sin(a)*ry*.007 + rng.uniform(-.7, .7),
                "rx": rx*(.205 if si == 0 else .235)*root*rng.uniform(.96, 1.05),
                "ry": ry*(.175 if si == 0 else .195)*root*rng.uniform(.96, 1.05),
            })
            branch_count += 1

    # Front clusters are deliberately separated enough to keep a visible mound
    # rhythm across the crown while still overlapping at their edges.
    front = (
        (-.39, -.19, .22, .18), (-.13, -.28, .23, .18),
        (.15, -.25, .23, .18), (.39, -.14, .22, .18),
        (-.30, .07, .23, .19), (-.02, .04, .24, .19),
        (.27, .08, .23, .19), (-.19, .28, .22, .18),
        (.11, .28, .23, .18), (.36, .24, .21, .17),
    )
    for i, (ox, oy, sx, sy) in enumerate(front):
        a = phase + i*.61
        groups.append({
            "depth": 2, "source": "front",
            "x": cx + ox*rx + math.cos(a)*rx*.009 + rng.uniform(-.8, .8),
            "y": cy + oy*ry + math.sin(a)*ry*.006 + rng.uniform(-.6, .6),
            "rx": rx*sx*root, "ry": ry*sy*root,
        })

    # Three small apex clusters round the top without creating the single dome
    # that made V4 look rubbery.
    for i, (ox, oy) in enumerate(((-.20, -.55), (.03, -.62), (.25, -.52))):
        groups.append({
            "depth": 2, "source": "apex",
            "x": cx + ox*rx + math.cos(phase+i*.8)*rx*.006 + rng.uniform(-.5, .5),
            "y": cy + oy*ry + rng.uniform(-.5, .5),
            "rx": rx*.20*root, "ry": ry*.16*root,
        })

    # Lower-front clusters hide the branch fork and make the crown hang naturally.
    for i, (ox, oy) in enumerate(((-.24, .39), (.02, .43), (.27, .37))):
        groups.append({
            "depth": 2, "source": "skirt",
            "x": cx + ox*rx + math.cos(phase+i*.7)*rx*.006 + rng.uniform(-.5, .5),
            "y": cy + oy*ry + rng.uniform(-.4, .4),
            "rx": rx*.22*root, "ry": ry*.17*root,
        })

    groups.sort(key=lambda g: (g["depth"], g["y"]))
    return groups, branch_count


def _paint_leaves(work, mask, rng, palette, group, crown_center):
    """Opaque, readable leaf marks instead of low-alpha paint noise."""
    cx, cy = group["x"], group["y"]
    rx, ry = group["rx"], group["ry"]
    crown_cx, crown_cy = crown_center
    px = mask.load()
    layer = Image.new("RGBA", mask.size)
    draw = ImageDraw.Draw(layer, "RGBA")

    depth = group["depth"]
    if depth == 0:
        target = max(7, min(16, round(rx*ry/22)))
    elif depth == 1:
        target = max(12, min(26, round(rx*ry/15)))
    else:
        target = max(15, min(32, round(rx*ry/13)))

    painted = 0
    for _ in range(target * 6):
        if painted >= target:
            break
        x = cx + rng.uniform(-.86, .86)*rx
        y = cy + rng.uniform(-.82, .82)*ry
        ix, iy = round(x*WORK_SCALE), round(y*WORK_SCALE)
        if not (0 <= ix < mask.width and 0 <= iy < mask.height) or px[ix, iy] < 220:
            continue
        lit = x < crown_cx + rx*.08 and y < crown_cy + ry*.02
        roll = rng.random()
        if depth == 0:
            color = palette["back_top"] if roll < .46 else palette["mid_bottom"]
        elif depth == 1:
            if lit and roll < .18:
                color = palette["front_top"]
            elif roll < .52:
                color = palette["mid_top"]
            else:
                color = palette["front_bottom"]
        else:
            if lit and roll < .20:
                color = palette["highlight"]
            elif lit and roll < .62:
                color = palette["front_top"]
            elif roll < .78:
                color = palette["mid_top"]
            else:
                color = palette["front_bottom"]

        outward = math.atan2(y-crown_cy, x-crown_cx)*.15
        organic._draw_leaflet(
            draw, x, y,
            rng.uniform(5.2, 7.8), rng.uniform(2.0, 3.0),
            outward + rng.uniform(-.52, .52), color,
            rng.randint(232, 255),
        )
        painted += 1

    layer.putalpha(ImageChops.multiply(layer.getchannel("A"), mask))
    work.alpha_composite(layer)
    return painted


def _paint_mass(work, rng, palette, group, crown_center):
    mask = _cluster_mask(work.size, rng, group["x"], group["y"], group["rx"], group["ry"])
    depth = group["depth"]

    if depth == 0:
        top = palette["back_top"]
        bottom = palette["back_bottom"]
        shade_strength = 86
        right = .08
    elif depth == 1:
        top = organic._mix_color(palette["mid_top"], palette["front_top"], .18)
        bottom = palette["mid_bottom"]
        shade_strength = 72
        right = .065
    else:
        top = palette["front_top"]
        bottom = organic._mix_color(palette["front_bottom"], palette["mid_bottom"], .20)
        shade_strength = 58
        right = .05

    organic._composite(work, mask, top, bottom, right_shade=right)

    # Local underside shadow separates one cluster from the next.  It stays
    # compact and never becomes a black central hole.
    shade = Image.new("L", work.size)
    brushes.interior_occlusion_patch(
        shade, rng,
        group["x"] + group["rx"]*.16,
        group["y"] + group["ry"]*.25,
        group["rx"]*.42,
        group["ry"]*.29,
        strength=shade_strength,
    )
    shade = ImageChops.multiply(shade, mask)
    organic._composite(work, shade, palette["occlusion"], bottom)

    # Crisp small highlight cap on front groups only.
    if depth == 2:
        light = Image.new("L", work.size)
        brushes.leaf_cluster_round(
            light, rng,
            group["x"]-group["rx"]*.24,
            group["y"]-group["ry"]*.27,
            group["rx"]*.27,
            group["ry"]*.20,
            lobes=9, jitter=.12, fill=82,
        )
        light = ImageChops.multiply(light, mask)
        organic._composite(work, light, palette["highlight"], top, right_shade=.01)

    return _paint_leaves(work, mask, rng, palette, group, crown_center)


def render(recipe: dict, view: str = "south"):
    if recipe.get("contract") != CONTRACT:
        raise ValueError(f"recipe must declare {CONTRACT}")
    camera = recipe.get("camera", {})
    if camera.get("contract") != CAMERA_CONTRACT or camera.get("tile") != [128, 64]:
        raise ValueError("structured broadleaf v5 requires CH_CAMERA_V1 on 128x64")
    if view not in VALID_VIEWS:
        raise ValueError(f"view must be one of {VALID_VIEWS}")
    if recipe.get("crownStyle") != "broadleaf":
        raise ValueError("structured broadleaf v5 requires crownStyle broadleaf")

    canvas = recipe.get("canvas", [256, 320])
    anchor = recipe.get("anchor", [canvas[0]//2, canvas[1]-9])
    seed = int(recipe.get("seed", 1))
    rng = random.Random(seed ^ (0xD5A71 + int(round(VIEW_PHASE[view]*1000))))
    W, H = canvas[0]*WORK_SCALE, canvas[1]*WORK_SCALE
    palette = recipe["palette"]
    work = Image.new("RGBA", (W, H))

    shadow = Image.new("L", (W, H))
    sw = int(recipe.get("shadowWidth", round(canvas[0]*.40)))
    ImageDraw.Draw(shadow).ellipse(
        ((anchor[0]-sw//2)*WORK_SCALE, (anchor[1]-7)*WORK_SCALE,
         (anchor[0]+sw//2)*WORK_SCALE, (anchor[1]+3)*WORK_SCALE), fill=88)
    shadow = shadow.filter(ImageFilter.GaussianBlur(1.8*WORK_SCALE))
    sh = Image.new("RGBA", (W, H), (*organic._hex(palette["ground_shadow"]), 0))
    sh.putalpha(shadow)
    work.alpha_composite(sh)

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
        "authoringMode": "crisp_clustered_depth_groups_v5",
        "view": view,
        "yawDeg": int(recipe.get("rotation", {}).get("yawDeg", {}).get(view, DEFAULT_YAWS[view])),
        "camera": camera,
        "critic": {
            "singleCanopyBlob": False,
            "depthBands": 3,
            "macroMassCount": len(groups),
            "branchDerivedMassCount": branch_count,
            "explicitLeafCount": leaves,
            "opaqueLeafDetail": True,
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
    with Image.open(canonical) as image:
        final_frame = image.convert("RGBA")
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

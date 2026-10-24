"""Brush-driven deterministic flower beds for City Horizon.

V2 keeps the existing CH camera/anchor contract but replaces the legacy
rectangular bloom construction with reusable flower brushes. Legacy flower
recipes remain routed to flower_bed_scenery.py unchanged.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import random
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter

from .exporter import alpha_safe_resize as _alpha_safe_resize
from .flower_bed_scenery import _ellipse_inside, _gradient_mask, _hex, _irregular_blob, isometric_board, review_board
from . import flower_brushes

CONTRACT = "CH_2D_ORGANIC_SCENERY_V1"
CAMERA_CONTRACT = "CH_CAMERA_V1"
SCENERY_TYPE = "flower_bed_v2"
WORK_SCALE = 4


def _flower_style(recipe: dict) -> dict:
    explicit = recipe.get("flowerStyle")
    if isinstance(explicit, dict):
        return explicit
    profile = recipe.get("visualProfileData", {})
    foliage = profile.get("foliage", {}) if isinstance(profile, dict) else {}
    flowering = profile.get("flowering", {}) if isinstance(profile, dict) else {}
    return {
        "flowerBrush": foliage.get("flowerBrush", "flower_rosette"),
        "leafBrush": foliage.get("leafBrush", "leaf_pair_small"),
        "budBrush": foliage.get("budBrush", "flower_bud"),
        "distribution": flowering.get("distribution", "clustered_even"),
        "stemCurvature": flowering.get("stemCurvature", "soft"),
    }


def render(recipe: dict) -> tuple[Image.Image, dict]:
    if recipe.get("contract") != CONTRACT:
        raise ValueError(f"recipe must declare {CONTRACT}")
    if recipe.get("sceneryType") != SCENERY_TYPE:
        raise ValueError(f"flower bed v2 requires sceneryType {SCENERY_TYPE!r}")
    camera = recipe.get("camera", {})
    if camera.get("contract") != CAMERA_CONTRACT or camera.get("tile") != [128, 64]:
        raise ValueError("flower bed v2 requires CH_CAMERA_V1 on 128x64 tile")

    canvas = tuple(recipe.get("canvas", [160, 144]))
    anchor = list(recipe.get("anchor", [80, 118]))
    seed = int(recipe.get("seed", 23))
    rng = random.Random(seed)
    palette = recipe["palette"]
    layout = recipe.get("layout", {})
    raster = recipe.get("raster", {})
    style = _flower_style(recipe)

    width, height = canvas
    work = Image.new("RGBA", (width * WORK_SCALE, height * WORK_SCALE))
    center_x, center_y = layout.get("center", [80, 94])
    outer_rx, outer_ry = layout.get("outerRadius", [59, 21])
    inner_rx, inner_ry = layout.get("innerRadius", [51, 16])
    foliage_rx, foliage_ry = layout.get("foliageRadius", [59, 29])

    # Ground contact, border and soil stay deliberately compatible with V1.
    shadow = Image.new("L", work.size)
    ImageDraw.Draw(shadow).ellipse(((center_x-outer_rx)*WORK_SCALE,
                                    (center_y+9-outer_ry*.25)*WORK_SCALE,
                                    (center_x+outer_rx)*WORK_SCALE,
                                    (center_y+9+outer_ry*.65)*WORK_SCALE), fill=118)
    shadow = shadow.filter(ImageFilter.GaussianBlur(2.3 * WORK_SCALE))
    shadow_layer = Image.new("RGBA", work.size, _hex(palette["ground_shadow"]) + (0,))
    shadow_layer.putalpha(shadow)
    work.alpha_composite(shadow_layer)

    border = Image.new("L", work.size)
    _irregular_blob(ImageDraw.Draw(border), rng, center_x, center_y+6, outer_rx, outer_ry, 255, 22, .07)
    work.alpha_composite(_gradient_mask(border, palette["border_top"], palette["border_bottom"]))
    soil = Image.new("L", work.size)
    _irregular_blob(ImageDraw.Draw(soil), rng, center_x, center_y, inner_rx, inner_ry, 255, 20, .09)
    soil_layer = Image.new("RGBA", work.size, _hex(palette["soil"]) + (0,))
    soil_layer.putalpha(soil.filter(ImageFilter.GaussianBlur(.10 * WORK_SCALE)))
    work.alpha_composite(soil_layer)

    # Macro foliage still owns the bed silhouette; small leaves add structure.
    foliage_specs = [
        (palette["foliage_dark"], int(layout.get("darkBlobs", 36)), 8., 19., 5., 11., 255),
        (palette["foliage_mid"], int(layout.get("midBlobs", 56)), 6., 15., 4., 9., 235),
        (palette["foliage_light"], int(layout.get("lightBlobs", 58)), 4., 12., 3., 8., 220),
        (palette["foliage_highlight"], int(layout.get("highlightBlobs", 34)), 3., 9., 2., 6., 195),
    ]
    for colour, count, min_rx, max_rx, min_ry, max_ry, max_alpha in foliage_specs:
        mask = Image.new("L", work.size)
        draw = ImageDraw.Draw(mask)
        made = attempts = 0
        while made < count and attempts < count * 20:
            attempts += 1
            x = rng.uniform(center_x-foliage_rx, center_x+foliage_rx)
            y = rng.uniform(center_y-foliage_ry, center_y+foliage_ry*.48)
            if not _ellipse_inside(x, y, center_x, center_y-2, foliage_rx, foliage_ry, 1.05):
                continue
            _irregular_blob(draw, rng, x, y, rng.uniform(min_rx,max_rx), rng.uniform(min_ry,max_ry),
                            rng.randint(int(max_alpha*.65), max_alpha), rng.randint(8,15), .26)
            made += 1
        layer = Image.new("RGBA", work.size, _hex(colour) + (0,))
        layer.putalpha(mask.filter(ImageFilter.GaussianBlur(.16*WORK_SCALE)))
        work.alpha_composite(layer)

    leaf_layer = Image.new("RGBA", work.size)
    leaf_colours = tuple(palette["leaf_dabs"])
    for _ in range(int(raster.get("leafDabs", 220)) // 3):
        x = rng.uniform(center_x-foliage_rx*.96, center_x+foliage_rx*.96)
        y = rng.uniform(center_y-foliage_ry*.96, center_y+foliage_ry*.40)
        if not _ellipse_inside(x, y, center_x, center_y-2, foliage_rx, foliage_ry, .98):
            continue
        flower_brushes.leaf_pair_small(leaf_layer, rng, (x,y), rng.choice(leaf_colours),
                                       length=rng.uniform(2.2,4.4), width=rng.uniform(.8,1.5),
                                       angle=rng.uniform(-2.8,-.35), alpha=rng.randint(105,190))
    work.alpha_composite(leaf_layer)

    flowers = Image.new("RGBA", work.size)
    stem_count = int(layout.get("stemCount", 42))
    petal_colours = tuple(palette["flower_yellows"])
    stem_colour = palette["stem"]
    stem_light = palette["stem_light"]
    brush_name = style.get("flowerBrush", "flower_rosette")
    bud_chance = float(recipe.get("flowerStyle", {}).get("budChance", .16))
    stems = []
    for _ in range(stem_count):
        x = rng.uniform(center_x-foliage_rx*.92, center_x+foliage_rx*.92)
        base_y = rng.uniform(center_y-foliage_ry*.42, center_y+foliage_ry*.40)
        central = max(0., 1.-abs(x-center_x)/max(1.,foliage_rx))
        stalk_height = rng.uniform(12.,31.) + central*rng.uniform(6.,20.)
        if rng.random() < float(layout.get("tallStemChance", .18)):
            stalk_height += rng.uniform(8.,15.)
        top_y = max(float(layout.get("minimumFlowerY",18)), base_y-stalk_height)
        top_x = x + rng.uniform(-4.,4.)
        stems.append((base_y,x,top_x,top_y))

    for base_y, x, top_x, top_y in sorted(stems):
        bend = rng.uniform(-3.0,3.0)
        flower_brushes.stem_curve(flowers, (x,base_y), ((x+top_x)/2+bend,(base_y+top_y)/2),
                                  (top_x,top_y), stem_colour, width=rng.uniform(.7,1.05))
        for _ in range(rng.randint(1,3)):
            t = rng.uniform(.28,.72)
            sx = x + (top_x-x)*t
            sy = base_y + (top_y-base_y)*t
            flower_brushes.leaf_pair_small(flowers, rng, (sx,sy), stem_light,
                                           length=rng.uniform(2.0,4.4), width=rng.uniform(.7,1.3),
                                           angle=rng.uniform(-2.7,-.45), alpha=185)
        if rng.random() < bud_chance:
            flower_brushes.flower_bud(flowers, (top_x,top_y), rng.choice(petal_colours),
                                      radius=rng.uniform(1.0,1.7))
        elif brush_name == "flower_star":
            flower_brushes.flower_star(flowers, rng, (top_x,top_y), rng.choice(petal_colours),
                                       palette.get("flower_center", "#D6A52E"),
                                       points=rng.randint(5,7), radius=rng.uniform(2.3,3.8))
        else:
            flower_brushes.flower_rosette(flowers, rng, (top_x,top_y), petal_colours,
                                          palette.get("flower_center", "#D6A52E"),
                                          petals=rng.randint(6,9), radius=rng.uniform(2.4,3.9))
    work.alpha_composite(flowers)

    frame = _alpha_safe_resize(work, canvas)
    frame = frame.filter(ImageFilter.UnsharpMask(radius=.50, percent=120, threshold=2))
    bounds = frame.getchannel("A").getbbox()
    metadata = {
        "contract": CONTRACT, "id": recipe["id"], "sceneryType": SCENERY_TYPE,
        "canvas": list(canvas), "anchor": anchor, "bounds": list(bounds) if bounds else None,
        "seed": seed, "camera": camera, "flowerStyle": style,
        "visualProfile": recipe.get("visualProfile"),
        "runtimePromotion": False, "artApproved": False,
    }
    return frame, metadata


def export(recipe_path: Path, output_dir: Path) -> dict:
    raw = recipe_path.read_bytes()
    recipe = json.loads(raw)
    frame, metadata = render(recipe)
    output_dir.mkdir(parents=True, exist_ok=True)
    stem = recipe["id"]
    png = output_dir / f"{stem}.png"
    review = output_dir / f"{stem}_review.png"
    isometric = output_dir / f"{stem}_isometric_review.png"
    report = output_dir / f"{stem}.json"
    frame.save(png)
    review_board(frame).save(review)
    isometric_board(frame, metadata["anchor"], "CH_CAMERA_V1 / flower brush V2 / 128x64").save(isometric)
    metadata.update({"recipe": str(recipe_path), "recipeSha256": hashlib.sha256(raw).hexdigest(),
                     "png": str(png), "review": str(review), "isometricReview": str(isometric)})
    report.write_text(json.dumps(metadata, indent=2) + "\n", encoding="utf-8")
    return {"png": str(png), "review": str(review), "isometricReview": str(isometric), "metadata": str(report)}


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--recipe", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    print(json.dumps(export(args.recipe, args.output), indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

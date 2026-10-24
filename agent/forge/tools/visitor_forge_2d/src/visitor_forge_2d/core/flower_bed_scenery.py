"""Deterministic raster-painted flower beds for City Horizon."""
from __future__ import annotations

import argparse
import hashlib
import json
import math
import random
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter
from .exporter import alpha_safe_resize as _alpha_safe_resize  # VF-3: single source

CONTRACT = "CH_2D_ORGANIC_SCENERY_V1"
CAMERA_CONTRACT = "CH_CAMERA_V1"
SCENERY_TYPE = "flower_bed"
WORK_SCALE = 4


def _hex(value: str) -> tuple[int, int, int]:
    return tuple(int(value[i:i + 2], 16) for i in (1, 3, 5))


def _irregular_blob(
    draw: ImageDraw.ImageDraw,
    rng: random.Random,
    cx: float,
    cy: float,
    rx: float,
    ry: float,
    fill: int,
    lobes: int = 14,
    jitter: float = 0.22,
) -> None:
    points = []
    for index in range(lobes):
        angle = 2.0 * math.pi * index / lobes
        scale = 1.0 + rng.uniform(-jitter, jitter)
        points.append(
            (
                round((cx + math.cos(angle) * rx * scale) * WORK_SCALE),
                round((cy + math.sin(angle) * ry * scale) * WORK_SCALE),
            )
        )
    draw.polygon(points, fill=fill)


def _gradient_mask(mask: Image.Image, top_hex: str, bottom_hex: str) -> Image.Image:
    width, height = mask.size
    top = _hex(top_hex)
    bottom = _hex(bottom_hex)
    out = Image.new("RGBA", (width, height))
    pixels = out.load()
    alpha = mask.load()
    for y in range(height):
        t = y / max(1, height - 1)
        colour = tuple(round(top[c] * (1.0 - t) + bottom[c] * t) for c in range(3))
        for x in range(width):
            pixels[x, y] = colour + (alpha[x, y],)
    return out


def _ellipse_inside(x: float, y: float, cx: float, cy: float, rx: float, ry: float, margin: float = 1.0) -> bool:
    return ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 <= margin


def render(recipe: dict) -> tuple[Image.Image, dict]:
    if recipe.get("contract") != CONTRACT:
        raise ValueError(f"recipe must declare {CONTRACT}")
    if recipe.get("sceneryType") != SCENERY_TYPE:
        raise ValueError(f"flower bed renderer requires sceneryType {SCENERY_TYPE!r}")
    camera = recipe.get("camera", {})
    if camera.get("contract") != CAMERA_CONTRACT:
        raise ValueError("flower bed gameplay scenery must declare CH_CAMERA_V1")
    if camera.get("tile") != [128, 64]:
        raise ValueError("CH_CAMERA_V1 review requires 128x64 tile")

    canvas = tuple(recipe.get("canvas", [160, 144]))
    anchor = list(recipe.get("anchor", [80, 118]))
    seed = int(recipe.get("seed", 23))
    rng = random.Random(seed)
    palette = recipe["palette"]
    layout = recipe.get("layout", {})
    raster = recipe.get("raster", {})

    width, height = canvas
    work = Image.new("RGBA", (width * WORK_SCALE, height * WORK_SCALE))
    center_x, center_y = layout.get("center", [80, 93])
    outer_rx, outer_ry = layout.get("outerRadius", [61, 24])
    inner_rx, inner_ry = layout.get("innerRadius", [54, 18])
    foliage_rx, foliage_ry = layout.get("foliageRadius", [59, 30])

    shadow = Image.new("L", work.size)
    shadow_draw = ImageDraw.Draw(shadow)
    shadow_draw.ellipse(
        (
            (center_x - outer_rx) * WORK_SCALE,
            (center_y + 9 - outer_ry * 0.25) * WORK_SCALE,
            (center_x + outer_rx) * WORK_SCALE,
            (center_y + 9 + outer_ry * 0.65) * WORK_SCALE,
        ),
        fill=118,
    )
    shadow = shadow.filter(ImageFilter.GaussianBlur(2.3 * WORK_SCALE))
    shadow_layer = Image.new("RGBA", work.size, _hex(palette["ground_shadow"]) + (0,))
    shadow_layer.putalpha(shadow)
    work.alpha_composite(shadow_layer)

    border = Image.new("L", work.size)
    border_draw = ImageDraw.Draw(border)
    _irregular_blob(border_draw, rng, center_x, center_y + 6, outer_rx, outer_ry, 255, 22, 0.07)
    work.alpha_composite(_gradient_mask(border, palette["border_top"], palette["border_bottom"]))

    soil = Image.new("L", work.size)
    soil_draw = ImageDraw.Draw(soil)
    _irregular_blob(soil_draw, rng, center_x, center_y, inner_rx, inner_ry, 255, 20, 0.09)
    soil_layer = Image.new("RGBA", work.size, _hex(palette["soil"]) + (0,))
    soil_layer.putalpha(soil.filter(ImageFilter.GaussianBlur(0.10 * WORK_SCALE)))
    work.alpha_composite(soil_layer)

    foliage_specs = [
        (palette["foliage_dark"], int(layout.get("darkBlobs", 36)), 8.0, 19.0, 5.0, 11.0, 255),
        (palette["foliage_mid"], int(layout.get("midBlobs", 56)), 6.0, 15.0, 4.0, 9.0, 235),
        (palette["foliage_light"], int(layout.get("lightBlobs", 58)), 4.0, 12.0, 3.0, 8.0, 220),
        (palette["foliage_highlight"], int(layout.get("highlightBlobs", 34)), 3.0, 9.0, 2.0, 6.0, 195),
    ]
    for colour, count, min_rx, max_rx, min_ry, max_ry, max_alpha in foliage_specs:
        mask = Image.new("L", work.size)
        draw = ImageDraw.Draw(mask)
        made = 0
        attempts = 0
        while made < count and attempts < count * 20:
            attempts += 1
            x = rng.uniform(center_x - foliage_rx, center_x + foliage_rx)
            y = rng.uniform(center_y - foliage_ry, center_y + foliage_ry * 0.48)
            if not _ellipse_inside(x, y, center_x, center_y - 2, foliage_rx, foliage_ry, 1.05):
                continue
            _irregular_blob(
                draw,
                rng,
                x,
                y,
                rng.uniform(min_rx, max_rx),
                rng.uniform(min_ry, max_ry),
                rng.randint(int(max_alpha * 0.65), max_alpha),
                rng.randint(8, 15),
                0.26,
            )
            made += 1
        layer = Image.new("RGBA", work.size, _hex(colour) + (0,))
        layer.putalpha(mask.filter(ImageFilter.GaussianBlur(0.16 * WORK_SCALE)))
        work.alpha_composite(layer)

    leaf_detail = Image.new("RGBA", work.size)
    leaf_draw = ImageDraw.Draw(leaf_detail, "RGBA")
    leaf_colours = [_hex(value) for value in palette["leaf_dabs"]]
    for _ in range(int(raster.get("leafDabs", 280))):
        x = rng.uniform(center_x - foliage_rx, center_x + foliage_rx)
        y = rng.uniform(center_y - foliage_ry * 1.05, center_y + foliage_ry * 0.45)
        if not _ellipse_inside(x, y, center_x, center_y - 2, foliage_rx + 1, foliage_ry, 1.0):
            continue
        colour = rng.choice(leaf_colours)
        alpha = rng.randint(75, 190)
        radius_x = rng.uniform(1.0, 2.7) * WORK_SCALE
        radius_y = rng.uniform(0.45, 1.35) * WORK_SCALE
        leaf_draw.ellipse(
            (
                x * WORK_SCALE - radius_x,
                y * WORK_SCALE - radius_y,
                x * WORK_SCALE + radius_x,
                y * WORK_SCALE + radius_y,
            ),
            fill=colour + (alpha,),
        )
    work.alpha_composite(leaf_detail)

    flowers = Image.new("RGBA", work.size)
    flower_draw = ImageDraw.Draw(flowers, "RGBA")
    stem_count = int(layout.get("stemCount", 42))
    stems = []
    for _ in range(stem_count):
        x = rng.uniform(center_x - foliage_rx * 0.92, center_x + foliage_rx * 0.92)
        base_y = rng.uniform(center_y - foliage_ry * 0.42, center_y + foliage_ry * 0.40)
        central = max(0.0, 1.0 - abs(x - center_x) / max(1.0, foliage_rx))
        stalk_height = rng.uniform(12.0, 31.0) + central * rng.uniform(6.0, 20.0)
        if rng.random() < float(layout.get("tallStemChance", 0.18)):
            stalk_height += rng.uniform(8.0, 15.0)
        top_y = max(float(layout.get("minimumFlowerY", 18)), base_y - stalk_height)
        top_x = x + rng.uniform(-4.0, 4.0)
        stems.append((base_y, x, top_x, top_y))

    stem_colour = _hex(palette["stem"])
    stem_light = _hex(palette["stem_light"])
    flower_colours = [_hex(value) for value in palette["flower_yellows"]]
    for base_y, x, top_x, top_y in sorted(stems):
        flower_draw.line(
            (x * WORK_SCALE, base_y * WORK_SCALE, top_x * WORK_SCALE, top_y * WORK_SCALE),
            fill=stem_colour + (225,),
            width=rng.choice([3, 4, 5]),
        )
        for _ in range(rng.randint(1, 3)):
            t = rng.uniform(0.25, 0.72)
            stem_x = x + (top_x - x) * t
            stem_y = base_y + (top_y - base_y) * t
            side = rng.choice([-1, 1])
            length = rng.uniform(2.2, 5.2)
            flower_draw.line(
                (
                    stem_x * WORK_SCALE,
                    stem_y * WORK_SCALE,
                    (stem_x + side * length) * WORK_SCALE,
                    (stem_y + rng.uniform(-0.5, 2.0)) * WORK_SCALE,
                ),
                fill=stem_light + (190,),
                width=3,
            )

        flower_colour = rng.choice(flower_colours)
        size = rng.choice([1.2, 1.5, 1.8, 2.0])
        cx, cy = top_x, top_y
        flower_draw.rectangle(
            ((cx - size) * WORK_SCALE, (cy - size) * WORK_SCALE, (cx + size) * WORK_SCALE, (cy + size) * WORK_SCALE),
            fill=flower_colour + (245,),
        )
        arm = rng.uniform(2.0, 4.0)
        flower_draw.rectangle(
            ((cx - 0.55) * WORK_SCALE, (cy - arm) * WORK_SCALE, (cx + 0.55) * WORK_SCALE, (cy + arm) * WORK_SCALE),
            fill=flower_colour + (235,),
        )
        flower_draw.rectangle(
            ((cx - arm) * WORK_SCALE, (cy - 0.55) * WORK_SCALE, (cx + arm) * WORK_SCALE, (cy + 0.55) * WORK_SCALE),
            fill=flower_colour + (235,),
        )
        for _ in range(rng.randint(0, 4)):
            t = rng.uniform(0.08, 0.35)
            bloom_x = top_x + (x - top_x) * t + rng.choice([-1, 1]) * rng.uniform(1.0, 4.0)
            bloom_y = top_y + (base_y - top_y) * t
            bloom_size = rng.uniform(0.55, 1.25)
            flower_draw.rectangle(
                (
                    (bloom_x - bloom_size) * WORK_SCALE,
                    (bloom_y - bloom_size) * WORK_SCALE,
                    (bloom_x + bloom_size) * WORK_SCALE,
                    (bloom_y + bloom_size) * WORK_SCALE,
                ),
                fill=flower_colour + (220,),
            )
    work.alpha_composite(flowers)

    glints = Image.new("RGBA", work.size)
    glint_draw = ImageDraw.Draw(glints, "RGBA")
    glint_colours = [_hex(value) for value in palette["glints"]]
    for _ in range(int(raster.get("glints", 190))):
        x = rng.uniform(center_x - foliage_rx, center_x + foliage_rx)
        y = rng.uniform(center_y - foliage_ry * 1.05, center_y + foliage_ry * 0.5)
        if not _ellipse_inside(x, y, center_x, center_y - 2, foliage_rx + 2, foliage_ry + 1, 1.0):
            continue
        colour = rng.choice(glint_colours)
        alpha = rng.randint(30, 95)
        x0 = round(x * WORK_SCALE)
        y0 = round(y * WORK_SCALE)
        glint_draw.rectangle(
            (x0, y0, x0 + rng.choice([2, 4, 6]), y0 + rng.choice([2, 3, 4])),
            fill=colour + (alpha,),
        )
    work.alpha_composite(glints)

    frame = _alpha_safe_resize(work, canvas)
    final_draw = ImageDraw.Draw(frame, "RGBA")
    grain_colours = [_hex(value) for value in palette["grain"]]
    for _ in range(int(raster.get("finalGrain", 180))):
        x = rng.randint(max(0, round(center_x - foliage_rx - 3)), min(width - 1, round(center_x + foliage_rx + 3)))
        y = rng.randint(max(0, round(center_y - foliage_ry - 8)), min(height - 1, round(center_y + foliage_ry * 0.6)))
        if frame.getpixel((x, y))[3] < 120:
            continue
        colour = rng.choice(grain_colours)
        alpha = rng.randint(30, 90)
        if rng.random() < 0.62:
            final_draw.point((x, y), fill=colour + (alpha,))
        else:
            final_draw.line((x, y, x + rng.choice([-2, -1, 1]), y + rng.choice([0, 0, 1])), fill=colour + (alpha,), width=1)

    frame = frame.filter(ImageFilter.UnsharpMask(radius=0.55, percent=125, threshold=2))
    bounds = frame.getchannel("A").getbbox()
    metadata = {
        "contract": CONTRACT,
        "id": recipe["id"],
        "sceneryType": SCENERY_TYPE,
        "canvas": list(canvas),
        "anchor": anchor,
        "bounds": list(bounds) if bounds else None,
        "seed": seed,
        "camera": camera,
        "runtimePromotion": False,
        "artApproved": False,
    }
    return frame, metadata


def review_board(frame: Image.Image) -> Image.Image:
    width, height = frame.size
    board = Image.new("RGBA", (width * 3 + 48, height * 2 + 40), (76, 116, 48, 255))
    board.alpha_composite(frame, (16, 20 + height // 2))
    board.alpha_composite(frame.resize((width * 2, height * 2), Image.Resampling.NEAREST), (width + 32, 20))
    draw = ImageDraw.Draw(board)
    draw.text((16, 4), "1x / gameplay", fill=(247, 244, 220, 255))
    draw.text((width + 32, 4), "2x / inspection", fill=(247, 244, 220, 255))
    return board


def isometric_board(
    frame: Image.Image,
    anchor: list[int],
    label: str = "CH_CAMERA_V1 / 30deg / 45deg yaw / 128x64",
) -> Image.Image:
    board = Image.new("RGBA", (768, 480), (46, 77, 55, 255))
    draw = ImageDraw.Draw(board)
    grid_x, grid_y = 384, 314
    half_width, half_height = 64, 32
    for x in range(-3, 4):
        for y in range(-3, 4):
            cx = grid_x + (x - y) * half_width
            cy = grid_y + (x + y) * half_height
            polygon = [(cx, cy - half_height), (cx + half_width, cy), (cx, cy + half_height), (cx - half_width, cy)]
            fill = (76, 119, 66, 255) if (x + y) % 2 == 0 else (71, 113, 64, 255)
            draw.polygon(polygon, fill=fill, outline=(105, 148, 93, 205))
    draw.polygon(
        [(grid_x, grid_y - half_height), (grid_x + half_width, grid_y), (grid_x, grid_y + half_height), (grid_x - half_width, grid_y)],
        fill=(82, 132, 72, 255),
        outline=(174, 207, 145, 255),
    )
    board.alpha_composite(frame, (round(grid_x - anchor[0]), round(grid_y - anchor[1])))
    draw.ellipse((grid_x - 3, grid_y - 3, grid_x + 3, grid_y + 3), fill=(255, 224, 132, 255))
    draw.text((18, 16), label, fill=(247, 244, 220, 255))
    draw.text((18, 36), "procedural raster flower bed / 1x1 decoration / gameplay 1x", fill=(220, 232, 205, 255))
    return board


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
    isometric_board(frame, metadata["anchor"]).save(isometric)
    metadata.update(
        {
            "recipe": str(recipe_path),
            "recipeSha256": hashlib.sha256(raw).hexdigest(),
            "png": str(png),
            "review": str(review),
            "isometricReview": str(isometric),
        }
    )
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

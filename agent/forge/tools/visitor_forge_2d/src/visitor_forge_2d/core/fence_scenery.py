"""Deterministic modular fence scenery for City Horizon.

One recipe produces east/south segments, matching gates, a reusable vertex post,
a gameplay review enclosure and an isometric camera review.  Runtime promotion
remains an explicit later gate.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import math
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter

from .exporter import alpha_safe_resize

CONTRACT = "CH_2D_FENCE_SCENERY_V1"
SCALE = 4
DIRECTIONS = {"east": (64.0, 32.0), "south": (-64.0, 32.0)}
VARIANTS = {"iron", "chainlink", "wood"}


def _color(value: object, label: str) -> tuple[int, int, int, int]:
    if not isinstance(value, str) or len(value) != 7 or not value.startswith("#"):
        raise ValueError(f"{label} must be #RRGGBB")
    try:
        return tuple(int(value[i:i + 2], 16) for i in (1, 3, 5)) + (255,)
    except ValueError as exc:
        raise ValueError(f"{label} must be #RRGGBB") from exc


def _number(value: object, label: str, low: float, high: float) -> float:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise ValueError(f"{label} must be numeric")
    result = float(value)
    if not math.isfinite(result) or not low <= result <= high:
        raise ValueError(f"{label} must be between {low} and {high}")
    return result


def validate_recipe(recipe: dict) -> dict:
    if not isinstance(recipe, dict) or recipe.get("contract") != CONTRACT:
        raise ValueError(f"Fence recipe must declare {CONTRACT}")
    camera = recipe.get("camera")
    if not isinstance(camera, dict) or camera.get("contract") != "CH_CAMERA_V1" or camera.get("tile") != [128, 64] or camera.get("yawDeg") != 45 or camera.get("elevationDeg") != 30:
        raise ValueError("Fence scenery requires CH_CAMERA_V1, tile 128x64, yaw 45 and elevation 30")
    if recipe.get("canvas") != [192, 128] or recipe.get("anchor") != [96, 64]:
        raise ValueError("V1 fence modules require canvas [192,128] and anchor [96,64]")
    variant = recipe.get("variant", "iron")
    if variant not in VARIANTS:
        raise ValueError(f"Fence variant must be one of {sorted(VARIANTS)}")
    geom, palette = recipe.get("geometry"), recipe.get("palette")
    if not isinstance(geom, dict) or not isinstance(palette, dict):
        raise ValueError("Fence recipe requires geometry and palette objects")
    cfg = {
        "variant": variant,
        "height": _number(geom.get("heightPx"), "heightPx", 14, 52),
        "post_width": _number(geom.get("postWidthPx"), "postWidthPx", 2, 12),
        "rail_width": _number(geom.get("railWidthPx"), "railWidthPx", 1, 9),
    }
    if variant == "iron":
        cfg["base_width"] = _number(geom.get("stoneBaseWidthPx"), "stoneBaseWidthPx", 3, 14)
        cfg["bar_spacing"] = _number(geom.get("barSpacingPx"), "barSpacingPx", 5, 20)
        keys = ("metal", "metalHighlight", "metalShadow", "stone", "stoneHighlight", "stoneShadow", "groundShadow")
    elif variant == "chainlink":
        cfg["mesh_spacing"] = _number(geom.get("meshSpacingPx"), "meshSpacingPx", 4, 14)
        keys = ("metal", "metalHighlight", "metalShadow", "mesh", "meshShadow", "groundShadow")
    else:
        cfg["picket_spacing"] = _number(geom.get("picketSpacingPx"), "picketSpacingPx", 5, 18)
        cfg["picket_width"] = _number(geom.get("picketWidthPx"), "picketWidthPx", 2, 9)
        keys = ("wood", "woodHighlight", "woodShadow", "groundShadow")
    for key in keys:
        cfg[key] = _color(palette.get(key), f"palette.{key}")
    return cfg


def _pt(point: tuple[float, float]) -> tuple[int, int]:
    return round(point[0] * SCALE), round(point[1] * SCALE)


def _line(draw: ImageDraw.ImageDraw, points, fill, width: float) -> None:
    draw.line([_pt(point) for point in points], fill=fill, width=max(1, round(width * SCALE)), joint="curve")


def _shadow(draw: ImageDraw.ImageDraw, p0, p1, cfg, *, gate=False) -> None:
    colour = (*cfg["groundShadow"][:3], 48 if gate else 72)
    _line(draw, [(p0[0] + 3, p0[1] + 4), (p1[0] + 3, p1[1] + 4)], colour, 5.5)


def _draw_post(draw, point, cfg) -> None:
    x, y = point
    h, w = cfg["height"], cfg["post_width"]
    if cfg["variant"] == "wood":
        dark, mid, light = cfg["woodShadow"], cfg["wood"], cfg["woodHighlight"]
    else:
        dark, mid, light = cfg["metalShadow"], cfg["metal"], cfg["metalHighlight"]
    _line(draw, [(x, y - 1), (x, y - h - 4)], dark, w + 1.6)
    _line(draw, [(x - .5, y - 1), (x - .5, y - h - 4)], mid, w)
    _line(draw, [(x - w * .25, y - 3), (x - w * .25, y - h - 3)], light, .8)
    cap = [(_pt((x - w * .7, y - h - 4))), (_pt((x, y - h - 8))), (_pt((x + w * .7, y - h - 4))), (_pt((x, y - h - 1.5)))]
    draw.polygon(cap, fill=light)


def _draw_iron(draw, p0, p1, cfg, gate=False) -> None:
    h = cfg["height"]
    _shadow(draw, p0, p1, cfg, gate=gate)
    if not gate:
        _line(draw, [p0, p1], cfg["stoneShadow"], cfg["base_width"] + 2)
        _line(draw, [p0, p1], cfg["stone"], cfg["base_width"])
        _line(draw, [(p0[0], p0[1] - 2), (p1[0], p1[1] - 2)], cfg["stoneHighlight"], 1.5)
    for rise in (h, h * .36):
        _line(draw, [(p0[0], p0[1] - rise), (p1[0], p1[1] - rise)], cfg["metalShadow"], cfg["rail_width"] + 1.2)
        _line(draw, [(p0[0], p0[1] - rise - .4), (p1[0], p1[1] - rise - .4)], cfg["metal"], cfg["rail_width"])
    count = max(3, int(math.dist(p0, p1) / cfg["bar_spacing"]))
    for i in range(1, count):
        t = i / count
        x, y = p0[0] + (p1[0]-p0[0])*t, p0[1] + (p1[1]-p0[1])*t
        _line(draw, [(x, y - 4), (x, y - h + 1)], cfg["metalShadow"], 2.5)
        _line(draw, [(x - .4, y - 4), (x - .4, y - h + 1)], cfg["metalHighlight"], .75)


def _draw_chainlink(draw, p0, p1, cfg, gate=False) -> None:
    h = cfg["height"]
    _shadow(draw, p0, p1, cfg, gate=gate)
    for rise in (h, 4):
        _line(draw, [(p0[0], p0[1]-rise), (p1[0], p1[1]-rise)], cfg["metalShadow"], cfg["rail_width"] + 1)
        _line(draw, [(p0[0], p0[1]-rise-.4), (p1[0], p1[1]-rise-.4)], cfg["metal"], cfg["rail_width"])
    length = math.dist(p0, p1)
    count = max(4, int(length / cfg["mesh_spacing"]))
    for i in range(count + 1):
        t = i / count
        x, y = p0[0] + (p1[0]-p0[0])*t, p0[1] + (p1[1]-p0[1])*t
        lean = 5.0
        _line(draw, [(x-lean, y-4), (x+lean, y-h)], cfg["meshShadow"], .9)
        _line(draw, [(x+lean, y-4), (x-lean, y-h)], cfg["mesh"], .65)
    if gate:
        mid = ((p0[0]+p1[0])/2, (p0[1]+p1[1])/2)
        _line(draw, [(mid[0], mid[1]-3), (mid[0], mid[1]-h)], cfg["metal"], 2.2)


def _draw_wood(draw, p0, p1, cfg, gate=False) -> None:
    h = cfg["height"]
    _shadow(draw, p0, p1, cfg, gate=gate)
    for rise in (h*.72, h*.30):
        _line(draw, [(p0[0], p0[1]-rise), (p1[0], p1[1]-rise)], cfg["woodShadow"], cfg["rail_width"] + 1.4)
        _line(draw, [(p0[0], p0[1]-rise-.5), (p1[0], p1[1]-rise-.5)], cfg["wood"], cfg["rail_width"])
    count = max(3, int(math.dist(p0, p1) / cfg["picket_spacing"]))
    for i in range(1, count):
        t = i / count
        x, y = p0[0] + (p1[0]-p0[0])*t, p0[1] + (p1[1]-p0[1])*t
        _line(draw, [(x, y-2), (x, y-h)], cfg["woodShadow"], cfg["picket_width"] + 1)
        _line(draw, [(x-.5, y-2), (x-.5, y-h)], cfg["wood"], cfg["picket_width"])
        _line(draw, [(x-1, y-h+2), (x-1, y-4)], cfg["woodHighlight"], .7)


def _draw_segment(draw, p0, p1, cfg, gate=False) -> None:
    if cfg["variant"] == "iron":
        _draw_iron(draw, p0, p1, cfg, gate)
    elif cfg["variant"] == "chainlink":
        _draw_chainlink(draw, p0, p1, cfg, gate)
    else:
        _draw_wood(draw, p0, p1, cfg, gate)


def _module(recipe: dict, cfg: dict, direction: str, kind: str) -> Image.Image:
    canvas = tuple(recipe["canvas"])
    work = Image.new("RGBA", (canvas[0]*SCALE, canvas[1]*SCALE))
    draw = ImageDraw.Draw(work, "RGBA")
    p0 = tuple(recipe["anchor"])
    vector = DIRECTIONS[direction]
    p1 = (p0[0] + vector[0], p0[1] + vector[1])
    if kind == "post":
        _draw_post(draw, p0, cfg)
    else:
        _draw_segment(draw, p0, p1, cfg, gate=kind == "gate")
        _draw_post(draw, p0, cfg)
        _draw_post(draw, p1, cfg)
    return alpha_safe_resize(work, canvas)


def _isometric_review(recipe: dict, cfg: dict) -> Image.Image:
    board = Image.new("RGBA", (768*SCALE, 480*SCALE), (46,77,55,255))
    draw = ImageDraw.Draw(board, "RGBA")
    gx, gy = 384.0, 292.0
    def project(x, y): return gx + (x-y)*64, gy + (x+y)*32
    for y in range(-2, 3):
        for x in range(-3, 4):
            c = project(x,y)
            diamond = [(c[0],c[1]-32),(c[0]+64,c[1]),(c[0],c[1]+32),(c[0]-64,c[1])]
            fill = (76,119,66,255) if (x+y)%2==0 else (71,113,64,255)
            draw.polygon([_pt(p) for p in diamond], fill=fill, outline=(105,148,93,190))
    segments = [((0,0),(1,0),False),((1,0),(2,0),False),((2,0),(2,1),False),((2,1),(2,2),True),((2,2),(1,2),False),((1,2),(0,2),False),((0,2),(0,1),False),((0,1),(0,0),False)]
    segments.sort(key=lambda s:(project(*s[0])[1]+project(*s[1])[1])/2)
    vertices=set()
    for a,b,gate in segments:
        pa,pb=project(*a),project(*b)
        _draw_segment(draw,pa,pb,cfg,gate)
        vertices.update((a,b))
    for v in sorted(vertices,key=lambda p:project(*p)[1]):
        _draw_post(draw,project(*v),cfg)
    draw.text(_pt((18,14)), f"CH_CAMERA_V1 / fence {cfg['variant']} / modular edge scenery", fill=(247,244,220,255))
    return alpha_safe_resize(board,(768,480))


def _review(recipe: dict, cfg: dict, modules: dict[str,Image.Image]) -> Image.Image:
    board = Image.new("RGBA", (640, 520), (69,104,66,255))
    draw = ImageDraw.Draw(board)
    draw.text((14,10), f"{recipe['id']} / {cfg['variant']} / gameplay modules", fill=(246,241,218,255))
    placements=[("segment_east",20,48),("segment_south",330,48),("gate_east",20,220),("gate_south",330,220),("post",224,380)]
    for key,x,y in placements:
        board.alpha_composite(modules[key],(x,y))
        draw.text((x,y+132),key,fill=(236,228,196,255))
    return board


def export_fence_scenery(recipe_path: Path, output_dir: Path) -> dict:
    raw = recipe_path.read_bytes()
    recipe = json.loads(raw)
    cfg = validate_recipe(recipe)
    output_dir.mkdir(parents=True, exist_ok=True)
    modules: dict[str,Image.Image] = {}
    outputs = {}
    for direction in DIRECTIONS:
        for kind in ("segment","gate"):
            key=f"{kind}_{direction}"
            image=_module(recipe,cfg,direction,kind)
            path=output_dir/f"{recipe['id']}_{key}.png"
            image.save(path)
            modules[key]=image
            outputs[key]=str(path)
    modules["post"]=_module(recipe,cfg,"east","post")
    post_path=output_dir/f"{recipe['id']}_post.png"
    modules["post"].save(post_path)
    outputs["post"]=str(post_path)

    primary=modules["segment_east"]
    png=output_dir/f"{recipe['id']}.png"
    review_path=output_dir/f"{recipe['id']}_review.png"
    iso_path=output_dir/f"{recipe['id']}_isometric_review.png"
    metadata_path=output_dir/f"{recipe['id']}.json"
    primary.save(png)
    _review(recipe,cfg,modules).save(review_path)
    _isometric_review(recipe,cfg).save(iso_path)
    bounds=primary.getchannel("A").getbbox()
    metadata={
        "contract":CONTRACT,"id":recipe["id"],"variant":cfg["variant"],
        "camera":recipe["camera"],"canvas":recipe["canvas"],"anchor":recipe["anchor"],
        "bounds":list(bounds) if bounds else None,"segmentVectors":{k:list(v) for k,v in DIRECTIONS.items()},
        "composition":"edge segment plus one post per occupied fence vertex",
        "recipeSha256":hashlib.sha256(raw).hexdigest(),"outputs":outputs,
        "png":str(png),"review":str(review_path),"isometricReview":str(iso_path),
        "artApproved":False,"runtimePromotion":False,
    }
    metadata_path.write_text(json.dumps(metadata,indent=2)+"\n",encoding="utf-8")
    return {**metadata, "metadata":str(metadata_path)}


def main() -> int:
    parser=argparse.ArgumentParser()
    parser.add_argument("--recipe",type=Path,required=True)
    parser.add_argument("--output",type=Path,required=True)
    args=parser.parse_args()
    print(json.dumps(export_fence_scenery(args.recipe,args.output),indent=2))
    return 0


if __name__=="__main__":
    raise SystemExit(main())

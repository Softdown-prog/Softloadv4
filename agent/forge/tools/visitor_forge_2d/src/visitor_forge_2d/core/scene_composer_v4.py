"""Scene Composer V4: painterly finish and visual critic.

V4 reuses the bounded V3 scene graph, then applies deterministic edge breakup,
surface variation, localized material wear and a gameplay critic. It also
expands authored smooth closed silhouettes and reusable component-gallery nodes
before V3 validation, so props can be assembled from shared building blocks.
"""
from __future__ import annotations

import hashlib
import json
import math
import random
from copy import deepcopy
from pathlib import Path

from PIL import Image, ImageChops, ImageDraw, ImageFilter, ImageStat

from . import component_resolver, localized_finish, scene_composer_v3, smooth_geometry
from .exporter import alpha_safe_resize

CONTRACT = "CH_2D_SCENE_RECIPE_V4"


def _num(value, label):
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value):
        raise ValueError(f"{label} must be a finite number")
    return float(value)


def _legacy_recipe(recipe: dict) -> dict:
    legacy = deepcopy(recipe)
    legacy["contract"] = scene_composer_v3.CONTRACT
    legacy.pop("finish", None)
    legacy.pop("finishRegions", None)
    legacy = component_resolver.expand_recipe(legacy)
    return smooth_geometry.expand_recipe(legacy)


def validate_recipe(recipe: dict) -> None:
    if not isinstance(recipe, dict) or recipe.get("contract") != CONTRACT:
        raise ValueError(f"scene recipe must declare {CONTRACT}")
    scene_composer_v3.validate_recipe(_legacy_recipe(recipe))
    finish = recipe.get("finish", {})
    if not isinstance(finish, dict):
        raise ValueError("finish must be an object")
    allowed = {"edgeBreakupPx", "surfaceVariation", "brushStamps", "brushOpacity", "warmHighlight", "coolShadow"}
    if any(k not in allowed for k in finish):
        raise ValueError("finish contains unsupported keys")
    if not 0 <= _num(finish.get("edgeBreakupPx", 0.65), "finish.edgeBreakupPx") <= 2.0:
        raise ValueError("finish.edgeBreakupPx must be 0..2")
    if not 0 <= _num(finish.get("surfaceVariation", 0.08), "finish.surfaceVariation") <= 0.35:
        raise ValueError("finish.surfaceVariation must be 0..0.35")
    stamps = finish.get("brushStamps", 28)
    if type(stamps) is not int or not 0 <= stamps <= 160:
        raise ValueError("finish.brushStamps must be 0..160")
    localized_finish.validate_regions(recipe.get("finishRegions"))


def _edge_breakup(frame: Image.Image, seed: int, amount: float) -> Image.Image:
    if amount <= 0:
        return frame
    rng = random.Random(seed ^ 0xA13F)
    rgba = frame.convert("RGBA")
    w, h = rgba.size
    out = Image.new("RGBA", rgba.size)
    src = rgba.load(); dst = out.load()
    max_shift = max(1, round(amount))
    phase = rng.random() * math.tau
    for y in range(h):
        envelope = math.sin(math.pi * y / max(1, h - 1))
        dx = round(max_shift * envelope * math.sin(phase + y * 0.115))
        for x in range(w):
            sx = x - dx
            if 0 <= sx < w:
                dst[x, y] = src[sx, y]
    return out


def _surface_finish(frame: Image.Image, seed: int, finish: dict) -> Image.Image:
    rng = random.Random(seed ^ 0x5EED)
    image = frame.convert("RGBA")
    alpha = image.getchannel("A")
    w, h = image.size
    variation = _num(finish.get("surfaceVariation", 0.08), "finish.surfaceVariation")
    stamps = finish.get("brushStamps", 28)
    opacity = max(0.0, min(1.0, _num(finish.get("brushOpacity", 0.11), "finish.brushOpacity")))
    layer = Image.new("RGBA", image.size, (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    for _ in range(stamps):
        x = rng.randrange(w); y = rng.randrange(h)
        rx = rng.randint(2, 9); ry = rng.randint(1, 5)
        light = rng.random() > 0.46
        color = ((255, 229, 190) if light else (56, 38, 29)) + (round(255 * opacity * rng.uniform(0.35, 1.0)),)
        d.ellipse((x-rx, y-ry, x+rx, y+ry), fill=color)
    layer = layer.filter(ImageFilter.GaussianBlur(1.15))
    layer.putalpha(ImageChops.multiply(layer.getchannel("A"), alpha))
    image = Image.alpha_composite(image, layer)
    if variation > 0:
        small = Image.new("L", (max(2, w//14), max(2, h//14)))
        p = small.load()
        for yy in range(small.height):
            for xx in range(small.width):
                p[xx, yy] = rng.randrange(80, 176)
        field = small.resize((w, h), Image.Resampling.BILINEAR).filter(ImageFilter.GaussianBlur(1.2))
        tint = Image.new("RGBA", (w, h), (255, 242, 220, 0))
        tint.putalpha(ImageChops.multiply(field.point(lambda v: round(abs(v-128) * variation)), alpha))
        image = Image.alpha_composite(image, tint)
    image.putalpha(alpha)
    return image


def critic(frame: Image.Image, recipe: dict) -> dict:
    alpha = frame.getchannel("A")
    bounds = alpha.getbbox()
    if bounds is None:
        raise ValueError("critic received transparent image")
    crop = frame.crop(bounds).convert("RGB")
    stat = ImageStat.Stat(crop)
    means = stat.mean
    extrema = stat.extrema
    contrast = sum((hi - lo) for lo, hi in extrema) / (3 * 255)
    occupancy = (bounds[2]-bounds[0]) * (bounds[3]-bounds[1]) / max(1, frame.width * frame.height)
    edge = ImageChops.difference(alpha, alpha.filter(ImageFilter.MinFilter(3)))
    edge_pixels = sum(1 for v in edge.getdata() if v > 18)
    opaque = sum(1 for v in alpha.getdata() if v > 18)
    edge_ratio = edge_pixels / max(1, opaque)
    scores = {
        "contrast": round(contrast, 3),
        "canvasOccupancy": round(occupancy, 3),
        "edgeComplexity": round(edge_ratio, 3),
        "meanLuma": round(sum(means)/3/255, 3),
    }
    flags = []
    if contrast < 0.26: flags.append("low_internal_contrast")
    if edge_ratio < 0.045: flags.append("silhouette_too_regular")
    if occupancy < 0.10: flags.append("asset_too_small_on_canvas")
    scores["flags"] = flags
    scores["passesMechanicalCritic"] = not flags
    return scores


def render_scene(recipe: dict) -> tuple[Image.Image, dict]:
    validate_recipe(recipe)
    usage = component_resolver.component_usage(recipe)
    frame, metadata = scene_composer_v3.render_scene(_legacy_recipe(recipe))
    seed = recipe.get("seed", 0)
    finish = recipe.get("finish", {})
    frame = _edge_breakup(frame, seed, _num(finish.get("edgeBreakupPx", 0.65), "finish.edgeBreakupPx"))
    frame = _surface_finish(frame, seed, finish)
    frame = localized_finish.apply_regions(frame, recipe.get("finishRegions"), seed)
    frame = alpha_safe_resize(frame, tuple(recipe["canvas"]))
    bounds = frame.getchannel("A").getbbox()
    metadata.update({
        "contract": CONTRACT,
        "bounds": list(bounds),
        "finish": finish,
        "finishRegionCount": len(recipe.get("finishRegions") or []),
        "componentInstanceCount": usage["count"],
        "componentIds": usage["componentIds"],
        "critic": critic(frame, recipe),
    })
    return frame, metadata


def export(recipe_path: Path, output_dir: Path) -> dict:
    raw = recipe_path.read_bytes(); recipe = json.loads(raw)
    frame, metadata = render_scene(recipe)
    output_dir.mkdir(parents=True, exist_ok=True)
    stem = recipe["id"]
    png = output_dir / f"{stem}.png"; meta = output_dir / f"{stem}.json"
    review = output_dir / f"{stem}_review.png"; iso = output_dir / f"{stem}_isometric_review.png"
    frame.save(png, format="PNG", optimize=False)
    metadata["recipeSha256"] = hashlib.sha256(raw).hexdigest()
    meta.write_text(json.dumps(metadata, indent=2)+"\n", encoding="utf-8")
    w,h = frame.size
    panel = Image.new("RGBA", (w*3+48,h*2+40), (64,84,57,255))
    panel.alpha_composite(frame,(16,20+h//2)); panel.alpha_composite(frame.resize((w*2,h*2),Image.Resampling.NEAREST),(w+32,20))
    d=ImageDraw.Draw(panel); d.text((16,4),"1x gameplay",fill=(245,245,230,255)); d.text((w+32,4),"2x inspection",fill=(245,245,230,255))
    panel.save(review,format="PNG",optimize=False)
    iso_panel=Image.new("RGBA",(max(320,w+96),max(220,h+96)),(82,119,65,255)); cx,cy=iso_panel.size[0]//2,iso_panel.size[1]-46
    d=ImageDraw.Draw(iso_panel); d.polygon([(cx,cy-32),(cx+64,cy),(cx,cy+32),(cx-64,cy)],fill=(100,145,78,255),outline=(63,97,52,255)); iso_panel.alpha_composite(frame,(cx-recipe["anchor"][0],cy-recipe["anchor"][1])); iso_panel.save(iso,format="PNG",optimize=False)
    return {"png":str(png),"metadata":str(meta),"review":str(review),"isometricReview":str(iso)}

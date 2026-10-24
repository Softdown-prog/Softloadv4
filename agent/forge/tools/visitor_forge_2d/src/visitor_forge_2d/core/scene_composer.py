"""Deterministic scene-graph renderer for general 2D game props.

This is the generic half of Visitor Forge 2D: unlike species renderers it is not
specialized for trees.  Recipes describe reusable symbols, transforms, materials
and safe procedural repetition so signs, piers, boats and decorations can share
one drawing engine.
"""
from __future__ import annotations

from .scene_geometry import box_contour, shift_mask, stroke_scale

import hashlib
import json
import math
import random
from copy import deepcopy
from pathlib import Path

from PIL import Image, ImageChops, ImageDraw, ImageFilter

from .exporter import alpha_safe_resize

CONTRACT = "CH_2D_SCENE_RECIPE_V1"
SCALE = 4
_MAX_DEPTH = 12
_MAX_NODES = 1200
_ALLOWED_PRIMITIVES = {
    "ellipse", "rect", "rounded_rect", "polygon", "line", "quadratic",
    "cubic", "diamond", "capsule",
}


def _num(value: object, label: str) -> float:
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value):
        raise ValueError(f"{label} must be a finite number")
    return float(value)


def _pair(value: object, label: str) -> tuple[float, float]:
    if not isinstance(value, list) or len(value) != 2:
        raise ValueError(f"{label} must be [x, y]")
    return _num(value[0], label), _num(value[1], label)


def _color(value: object, label: str) -> tuple[int, int, int, int]:
    if not isinstance(value, str) or len(value) not in (7, 9) or not value.startswith("#"):
        raise ValueError(f"{label} must be #RRGGBB or #RRGGBBAA")
    try:
        rgb = tuple(int(value[i:i + 2], 16) for i in (1, 3, 5))
        alpha = int(value[7:9], 16) if len(value) == 9 else 255
    except ValueError as exc:
        raise ValueError(f"{label} has invalid hex color") from exc
    return (*rgb, alpha)


def _transform_point(point: tuple[float, float], transform: dict) -> tuple[float, float]:
    x, y = point
    sx, sy = transform.get("scale", [1.0, 1.0])
    x *= sx
    y *= sy
    angle = math.radians(transform.get("rotateDeg", 0.0))
    if angle:
        c, s = math.cos(angle), math.sin(angle)
        x, y = x * c - y * s, x * s + y * c
    tx, ty = transform.get("translate", [0.0, 0.0])
    return x + tx, y + ty


def _combine(a: dict, b: dict | None) -> dict:
    """Compose simple local transforms. Rotation+scale are applied parent first."""
    b = b or {}
    pa = {"translate": list(a.get("translate", [0.0, 0.0])),
          "scale": list(a.get("scale", [1.0, 1.0])),
          "rotateDeg": float(a.get("rotateDeg", 0.0))}
    bt = b.get("translate", [0.0, 0.0])
    moved = _transform_point((float(bt[0]), float(bt[1])), pa)
    bs = b.get("scale", [1.0, 1.0])
    return {
        "translate": [moved[0], moved[1]],
        "scale": [pa["scale"][0] * float(bs[0]), pa["scale"][1] * float(bs[1])],
        "rotateDeg": pa["rotateDeg"] + float(b.get("rotateDeg", 0.0)),
    }


def _validate_transform(value: object, label: str) -> dict:
    if value is None:
        return {"translate": [0.0, 0.0], "scale": [1.0, 1.0], "rotateDeg": 0.0}
    if not isinstance(value, dict) or any(k not in ("translate", "scale", "rotateDeg") for k in value):
        raise ValueError(f"{label} contains unsupported transform keys")
    t = _pair(value.get("translate", [0, 0]), label + ".translate")
    s = _pair(value.get("scale", [1, 1]), label + ".scale")
    r = _num(value.get("rotateDeg", 0), label + ".rotateDeg")
    if s[0] == 0 or s[1] == 0 or abs(s[0]) > 20 or abs(s[1]) > 20:
        raise ValueError(f"{label}.scale is outside safe limits")
    return {"translate": list(t), "scale": list(s), "rotateDeg": r}


def _points_on_curve(kind: str, points: list[tuple[float, float]]) -> list[tuple[float, float]]:
    if kind == "line":
        return points
    out = []
    for i in range(33):
        t = i / 32
        if kind == "quadratic":
            a, b, c = points
            x = (1-t)**2*a[0] + 2*(1-t)*t*b[0] + t*t*c[0]
            y = (1-t)**2*a[1] + 2*(1-t)*t*b[1] + t*t*c[1]
        else:
            a, b, c, d = points
            x = (1-t)**3*a[0] + 3*(1-t)**2*t*b[0] + 3*(1-t)*t*t*c[0] + t**3*d[0]
            y = (1-t)**3*a[1] + 3*(1-t)**2*t*b[1] + 3*(1-t)*t*t*c[1] + t**3*d[1]
        out.append((x, y))
    return out


def _shape_mask(size: tuple[int, int], primitive: dict, transform: dict, label: str) -> Image.Image:
    kind = primitive.get("primitive")
    if kind not in _ALLOWED_PRIMITIVES:
        raise ValueError(f"{label}.primitive must be one of {sorted(_ALLOWED_PRIMITIVES)}")
    mask = Image.new("L", size)
    draw = ImageDraw.Draw(mask)
    def px(p: tuple[float, float]) -> tuple[int, int]:
        x, y = _transform_point(p, transform)
        return round(x * SCALE), round(y * SCALE)
    if kind in ("ellipse", "rect", "rounded_rect", "capsule"):
        draw.polygon([px(p) for p in box_contour(primitive, label)], fill=255)
    elif kind == "diamond":
        center = _pair(primitive.get("center"), label+".center")
        radius = _pair(primitive.get("radius"), label+".radius")
        cx, cy = center; rx, ry = radius
        draw.polygon([px((cx, cy-ry)), px((cx+rx, cy)), px((cx, cy+ry)), px((cx-rx, cy))], fill=255)
    elif kind == "polygon":
        raw = primitive.get("points")
        if not isinstance(raw, list) or len(raw) < 3:
            raise ValueError(f"{label}.points needs at least 3 points")
        draw.polygon([px(_pair(p, label+".points")) for p in raw], fill=255)
    else:
        raw = primitive.get("points")
        need = {"line": 2, "quadratic": 3, "cubic": 4}[kind]
        if not isinstance(raw, list) or len(raw) != need:
            raise ValueError(f"{label}.points needs {need} points")
        points = [_pair(p, label+".points") for p in raw]
        points = _points_on_curve(kind, points)
        width = _num(primitive.get("width", 1), label+".width")
        if width <= 0:
            raise ValueError(f"{label}.width must be positive")
        draw.line([px(p) for p in points], fill=255, width=max(1, round(width*SCALE*stroke_scale(transform))), joint="curve")
    holes = primitive.get("cutouts", [])
    if not isinstance(holes, list) or len(holes) > 32:
        raise ValueError(f"{label}.cutouts must contain at most 32 shapes")
    for hole in holes:
        if not isinstance(hole, dict) or "cutouts" in hole or hole.get("primitive") not in ("ellipse", "rect", "rounded_rect", "capsule", "polygon", "diamond"):
            raise ValueError(f"{label}.cutouts require closed shapes without nested cutouts")
        mask = ImageChops.subtract(mask, _shape_mask(size, hole, transform, label + ".cutouts"))
    return mask


def _material(size: tuple[int, int], mask: Image.Image, spec: dict, label: str) -> Image.Image:
    if not isinstance(spec, dict):
        raise ValueError(f"{label} material must be an object")
    kind = spec.get("type", "solid")
    opacity = _num(spec.get("opacity", 1.0), label+".opacity")
    if not 0 <= opacity <= 1:
        raise ValueError(f"{label}.opacity must be 0..1")
    if kind == "solid":
        rgba = _color(spec.get("color"), label+".color")
        image = Image.new("RGBA", size, rgba)
    elif kind == "linear_gradient":
        top = _color(spec.get("start"), label+".start")
        bottom = _color(spec.get("end"), label+".end")
        image = Image.new("RGBA", size)
        d = ImageDraw.Draw(image)
        for y in range(size[1]):
            t = y / max(1, size[1]-1)
            rgba = tuple(round(a*(1-t)+b*t) for a,b in zip(top,bottom))
            d.line((0,y,size[0],y), fill=rgba)
    elif kind == "radial_gradient":
        inner = _color(spec.get("inner"), label+".inner")
        outer = _color(spec.get("outer"), label+".outer")
        center = _pair(spec.get("center", [size[0]/SCALE/2, size[1]/SCALE/2]), label+".center")
        radius = max(1.0, _num(spec.get("radius", max(size)/SCALE/2), label+".radius")) * SCALE
        image = Image.new("RGBA", size)
        pix = image.load(); cx,cy = center[0]*SCALE, center[1]*SCALE
        for y in range(size[1]):
            for x in range(size[0]):
                t = min(1.0, math.hypot(x-cx,y-cy)/radius)
                pix[x,y] = tuple(round(a*(1-t)+b*t) for a,b in zip(inner,outer))
    else:
        raise ValueError(f"{label}.type must be solid, linear_gradient or radial_gradient")
    alpha = ImageChops.multiply(image.getchannel("A"), mask)
    if opacity != 1:
        alpha = alpha.point(lambda v: round(v*opacity))
    image.putalpha(alpha)
    return image


def _apply_effects(base: Image.Image, mask: Image.Image, effects: dict | None, label: str) -> Image.Image:
    if effects is None:
        return base
    if not isinstance(effects, dict) or any(k not in ("shadow", "outline", "highlight") for k in effects):
        raise ValueError(f"{label}.effects contains unsupported keys")
    out = Image.new("RGBA", base.size)
    shadow = effects.get("shadow")
    if shadow:
        dx,dy = _pair(shadow.get("offset", [2,2]), label+".shadow.offset")
        blur = _num(shadow.get("blur", 2), label+".shadow.blur")
        color = _color(shadow.get("color", "#18202A88"), label+".shadow.color")
        shifted = shift_mask(mask, round(dx*SCALE), round(dy*SCALE))
        shifted = shifted.filter(ImageFilter.GaussianBlur(max(0, blur*SCALE)))
        layer = Image.new("RGBA", base.size, color); layer.putalpha(ImageChops.multiply(layer.getchannel("A"), shifted))
        out.alpha_composite(layer)
    outline = effects.get("outline")
    if outline:
        width = _num(outline.get("width", 1), label+".outline.width")
        color = _color(outline.get("color", "#28303AFF"), label+".outline.color")
        expanded = mask.filter(ImageFilter.MaxFilter(max(3, int(round(width*SCALE))*2+1)))
        ring = ImageChops.subtract(expanded, mask)
        layer = Image.new("RGBA", base.size, color); layer.putalpha(ImageChops.multiply(layer.getchannel("A"), ring))
        out.alpha_composite(layer)
    out.alpha_composite(base)
    surface_alpha = out.getchannel("A")
    highlight = effects.get("highlight")
    if highlight:
        width = _num(highlight.get("width", 1), label+".highlight.width")
        color = _color(highlight.get("color", "#FFFFFF66"), label+".highlight.color")
        shifted = shift_mask(mask, -round(width*SCALE), -round(width*SCALE))
        edge = ImageChops.subtract(mask, shifted)
        layer = Image.new("RGBA", base.size, color); layer.putalpha(ImageChops.multiply(layer.getchannel("A"), edge))
        out.alpha_composite(layer)
    out.putalpha(surface_alpha)
    return out


def _validate_recipe(recipe: dict) -> None:
    if not isinstance(recipe, dict) or recipe.get("contract") != CONTRACT:
        raise ValueError(f"scene recipe must declare {CONTRACT}")
    canvas = recipe.get("canvas")
    if not isinstance(canvas, list) or len(canvas) != 2 or any(type(v) is not int or v <= 0 or v > 1024 for v in canvas):
        raise ValueError("canvas must be two positive integers <=1024")
    anchor = recipe.get("anchor")
    if not isinstance(anchor, list) or len(anchor) != 2 or any(not isinstance(v, (int,float)) for v in anchor):
        raise ValueError("anchor must be [x,y]")
    if not (0 <= anchor[0] <= canvas[0] and 0 <= anchor[1] <= canvas[1]):
        raise ValueError("anchor must lie within canvas")
    if not isinstance(recipe.get("layers"), list) or not recipe["layers"]:
        raise ValueError("layers must be a non-empty list")
    symbols = recipe.get("symbols", {})
    if not isinstance(symbols, dict) or any(not isinstance(k,str) or not isinstance(v,list) for k,v in symbols.items()):
        raise ValueError("symbols must map names to node lists")
    if len(recipe["layers"]) + sum(len(v) for v in symbols.values()) > _MAX_NODES:
        raise ValueError("scene recipe exceeds node budget")


def _render_nodes(work: Image.Image, nodes: list, symbols: dict, parent: dict, rng: random.Random,
                  depth: int = 0, prefix: str = "layers") -> None:
    if depth > _MAX_DEPTH:
        raise ValueError("scene graph exceeds maximum depth")
    for i,node in enumerate(nodes):
        label = f"{prefix}[{i}]"
        if not isinstance(node, dict):
            raise ValueError(f"{label} must be an object")
        transform = _combine(parent, _validate_transform(node.get("transform"), label+".transform"))
        kind = node.get("type", "shape")
        if kind == "group":
            children = node.get("children")
            if not isinstance(children, list):
                raise ValueError(f"{label}.children must be a list")
            _render_nodes(work, children, symbols, transform, rng, depth+1, label+".children")
        elif kind == "symbol":
            name = node.get("symbol")
            if name not in symbols:
                raise ValueError(f"{label} references unknown symbol {name!r}")
            _render_nodes(work, deepcopy(symbols[name]), symbols, transform, rng, depth+1, f"symbol:{name}")
        elif kind == "scatter":
            name = node.get("symbol")
            if name not in symbols:
                raise ValueError(f"{label} references unknown symbol {name!r}")
            count = node.get("count")
            if type(count) is not int or not 1 <= count <= 256:
                raise ValueError(f"{label}.count must be 1..256")
            spread = _pair(node.get("spread", [0,0]), label+".spread")
            rot = node.get("rotationRange", [0,0]); scl = node.get("scaleRange", [1,1])
            r0,r1 = _pair(rot, label+".rotationRange"); s0,s1 = _pair(scl, label+".scaleRange")
            if r0 > r1 or s0 <= 0 or s0 > s1:
                raise ValueError(f"{label} has invalid scatter ranges")
            for n in range(count):
                local = {"translate": [rng.uniform(-spread[0], spread[0]), rng.uniform(-spread[1], spread[1])],
                         "scale": [rng.uniform(s0,s1)]*2, "rotateDeg": rng.uniform(r0,r1)}
                _render_nodes(work, deepcopy(symbols[name]), symbols, _combine(transform, local), rng, depth+1, f"{label}.item{n}")
        elif kind == "shape":
            mask = _shape_mask(work.size, node, transform, label)
            if mask.getbbox() is None:
                continue
            surface = _material(work.size, mask, node.get("material"), label+".material")
            work.alpha_composite(_apply_effects(surface, mask, node.get("effects"), label))
        else:
            raise ValueError(f"{label}.type must be shape, group, symbol or scatter")


def render_scene(recipe: dict) -> tuple[Image.Image, dict]:
    _validate_recipe(recipe)
    canvas = tuple(recipe["canvas"])
    work = Image.new("RGBA", (canvas[0]*SCALE, canvas[1]*SCALE))
    seed = recipe.get("seed", 0)
    if type(seed) is not int or seed < 0:
        raise ValueError("seed must be a nonnegative integer")
    rng = random.Random(seed)
    _render_nodes(work, recipe["layers"], recipe.get("symbols", {}),
                  {"translate":[0,0],"scale":[1,1],"rotateDeg":0}, rng)
    frame = alpha_safe_resize(work, canvas)
    bounds = frame.getchannel("A").getbbox()
    if bounds is None:
        raise ValueError("scene recipe rendered fully transparent")
    meta = {"contract": CONTRACT, "id": recipe["id"], "canvas": list(canvas),
            "anchor": recipe["anchor"], "bounds": list(bounds), "seed": seed,
            "artApproved": False, "runtimePromotion": False}
    if isinstance(recipe.get("camera"), dict):
        meta["camera"] = recipe["camera"]
    return frame, meta


def export(recipe_path: Path, output_dir: Path) -> dict:
    raw = recipe_path.read_bytes(); recipe = json.loads(raw)
    frame, metadata = render_scene(recipe)
    output_dir.mkdir(parents=True, exist_ok=True)
    stem = recipe["id"]
    png = output_dir / f"{stem}.png"; meta = output_dir / f"{stem}.json"
    review = output_dir / f"{stem}_review.png"; iso = output_dir / f"{stem}_isometric_review.png"
    frame.save(png, format="PNG", optimize=False)
    meta.write_text(json.dumps(metadata, indent=2)+"\n", encoding="utf-8")
    w,h = frame.size
    panel = Image.new("RGBA", (w*3+48, h*2+40), (70,95,56,255))
    panel.alpha_composite(frame, (16,20+h//2)); panel.alpha_composite(frame.resize((w*2,h*2), Image.Resampling.NEAREST),(w+32,20))
    ImageDraw.Draw(panel).text((16,4), "1x gameplay", fill=(245,245,230,255)); ImageDraw.Draw(panel).text((w+32,4), "2x inspection", fill=(245,245,230,255))
    panel.save(review, format="PNG", optimize=False)
    iso_panel = Image.new("RGBA", (max(320,w+96), max(220,h+96)), (86,126,68,255))
    cx, cy = iso_panel.size[0]//2, iso_panel.size[1]-46
    d = ImageDraw.Draw(iso_panel)
    d.polygon([(cx,cy-32),(cx+64,cy),(cx,cy+32),(cx-64,cy)], fill=(101,145,78,255), outline=(65,100,53,255))
    iso_panel.alpha_composite(frame, (cx-recipe["anchor"][0], cy-recipe["anchor"][1]))
    iso_panel.save(iso, format="PNG", optimize=False)
    metadata.update({"recipeSha256": hashlib.sha256(raw).hexdigest()})
    meta.write_text(json.dumps(metadata, indent=2)+"\n", encoding="utf-8")
    return {"png":str(png),"metadata":str(meta),"review":str(review),"isometricReview":str(iso)}

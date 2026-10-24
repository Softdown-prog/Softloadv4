"""Localized deterministic finish passes for Visitor Forge 2D.

These passes sit between structural rendering and the final gameplay critic.
They let recipes paint material-specific wear and construction detail inside
authored masks instead of applying one global texture to the entire asset.
The vocabulary is intentionally generic enough for boats, piers, signs, street
props and decorations while staying deterministic and bounded. Optional mask
sampling spends the stamp budget on visible material, with alpha preserved in
both legacy canvas and mask modes. See docs/A7_LOCALIZED_FINISH.md.
"""
from __future__ import annotations

from array import array
import math
import random
from copy import deepcopy

from PIL import Image, ImageChops, ImageDraw, ImageFilter

from . import scene_composer_v3, smooth_geometry

_ALLOWED_STYLES = {
    "wood_wear",
    "edge_wear",
    "scratches",
    "plank_seams",
    "paint_chips",
    "rust_bloom",
    "grime",
    "rope_fibers",
}
_MAX_REGIONS = 32
_MAX_STAMPS = 120


def _num(value, label: str) -> float:
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value):
        raise ValueError(f"{label} must be a finite number")
    return float(value)


def validate_regions(regions: object) -> None:
    if regions is None:
        return
    if not isinstance(regions, list) or len(regions) > _MAX_REGIONS:
        raise ValueError(f"finishRegions must be a list with at most {_MAX_REGIONS} entries")
    for index, region in enumerate(regions):
        label = f"finishRegions[{index}]"
        if not isinstance(region, dict):
            raise ValueError(f"{label} must be an object")
        if region.get("style") not in _ALLOWED_STYLES:
            raise ValueError(f"{label}.style must be one of {sorted(_ALLOWED_STYLES)}")
        mask = region.get("mask")
        if not isinstance(mask, dict):
            raise ValueError(f"{label}.mask must be a shape object")
        if region.get("sampling", "canvas") not in ("canvas", "mask"):
            raise ValueError(f"{label}.sampling must be canvas or mask")
        stamps = region.get("stamps", 24)
        if type(stamps) is not int or not 0 <= stamps <= _MAX_STAMPS:
            raise ValueError(f"{label}.stamps must be 0..{_MAX_STAMPS}")
        opacity = _num(region.get("opacity", 0.12), label + ".opacity")
        if not 0 <= opacity <= 0.5:
            raise ValueError(f"{label}.opacity must be 0..0.5")
        angle = _num(region.get("angleDeg", 0), label + ".angleDeg")
        if abs(angle) > 3600:
            raise ValueError(f"{label}.angleDeg is outside safe limits")


def _expanded_mask_node(mask: dict) -> dict:
    if mask.get("primitive") != "smooth_polygon":
        return deepcopy(mask)
    node = deepcopy(mask)
    node["points"] = smooth_geometry.sample_closed_catmull_rom(
        node.get("points"), node.pop("samplesPerSegment", 6), node.pop("tension", 0.5)
    )
    node["primitive"] = "polygon"
    return node


def _mask(size: tuple[int, int], spec: dict, label: str) -> Image.Image:
    """Raster a recipe-space mask with the same supersampling as the scene.

    scene_composer_v3._shape_mask expects its target image to be SCALE times
    larger than recipe coordinates. Localized finishes run after V3 has already
    downsampled to gameplay resolution, so feeding the final frame size directly
    would multiply coordinates twice and push most masks off-canvas.
    """
    identity = {"translate": [0.0, 0.0], "scale": [1.0, 1.0], "rotateDeg": 0.0}
    high_size = (size[0] * scene_composer_v3.SCALE, size[1] * scene_composer_v3.SCALE)
    high = scene_composer_v3._shape_mask(high_size, _expanded_mask_node(spec), identity, label)
    return high.resize(size, Image.Resampling.LANCZOS)


def _oriented_line(draw: ImageDraw.ImageDraw, cx: float, cy: float, angle: float,
                   half_len: float, width: int, fill) -> None:
    c, s = math.cos(angle), math.sin(angle)
    draw.line((cx-c*half_len, cy-s*half_len, cx+c*half_len, cy+s*half_len),
              fill=fill, width=max(1, width))


def _center(size, rng, centers):
    if centers is None:
        return rng.randrange(size[0]), rng.randrange(size[1])
    index = rng.choice(centers)
    return index % size[0], index // size[0]


def _wood_wear(size, mask, rng, stamps: int, opacity: float, angle_deg: float, centers=None) -> Image.Image:
    layer = Image.new("RGBA", size, (0, 0, 0, 0)); d = ImageDraw.Draw(layer)
    angle = math.radians(angle_deg)
    for _ in range(stamps):
        x, y = _center(size, rng, centers)
        length = rng.uniform(5, 18); width = rng.choice((1, 1, 2))
        light = rng.random() > 0.44
        alpha = round(255 * opacity * rng.uniform(0.25, 0.9))
        fill = (246, 205, 153, alpha) if light else (67, 37, 24, alpha)
        _oriented_line(d, x, y, angle + rng.uniform(-0.13, 0.13), length/2, width, fill)
    layer = layer.filter(ImageFilter.GaussianBlur(0.35))
    layer.putalpha(ImageChops.multiply(layer.getchannel("A"), mask))
    return layer


def _scratches(size, mask, rng, stamps: int, opacity: float, angle_deg: float, centers=None) -> Image.Image:
    layer = Image.new("RGBA", size, (0, 0, 0, 0)); d = ImageDraw.Draw(layer)
    angle = math.radians(angle_deg)
    for _ in range(stamps):
        x, y = _center(size, rng, centers)
        length = rng.uniform(3, 13)
        alpha = round(255 * opacity * rng.uniform(0.3, 1.0))
        fill = (238, 220, 192, alpha) if rng.random() > 0.58 else (49, 36, 31, alpha)
        _oriented_line(d, x, y, angle + rng.uniform(-0.32, 0.32), length/2, 1, fill)
    layer.putalpha(ImageChops.multiply(layer.getchannel("A"), mask))
    return layer


def _edge_wear(size, mask, rng, stamps: int, opacity: float, centers=None) -> Image.Image:
    inner = mask.filter(ImageFilter.MinFilter(5))
    edge = ImageChops.subtract(mask, inner)
    layer = Image.new("RGBA", size, (0, 0, 0, 0)); d = ImageDraw.Draw(layer)
    for _ in range(stamps):
        x, y = _center(size, rng, centers)
        r = rng.randint(1, 4)
        alpha = round(255 * opacity * rng.uniform(0.25, 0.9))
        fill = (250, 222, 184, alpha) if rng.random() > 0.45 else (55, 34, 24, alpha)
        d.ellipse((x-r, y-r, x+r, y+r), fill=fill)
    layer = layer.filter(ImageFilter.GaussianBlur(0.55))
    layer.putalpha(ImageChops.multiply(layer.getchannel("A"), edge))
    return layer


def _plank_seams(size, mask, rng, stamps: int, opacity: float, angle_deg: float, centers=None) -> Image.Image:
    """Long paired construction seams for planked wood and pier decking."""
    layer = Image.new("RGBA", size, (0, 0, 0, 0)); d = ImageDraw.Draw(layer)
    angle = math.radians(angle_deg)
    c, s = math.cos(angle), math.sin(angle)
    nx, ny = -s, c
    diag = math.hypot(*size)
    bounds = mask.getbbox() if centers is not None else (0, 0, *size)
    bx, by, ex, ey = bounds
    spread = abs(nx) * (ex - bx) + abs(ny) * (ey - by)
    if centers is None:
        spread = max(size)  # Preserve legacy seam placement.
    count = max(1, stamps)
    offsets = [(-0.5 + (i + 0.5) / count) * spread for i in range(count)]
    for off in offsets:
        jitter = rng.uniform(-2.0, 2.0)
        cx = (bx + ex) / 2 + nx * (off + jitter)
        cy = (by + ey) / 2 + ny * (off + jitter)
        alpha_dark = round(255 * opacity * rng.uniform(0.45, 0.9))
        alpha_light = round(255 * opacity * rng.uniform(0.18, 0.5))
        _oriented_line(d, cx, cy, angle, diag, 1, (46, 26, 18, alpha_dark))
        _oriented_line(d, cx + nx, cy + ny, angle, diag, 1, (239, 190, 133, alpha_light))
    layer = layer.filter(ImageFilter.GaussianBlur(0.2))
    layer.putalpha(ImageChops.multiply(layer.getchannel("A"), mask))
    return layer


def _paint_chips(size, mask, rng, stamps: int, opacity: float, centers=None) -> Image.Image:
    """Small irregular chips revealing dark undercoat and a pale rim."""
    layer = Image.new("RGBA", size, (0, 0, 0, 0)); d = ImageDraw.Draw(layer)
    for _ in range(stamps):
        x, y = _center(size, rng, centers)
        rx = rng.randint(1, 4); ry = rng.randint(1, 3)
        a = round(255 * opacity * rng.uniform(0.45, 1.0))
        d.ellipse((x-rx, y-ry, x+rx, y+ry), fill=(47, 42, 37, a))
        if rng.random() > 0.35:
            d.arc((x-rx-1, y-ry-1, x+rx+1, y+ry+1), 190, 330,
                  fill=(239, 221, 188, max(1, a // 2)), width=1)
    layer.putalpha(ImageChops.multiply(layer.getchannel("A"), mask))
    return layer


def _rust_bloom(size, mask, rng, stamps: int, opacity: float, centers=None) -> Image.Image:
    """Soft orange/brown oxidation blooms for metal props and hardware."""
    layer = Image.new("RGBA", size, (0, 0, 0, 0)); d = ImageDraw.Draw(layer)
    for _ in range(stamps):
        x, y = _center(size, rng, centers)
        r = rng.randint(2, 8)
        a = round(255 * opacity * rng.uniform(0.25, 0.75))
        color = rng.choice(((150, 65, 25, a), (180, 86, 32, a), (92, 49, 30, a)))
        d.ellipse((x-r, y-r, x+r, y+r), fill=color)
    layer = layer.filter(ImageFilter.GaussianBlur(1.6))
    layer.putalpha(ImageChops.multiply(layer.getchannel("A"), mask))
    return layer


def _grime(size, mask, rng, stamps: int, opacity: float, centers=None) -> Image.Image:
    """Low-frequency dirt/moss-like staining for piers and outdoor props."""
    layer = Image.new("RGBA", size, (0, 0, 0, 0)); d = ImageDraw.Draw(layer)
    for _ in range(stamps):
        x, y = _center(size, rng, centers)
        rx = rng.randint(3, 10); ry = rng.randint(2, 6)
        a = round(255 * opacity * rng.uniform(0.18, 0.65))
        color = rng.choice(((48, 54, 34, a), (72, 61, 39, a), (40, 37, 31, a)))
        d.ellipse((x-rx, y-ry, x+rx, y+ry), fill=color)
    layer = layer.filter(ImageFilter.GaussianBlur(2.0))
    layer.putalpha(ImageChops.multiply(layer.getchannel("A"), mask))
    return layer


def _rope_fibers(size, mask, rng, stamps: int, opacity: float, angle_deg: float, centers=None) -> Image.Image:
    """Short alternating fiber marks that read as twisted rope at game scale."""
    layer = Image.new("RGBA", size, (0, 0, 0, 0)); d = ImageDraw.Draw(layer)
    base = math.radians(angle_deg)
    for _ in range(stamps):
        x, y = _center(size, rng, centers)
        angle = base + rng.choice((-0.55, 0.55))
        a = round(255 * opacity * rng.uniform(0.35, 0.9))
        _oriented_line(d, x, y, angle, rng.uniform(1.5, 4.0), 1, (244, 220, 166, a))
    layer.putalpha(ImageChops.multiply(layer.getchannel("A"), mask))
    return layer


def apply_regions(frame: Image.Image, regions: object, seed: int) -> Image.Image:
    validate_regions(regions)
    if not regions:
        return frame
    image = frame.convert("RGBA")
    alpha = image.getchannel("A")
    for index, region in enumerate(regions):
        mask = _mask(image.size, region["mask"], f"finishRegions[{index}].mask")
        rng = random.Random((seed + 1) * 104729 + index * 8191)
        stamps = region.get("stamps", 24)
        opacity = _num(region.get("opacity", 0.12), f"finishRegions[{index}].opacity")
        angle = _num(region.get("angleDeg", 0), f"finishRegions[{index}].angleDeg")
        style = region["style"]
        if stamps == 0 or opacity == 0:
            continue
        # Finish is a surface effect: it must never create geometry or opacity.
        mask = ImageChops.multiply(mask, alpha)
        centers = None
        if region.get("sampling", "canvas") == "mask":
            sampling_mask = mask
            if style == "edge_wear":
                sampling_mask = ImageChops.subtract(mask, mask.filter(ImageFilter.MinFilter(5)))
            centers = array("I", (i for i, value in enumerate(sampling_mask.tobytes()) if value >= 16))
            if not centers:
                continue
        if style == "wood_wear":
            layer = _wood_wear(image.size, mask, rng, stamps, opacity, angle, centers)
        elif style == "scratches":
            layer = _scratches(image.size, mask, rng, stamps, opacity, angle, centers)
        elif style == "edge_wear":
            layer = _edge_wear(image.size, mask, rng, stamps, opacity, centers)
        elif style == "plank_seams":
            layer = _plank_seams(image.size, mask, rng, stamps, opacity, angle, centers)
        elif style == "paint_chips":
            layer = _paint_chips(image.size, mask, rng, stamps, opacity, centers)
        elif style == "rust_bloom":
            layer = _rust_bloom(image.size, mask, rng, stamps, opacity, centers)
        elif style == "grime":
            layer = _grime(image.size, mask, rng, stamps, opacity, centers)
        else:
            layer = _rope_fibers(image.size, mask, rng, stamps, opacity, angle, centers)
        image = Image.alpha_composite(image, layer)
        image.putalpha(alpha)
    return image

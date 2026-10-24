"""A7 Field Mass Engine V1.

Turns scalar fields into coherent painted masses without requiring thousands of
independent bitmap stamps. The primitive is generic: foliage support masses,
shrub bodies, cloud-like material patches, terrain stains and other organic
regions can all be authored from the same field contract.
"""
from __future__ import annotations

import random
from typing import Sequence

from PIL import Image, ImageFilter

from .field_engine import FIELD_ENGINE_CONTRACT

FIELD_MASS_CONTRACT = "A7_FIELD_MASS_ENGINE_V1"


def _clamp(value: float, lo: float, hi: float) -> float:
    return max(lo, min(hi, float(value)))


def _rgba(value: str | Sequence[int]) -> tuple[int, int, int, int]:
    if isinstance(value, str):
        text = value.lstrip("#")
        if len(text) not in (6, 8):
            raise ValueError("mass colors must use #RRGGBB or #RRGGBBAA")
        channels = tuple(int(text[index:index + 2], 16) for index in range(0, len(text), 2))
        if len(channels) == 3:
            return channels[0], channels[1], channels[2], 255
        return channels  # type: ignore[return-value]
    channels = tuple(int(_clamp(channel, 0, 255)) for channel in value)
    if len(channels) == 3:
        return channels[0], channels[1], channels[2], 255
    if len(channels) == 4:
        return channels  # type: ignore[return-value]
    raise ValueError("mass colors require RGB or RGBA channels")


def _smoothstep(edge0: float, edge1: float, value: float) -> float:
    if edge1 <= edge0:
        return 1.0 if value >= edge1 else 0.0
    t = _clamp((value - edge0) / (edge1 - edge0), 0.0, 1.0)
    return t * t * (3.0 - 2.0 * t)


def _low_frequency_noise(size: tuple[int, int], seed: int, cell_px: int) -> Image.Image:
    """Deterministic smooth noise used only to break mathematically perfect edges."""
    width, height = size
    cell = max(4, int(cell_px))
    grid_w = max(2, width // cell + 2)
    grid_h = max(2, height // cell + 2)
    rng = random.Random(int(seed))
    small = Image.new("L", (grid_w, grid_h), 128)
    pixels = small.load()
    for y in range(grid_h):
        for x in range(grid_w):
            pixels[x, y] = rng.randrange(0, 256)
    return small.resize((width, height), Image.Resampling.BICUBIC)


def paint_field_mass(
    canvas: Image.Image,
    density_field: Image.Image,
    *,
    depth_field: Image.Image | None = None,
    color: str | Sequence[int] = "#315E36",
    threshold: float = 0.16,
    feather: float = 0.10,
    opacity: int = 220,
    close_px: int = 2,
    edge_noise: float = 0.10,
    noise_cell_px: int = 18,
    depth_shade: float = 0.22,
    seed: int = 1,
) -> dict:
    """Composite a coherent field-defined material mass onto an RGBA canvas.

    Noise may perturb an existing field edge, but it is field-gated and can
    never create material where the authored density is zero. This invariant is
    important for masks and organic support masses: edge breakup must deform a
    silhouette, not invent disconnected islands elsewhere on the canvas.
    """
    if canvas.mode != "RGBA":
        raise ValueError("Field Mass Engine canvas must be RGBA")
    density = density_field if density_field.mode == "L" else density_field.convert("L")
    if density.size != canvas.size:
        raise ValueError("density field must match canvas size")
    depth = None if depth_field is None else (depth_field if depth_field.mode == "L" else depth_field.convert("L"))
    if depth is not None and depth.size != canvas.size:
        raise ValueError("depth field must match canvas size")

    threshold = _clamp(threshold, 0.0, 1.0)
    feather = max(0.001, float(feather))
    opacity = int(_clamp(opacity, 0, 255))
    edge_noise = _clamp(edge_noise, 0.0, 0.45)
    depth_shade = _clamp(depth_shade, 0.0, 0.8)
    base = _rgba(color)
    noise = _low_frequency_noise(canvas.size, int(seed), int(noise_cell_px))

    alpha = Image.new("L", canvas.size, 0)
    alpha_px = alpha.load()
    density_px = density.load()
    noise_px = noise.load()
    gate_end = max(0.02, threshold + feather * 1.5)
    for y in range(canvas.height):
        for x in range(canvas.width):
            d = density_px[x, y] / 255.0
            if d <= 0.0:
                alpha_px[x, y] = 0
                continue
            n = noise_px[x, y] / 255.0 - 0.5
            noise_gate = _smoothstep(0.0, gate_end, d)
            adjusted = d + n * edge_noise * noise_gate
            a = _smoothstep(threshold - feather, threshold + feather, adjusted)
            alpha_px[x, y] = round(a * opacity)

    close = max(0, int(close_px))
    if close:
        kernel = close * 2 + 1
        alpha = alpha.filter(ImageFilter.MaxFilter(kernel)).filter(ImageFilter.MinFilter(kernel))
    alpha = alpha.filter(ImageFilter.GaussianBlur(0.45))

    # Morphology/feathering may spread a subpixel fringe from a valid edge, but
    # it must not resurrect distant zero-density pixels. Constrain the result to
    # a tiny dilation of the authored source-field support.
    support = density.point(lambda px: 255 if px > 0 else 0)
    support = support.filter(ImageFilter.MaxFilter(3))
    alpha_px = alpha.load()
    support_px = support.load()
    for y in range(canvas.height):
        for x in range(canvas.width):
            if support_px[x, y] == 0:
                alpha_px[x, y] = 0

    layer = Image.new("RGBA", canvas.size, (0, 0, 0, 0))
    layer_px = layer.load()
    alpha_px = alpha.load()
    depth_px = depth.load() if depth is not None else None
    for y in range(canvas.height):
        for x in range(canvas.width):
            a = alpha_px[x, y]
            if a <= 0:
                continue
            depth_value = 0.5 if depth_px is None else depth_px[x, y] / 255.0
            value_mul = 1.0 + (depth_value - 0.5) * depth_shade
            r = round(_clamp(base[0] * value_mul, 0, 255))
            g = round(_clamp(base[1] * value_mul, 0, 255))
            b = round(_clamp(base[2] * value_mul, 0, 255))
            layer_px[x, y] = (r, g, b, round(a * (base[3] / 255.0)))

    canvas.alpha_composite(layer)
    bbox = alpha.getbbox()
    coverage = 0.0 if bbox is None else sum(alpha.getdata()) / (255.0 * canvas.width * canvas.height)
    return {
        "contract": FIELD_MASS_CONTRACT,
        "fieldContract": FIELD_ENGINE_CONTRACT,
        "threshold": threshold,
        "feather": feather,
        "opacity": opacity,
        "closePx": close,
        "edgeNoise": edge_noise,
        "noiseFieldGated": True,
        "depthShade": depth_shade,
        "coverage": round(coverage, 6),
        "bounds": None if bbox is None else list(bbox),
    }

"""A7 Layer Engine V1.

Deterministic RGBA layer composition and contact occlusion for the Draw Engine.
The goal is to make depth explicit in recipes instead of baking every visual
relationship into one renderer.
"""
from __future__ import annotations

from typing import Sequence

from PIL import Image, ImageFilter

LAYER_ENGINE_CONTRACT = "A7_LAYER_ENGINE_V1"


def _clamp(value: float, lo: float, hi: float) -> float:
    return max(lo, min(hi, float(value)))


def _rgb(value: str | Sequence[int]) -> tuple[int, int, int]:
    if isinstance(value, str):
        text = value.lstrip("#")
        if len(text) != 6:
            raise ValueError("layer colors must use #RRGGBB")
        return tuple(int(text[i:i + 2], 16) for i in (0, 2, 4))  # type: ignore[return-value]
    if len(value) < 3:
        raise ValueError("layer colors require RGB channels")
    return tuple(int(_clamp(channel, 0, 255)) for channel in value[:3])  # type: ignore[return-value]


def composite(base: Image.Image, layer: Image.Image, *, opacity: float = 1.0) -> Image.Image:
    """Alpha-composite an RGBA layer over an RGBA base with optional opacity."""
    if base.mode != "RGBA" or layer.mode != "RGBA":
        raise ValueError("layer composite requires RGBA inputs")
    if base.size != layer.size:
        raise ValueError("layer composite inputs must have matching sizes")
    top = layer.copy()
    opacity = _clamp(opacity, 0.0, 1.0)
    if opacity < 1.0:
        top.putalpha(top.getchannel("A").point(lambda a: round(a * opacity)))
    out = base.copy()
    out.alpha_composite(top)
    return out


def contact_occlusion(
    base: Image.Image,
    occluder: Image.Image,
    *,
    radius: float = 3.0,
    strength: float = 0.28,
    offset: Sequence[int] = (0, 2),
    color: str | Sequence[int] = "#102016",
    expand_px: int = 1,
    base_alpha_only: bool = True,
) -> Image.Image:
    """Darken surfaces immediately under an authored occluder layer.

    The shadow is derived only from the occluder's alpha. When base_alpha_only
    is true (the production default), the shadow cannot appear on empty canvas,
    which prevents floating halos around transparent assets.
    """
    if base.mode != "RGBA" or occluder.mode != "RGBA":
        raise ValueError("contact occlusion requires RGBA inputs")
    if base.size != occluder.size:
        raise ValueError("contact occlusion inputs must have matching sizes")
    if len(offset) != 2:
        raise ValueError("contact occlusion offset must be [x,y]")

    alpha = occluder.getchannel("A")
    expand = max(0, int(expand_px))
    if expand:
        alpha = alpha.filter(ImageFilter.MaxFilter(expand * 2 + 1))
    if radius > 0.0:
        alpha = alpha.filter(ImageFilter.GaussianBlur(float(radius)))

    dx, dy = int(offset[0]), int(offset[1])
    shifted = Image.new("L", base.size, 0)
    shifted.paste(alpha, (dx, dy))

    strength = _clamp(strength, 0.0, 1.0)
    shifted = shifted.point(lambda a: round(a * strength))
    if base_alpha_only:
        base_alpha = base.getchannel("A")
        shadow_px = shifted.load()
        base_px = base_alpha.load()
        for y in range(base.height):
            for x in range(base.width):
                shadow_px[x, y] = round(shadow_px[x, y] * (base_px[x, y] / 255.0))

    r, g, b = _rgb(color)
    shadow = Image.new("RGBA", base.size, (r, g, b, 0))
    shadow.putalpha(shifted)
    out = base.copy()
    out.alpha_composite(shadow)
    return out

"""A7 Brush Engine V2.

Deterministic bitmap-tip brush engine for 2D game asset authoring.

Unlike the legacy procedural brush helpers, this engine treats RGBA images as
first-class brush tips.  Tips are loaded from a reusable package library, then
scaled, rotated, tinted, scattered or stroked along authored paths.

The engine deliberately stays independent from any particular asset type.
Trees, grass, bark, flowers, stone, roof tiles and decals can all use the same
primitive.
"""
from __future__ import annotations

from dataclasses import dataclass
import math
import random
from pathlib import Path
from typing import Iterable, Sequence

from PIL import Image, ImageChops

BRUSH_CONTRACT = "A7_BRUSH_ENGINE_V2"
BRUSH_LIBRARY = Path(__file__).resolve().parents[1] / "brush_library"


def _clamp(value: float, lo: float, hi: float) -> float:
    return max(lo, min(hi, value))


def _rgb(value: str | Sequence[int]) -> tuple[int, int, int]:
    if isinstance(value, str):
        text = value.lstrip("#")
        if len(text) != 6:
            raise ValueError("hex tint must use #RRGGBB")
        return tuple(int(text[i:i + 2], 16) for i in (0, 2, 4))
    if len(value) != 3:
        raise ValueError("RGB tint requires three channels")
    return tuple(int(_clamp(int(channel), 0, 255)) for channel in value)


def resolve_brush_tip(name: str | Path) -> Path:
    path = Path(name)
    if not path.is_absolute():
        path = BRUSH_LIBRARY / path
    path = path.resolve()
    library = BRUSH_LIBRARY.resolve()
    if library not in path.parents:
        raise ValueError("brush tips must resolve inside the A7 brush library")
    if path.suffix.lower() != ".png":
        raise ValueError("Brush Engine V2 currently accepts PNG RGBA tips")
    if not path.exists():
        raise FileNotFoundError(path)
    return path


def load_brush_tip(name: str | Path) -> Image.Image:
    path = resolve_brush_tip(name)
    with Image.open(path) as source:
        source.load()
        if source.mode != "RGBA":
            source = source.convert("RGBA")
        return source.copy()


def tint_tip(tip: Image.Image, tint: str | Sequence[int]) -> Image.Image:
    """Tint an RGBA tip while preserving its luminance and alpha."""
    if tip.mode != "RGBA":
        tip = tip.convert("RGBA")
    tr, tg, tb = _rgb(tint)
    r, g, b, alpha = tip.split()
    tone = Image.merge("RGB", (r, g, b))
    tint_layer = Image.new("RGB", tip.size, (tr, tg, tb))
    shaded = ImageChops.multiply(tone, tint_layer)
    rr, gg, bb = shaded.split()
    return Image.merge("RGBA", (rr, gg, bb, alpha))


@dataclass(frozen=True)
class BrushStamp:
    x: float
    y: float
    scale: float = 1.0
    rotation_deg: float = 0.0
    opacity: int = 255
    tint: str = "#FFFFFF"


class BrushEngineV2:
    """Deterministic bitmap brush renderer."""

    contract = BRUSH_CONTRACT

    def __init__(self, seed: int = 1):
        self.seed = int(seed)
        self.rng = random.Random(self.seed)
        self._cache: dict[str, Image.Image] = {}

    def tip(self, name: str) -> Image.Image:
        cached = self._cache.get(name)
        if cached is None:
            cached = load_brush_tip(name)
            self._cache[name] = cached
        return cached.copy()

    def stamp(self, canvas: Image.Image, brush: str, stamp: BrushStamp) -> None:
        if canvas.mode != "RGBA":
            raise ValueError("Brush Engine V2 canvas must be RGBA")
        source = tint_tip(self.tip(brush), stamp.tint)
        scale = max(0.05, float(stamp.scale))
        width = max(1, round(source.width * scale))
        height = max(1, round(source.height * scale))
        source = source.resize((width, height), Image.Resampling.LANCZOS)
        if abs(stamp.rotation_deg) > 1e-6:
            source = source.rotate(float(stamp.rotation_deg), resample=Image.Resampling.BICUBIC, expand=True)
        opacity = int(_clamp(stamp.opacity, 0, 255))
        if opacity != 255:
            alpha = source.getchannel("A").point(lambda a: round(a * opacity / 255))
            source.putalpha(alpha)
        x = round(stamp.x - source.width / 2)
        y = round(stamp.y - source.height / 2)
        canvas.alpha_composite(source, (x, y))

    def scatter_regions(self, canvas: Image.Image, brushes: Sequence[str], regions: Sequence[dict], count: int,
                        *, scale: Sequence[float] = (1.0, 1.0), rotation_deg: Sequence[float] = (0.0, 360.0),
                        opacity: Sequence[int] = (255, 255), tints: Sequence[str] = ("#FFFFFF",)) -> list[BrushStamp]:
        if not brushes:
            raise ValueError("scatter requires at least one brush tip")
        if not regions:
            raise ValueError("scatter requires at least one region")
        if count < 0:
            raise ValueError("scatter count cannot be negative")
        weights = [max(0.0, float(region.get("weight", 1.0))) for region in regions]
        if sum(weights) <= 0:
            raise ValueError("scatter region weights must sum above zero")
        stamps: list[BrushStamp] = []
        for _ in range(int(count)):
            region = self.rng.choices(regions, weights=weights, k=1)[0]
            center = region.get("center")
            radius = region.get("radius")
            if (not isinstance(center, Sequence) or len(center) != 2 or
                not isinstance(radius, Sequence) or len(radius) != 2):
                raise ValueError("scatter region needs center[x,y] and radius[rx,ry]")
            angle = self.rng.random() * math.tau
            distance = math.sqrt(self.rng.random())
            x = float(center[0]) + math.cos(angle) * float(radius[0]) * distance
            y = float(center[1]) + math.sin(angle) * float(radius[1]) * distance
            item = BrushStamp(
                x=x, y=y,
                scale=self.rng.uniform(float(scale[0]), float(scale[1])),
                rotation_deg=self.rng.uniform(float(rotation_deg[0]), float(rotation_deg[1])),
                opacity=round(self.rng.uniform(float(opacity[0]), float(opacity[1]))),
                tint=self.rng.choice(tuple(tints)),
            )
            self.stamp(canvas, self.rng.choice(tuple(brushes)), item)
            stamps.append(item)
        return stamps

    @staticmethod
    def _sample_polyline(points: Sequence[Sequence[float]], spacing: float) -> Iterable[tuple[float, float, float]]:
        if len(points) < 2:
            return
        spacing = max(0.5, float(spacing))
        carry = 0.0
        for start, end in zip(points, points[1:]):
            x0, y0 = map(float, start)
            x1, y1 = map(float, end)
            dx, dy = x1 - x0, y1 - y0
            length = math.hypot(dx, dy)
            if length <= 1e-9:
                continue
            tangent = math.degrees(math.atan2(dy, dx))
            distance = max(0.0, spacing - carry)
            while distance <= length:
                t = distance / length
                yield x0 + dx * t, y0 + dy * t, tangent
                distance += spacing
            carry = max(0.0, length - (distance - spacing))

    def stroke_paths(self, canvas: Image.Image, brush: str, paths: Sequence[Sequence[Sequence[float]]],
                     *, spacing: float = 4.0, scale: Sequence[float] = (1.0, 1.0),
                     opacity: Sequence[int] = (255, 255), tints: Sequence[str] = ("#FFFFFF",),
                     follow_tangent: bool = True, rotation_jitter_deg: float = 0.0) -> list[BrushStamp]:
        stamps: list[BrushStamp] = []
        for points in paths:
            for x, y, tangent in self._sample_polyline(points, spacing):
                rotation = tangent if follow_tangent else 0.0
                rotation += self.rng.uniform(-rotation_jitter_deg, rotation_jitter_deg)
                item = BrushStamp(
                    x=x, y=y,
                    scale=self.rng.uniform(float(scale[0]), float(scale[1])),
                    rotation_deg=rotation,
                    opacity=round(self.rng.uniform(float(opacity[0]), float(opacity[1]))),
                    tint=self.rng.choice(tuple(tints)),
                )
                self.stamp(canvas, brush, item)
                stamps.append(item)
        return stamps

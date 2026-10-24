"""A7 Brush Engine V3: deterministic brush dynamics over bitmap tips."""
from __future__ import annotations

from dataclasses import dataclass
import math
import random
from typing import Sequence

from PIL import Image, ImageOps

from .brush_engine_v2 import BRUSH_LIBRARY, load_brush_tip, tint_tip
from .dab_density import DAB_DENSITY_CONTRACT, spacing_from_density

BRUSH_V3_CONTRACT = "A7_BRUSH_ENGINE_V3"


def _clamp(value: float, lo: float, hi: float) -> float:
    return max(lo, min(hi, value))


def _range_pair(value: Sequence[float] | float, default: float = 1.0) -> tuple[float, float]:
    if isinstance(value, (int, float)):
        number = float(value)
        return number, number
    if len(value) != 2:
        return default, default
    return float(value[0]), float(value[1])


def _hsv_adjust(image: Image.Image, hue_deg: float, saturation_mul: float, value_mul: float) -> Image.Image:
    """Apply deterministic HSV variation while preserving alpha."""
    if image.mode != "RGBA":
        image = image.convert("RGBA")
    alpha = image.getchannel("A")
    hsv = image.convert("RGB").convert("HSV")
    h, s, v = hsv.split()
    hue_shift = round(float(hue_deg) / 360.0 * 255.0)
    if hue_shift:
        h = h.point(lambda px: (px + hue_shift) % 256)
    if abs(saturation_mul - 1.0) > 1e-6:
        s = s.point(lambda px: round(_clamp(px * saturation_mul, 0, 255)))
    if abs(value_mul - 1.0) > 1e-6:
        v = v.point(lambda px: round(_clamp(px * value_mul, 0, 255)))
    out = Image.merge("HSV", (h, s, v)).convert("RGBA")
    out.putalpha(alpha)
    return out


@dataclass(frozen=True)
class DynamicBrushStamp:
    x: float
    y: float
    scale_x: float = 1.0
    scale_y: float = 1.0
    rotation_deg: float = 0.0
    opacity: int = 255
    tint: str = "#FFFFFF"
    mirror_x: bool = False
    mirror_y: bool = False
    hue_shift_deg: float = 0.0
    saturation_mul: float = 1.0
    value_mul: float = 1.0


class BrushEngineV3:
    """Bitmap-tip engine with deterministic per-stamp dynamics."""

    contract = BRUSH_V3_CONTRACT
    library = BRUSH_LIBRARY

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

    def random_stamp(
        self,
        x: float,
        y: float,
        *,
        scale: Sequence[float] = (1.0, 1.0),
        aspect: Sequence[float] = (1.0, 1.0),
        rotation_deg: Sequence[float] = (0.0, 0.0),
        base_rotation_deg: float = 0.0,
        opacity: Sequence[int] = (255, 255),
        tints: Sequence[str] = ("#FFFFFF",),
        mirror_x_probability: float = 0.0,
        mirror_y_probability: float = 0.0,
        hue_jitter_deg: float = 0.0,
        saturation: Sequence[float] = (1.0, 1.0),
        value: Sequence[float] = (1.0, 1.0),
    ) -> DynamicBrushStamp:
        if not tints:
            raise ValueError("Brush Engine V3 requires at least one tint")
        scale_range = _range_pair(scale)
        aspect_range = _range_pair(aspect)
        rotation_range = _range_pair(rotation_deg, 0.0)
        saturation_range = _range_pair(saturation)
        value_range = _range_pair(value)
        opacity_range = _range_pair(opacity, 255.0)

        uniform_scale = max(0.05, self.rng.uniform(*scale_range))
        aspect_ratio = max(0.1, self.rng.uniform(*aspect_range))
        aspect_root = aspect_ratio ** 0.5
        scale_x = uniform_scale * aspect_root
        scale_y = uniform_scale / aspect_root
        return DynamicBrushStamp(
            x=float(x),
            y=float(y),
            scale_x=scale_x,
            scale_y=scale_y,
            rotation_deg=float(base_rotation_deg) + self.rng.uniform(*rotation_range),
            opacity=round(_clamp(self.rng.uniform(*opacity_range), 0, 255)),
            tint=self.rng.choice(tuple(tints)),
            mirror_x=self.rng.random() < _clamp(float(mirror_x_probability), 0.0, 1.0),
            mirror_y=self.rng.random() < _clamp(float(mirror_y_probability), 0.0, 1.0),
            hue_shift_deg=self.rng.uniform(-abs(float(hue_jitter_deg)), abs(float(hue_jitter_deg))),
            saturation_mul=max(0.0, self.rng.uniform(*saturation_range)),
            value_mul=max(0.0, self.rng.uniform(*value_range)),
        )

    def stamp(self, canvas: Image.Image, brush: str, stamp: DynamicBrushStamp) -> None:
        if canvas.mode != "RGBA":
            raise ValueError("Brush Engine V3 canvas must be RGBA")
        source = tint_tip(self.tip(brush), stamp.tint)
        source = _hsv_adjust(source, stamp.hue_shift_deg, stamp.saturation_mul, stamp.value_mul)
        if stamp.mirror_x:
            source = ImageOps.mirror(source)
        if stamp.mirror_y:
            source = ImageOps.flip(source)

        width = max(1, round(source.width * max(0.05, float(stamp.scale_x))))
        height = max(1, round(source.height * max(0.05, float(stamp.scale_y))))
        source = source.resize((width, height), Image.Resampling.LANCZOS)
        if abs(stamp.rotation_deg) > 1e-6:
            source = source.rotate(float(stamp.rotation_deg), resample=Image.Resampling.BICUBIC, expand=True)
        opacity = int(_clamp(stamp.opacity, 0, 255))
        if opacity != 255:
            alpha = source.getchannel("A").point(lambda px: round(px * opacity / 255))
            source.putalpha(alpha)

        x = round(stamp.x - source.width / 2)
        y = round(stamp.y - source.height / 2)
        canvas.alpha_composite(source, (x, y))

    def stamp_random(self, canvas: Image.Image, brush: str, x: float, y: float, **dynamics) -> DynamicBrushStamp:
        stamp = self.random_stamp(x, y, **dynamics)
        self.stamp(canvas, brush, stamp)
        return stamp

    def scatter_regions(
        self,
        canvas: Image.Image,
        brushes: Sequence[str],
        regions: Sequence[dict],
        count: int,
        **dynamics,
    ) -> list[DynamicBrushStamp]:
        if not brushes:
            raise ValueError("dynamic scatter requires at least one brush")
        if not regions:
            raise ValueError("dynamic scatter requires at least one region")
        if int(count) < 0:
            raise ValueError("dynamic scatter count cannot be negative")
        weights = [max(0.0, float(region.get("weight", 1.0))) for region in regions]
        if sum(weights) <= 0:
            raise ValueError("dynamic scatter region weights must sum above zero")

        stamps: list[DynamicBrushStamp] = []
        for _ in range(int(count)):
            region = self.rng.choices(regions, weights=weights, k=1)[0]
            center, radius = region.get("center"), region.get("radius")
            if not isinstance(center, Sequence) or len(center) != 2 or not isinstance(radius, Sequence) or len(radius) != 2:
                raise ValueError("dynamic scatter region needs center[x,y] and radius[rx,ry]")
            angle = self.rng.random() * math.tau
            distance = math.sqrt(self.rng.random())
            x = float(center[0]) + math.cos(angle) * float(radius[0]) * distance
            y = float(center[1]) + math.sin(angle) * float(radius[1]) * distance
            brush = self.rng.choice(tuple(brushes))
            stamps.append(self.stamp_random(canvas, brush, x, y, **dynamics))
        return stamps

    @staticmethod
    def _polyline_metrics(points: Sequence[Sequence[float]]) -> tuple[list[float], float]:
        if len(points) < 2:
            return [], 0.0
        lengths: list[float] = []
        total = 0.0
        for start, end in zip(points, points[1:]):
            length = math.hypot(float(end[0]) - float(start[0]), float(end[1]) - float(start[1]))
            lengths.append(length)
            total += length
        return lengths, total

    @staticmethod
    def _point_at_distance(points: Sequence[Sequence[float]], lengths: Sequence[float], distance: float) -> tuple[float, float, float]:
        remaining = max(0.0, float(distance))
        for index, length in enumerate(lengths):
            if length <= 1e-9:
                continue
            if remaining <= length:
                start, end = points[index], points[index + 1]
                t = remaining / length
                x = float(start[0]) + (float(end[0]) - float(start[0])) * t
                y = float(start[1]) + (float(end[1]) - float(start[1])) * t
                tangent = math.degrees(math.atan2(float(end[1]) - float(start[1]), float(end[0]) - float(start[0])))
                return x, y, tangent
            remaining -= length
        start, end = points[-2], points[-1]
        tangent = math.degrees(math.atan2(float(end[1]) - float(start[1]), float(end[0]) - float(start[0])))
        return float(end[0]), float(end[1]), tangent

    @staticmethod
    def _equivalent_radius(tip: Image.Image, stamp: DynamicBrushStamp) -> float:
        """Area-preserving equivalent radius for an anisotropically scaled tip."""
        width = max(1e-6, float(tip.width) * max(0.05, float(stamp.scale_x)))
        height = max(1e-6, float(tip.height) * max(0.05, float(stamp.scale_y)))
        return max(0.1, math.sqrt(width * height) * 0.5)

    def stroke_paths(
        self,
        canvas: Image.Image,
        brush: str,
        paths: Sequence[Sequence[Sequence[float]]],
        *,
        spacing: float = 8.0,
        spacing_jitter: float = 0.0,
        follow_tangent: bool = True,
        dabs_per_actual_radius: float = 0.0,
        dabs_per_basic_radius: float = 0.0,
        basic_radius_px: float | None = None,
        **dynamics,
    ) -> list[DynamicBrushStamp]:
        """Stroke bitmap tips along paths.

        Legacy recipes may keep explicit `spacing`. If either dab-density value
        is above zero, spacing becomes proportional to brush radius using the
        MyPaint-informed A7_DAB_DENSITY_V1 model.
        """
        stamps: list[DynamicBrushStamp] = []
        base_spacing = max(0.5, float(spacing))
        jitter = _clamp(abs(float(spacing_jitter)), 0.0, 0.95)
        actual_density = max(0.0, float(dabs_per_actual_radius))
        basic_density = max(0.0, float(dabs_per_basic_radius))
        density_enabled = actual_density > 0.0 or basic_density > 0.0
        tip = self.tip(brush)
        default_base_radius = max(0.1, math.sqrt(float(tip.width) * float(tip.height)) * 0.5)
        base_radius = default_base_radius if basic_radius_px is None else max(0.1, float(basic_radius_px))

        for points in paths:
            lengths, total = self._polyline_metrics(points)
            if total <= 1e-9:
                continue
            distance = 0.0
            while distance <= total:
                x, y, tangent = self._point_at_distance(points, lengths, distance)
                base_rotation = tangent if follow_tangent else 0.0
                stamp = self.random_stamp(x, y, base_rotation_deg=base_rotation, **dynamics)
                self.stamp(canvas, brush, stamp)
                stamps.append(stamp)

                if density_enabled:
                    actual_radius = self._equivalent_radius(tip, stamp)
                    step = spacing_from_density(
                        actual_radius=actual_radius,
                        base_radius=base_radius,
                        dabs_per_actual_radius=actual_density,
                        dabs_per_basic_radius=basic_density,
                        fallback_spacing=base_spacing,
                    )
                else:
                    step = base_spacing

                step *= self.rng.uniform(1.0 - jitter, 1.0 + jitter)
                distance += max(0.5, step)
        return stamps

    @staticmethod
    def dab_density_contract() -> str:
        return DAB_DENSITY_CONTRACT

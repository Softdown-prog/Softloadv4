"""A7 mapped brush engine.

Connects Brush Engine V3 to generic sensor contexts and option bindings so
brush properties can be driven by named signals instead of random ranges alone.
"""
from __future__ import annotations

from dataclasses import replace
import math
import random
from typing import Mapping, Sequence

from PIL import Image

from .brush_engine_v3 import BRUSH_V3_CONTRACT, BrushEngineV3, DynamicBrushStamp
from .brush_option_bindings import BRUSH_OPTION_BINDINGS_CONTRACT, BrushOptionBindings
from .dynamics_mapping import DYNAMICS_MAPPING_CONTRACT
from .sensor_context import SENSOR_CONTEXT_CONTRACT, SensorContext, canonical_sensor_names

MAPPED_BRUSH_CONTRACT = "A7_MAPPED_BRUSH_ENGINE_V1"


def _clamp(value: float, lo: float, hi: float) -> float:
    return max(lo, min(hi, value))


class MappedBrushEngineV1:
    """Brush V3 plus curve-driven semantic brush options."""

    contract = MAPPED_BRUSH_CONTRACT

    def __init__(self, seed: int = 1):
        self.seed = int(seed)
        self.rng = random.Random(self.seed)
        self.brush = BrushEngineV3(self.seed + 104729)

    @staticmethod
    def apply_option_values(
        stamp: DynamicBrushStamp,
        values: Mapping[str, float],
    ) -> DynamicBrushStamp:
        scale_mul = max(0.05, float(values.get("scale_mul", 1.0)))
        aspect_mul = max(0.1, float(values.get("aspect_mul", 1.0)))
        aspect_root = math.sqrt(aspect_mul)

        return replace(
            stamp,
            x=stamp.x + float(values.get("offset_x", 0.0)),
            y=stamp.y + float(values.get("offset_y", 0.0)),
            scale_x=max(0.05, stamp.scale_x * scale_mul * aspect_root),
            scale_y=max(0.05, stamp.scale_y * scale_mul / aspect_root),
            rotation_deg=stamp.rotation_deg + float(values.get("rotation_add_deg", 0.0)),
            opacity=round(_clamp(stamp.opacity * float(values.get("opacity_mul", 1.0)), 0, 255)),
            hue_shift_deg=stamp.hue_shift_deg + float(values.get("hue_add_deg", 0.0)),
            saturation_mul=max(0.0, stamp.saturation_mul * float(values.get("saturation_mul", 1.0))),
            value_mul=max(0.0, stamp.value_mul * float(values.get("value_mul", 1.0))),
        )

    @staticmethod
    def apply_mappings(
        stamp: DynamicBrushStamp,
        mappings: Mapping[str, Mapping],
        inputs: Mapping[str, float] | SensorContext,
    ) -> DynamicBrushStamp:
        """Compatibility entry point retained for existing callers/tests."""
        bindings = BrushOptionBindings(mappings)
        return MappedBrushEngineV1.apply_option_values(stamp, bindings.evaluate(inputs))

    def scatter_regions(
        self,
        canvas: Image.Image,
        brushes: Sequence[str],
        regions: Sequence[dict],
        count: int,
        *,
        mappings: Mapping[str, Mapping],
        dynamics: Mapping | None = None,
    ) -> tuple[list[DynamicBrushStamp], dict]:
        if canvas.mode != "RGBA":
            raise ValueError("mapped brush canvas must be RGBA")
        if not brushes:
            raise ValueError("mapped scatter requires at least one brush")
        if not regions:
            raise ValueError("mapped scatter requires at least one region")
        count = int(count)
        if count < 0:
            raise ValueError("mapped scatter count cannot be negative")

        weights = [max(0.0, float(region.get("weight", 1.0))) for region in regions]
        if sum(weights) <= 0.0:
            raise ValueError("mapped scatter region weights must sum above zero")

        dynamics = dict(dynamics or {})
        bindings = BrushOptionBindings(mappings)
        stamps: list[DynamicBrushStamp] = []

        for index in range(count):
            region_index = self.rng.choices(range(len(regions)), weights=weights, k=1)[0]
            region = regions[region_index]
            center, radius = region.get("center"), region.get("radius")
            if (
                not isinstance(center, Sequence)
                or len(center) != 2
                or not isinstance(radius, Sequence)
                or len(radius) != 2
            ):
                raise ValueError("mapped scatter region needs center[x,y] and radius[rx,ry]")

            angle = self.rng.random() * math.tau
            radial = math.sqrt(self.rng.random())
            x = float(center[0]) + math.cos(angle) * float(radius[0]) * radial
            y = float(center[1]) + math.sin(angle) * float(radius[1]) * radial

            sensors = SensorContext.scatter(
                index=index,
                count=count,
                random_value=self.rng.random(),
                direction_deg=math.degrees(angle),
                radial=radial,
                x=x,
                y=y,
                canvas_width=canvas.width,
                canvas_height=canvas.height,
                region=region_index,
                depth=float(region.get("depth", 0.0)),
                density=float(region.get("density", 1.0)),
            )

            brush_name = self.rng.choice(tuple(brushes))
            base_stamp = self.brush.random_stamp(x, y, **dynamics)
            stamp = self.apply_option_values(base_stamp, bindings.evaluate(sensors))
            self.brush.stamp(canvas, brush_name, stamp)
            stamps.append(stamp)

        return stamps, {
            "contract": MAPPED_BRUSH_CONTRACT,
            "brushContract": BRUSH_V3_CONTRACT,
            "sensorContract": SENSOR_CONTEXT_CONTRACT,
            "optionBindingsContract": BRUSH_OPTION_BINDINGS_CONTRACT,
            "mappingContract": DYNAMICS_MAPPING_CONTRACT,
            "stampCount": len(stamps),
            "mappingOutputs": sorted(str(key) for key in mappings.keys()),
            "mappingInputs": list(canonical_sensor_names()),
        }

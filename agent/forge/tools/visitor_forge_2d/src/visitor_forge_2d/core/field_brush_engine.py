"""A7 Field Brush Engine V1.

Places Brush Engine V3 tips using scalar/directional fields instead of broad
ellipse-only sampling. Field values are also exposed through SensorContext so
existing curve mappings can react to density, depth, direction and distance.
"""
from __future__ import annotations

import math
import random
from typing import Mapping, Sequence

from PIL import Image

from .brush_engine_v3 import BRUSH_V3_CONTRACT, BrushEngineV3, DynamicBrushStamp
from .brush_option_bindings import BRUSH_OPTION_BINDINGS_CONTRACT, BrushOptionBindings
from .field_engine import FIELD_ENGINE_CONTRACT, sample_direction_deg, sample_scalar
from .mapped_brush_engine import MAPPED_BRUSH_CONTRACT, MappedBrushEngineV1
from .sensor_context import SENSOR_CONTEXT_CONTRACT, SensorContext

FIELD_BRUSH_CONTRACT = "A7_FIELD_BRUSH_ENGINE_V1"


class FieldBrushEngineV1:
    contract = FIELD_BRUSH_CONTRACT

    def __init__(self, seed: int = 1):
        self.seed = int(seed)
        self.rng = random.Random(self.seed)
        self.brush = BrushEngineV3(self.seed + 104729)

    def scatter(
        self,
        canvas: Image.Image,
        brushes: Sequence[str],
        count: int,
        *,
        density_field: Image.Image,
        avoid_field: Image.Image | None = None,
        depth_field: Image.Image | None = None,
        direction_field: Image.Image | None = None,
        distance_field: Image.Image | None = None,
        bounds: Sequence[float] | None = None,
        min_distance: float = 0.0,
        mappings: Mapping[str, Mapping] | None = None,
        dynamics: Mapping | None = None,
        max_attempts: int | None = None,
    ) -> tuple[list[DynamicBrushStamp], dict]:
        if canvas.mode != "RGBA":
            raise ValueError("field brush canvas must be RGBA")
        if not brushes:
            raise ValueError("field scatter requires at least one brush")
        if density_field.size != canvas.size:
            raise ValueError("density field must match canvas size")
        for field in (avoid_field, depth_field, direction_field, distance_field):
            if field is not None and field.size != canvas.size:
                raise ValueError("all fields must match canvas size")

        count = int(count)
        if count < 0:
            raise ValueError("field scatter count cannot be negative")
        if count == 0:
            return [], self._stats(0, 0, 0.0, mappings or {})

        if bounds is None:
            x0, y0, x1, y1 = 0.0, 0.0, float(canvas.width - 1), float(canvas.height - 1)
        else:
            if len(bounds) != 4:
                raise ValueError("field scatter bounds must be [x0,y0,x1,y1]")
            x0, y0, x1, y1 = map(float, bounds)
            if x1 <= x0 or y1 <= y0:
                raise ValueError("field scatter bounds must have positive area")

        minimum = max(0.0, float(min_distance))
        cell_size = max(1.0, minimum)
        grid: dict[tuple[int, int], list[tuple[float, float]]] = {}
        attempts_limit = int(max_attempts) if max_attempts is not None else max(256, count * 120)
        if attempts_limit <= 0:
            raise ValueError("field scatter max_attempts must be positive")
        dynamics = dict(dynamics or {})
        bindings = BrushOptionBindings(mappings or {})
        stamps: list[DynamicBrushStamp] = []
        attempts = 0

        cx, cy = (x0 + x1) * 0.5, (y0 + y1) * 0.5
        max_radial = max(1e-6, math.hypot((x1 - x0) * 0.5, (y1 - y0) * 0.5))

        def can_place(x: float, y: float) -> bool:
            if minimum <= 0.0:
                return True
            gx, gy = math.floor(x / cell_size), math.floor(y / cell_size)
            for ix in range(gx - 1, gx + 2):
                for iy in range(gy - 1, gy + 2):
                    for px, py in grid.get((ix, iy), ()): 
                        if math.hypot(x - px, y - py) < minimum:
                            return False
            return True

        def register(x: float, y: float) -> None:
            key = (math.floor(x / cell_size), math.floor(y / cell_size))
            grid.setdefault(key, []).append((x, y))

        while len(stamps) < count and attempts < attempts_limit:
            attempts += 1
            x = self.rng.uniform(x0, x1)
            y = self.rng.uniform(y0, y1)
            density = sample_scalar(density_field, x, y, 0.0)
            avoid = sample_scalar(avoid_field, x, y, 0.0)
            acceptance = max(0.0, min(1.0, density * (1.0 - avoid)))
            if acceptance <= 0.0 or self.rng.random() > acceptance or not can_place(x, y):
                continue

            depth = sample_scalar(depth_field, x, y, 0.0)
            distance = sample_scalar(distance_field, x, y, 0.0)
            direction = sample_direction_deg(direction_field, x, y, 0.0)
            radial = min(1.0, math.hypot(x - cx, y - cy) / max_radial)
            sensors = SensorContext.scatter(
                index=len(stamps),
                count=count,
                random_value=self.rng.random(),
                direction_deg=direction,
                radial=radial,
                x=x,
                y=y,
                canvas_width=canvas.width,
                canvas_height=canvas.height,
                depth=depth,
                density=density,
                extra={"avoid": avoid, "field_distance": distance},
            ).with_values(distance=distance, distance_norm=distance)

            brush_name = self.rng.choice(tuple(brushes))
            base = self.brush.random_stamp(x, y, base_rotation_deg=direction, **dynamics)
            stamp = MappedBrushEngineV1.apply_option_values(base, bindings.evaluate(sensors))
            # Dynamics can move a candidate after its field/spacing test. Enforce
            # the authored region on the final center, not the pre-mapping point.
            if not math.isfinite(stamp.x) or not math.isfinite(stamp.y):
                raise ValueError("mapped brush coordinates must be finite")
            if (not x0 <= stamp.x <= x1 or not y0 <= stamp.y <= y1 or
                    not 0 <= stamp.x < canvas.width or not 0 <= stamp.y < canvas.height or
                    sample_scalar(density_field, stamp.x, stamp.y, 0.0) <= 0 or
                    sample_scalar(avoid_field, stamp.x, stamp.y, 0.0) >= 1 or
                    not can_place(stamp.x, stamp.y)):
                continue
            self.brush.stamp(canvas, brush_name, stamp)
            stamps.append(stamp)
            register(stamp.x, stamp.y)

        stats = self._stats(len(stamps), attempts, minimum, mappings or {})
        stats["requested"] = count
        stats["saturated"] = len(stamps) < count
        stats["fields"] = {
            "density": True,
            "avoid": avoid_field is not None,
            "depth": depth_field is not None,
            "direction": direction_field is not None,
            "distance": distance_field is not None,
        }
        return stamps, stats

    @staticmethod
    def _stats(placed: int, attempts: int, min_distance: float, mappings: Mapping) -> dict:
        return {
            "contract": FIELD_BRUSH_CONTRACT,
            "fieldContract": FIELD_ENGINE_CONTRACT,
            "brushContract": BRUSH_V3_CONTRACT,
            "mappedBrushContract": MAPPED_BRUSH_CONTRACT,
            "sensorContract": SENSOR_CONTEXT_CONTRACT,
            "optionBindingsContract": BRUSH_OPTION_BINDINGS_CONTRACT,
            "placed": int(placed),
            "attempts": int(attempts),
            "minDistance": float(min_distance),
            "mappingOutputs": sorted(str(key) for key in mappings.keys()),
        }

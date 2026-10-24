"""A7 Field Cluster Engine V1.

Combines Field Engine placement with hierarchical Cluster Engine rendering.
Fields decide where/which way a macro group grows; the cluster describes its
internal leaf/twig structure.
"""
from __future__ import annotations

import math
import random
from typing import Mapping, Sequence

from PIL import Image

from .brush_option_bindings import BrushOptionBindings
from .cluster_engine import CLUSTER_CONTRACT, ClusterEngineV1
from .field_engine import FIELD_ENGINE_CONTRACT, sample_direction_deg, sample_scalar
from .sensor_context import SENSOR_CONTEXT_CONTRACT, SensorContext

FIELD_CLUSTER_CONTRACT = "A7_FIELD_CLUSTER_ENGINE_V1"


def _pair(value: Sequence[float] | float, default: float = 1.0) -> tuple[float, float]:
    if isinstance(value, (int, float)):
        return float(value), float(value)
    if len(value) != 2:
        return default, default
    return float(value[0]), float(value[1])


class FieldClusterEngineV1:
    contract = FIELD_CLUSTER_CONTRACT

    def __init__(self, seed: int = 1):
        self.seed = int(seed)
        self.rng = random.Random(self.seed)
        self.cluster = ClusterEngineV1(self.seed + 104729)

    def scatter(
        self,
        canvas: Image.Image,
        cluster: dict,
        count: int,
        *,
        density_field: Image.Image,
        avoid_field: Image.Image | None = None,
        depth_field: Image.Image | None = None,
        direction_field: Image.Image | None = None,
        distance_field: Image.Image | None = None,
        bounds: Sequence[float] | None = None,
        min_distance: float = 0.0,
        scale: Sequence[float] = (1.0, 1.0),
        rotation_deg: Sequence[float] = (-15.0, 15.0),
        mirror_x_probability: float = 0.5,
        mappings: Mapping[str, Mapping] | None = None,
        max_attempts: int | None = None,
    ) -> dict:
        if canvas.mode != "RGBA":
            raise ValueError("field cluster canvas must be RGBA")
        self.cluster._validate_cluster(cluster)
        if density_field.size != canvas.size:
            raise ValueError("density field must match canvas size")
        for field in (avoid_field, depth_field, direction_field, distance_field):
            if field is not None and field.size != canvas.size:
                raise ValueError("all fields must match canvas size")

        count = int(count)
        if count < 0:
            raise ValueError("field cluster count cannot be negative")
        if bounds is None:
            x0, y0, x1, y1 = 0.0, 0.0, float(canvas.width - 1), float(canvas.height - 1)
        else:
            if len(bounds) != 4:
                raise ValueError("field cluster bounds must be [x0,y0,x1,y1]")
            x0, y0, x1, y1 = map(float, bounds)
        if x1 <= x0 or y1 <= y0:
            raise ValueError("field cluster bounds must have positive area")

        minimum = max(0.0, float(min_distance))
        attempts_limit = int(max_attempts) if max_attempts is not None else max(256, count * 180)
        cell_size = max(1.0, minimum)
        grid: dict[tuple[int, int], list[tuple[float, float]]] = {}
        scale_range = _pair(scale)
        rotation_range = _pair(rotation_deg, 0.0)
        bindings = BrushOptionBindings(mappings or {})
        placed = 0
        attempts = 0
        total_leaf = 0
        total_nodes = 0
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

        while placed < count and attempts < attempts_limit:
            attempts += 1
            x, y = self.rng.uniform(x0, x1), self.rng.uniform(y0, y1)
            density = sample_scalar(density_field, x, y, 0.0)
            avoid = sample_scalar(avoid_field, x, y, 0.0)
            if self.rng.random() > max(0.0, min(1.0, density * (1.0 - avoid))):
                continue
            if not can_place(x, y):
                continue

            depth = sample_scalar(depth_field, x, y, 0.0)
            distance = sample_scalar(distance_field, x, y, 0.0)
            direction = sample_direction_deg(direction_field, x, y, 0.0)
            radial = min(1.0, math.hypot(x - cx, y - cy) / max_radial)
            sensors = SensorContext.scatter(
                index=placed,
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
            options = bindings.evaluate(sensors)
            parent_scale = max(0.05, self.rng.uniform(*scale_range) * options["scale_mul"])
            parent_rotation = direction + self.rng.uniform(*rotation_range) + options["rotation_add_deg"]
            parent_mirror = self.rng.random() < max(0.0, min(1.0, float(mirror_x_probability)))
            stats = self.cluster.stamp_cluster(
                canvas,
                cluster,
                x,
                y,
                scale=parent_scale,
                rotation_deg=parent_rotation,
                mirror_x=parent_mirror,
            )
            total_leaf += int(stats["leafStampCount"])
            total_nodes += int(stats["clusterNodeCount"])
            key = (math.floor(x / cell_size), math.floor(y / cell_size))
            grid.setdefault(key, []).append((x, y))
            placed += 1

        return {
            "contract": FIELD_CLUSTER_CONTRACT,
            "fieldContract": FIELD_ENGINE_CONTRACT,
            "clusterContract": CLUSTER_CONTRACT,
            "sensorContract": SENSOR_CONTEXT_CONTRACT,
            "requestedClusters": count,
            "clusterCount": placed,
            "leafStampCount": total_leaf,
            "clusterNodeCount": total_nodes,
            "attempts": attempts,
            "minDistance": minimum,
            "saturated": placed < count,
            "hierarchical": True,
            "fieldConditioned": True,
            "mappingOutputs": sorted(str(key) for key in (mappings or {}).keys()),
        }

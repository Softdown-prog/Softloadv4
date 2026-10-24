"""A7 Distribution Engine V1.

Deterministic spatial distribution primitives for 2D game asset authoring.

The first distribution is minimum-distance scatter.  It prevents the common
failure mode where hundreds of independent stamps collapse into noisy moss or
paint because their centers are allowed to pile up arbitrarily.
"""
from __future__ import annotations

import math
import random
from typing import Sequence

from PIL import Image

from .brush_engine_v2 import BrushEngineV2, BrushStamp

DISTRIBUTION_CONTRACT = "A7_DISTRIBUTION_ENGINE_V1"


def _clamp(value: float, lo: float, hi: float) -> float:
    return max(lo, min(hi, value))


class DistributionEngineV1:
    contract = DISTRIBUTION_CONTRACT

    def __init__(self, seed: int = 1):
        self.seed = int(seed)
        self.rng = random.Random(self.seed)

    @staticmethod
    def _validate_regions(regions: Sequence[dict]) -> list[float]:
        if not regions:
            raise ValueError("distribution requires at least one region")
        weights: list[float] = []
        for region in regions:
            center, radius = region.get("center"), region.get("radius")
            if (not isinstance(center, Sequence) or len(center) != 2 or
                not isinstance(radius, Sequence) or len(radius) != 2):
                raise ValueError("distribution region needs center[x,y] and radius[rx,ry]")
            if float(radius[0]) <= 0 or float(radius[1]) <= 0:
                raise ValueError("distribution radii must be positive")
            weights.append(max(0.0, float(region.get("weight", 1.0))))
        if sum(weights) <= 0.0:
            raise ValueError("distribution region weights must sum above zero")
        return weights

    def sample_spaced(self, regions: Sequence[dict], count: int, *, min_distance: float,
                      max_attempts: int | None = None) -> tuple[list[tuple[float, float]], int]:
        """Return deterministic points with a minimum center-to-center distance."""
        count = int(count)
        if count < 0:
            raise ValueError("distribution count cannot be negative")
        if count == 0:
            return [], 0
        min_distance = max(0.0, float(min_distance))
        weights = self._validate_regions(regions)
        attempts_limit = int(max_attempts) if max_attempts is not None else max(128, count * 80)
        if attempts_limit <= 0:
            raise ValueError("max_attempts must be positive")

        points: list[tuple[float, float]] = []
        attempts = 0
        # Spatial hash keeps distance tests cheap even when recipes request
        # hundreds of candidates.  One cell is one minimum-distance unit.
        cell_size = max(1.0, min_distance)
        grid: dict[tuple[int, int], list[tuple[float, float]]] = {}

        def can_place(x: float, y: float) -> bool:
            if min_distance <= 0.0:
                return True
            cx, cy = math.floor(x / cell_size), math.floor(y / cell_size)
            for gx in range(cx - 1, cx + 2):
                for gy in range(cy - 1, cy + 2):
                    for px, py in grid.get((gx, gy), ()):  # local neighbors only
                        if math.hypot(x - px, y - py) < min_distance:
                            return False
            return True

        def register(x: float, y: float) -> None:
            points.append((x, y))
            key = (math.floor(x / cell_size), math.floor(y / cell_size))
            grid.setdefault(key, []).append((x, y))

        while len(points) < count and attempts < attempts_limit:
            attempts += 1
            region = self.rng.choices(regions, weights=weights, k=1)[0]
            center, radius = region["center"], region["radius"]
            angle = self.rng.random() * math.tau
            distance = math.sqrt(self.rng.random())
            x = float(center[0]) + math.cos(angle) * float(radius[0]) * distance
            y = float(center[1]) + math.sin(angle) * float(radius[1]) * distance
            if can_place(x, y):
                register(x, y)

        return points, attempts

    def scatter_spaced(self, canvas: Image.Image, brushes: Sequence[str], regions: Sequence[dict], count: int,
                       *, min_distance: float, scale: Sequence[float] = (1.0, 1.0),
                       rotation_deg: Sequence[float] = (0.0, 360.0), opacity: Sequence[int] = (255, 255),
                       tints: Sequence[str] = ("#FFFFFF",), max_attempts: int | None = None) -> tuple[list[BrushStamp], dict]:
        if canvas.mode != "RGBA":
            raise ValueError("Distribution Engine V1 canvas must be RGBA")
        if not brushes:
            raise ValueError("spaced scatter requires at least one brush")
        if not tints:
            raise ValueError("spaced scatter requires at least one tint")
        points, attempts = self.sample_spaced(
            regions, count, min_distance=min_distance, max_attempts=max_attempts,
        )
        brush_engine = BrushEngineV2(self.seed + 7919)
        stamps: list[BrushStamp] = []
        for x, y in points:
            stamp = BrushStamp(
                x=x,
                y=y,
                scale=self.rng.uniform(float(scale[0]), float(scale[1])),
                rotation_deg=self.rng.uniform(float(rotation_deg[0]), float(rotation_deg[1])),
                opacity=round(self.rng.uniform(float(opacity[0]), float(opacity[1]))),
                tint=self.rng.choice(tuple(tints)),
            )
            brush_engine.stamp(canvas, self.rng.choice(tuple(brushes)), stamp)
            stamps.append(stamp)
        stats = {
            "contract": DISTRIBUTION_CONTRACT,
            "requested": int(count),
            "placed": len(stamps),
            "attempts": attempts,
            "minDistance": float(min_distance),
            "saturated": len(stamps) < int(count),
        }
        return stamps, stats

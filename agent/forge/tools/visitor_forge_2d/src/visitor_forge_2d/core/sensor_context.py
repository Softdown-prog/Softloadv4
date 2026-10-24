"""A7 Sensor Context V1.

Independent runtime/authored signals for the Draw Engine.

Architecture note
-----------------
The separation between *sensor/input* and *brush option* is inspired by the
architecture observed in KDE Krita's dynamic-sensor system. Krita is GPL and
is treated as reference-only: this module is an independent A7 implementation
and contains no copied Krita code.

The context is deliberately generic so the same signals can later drive
brushes, clusters, fields, masks, lighting and image-processing nodes.
"""
from __future__ import annotations

from dataclasses import dataclass
import math
from typing import Mapping

SENSOR_CONTEXT_CONTRACT = "A7_SENSOR_CONTEXT_V1"

_CANONICAL = {
    "stroke",
    "index",
    "random",
    "direction",
    "direction_01",
    "radial",
    "x",
    "y",
    "x_norm",
    "y_norm",
    "region",
    "distance",
    "distance_norm",
    "pressure",
    "speed",
    "depth",
    "density",
}


def _finite(name: str, value: float) -> float:
    number = float(value)
    if not math.isfinite(number):
        raise ValueError(f"sensor {name} must be finite")
    return number


def _unit(value: float) -> float:
    return max(0.0, min(1.0, float(value)))


@dataclass(frozen=True)
class SensorContext:
    """Immutable named sensor values for one authored sample/dab."""

    values: Mapping[str, float]

    def __post_init__(self) -> None:
        normalized: dict[str, float] = {}
        for raw_name, raw_value in self.values.items():
            name = str(raw_name).strip()
            if not name:
                raise ValueError("sensor names cannot be empty")
            normalized[name] = _finite(name, raw_value)
        object.__setattr__(self, "values", normalized)

    def get(self, name: str, default: float = 0.0) -> float:
        return float(self.values.get(name, default))

    def as_dict(self) -> dict[str, float]:
        return dict(self.values)

    def with_values(self, **extra: float) -> "SensorContext":
        values = self.as_dict()
        values.update({str(key): float(value) for key, value in extra.items()})
        return SensorContext(values)

    @classmethod
    def scatter(
        cls,
        *,
        index: int,
        count: int,
        random_value: float,
        direction_deg: float,
        radial: float,
        x: float,
        y: float,
        canvas_width: float,
        canvas_height: float,
        region: int = 0,
        pressure: float = 1.0,
        speed: float = 0.0,
        depth: float = 0.0,
        density: float = 1.0,
        extra: Mapping[str, float] | None = None,
    ) -> "SensorContext":
        count = max(0, int(count))
        index = int(index)
        width = max(1.0, float(canvas_width))
        height = max(1.0, float(canvas_height))
        direction = float(direction_deg) % 360.0
        values = {
            "stroke": 0.0 if count <= 1 else _unit(index / (count - 1)),
            "index": float(index),
            "random": _unit(random_value),
            "direction": direction,
            "direction_01": direction / 360.0,
            "radial": _unit(radial),
            "x": float(x),
            "y": float(y),
            "x_norm": _unit(float(x) / width),
            "y_norm": _unit(float(y) / height),
            "region": float(region),
            "distance": 0.0,
            "distance_norm": 0.0,
            "pressure": max(0.0, float(pressure)),
            "speed": max(0.0, float(speed)),
            "depth": float(depth),
            "density": max(0.0, float(density)),
        }
        if extra:
            values.update({str(key): float(value) for key, value in extra.items()})
        return cls(values)

    @classmethod
    def path(
        cls,
        *,
        index: int,
        count: int,
        random_value: float,
        tangent_deg: float,
        distance: float,
        total_distance: float,
        x: float,
        y: float,
        canvas_width: float,
        canvas_height: float,
        pressure: float = 1.0,
        speed: float = 0.0,
        depth: float = 0.0,
        density: float = 1.0,
        extra: Mapping[str, float] | None = None,
    ) -> "SensorContext":
        total = max(0.0, float(total_distance))
        current = max(0.0, float(distance))
        base = cls.scatter(
            index=index,
            count=count,
            random_value=random_value,
            direction_deg=tangent_deg,
            radial=0.0,
            x=x,
            y=y,
            canvas_width=canvas_width,
            canvas_height=canvas_height,
            pressure=pressure,
            speed=speed,
            depth=depth,
            density=density,
            extra=extra,
        ).as_dict()
        base["distance"] = current
        base["distance_norm"] = 0.0 if total <= 1e-9 else _unit(current / total)
        return cls(base)


def canonical_sensor_names() -> tuple[str, ...]:
    return tuple(sorted(_CANONICAL))

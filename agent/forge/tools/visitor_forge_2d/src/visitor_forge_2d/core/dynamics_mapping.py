"""A7 Dynamics Mapping V1.

Piecewise-linear setting mappings adapted from libmypaint's mapping model.

Provenance
----------
The additive mapping model and interpolation behavior are adapted from
mypaint/libmypaint `mypaint-mapping.c` at commit
d5a88fbe6649d5ec776bc42ec8c1f4bb29d7fd7f.

Original work:
    libmypaint - The MyPaint Brush Library
    Copyright (C) 2007-2008 Martin Renold <martinxyz@gmx.ch>

libmypaint is distributed under the ISC license. The full notice used by A7 is
stored in `tools/visitor_forge_2d/third_party/libmypaint/NOTICE.txt`.

A7-specific additions include dictionary-based input naming, JSON-friendly
specs, validation, batch evaluation and deterministic asset-authoring inputs.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Mapping, Sequence

DYNAMICS_MAPPING_CONTRACT = "A7_DYNAMICS_MAPPING_V1"
MAX_CONTROL_POINTS = 64


def _points_from_spec(points: Sequence[Sequence[float]]) -> tuple[tuple[float, float], ...]:
    if not isinstance(points, Sequence):
        raise ValueError("mapping control points must be a sequence")
    if len(points) == 1:
        raise ValueError("a mapping curve needs zero or at least two control points")
    if len(points) > MAX_CONTROL_POINTS:
        raise ValueError(f"a mapping curve supports at most {MAX_CONTROL_POINTS} control points")

    normalized: list[tuple[float, float]] = []
    previous_x: float | None = None
    for raw in points:
        if not isinstance(raw, Sequence) or len(raw) != 2:
            raise ValueError("mapping control points must be [x, y] pairs")
        x, y = float(raw[0]), float(raw[1])
        if previous_x is not None and x < previous_x:
            raise ValueError("mapping control point x values must be non-decreasing")
        previous_x = x
        normalized.append((x, y))
    return tuple(normalized)


@dataclass(frozen=True)
class MappingCurve:
    """One piecewise-linear input curve."""

    points: tuple[tuple[float, float], ...]

    @classmethod
    def from_spec(cls, points: Sequence[Sequence[float]]) -> "MappingCurve":
        return cls(_points_from_spec(points))

    def evaluate(self, value: float) -> float:
        """Match libmypaint's stepwise-linear interpolation/extrapolation."""

        if not self.points:
            return 0.0
        if len(self.points) < 2:
            raise ValueError("mapping curve is invalid")

        x = float(value)
        x0, y0 = self.points[0]
        x1, y1 = self.points[1]

        index = 2
        while index < len(self.points) and x > x1:
            x0, y0 = x1, y1
            x1, y1 = self.points[index]
            index += 1

        if x0 == x1 or y0 == y1:
            return y0
        return (y1 * (x - x0) + y0 * (x1 - x)) / (x1 - x0)


@dataclass(frozen=True)
class DynamicsMapping:
    """Base value plus additive input curves, following libmypaint's model."""

    base_value: float
    curves: Mapping[str, MappingCurve]

    @classmethod
    def from_spec(cls, spec: Mapping) -> "DynamicsMapping":
        if not isinstance(spec, Mapping):
            raise ValueError("mapping spec must be an object")
        raw_inputs = spec.get("inputs", {})
        if not isinstance(raw_inputs, Mapping):
            raise ValueError("mapping spec inputs must be an object")

        curves: dict[str, MappingCurve] = {}
        for input_name, points in raw_inputs.items():
            name = str(input_name)
            if not name:
                raise ValueError("mapping input names cannot be empty")
            curves[name] = MappingCurve.from_spec(points)

        return cls(base_value=float(spec.get("base", 0.0)), curves=curves)

    def evaluate(self, inputs: Mapping[str, float]) -> float:
        result = self.base_value
        for input_name, curve in self.curves.items():
            result += curve.evaluate(float(inputs.get(input_name, 0.0)))
        return result


def evaluate_mapping(spec: Mapping, inputs: Mapping[str, float]) -> float:
    return DynamicsMapping.from_spec(spec).evaluate(inputs)


def evaluate_mapping_set(
    mappings: Mapping[str, Mapping],
    inputs: Mapping[str, float],
) -> dict[str, float]:
    """Evaluate several output parameters against the same input context."""

    if not isinstance(mappings, Mapping):
        raise ValueError("mapping set must be an object")
    return {
        str(output_name): evaluate_mapping(spec, inputs)
        for output_name, spec in mappings.items()
    }

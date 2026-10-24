"""A7 Dab Density V1.

Radius-aware spatial dab density adapted from libmypaint's motion-density model.

Provenance
----------
The spatial density formula is adapted from `mypaint-brush.c` in
mypaint/libmypaint at commit d5a88fbe6649d5ec776bc42ec8c1f4bb29d7fd7f.
libmypaint is ISC licensed; the retained notice is stored at
`tools/visitor_forge_2d/third_party/libmypaint/NOTICE.txt`.

MyPaint combines contributions from actual-radius density, base-radius density
and time density. A7 exposes the same decomposition, while deterministic asset
authoring commonly uses only the two spatial terms.
"""
from __future__ import annotations

import math

DAB_DENSITY_CONTRACT = "A7_DAB_DENSITY_V1"


def _non_negative(value: float) -> float:
    value = float(value)
    if not math.isfinite(value):
        raise ValueError("dab density values must be finite")
    return max(0.0, value)


def dabs_for_motion(
    distance: float,
    *,
    actual_radius: float,
    base_radius: float,
    dabs_per_actual_radius: float = 0.0,
    dabs_per_basic_radius: float = 0.0,
    delta_time: float = 0.0,
    dabs_per_second: float = 0.0,
) -> float:
    """Return the fractional number of dabs accumulated by one motion step.

    Equivalent to the spatial/time density decomposition used by libmypaint:
    distance / actual_radius * actual_density
    + distance / base_radius * base_density
    + delta_time * time_density.
    """

    distance = _non_negative(distance)
    actual_radius = float(actual_radius)
    base_radius = float(base_radius)
    if not math.isfinite(actual_radius) or actual_radius <= 0.0:
        raise ValueError("actual_radius must be finite and above zero")
    if not math.isfinite(base_radius) or base_radius <= 0.0:
        raise ValueError("base_radius must be finite and above zero")

    actual_density = _non_negative(dabs_per_actual_radius)
    basic_density = _non_negative(dabs_per_basic_radius)
    time_density = _non_negative(dabs_per_second)
    delta_time = _non_negative(delta_time)

    return (
        distance / actual_radius * actual_density
        + distance / base_radius * basic_density
        + delta_time * time_density
    )


def spatial_dabs_per_pixel(
    *,
    actual_radius: float,
    base_radius: float,
    dabs_per_actual_radius: float = 0.0,
    dabs_per_basic_radius: float = 0.0,
) -> float:
    """Return spatial dab density per authored pixel."""

    return dabs_for_motion(
        1.0,
        actual_radius=actual_radius,
        base_radius=base_radius,
        dabs_per_actual_radius=dabs_per_actual_radius,
        dabs_per_basic_radius=dabs_per_basic_radius,
    )


def spacing_from_density(
    *,
    actual_radius: float,
    base_radius: float,
    dabs_per_actual_radius: float = 0.0,
    dabs_per_basic_radius: float = 0.0,
    fallback_spacing: float = 8.0,
    minimum_spacing: float = 0.5,
) -> float:
    """Convert MyPaint-style spatial density into distance between dabs.

    If both spatial density terms are zero, A7 deliberately falls back to the
    legacy explicit spacing so existing recipes keep their behavior.
    """

    density = spatial_dabs_per_pixel(
        actual_radius=actual_radius,
        base_radius=base_radius,
        dabs_per_actual_radius=dabs_per_actual_radius,
        dabs_per_basic_radius=dabs_per_basic_radius,
    )
    minimum_spacing = max(0.01, _non_negative(minimum_spacing))
    if density <= 1e-12:
        return max(minimum_spacing, _non_negative(fallback_spacing))
    return max(minimum_spacing, 1.0 / density)

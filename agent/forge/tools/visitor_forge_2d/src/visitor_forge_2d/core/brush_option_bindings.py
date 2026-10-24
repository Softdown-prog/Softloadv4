"""A7 Brush Option Bindings V1.

Maps generic sensor contexts through A7 dynamics curves into semantic brush
options. This keeps input/sensor production separate from option behavior.

Krita's sensor/option separation is an architectural reference only. Krita is
GPL and no Krita implementation code is copied here.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Mapping

from .dynamics_mapping import DYNAMICS_MAPPING_CONTRACT, evaluate_mapping_set
from .sensor_context import SENSOR_CONTEXT_CONTRACT, SensorContext

BRUSH_OPTION_BINDINGS_CONTRACT = "A7_BRUSH_OPTION_BINDINGS_V1"

SUPPORTED_OPTIONS = {
    "scale_mul",
    "aspect_mul",
    "offset_x",
    "offset_y",
    "rotation_add_deg",
    "opacity_mul",
    "hue_add_deg",
    "saturation_mul",
    "value_mul",
}

_DEFAULTS = {
    "scale_mul": 1.0,
    "aspect_mul": 1.0,
    "offset_x": 0.0,
    "offset_y": 0.0,
    "rotation_add_deg": 0.0,
    "opacity_mul": 1.0,
    "hue_add_deg": 0.0,
    "saturation_mul": 1.0,
    "value_mul": 1.0,
}


@dataclass(frozen=True)
class BrushOptionBindings:
    mappings: Mapping[str, Mapping]

    def __post_init__(self) -> None:
        unknown = sorted(set(map(str, self.mappings.keys())) - SUPPORTED_OPTIONS)
        if unknown:
            raise ValueError(f"unsupported brush option mappings: {', '.join(unknown)}")

    def evaluate(self, sensors: SensorContext | Mapping[str, float]) -> dict[str, float]:
        context = sensors.as_dict() if isinstance(sensors, SensorContext) else dict(sensors)
        mapped = evaluate_mapping_set(self.mappings, context) if self.mappings else {}
        values = dict(_DEFAULTS)
        values.update({str(key): float(value) for key, value in mapped.items()})

        values["scale_mul"] = max(0.05, values["scale_mul"])
        values["aspect_mul"] = max(0.1, values["aspect_mul"])
        values["opacity_mul"] = max(0.0, values["opacity_mul"])
        values["saturation_mul"] = max(0.0, values["saturation_mul"])
        values["value_mul"] = max(0.0, values["value_mul"])
        return values

    @property
    def contract(self) -> str:
        return BRUSH_OPTION_BINDINGS_CONTRACT

    @property
    def mapping_contract(self) -> str:
        return DYNAMICS_MAPPING_CONTRACT

    @property
    def sensor_contract(self) -> str:
        return SENSOR_CONTEXT_CONTRACT

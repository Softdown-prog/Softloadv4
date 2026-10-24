from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Mapping


@dataclass(frozen=True)
class Vec2:
    x: float
    y: float

    @classmethod
    def from_value(cls, value: Any) -> "Vec2":
        if isinstance(value, cls):
            return value
        if not isinstance(value, (list, tuple)) or len(value) != 2:
            raise ValueError(f"Expected [x, y], got {value!r}")
        return cls(float(value[0]), float(value[1]))

    def as_list(self) -> list[float]:
        return [self.x, self.y]


@dataclass(frozen=True)
class CanvasSpec:
    working_size: tuple[int, int]
    output_size: tuple[int, int]
    anchor: Vec2

    @classmethod
    def from_dict(cls, data: Mapping[str, Any]) -> "CanvasSpec":
        working = tuple(int(v) for v in data["workingSize"])
        output = tuple(int(v) for v in data["outputSize"])
        if len(working) != 2 or len(output) != 2:
            raise ValueError("workingSize/outputSize must contain two integers")
        if min(*working, *output) <= 0:
            raise ValueError("Canvas dimensions must be positive")
        return cls(working, output, Vec2.from_value(data["anchor"]))


@dataclass(frozen=True)
class JointSpec:
    joint_id: str
    position: Vec2
    parent: str | None = None

    @classmethod
    def from_dict(cls, data: Mapping[str, Any]) -> "JointSpec":
        return cls(
            joint_id=str(data["id"]),
            position=Vec2.from_value(data["position"]),
            parent=str(data["parent"]) if data.get("parent") else None,
        )


@dataclass(frozen=True)
class JointTransform:
    rotation_degrees: float = 0.0
    translation: Vec2 = Vec2(0.0, 0.0)
    scale: Vec2 = Vec2(1.0, 1.0)

    @classmethod
    def from_dict(cls, data: Mapping[str, Any] | None) -> "JointTransform":
        if not data:
            return cls()
        return cls(
            rotation_degrees=float(data.get("rotationDegrees", 0.0)),
            translation=Vec2.from_value(data.get("translation", [0.0, 0.0])),
            scale=Vec2.from_value(data.get("scale", [1.0, 1.0])),
        )


@dataclass(frozen=True)
class LayerSpec:
    layer_id: str
    source: str
    position: Vec2
    pivot: Vec2
    z_index: int = 0
    opacity: float = 1.0
    palette_slot: str | None = None
    visible: bool = True

    @classmethod
    def from_dict(cls, data: Mapping[str, Any]) -> "LayerSpec":
        opacity = float(data.get("opacity", 1.0))
        if not 0.0 <= opacity <= 1.0:
            raise ValueError(f"Layer opacity out of range: {opacity}")
        return cls(
            layer_id=str(data["id"]),
            source=str(data["source"]),
            position=Vec2.from_value(data["position"]),
            pivot=Vec2.from_value(data["pivot"]),
            z_index=int(data.get("zIndex", 0)),
            opacity=opacity,
            palette_slot=str(data["paletteSlot"]) if data.get("paletteSlot") else None,
            visible=bool(data.get("visible", True)),
        )


@dataclass(frozen=True)
class PartSpec:
    part_id: str
    layer_id: str
    joint_id: str | None = None

    @classmethod
    def from_dict(cls, data: Mapping[str, Any]) -> "PartSpec":
        return cls(
            part_id=str(data["id"]),
            layer_id=str(data["layer"]),
            joint_id=str(data["joint"]) if data.get("joint") else None,
        )


@dataclass(frozen=True)
class PoseSpec:
    pose_id: str
    direction: str
    frame_duration_ms: int
    joints: dict[str, JointTransform] = field(default_factory=dict)

    @classmethod
    def from_dict(cls, data: Mapping[str, Any]) -> "PoseSpec":
        duration = int(data.get("frameDurationMs", 220))
        if duration <= 0:
            raise ValueError("frameDurationMs must be > 0")
        joints = {
            str(name): JointTransform.from_dict(transform)
            for name, transform in dict(data.get("joints", {})).items()
        }
        return cls(
            pose_id=str(data["poseId"]),
            direction=str(data["direction"]).lower(),
            frame_duration_ms=duration,
            joints=joints,
        )


@dataclass(frozen=True)
class CharacterDefinition:
    character_id: str
    direction: str
    canvas: CanvasSpec
    joints: dict[str, JointSpec]
    layers: dict[str, LayerSpec]
    parts: tuple[PartSpec, ...]
    palette: dict[str, str] = field(default_factory=dict)
    forge_contract_version: str = "CH_VISITOR_FORGE_2D_V1"

    @classmethod
    def from_dict(cls, data: Mapping[str, Any]) -> "CharacterDefinition":
        joints = {j.joint_id: j for j in (JointSpec.from_dict(x) for x in data.get("joints", []))}
        layers = {l.layer_id: l for l in (LayerSpec.from_dict(x) for x in data.get("layers", []))}
        parts = tuple(PartSpec.from_dict(x) for x in data.get("parts", []))
        result = cls(
            character_id=str(data["characterId"]),
            direction=str(data["direction"]).lower(),
            canvas=CanvasSpec.from_dict(data["canvas"]),
            joints=joints,
            layers=layers,
            parts=parts,
            palette={str(k): str(v) for k, v in dict(data.get("palette", {})).items()},
            forge_contract_version=str(data.get("forgeContractVersion", "CH_VISITOR_FORGE_2D_V1")),
        )
        result.validate()
        return result

    def validate(self) -> None:
        if self.direction not in {"south", "east", "west", "north"}:
            raise ValueError(f"Unsupported direction: {self.direction}")

        for joint in self.joints.values():
            if joint.parent and joint.parent not in self.joints:
                raise ValueError(f"Joint {joint.joint_id} references missing parent {joint.parent}")

        for part in self.parts:
            if part.layer_id not in self.layers:
                raise ValueError(f"Part {part.part_id} references missing layer {part.layer_id}")
            if part.joint_id and part.joint_id not in self.joints:
                raise ValueError(f"Part {part.part_id} references missing joint {part.joint_id}")

        visiting: set[str] = set()
        visited: set[str] = set()

        def visit(joint_id: str) -> None:
            if joint_id in visited:
                return
            if joint_id in visiting:
                raise ValueError(f"Joint cycle detected at {joint_id}")
            visiting.add(joint_id)
            parent = self.joints[joint_id].parent
            if parent:
                visit(parent)
            visiting.remove(joint_id)
            visited.add(joint_id)

        for joint_id in self.joints:
            visit(joint_id)

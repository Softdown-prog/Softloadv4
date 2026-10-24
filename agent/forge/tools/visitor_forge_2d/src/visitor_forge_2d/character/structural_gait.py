"""Joint-guided lower-body deformation for intact Visitor Forge masters.

This study keeps the approved raster identity intact above the pelvis while
using explicit hip -> knee -> ankle targets to shape each leg. It does not
synthesize hidden anatomy and it is not a runtime animation system.
"""

from __future__ import annotations

import hashlib
import json
from math import hypot, tanh
from pathlib import Path
from typing import Mapping, Sequence

from PIL import Image, ImageDraw

from .concept_rig import concept_ground_shadow
from .identity_lock import assert_identity_lock
from .review import frame_measurements
from ..core.exporter import alpha_safe_resize


STRUCTURAL_GAIT_CONTRACT = "CH_VISITOR_STRUCTURAL_GAIT_V1"
LEG_JOINTS = ("hip", "knee", "ankle")
LEGS = ("left", "right")
LOCKED_SOURCE_ROWS = 280


def _point(value: object, label: str) -> tuple[float, float]:
    if not isinstance(value, Sequence) or isinstance(value, (str, bytes)) or len(value) != 2:
        raise ValueError(f"{label} must be [x, y]")
    x, y = float(value[0]), float(value[1])
    if not (0.0 <= x <= 511.0 and 0.0 <= y <= 511.0):
        raise ValueError(f"{label} lies outside the 512px working canvas")
    return x, y


def _leg_points(data: Mapping[str, object], label: str) -> dict[str, tuple[float, float]]:
    if set(data) != set(LEG_JOINTS):
        raise ValueError(f"{label} must define hip, knee and ankle")
    return {joint: _point(data[joint], f"{label}/{joint}") for joint in LEG_JOINTS}


def _distance(a: tuple[float, float], b: tuple[float, float]) -> float:
    return hypot(b[0] - a[0], b[1] - a[1])


def validate_structural_pose(
    neutral: Mapping[str, Mapping[str, object]],
    target: Mapping[str, Mapping[str, object]],
) -> dict:
    """Reject implausible control targets before any raster deformation occurs."""
    if set(neutral) != set(LEGS) or set(target) != set(LEGS):
        raise ValueError("Structural gait requires left and right legs")

    report: dict[str, object] = {"contract": STRUCTURAL_GAIT_CONTRACT, "legs": {}}
    legs_report: dict[str, object] = report["legs"]  # type: ignore[assignment]
    for side in LEGS:
        base = _leg_points(neutral[side], f"neutral/{side}")
        posed = _leg_points(target[side], f"target/{side}")
        if not (base["hip"][1] < base["knee"][1] < base["ankle"][1]):
            raise ValueError(f"neutral/{side} joints must descend hip -> knee -> ankle")
        if posed["knee"][1] < posed["hip"][1] + 34 or posed["ankle"][1] < posed["knee"][1] + 32:
            raise ValueError(f"target/{side} folds the leg beyond the conservative V1 gate")

        deltas = {
            joint: (posed[joint][0] - base[joint][0], posed[joint][1] - base[joint][1])
            for joint in LEG_JOINTS
        }
        limits = {"hip": 3.0, "knee": 28.0, "ankle": 36.0}
        for joint in LEG_JOINTS:
            if hypot(*deltas[joint]) > limits[joint]:
                raise ValueError(f"target/{side}/{joint} exceeds {limits[joint]:.0f}px displacement")

        neutral_lengths = (
            _distance(base["hip"], base["knee"]),
            _distance(base["knee"], base["ankle"]),
        )
        target_lengths = (
            _distance(posed["hip"], posed["knee"]),
            _distance(posed["knee"], posed["ankle"]),
        )
        ratios = tuple(target_lengths[index] / neutral_lengths[index] for index in range(2))
        if any(ratio < 0.72 or ratio > 1.28 for ratio in ratios):
            raise ValueError(f"target/{side} changes a leg segment length beyond the V1 gate")

        legs_report[side] = {
            "neutral": {joint: list(base[joint]) for joint in LEG_JOINTS},
            "target": {joint: list(posed[joint]) for joint in LEG_JOINTS},
            "delta": {joint: [round(v, 3) for v in deltas[joint]] for joint in LEG_JOINTS},
            "segmentLengthRatios": [round(ratio, 4) for ratio in ratios],
        }
    return report


def _smoothstep(value: float) -> float:
    t = max(0.0, min(1.0, value))
    return t * t * (3.0 - 2.0 * t)


def _lerp(a: tuple[float, float], b: tuple[float, float], t: float) -> tuple[float, float]:
    return a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t


def _leg_delta(
    neutral: dict[str, tuple[float, float]],
    target: dict[str, tuple[float, float]],
    y: float,
) -> tuple[float, float]:
    delta = {joint: (target[joint][0] - neutral[joint][0], target[joint][1] - neutral[joint][1])
             for joint in LEG_JOINTS}
    hip_y, knee_y, ankle_y = (neutral[joint][1] for joint in LEG_JOINTS)
    if y <= hip_y:
        return (0.0, 0.0)
    if y < knee_y:
        return _lerp(delta["hip"], delta["knee"], _smoothstep((y - hip_y) / (knee_y - hip_y)))
    if y < ankle_y:
        return _lerp(delta["knee"], delta["ankle"], _smoothstep((y - knee_y) / (ankle_y - knee_y)))
    return delta["ankle"]


def warp_structural_master(
    master: Image.Image,
    neutral: Mapping[str, Mapping[str, object]],
    target: Mapping[str, Mapping[str, object]],
) -> tuple[Image.Image, dict]:
    """Warp only the lower body using explicit leg-joint targets."""
    if master.mode != "RGBA" or master.size != (512, 512):
        raise ValueError("A structural gait master must be 512x512 RGBA")
    validation = validate_structural_pose(neutral, target)
    base = {side: _leg_points(neutral[side], f"neutral/{side}") for side in LEGS}
    posed = {side: _leg_points(target[side], f"target/{side}") for side in LEGS}
    divider = (base["left"]["hip"][0] + base["right"]["hip"][0]) / 2.0

    def offset(x: float, y: float) -> tuple[float, float]:
        if y <= LOCKED_SOURCE_ROWS:
            return (0.0, 0.0)
        left_delta = _leg_delta(base["left"], posed["left"], y)
        right_delta = _leg_delta(base["right"], posed["right"], y)
        right_weight = (1.0 + tanh((x - divider) / 24.0)) / 2.0
        left_weight = 1.0 - right_weight
        return (
            left_weight * left_delta[0] + right_weight * right_delta[0],
            left_weight * left_delta[1] + right_weight * right_delta[1],
        )

    def inverse(x: int, y: int) -> tuple[float, float]:
        sx, sy = float(x), float(y)
        for _ in range(7):
            dx, dy = offset(sx, sy)
            sx, sy = x - dx, y - dy
        return sx, sy

    mesh = []
    for y in range(0, 512, 8):
        for x in range(0, 512, 8):
            x1, y1 = x + 8, y + 8
            corners = (inverse(x, y), inverse(x, y1), inverse(x1, y1), inverse(x1, y))
            mesh.append(((x, y, x1, y1), tuple(number for pair in corners for number in pair)))
    warped = master.convert("RGBa").transform(
        master.size, Image.Transform.MESH, mesh, resample=Image.Resampling.BICUBIC,
    ).convert("RGBA")
    # Identity-lock rows are copied verbatim after resampling. The gait is not
    # allowed to alter face, hair or torso merely because interpolation touched
    # a neighboring mesh cell.
    warped.paste(master.crop((0, 0, 512, LOCKED_SOURCE_ROWS)), (0, 0))
    return warped, validation


def render_structural_gait(tool_root: Path, recipe_path: Path, output: Path) -> dict:
    recipe = json.loads(recipe_path.read_text(encoding="utf-8"))
    if recipe.get("contract") != STRUCTURAL_GAIT_CONTRACT:
        raise ValueError(f"Expected {STRUCTURAL_GAIT_CONTRACT}")
    directions = recipe.get("directions")
    if not isinstance(directions, dict) or set(directions) != {"east", "north", "west"}:
        raise ValueError("Structural gait requires EAST, NORTH and WEST")

    output.mkdir(parents=True, exist_ok=True)
    root = tool_root / "art/concepts"
    panel = Image.new("RGBA", (4 * 105, 4 * 112), (77, 116, 51, 255))
    draw = ImageDraw.Draw(panel)
    report = {
        "contract": STRUCTURAL_GAIT_CONTRACT,
        "recipeSha256": hashlib.sha256(recipe_path.read_bytes()).hexdigest(),
        "anchor": [64, 116],
        "directions": {},
        "artApproved": False,
        "runtimePromotion": False,
    }

    for row, direction in enumerate(("east", "north", "west", "south")):
        if direction == "south":
            source = root / "south_front_candidate_v1"
            frames = [Image.open(source / f"south_{pose}.png").convert("RGBA")
                      for pose in ("idle", "walk_a", "walk_b")]
        else:
            direction_recipe = directions[direction]
            if not isinstance(direction_recipe, dict):
                raise ValueError(f"Invalid recipe for {direction}")
            neutral = direction_recipe.get("neutral")
            if not isinstance(neutral, dict):
                raise ValueError(f"{direction} requires neutral leg joints")
            master_path = root / f"visitor_male_01_{direction}_master.png"
            with Image.open(master_path) as source:
                master = source.convert("RGBA")
            with Image.open(root / "frames_preview" / f"{direction}_idle.png") as source:
                frames = [source.convert("RGBA")]
            structural: dict[str, object] = {}
            for pose in ("walk_a", "walk_b"):
                target = direction_recipe.get(pose)
                if not isinstance(target, dict):
                    raise ValueError(f"{direction}/{pose} requires structural joint targets")
                body, pose_validation = warp_structural_master(master, neutral, target)
                composed = Image.new("RGBA", (512, 512))
                composed.alpha_composite(concept_ground_shadow(), (200, 438))
                composed.alpha_composite(body)
                frame = alpha_safe_resize(composed, (128, 128))
                frame.save(output / f"{direction}_{pose}.png", format="PNG", optimize=False)
                frames.append(frame)
                structural[pose] = pose_validation
            identity_lock = assert_identity_lock(frames)
            report["directions"][direction] = {
                "masterSha256": hashlib.sha256(master_path.read_bytes()).hexdigest(),
                "measurements": frame_measurements(frames, (64, 116)),
                "identityLock": identity_lock,
                "structuralPose": structural,
            }
        for col, frame in enumerate(frames):
            panel.alpha_composite(frame.resize((74, 74), Image.Resampling.LANCZOS),
                                  (105 * col + 16, 112 * row + 8))
            draw.text((105 * col + 19, 112 * row + 87),
                      f"{direction} {('idle', 'A', 'B')[col]}", fill="white")

    panel_path = output / "four_direction_structural_gait_56px.png"
    panel.save(panel_path, format="PNG", optimize=False)
    report["reviewPanel"] = str(panel_path)
    (output / "review_metrics.json").write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    return report

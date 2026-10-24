"""Short 2-frame gait for intact directional concept masters.

Side-view cutout masks lack the hidden side of each trouser leg. Rotating
those masks exposes a straight seam, so this character-specific study warps
the *whole* source image smoothly below the waist instead. The face, shirt,
and contact shadow stay fixed. No unseen body art is synthesized.
"""

from __future__ import annotations

import hashlib
import json
from math import tanh
from pathlib import Path

from PIL import Image, ImageDraw

from .concept_rig import concept_ground_shadow
from .identity_lock import assert_identity_lock
from .review import frame_measurements
from ..core.exporter import alpha_safe_resize


LOCKED_MASTER_ROWS = 280
LEGACY_GAIT_CONTRACT = "CH_VISITOR_DIRECTIONAL_GAIT_STUDY_V1"
STRUCTURAL_GAIT_CONTRACT = "CH_VISITOR_STRUCTURAL_GAIT_V1"


def warp_intact_master(master: Image.Image, left: tuple[float, float],
                       right: tuple[float, float]) -> Image.Image:
    """Move the lower body with a continuous inverse mesh on a 512px master."""
    if master.mode != "RGBA" or master.size != (512, 512):
        raise ValueError("A directional gait master must be 512x512 RGBA")

    def offset(x: float, y: float) -> tuple[float, float]:
        t = max(0.0, min(1.0, (y - 281.0) / 183.0))
        weight = t * t * (3.0 - 2.0 * t)
        right_weight = (1.0 + tanh((x - 255.0) / 27.0)) / 2.0
        left_weight = 1.0 - right_weight
        return (weight * (left_weight * left[0] + right_weight * right[0]),
                weight * (left_weight * left[1] + right_weight * right[1]))

    def inverse(x: int, y: int) -> tuple[float, float]:
        sx, sy = float(x), float(y)
        for _ in range(6):
            dx, dy = offset(sx, sy)
            sx, sy = x - dx, y - dy
        return sx, sy

    mesh = []
    for y in range(0, 512, 8):
        for x in range(0, 512, 8):
            x1, y1 = x + 8, y + 8
            # Pillow QUAD ordering: upper-left, lower-left, lower-right, upper-right.
            corners = (inverse(x, y), inverse(x, y1),
                       inverse(x1, y1), inverse(x1, y))
            mesh.append(((x, y, x1, y1), tuple(n for pair in corners for n in pair)))
    warped = master.convert("RGBa").transform(
        master.size, Image.Transform.MESH, mesh,
        resample=Image.Resampling.BICUBIC,
    ).convert("RGBA")
    # The gait intentionally starts below the locked head/torso area. Restore
    # those source pixels verbatim so mesh resampling cannot introduce tiny
    # identity drift in a region that is not supposed to animate at all.
    warped.paste(master.crop((0, 0, master.width, LOCKED_MASTER_ROWS)), (0, 0))
    return warped


def render_directional_gait(tool_root: Path, recipe_path: Path,
                            output: Path) -> dict:
    recipe = json.loads(recipe_path.read_text(encoding="utf-8"))
    contract = recipe.get("contract")
    if contract == STRUCTURAL_GAIT_CONTRACT:
        # Structural gait is a separate V2 visual candidate. Keep the same CLI
        # entry point so V1 and V2 can be rendered side-by-side from recipes.
        from .structural_gait import render_structural_gait
        return render_structural_gait(tool_root, recipe_path, output)
    if contract != LEGACY_GAIT_CONTRACT:
        raise ValueError(f"Unsupported directional gait contract: {contract!r}")
    if set(recipe["directions"]) != {"east", "north", "west"}:
        raise ValueError("The gait study requires EAST, NORTH and WEST")
    output.mkdir(parents=True, exist_ok=True)
    root = tool_root / "art/concepts"
    panel = Image.new("RGBA", (4 * 105, 4 * 112), (77, 116, 51, 255))
    draw = ImageDraw.Draw(panel)
    report = {"contract": LEGACY_GAIT_CONTRACT,
              "recipeSha256": hashlib.sha256(recipe_path.read_bytes()).hexdigest(),
              "anchor": [64, 116], "directions": {}, "runtimePromotion": False}
    for row, direction in enumerate(("east", "north", "west", "south")):
        if direction == "south":
            # SOUTH frontal is separately approved and is never regenerated here.
            source = root / "south_front_candidate_v1"
            frames = [Image.open(source / f"south_{pose}.png").convert("RGBA")
                      for pose in ("idle", "walk_a", "walk_b")]
        else:
            master_path = root / f"visitor_male_01_{direction}_master.png"
            with Image.open(master_path) as source:
                master = source.convert("RGBA")
            with Image.open(root / "frames_preview" / f"{direction}_idle.png") as source:
                frames = [source.convert("RGBA")]
            for pose in ("walk_a", "walk_b"):
                offsets = recipe["directions"][direction][pose]
                if set(offsets) != {"left", "right"} or any(
                    len(offsets[leg]) != 2 or any(abs(float(n)) > 24 for n in offsets[leg])
                    for leg in ("left", "right")
                ):
                    raise ValueError(f"Invalid {direction}/{pose} foot offsets")
                body = warp_intact_master(master, tuple(offsets["left"]),
                                          tuple(offsets["right"]))
                composed = Image.new("RGBA", (512, 512))
                composed.alpha_composite(concept_ground_shadow(), (200, 438))
                composed.alpha_composite(body)
                frame = alpha_safe_resize(composed, (128, 128))
                frame.save(output / f"{direction}_{pose}.png", format="PNG", optimize=False)
                frames.append(frame)
            identity_lock = assert_identity_lock(frames)
            report["directions"][direction] = {
                "masterSha256": hashlib.sha256(master_path.read_bytes()).hexdigest(),
                "measurements": frame_measurements(frames, (64, 116)),
                "identityLock": identity_lock,
            }
        for col, frame in enumerate(frames):
            panel.alpha_composite(frame.resize((74, 74), Image.Resampling.LANCZOS),
                                  (105 * col + 16, 112 * row + 8))
            draw.text((105 * col + 19, 112 * row + 87),
                      f"{direction} {('idle', 'A', 'B')[col]}", fill="white")
    panel.save(output / "four_direction_gait_56px.png", format="PNG", optimize=False)
    (output / "review_metrics.json").write_text(json.dumps(report, indent=2) + "\n",
                                                 encoding="utf-8")
    return report

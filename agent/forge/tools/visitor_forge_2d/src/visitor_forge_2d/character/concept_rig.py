"""Reproducible directional cutout study from one character's concept masters.

This is a narrow, character-specific segmentation recipe. It never invents
unseen surfaces; the walking gate must reveal whether a joint needs repainting.
"""

from __future__ import annotations

import json
import hashlib
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter


PARTS = (
    "head", "hair", "torso",
    "upper_arm_left", "lower_arm_left", "hand_left",
    "upper_arm_right", "lower_arm_right", "hand_right",
    "upper_leg_left", "lower_leg_left", "shoe_left",
    "upper_leg_right", "lower_leg_right", "shoe_right",
)

JOINTS = [
    ("pelvis", None, (257, 281)), ("spine", "pelvis", (256, 219)),
    ("neck", "spine", (258, 161)), ("head", "neck", (258, 126)),
    ("shoulder_left", "spine", (216, 184)),
    ("elbow_left", "shoulder_left", (195, 230)),
    ("wrist_left", "elbow_left", (200, 281)),
    ("shoulder_right", "spine", (297, 187)),
    ("elbow_right", "shoulder_right", (303, 232)),
    ("wrist_right", "elbow_right", (316, 271)),
    ("hip_left", "pelvis", (238, 280)),
    ("knee_left", "hip_left", (230, 350)),
    ("ankle_left", "knee_left", (222, 417)),
    ("hip_right", "pelvis", (278, 280)),
    ("knee_right", "hip_right", (278, 348)),
    ("ankle_right", "knee_right", (283, 409)),
]

# Screen-space shoulder/elbow placements are measured on each 512px master.
# Keeping them per view avoids deforming a side-view arm around the SOUTH rig.
VIEW_ARM_JOINTS = {
    "east": {"shoulder_left": (222, 187), "elbow_left": (218, 230),
             "wrist_left": (221, 277), "shoulder_right": (286, 190),
             "elbow_right": (298, 230), "wrist_right": (301, 261)},
    "north": {"shoulder_left": (215, 184), "elbow_left": (196, 228),
              "wrist_left": (195, 277), "shoulder_right": (297, 184),
              "elbow_right": (316, 228), "wrist_right": (317, 277)},
    "west": {"shoulder_left": (223, 190), "elbow_left": (212, 229),
             "wrist_left": (213, 261), "shoulder_right": (287, 187),
             "elbow_right": (296, 230), "wrist_right": (293, 278)},
}

JOINT_FOR_PART = {
    "head": "head", "hair": "head", "torso": "spine",
    "upper_arm_left": "shoulder_left", "lower_arm_left": "elbow_left",
    "hand_left": "wrist_left", "upper_arm_right": "shoulder_right",
    "lower_arm_right": "elbow_right", "hand_right": "wrist_right",
    "upper_leg_left": "hip_left", "lower_leg_left": "knee_left",
    "shoe_left": "ankle_left", "upper_leg_right": "hip_right",
    "lower_leg_right": "knee_right", "shoe_right": "ankle_right",
}

Z_INDEX = {
    "upper_leg_left": 10, "lower_leg_left": 11, "shoe_left": 12,
    "upper_leg_right": 14, "lower_leg_right": 15, "shoe_right": 16,
    "upper_arm_left": 20, "lower_arm_left": 21, "hand_left": 22,
    "torso": 30, "upper_arm_right": 34, "lower_arm_right": 35,
    "hand_right": 36, "head": 40, "hair": 50,
}


def concept_ground_shadow() -> Image.Image:
    """The fixed contact shadow shared by the cutout and intact-master studies."""
    shadow_mask = Image.new("L", (116, 32))
    ImageDraw.Draw(shadow_mask).ellipse((5, 7, 110, 24), fill=95)
    shadow_mask = shadow_mask.filter(ImageFilter.GaussianBlur(6))
    shadow = Image.new("RGBA", shadow_mask.size, (23, 25, 19, 0))
    shadow.putalpha(shadow_mask)
    return shadow


def _part_at(x: int, y: int, rgb: tuple[int, int, int], direction: str) -> str:
    r, g, b = rgb
    if y < 174 and r > g * 1.08 and r > b * 1.2:
        return "hair" if (y < 96 or (r < 172 and g < 135 and b < 115)) else "head"

    # The shirt edge turns inward around the elbows. Assign each visible
    # source pixel once, so the unposed cutout reconstructs the source exactly.
    if direction == "east":
        left_edge = 238 if y < 241 else 236
        right_edge = 283 if y < 241 else 289
    elif direction == "west":
        left_edge = 223 if y < 241 else 220
        right_edge = 276 if y < 241 else 274
    elif direction == "north":
        left_edge, right_edge = 220, 292
    else:
        left_edge = 222 if y < 195 else 212 if y < 220 else 211
        right_edge = 292 if y < 210 else 296 if y < 246 else 299
    if y < 314 and x < left_edge:
        return ("upper_arm_left" if y < 223 else
                "lower_arm_left" if y < 281 else "hand_left")
    if y < 303 and x >= right_edge:
        return ("upper_arm_right" if y < 221 else
                "lower_arm_right" if y < 267 else "hand_right")
    if y < 281:
        return "torso"

    left = x < 255 if y < 310 else x < 252
    side = "left" if left else "right"
    if y >= 390 and r > b * 1.12 and g < 150:
        return f"shoe_{side}"
    return (f"upper_leg_{side}" if y < 351 else f"lower_leg_{side}")


def build_concept_rig(master_path: str | Path, asset_root: str | Path,
                      definition_path: str | Path, direction: str = "south") -> dict:
    """Split one immutable 512px master into compositable RGBA parts."""
    if direction not in {"south", "east", "north", "west"}:
        raise ValueError(f"Unsupported concept direction: {direction}")
    master_path = Path(master_path)
    master_sha256 = hashlib.sha256(master_path.read_bytes()).hexdigest()
    with Image.open(master_path) as file:
        file.load()
        if file.mode != "RGBA" or file.size != (512, 512):
            raise ValueError("Concept rig master must be 512x512 RGBA")
        master = file.copy()
    if master.getchannel("A").getbbox() is None:
        raise ValueError("Concept rig master has no visible character")

    pixels = master.load()
    buffers = {name: Image.new("RGBA", master.size) for name in PARTS}
    targets = {name: image.load() for name, image in buffers.items()}
    for y in range(master.height):
        for x in range(master.width):
            rgba = pixels[x, y]
            if rgba[3]:
                targets[_part_at(x, y, rgba[:3], direction)][x, y] = rgba

    # The masks form a lossless partition before posing. This catches gaps
    # introduced by later edits to the classifier or master.
    from PIL import ImageChops
    reconstructed = Image.new("RGBA", master.size)
    for name in PARTS:
        reconstructed.alpha_composite(buffers[name])
    if ImageChops.difference(reconstructed, master).getbbox():
        raise ValueError("Concept rig partition does not reconstruct its master")

    root = Path(asset_root)
    shadow = concept_ground_shadow()
    shadow_relative = f"visitor_male_01/{direction}_concept/ground_shadow.png"
    shadow_path = root / shadow_relative
    shadow_path.parent.mkdir(parents=True, exist_ok=True)
    shadow.save(shadow_path, format="PNG", optimize=False)
    layers = [{"id": "ground_shadow", "source": shadow_relative,
               "position": [200, 438], "pivot": [0, 0], "zIndex": 0}]
    source_paths = [str(shadow_path)]
    for name in PARTS:
        image = buffers[name]
        box = image.getchannel("A").getbbox()
        if box is None:
            raise ValueError(f"Empty concept rig part: {name}")
        relative = f"visitor_male_01/{direction}_concept/{name}.png"
        destination = root / relative
        destination.parent.mkdir(parents=True, exist_ok=True)
        image.crop(box).save(destination, format="PNG", optimize=False)
        source_paths.append(str(destination))
        layers.append({"id": name, "source": relative,
                       "position": [box[0], box[1]], "pivot": [0, 0],
                       "zIndex": Z_INDEX[name]})

    definition = {
        "forgeContractVersion": "CH_VISITOR_FORGE_2D_DIRECTIONAL_CUTOUT_STUDY_V1",
        "characterId": "visitor_male_01", "direction": direction,
        "canvas": {"workingSize": [512, 512], "outputSize": [128, 128],
                   "anchor": [64, 116]},
        "palette": {},
        "joints": [{"id": name, "position": list(VIEW_ARM_JOINTS.get(direction, {}).get(name, position)),
                    **({"parent": parent} if parent else {})}
                   for name, parent, position in JOINTS],
        "layers": layers,
        "parts": [{"id": name, "layer": name, "joint": JOINT_FOR_PART[name]}
                  for name in PARTS],
        "visualStyle": {"source": "concept_cutout_study", "direction": direction,
                        "master": str(master_path), "masterSha256": master_sha256,
                        "runtimePromotion": False},
    }
    destination = Path(definition_path)
    destination.parent.mkdir(parents=True, exist_ok=True)
    destination.write_text(json.dumps(definition, indent=2) + "\n", encoding="utf-8")
    return {"definition": str(destination), "parts": source_paths,
            "master": str(master_path), "masterSha256": master_sha256,
            "runtimePromotion": False}

"""Pixel-native character generator for A7 Forge 2D.

The renderer works directly on the final pixel grid. It intentionally avoids
supersampling, antialiasing and image scaling so pixel clusters remain explicit
and deterministic.
"""

from __future__ import annotations

import hashlib
import json
from pathlib import Path
from typing import Any

from PIL import Image, ImageDraw

from .animation import ANIMATION_CONTRACT, package_animation
from .pixel_polish import PIXEL_POLISH_PROFILES, polish_native_pixel_art
from .pixel_projectile import projectile_trajectory, render_energy_orb


PIXEL_CHARACTER_CONTRACT = "A7_FORGE_2D_PIXEL_CHARACTER_V1"
DIRECTIONS = ("south", "east", "north", "west")
WIZARD_ATTACK_POSES = tuple(f"attack_{index}" for index in range(6))
DEFAULT_PALETTE = {
    "outline": "#17202a",
    "skin": "#e7ad82",
    "hair": "#4c3328",
    "beard": "#e6e8ec",
    "beardShadow": "#c8cdd4",
    "shirt": "#3f78bd",
    "shirtShadow": "#2d5b91",
    "pants": "#33435a",
    "pantsShadow": "#253244",
    "shoes": "#20262e",
    "robe": "#6750a4",
    "robeShadow": "#49377d",
    "robeHighlight": "#7665b8",
    "hat": "#4f46a5",
    "hatBand": "#3f477f",
    "hatHighlight": "#6268a5",
    "staff": "#7a5230",
    "crystal": "#74d7ff",
    "crystalHighlight": "#b9efff",
}


def _hex_rgba(value: object, label: str) -> tuple[int, int, int, int]:
    text = str(value or "")
    if len(text) != 7 or not text.startswith("#"):
        raise ValueError(f"{label} must be #RRGGBB")
    try:
        return tuple(int(text[i:i + 2], 16) for i in (1, 3, 5)) + (255,)
    except ValueError as exc:
        raise ValueError(f"{label} must be #RRGGBB") from exc


def _safe_id(value: object) -> str:
    text = str(value or "").strip()
    if not text or any(ch not in "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_-" for ch in text):
        raise ValueError("character id must contain only letters, digits, '_' or '-'")
    return text


def _load_recipe(path: Path) -> dict[str, Any]:
    data = json.loads(path.read_text(encoding="utf-8"))
    if data.get("contract") != PIXEL_CHARACTER_CONTRACT:
        raise ValueError(f"expected contract {PIXEL_CHARACTER_CONTRACT}")
    return data


def _palette(recipe: dict[str, Any]) -> dict[str, tuple[int, int, int, int]]:
    raw = dict(DEFAULT_PALETTE)
    supplied = recipe.get("palette", {})
    if not isinstance(supplied, dict):
        raise ValueError("palette must be an object")
    unknown = sorted(set(supplied) - set(DEFAULT_PALETTE))
    if unknown:
        raise ValueError(f"unsupported palette slots: {unknown}")
    raw.update({key: str(value) for key, value in supplied.items()})
    return {key: _hex_rgba(value, f"palette.{key}") for key, value in raw.items()}


def _rect(draw: ImageDraw.ImageDraw, box: tuple[int, int, int, int], fill: tuple[int, int, int, int]) -> None:
    draw.rectangle(box, fill=fill)


def _pixel_character(
    size: tuple[int, int],
    direction: str,
    pose: str,
    colors: dict[str, tuple[int, int, int, int]],
    archetype: str = "adventurer",
) -> Image.Image:
    if direction not in DIRECTIONS:
        raise ValueError(f"unsupported direction: {direction}")
    width, height = size
    if width < 24 or height < 32:
        raise ValueError("pixel character canvas must be at least 24x32")
    if width > 128 or height > 192:
        raise ValueError("pixel character canvas is intentionally capped at 128x192")

    image = Image.new("RGBA", size, (0, 0, 0, 0))
    draw = ImageDraw.Draw(image)

    cx = width // 2
    ground = height - 2
    scale = max(1, min(width // 16, height // 24))
    # Keep all motion on the integer grid.
    phase_map = {"idle": 0, "walk_0": -1, "walk_1": 0, "walk_2": 1, "walk_3": 0}
    phase_map.update({attack_pose: 0 for attack_pose in WIZARD_ATTACK_POSES})
    phase = phase_map.get(pose)
    if phase is None:
        raise ValueError(f"unsupported pixel pose: {pose}")

    bob = -scale if pose in ("walk_1", "walk_3") else 0
    body_bottom = ground - 5 * scale + bob
    torso_top = body_bottom - 7 * scale
    head_top = torso_top - 6 * scale

    outline = colors["outline"]
    skin = colors["skin"]
    hair = colors["hair"]
    shirt = colors["shirt"]
    shirt_shadow = colors["shirtShadow"]
    pants = colors["pants"]
    pants_shadow = colors["pantsShadow"]
    shoes = colors["shoes"]

    # Walking uses discrete opposite limb offsets; no interpolated pixels.
    leg_shift = phase * 2 * scale
    arm_shift = -phase * scale

    if direction in ("south", "north"):
        head_half = 3 * scale
        torso_half = 3 * scale
        # Legs behind torso, alternating contact.
        left_x = cx - 2 * scale + leg_shift
        right_x = cx + scale - leg_shift
        _rect(draw, (left_x - scale, body_bottom, left_x, ground - scale), outline)
        _rect(draw, (left_x, body_bottom, left_x + scale, ground - scale), pants)
        _rect(draw, (right_x - scale, body_bottom, right_x, ground - scale), outline)
        _rect(draw, (right_x, body_bottom, right_x + scale, ground - scale), pants_shadow)
        _rect(draw, (left_x - scale, ground - scale, left_x + scale, ground), shoes)
        _rect(draw, (right_x - scale, ground - scale, right_x + scale, ground), shoes)

        # Arms.
        arm_y0 = torso_top + scale
        arm_y1 = body_bottom - scale
        lx = cx - (torso_half + 2) * scale + arm_shift
        rx = cx + (torso_half + 1) * scale - arm_shift
        _rect(draw, (lx, arm_y0, lx + scale, arm_y1), outline)
        _rect(draw, (lx + 1, arm_y0 + scale, lx + scale, arm_y1 - scale), shirt_shadow)
        _rect(draw, (rx, arm_y0, rx + scale, arm_y1), outline)
        _rect(draw, (rx, arm_y0 + scale, rx + scale - 1, arm_y1 - scale), shirt)
        _rect(draw, (lx, arm_y1, lx + scale, arm_y1 + scale), skin)
        _rect(draw, (rx, arm_y1, rx + scale, arm_y1 + scale), skin)

        # Torso.
        _rect(draw, (cx - (torso_half + 1) * scale, torso_top - scale,
                     cx + (torso_half + 1) * scale, body_bottom), outline)
        _rect(draw, (cx - torso_half * scale, torso_top,
                     cx + torso_half * scale, body_bottom - scale), shirt)
        if direction == "south":
            _rect(draw, (cx - torso_half * scale, body_bottom - 2 * scale,
                         cx + torso_half * scale, body_bottom - scale), shirt_shadow)
        else:
            _rect(draw, (cx + scale, torso_top,
                         cx + torso_half * scale, body_bottom - scale), shirt_shadow)

        # Head and hair.
        _rect(draw, (cx - (head_half + 1) * scale, head_top - scale,
                     cx + (head_half + 1) * scale, torso_top), outline)
        _rect(draw, (cx - head_half * scale, head_top,
                     cx + head_half * scale, torso_top - scale), skin)
        _rect(draw, (cx - head_half * scale, head_top,
                     cx + head_half * scale, head_top + 2 * scale), hair)
        if direction == "south":
            eye_y = head_top + 3 * scale
            _rect(draw, (cx - 2 * scale, eye_y, cx - scale, eye_y + scale - 1), outline)
            _rect(draw, (cx + scale, eye_y, cx + 2 * scale, eye_y + scale - 1), outline)
        else:
            _rect(draw, (cx - head_half * scale, head_top,
                         cx + head_half * scale, head_top + 4 * scale), hair)
    else:
        facing = 1 if direction == "east" else -1
        head_w = 5 * scale
        torso_w = 5 * scale
        front = cx + facing * scale
        # Back/front legs separate horizontally during gait.
        back_x = cx - facing * scale + leg_shift
        front_x = cx + facing * scale - leg_shift
        for x, fill in ((back_x, pants_shadow), (front_x, pants)):
            _rect(draw, (x - scale, body_bottom, x, ground - scale), outline)
            _rect(draw, (x, body_bottom, x + scale, ground - scale), fill)
            _rect(draw, (x - scale, ground - scale, x + scale, ground), shoes)

        # Rear arm then body then front arm to make direction readable.
        rear_x = cx - facing * (3 * scale) + arm_shift
        _rect(draw, (rear_x - scale, torso_top + scale, rear_x + scale, body_bottom), outline)
        _rect(draw, (rear_x, torso_top + 2 * scale, rear_x + scale, body_bottom - scale), shirt_shadow)

        x0 = cx - torso_w // 2
        x1 = x0 + torso_w
        _rect(draw, (x0 - scale, torso_top - scale, x1 + scale, body_bottom), outline)
        _rect(draw, (x0, torso_top, x1, body_bottom - scale), shirt)
        shadow_x0 = x0 if facing < 0 else x1 - 2 * scale
        _rect(draw, (shadow_x0, torso_top, shadow_x0 + 2 * scale, body_bottom - scale), shirt_shadow)

        front_arm_x = cx + facing * (3 * scale) - arm_shift
        _rect(draw, (front_arm_x - scale, torso_top + scale, front_arm_x + scale, body_bottom), outline)
        _rect(draw, (front_arm_x, torso_top + 2 * scale, front_arm_x + scale, body_bottom - scale), shirt)
        _rect(draw, (front_arm_x - scale, body_bottom - scale, front_arm_x + scale, body_bottom), skin)

        hx0 = cx - head_w // 2
        hx1 = hx0 + head_w
        _rect(draw, (hx0 - scale, head_top - scale, hx1 + scale, torso_top), outline)
        _rect(draw, (hx0, head_top, hx1, torso_top - scale), skin)
        hair_x0 = hx0 if facing > 0 else hx0 + 2 * scale
        _rect(draw, (hair_x0, head_top, hair_x0 + 3 * scale, head_top + 3 * scale), hair)
        eye_x = front + facing * scale
        eye_x2 = eye_x + facing * scale
        _rect(draw, (min(eye_x, eye_x2), head_top + 3 * scale,
                     max(eye_x, eye_x2), head_top + 4 * scale - 1), outline)

    if archetype == "wizard":
        _draw_wizard_overlay(image, direction, pose, colors)
    elif archetype != "adventurer":
        raise ValueError("archetype must be adventurer or wizard")

    return image


def _draw_wizard_overlay(
    image: Image.Image,
    direction: str,
    pose: str,
    colors: dict[str, tuple[int, int, int, int]],
) -> None:
    """Draw the reference wizard as native pixel art while preserving the walk gait.

    The wizard is authored as a complete silhouette instead of painting details
    over the adventurer. This prevents the base character from leaking through
    and keeps the hat, beard, sleeves, robe and staff consistent in every pose.
    """
    width, height = image.size
    image.paste((0, 0, 0, 0), (0, 0, width, height))
    draw = ImageDraw.Draw(image)

    cx = width // 2
    ground = height - 2
    scale = max(1, min(width // 16, height // 24))
    phase_map = {"idle": 0, "walk_0": -1, "walk_1": 0, "walk_2": 1, "walk_3": 0}
    phase_map.update({attack_pose: 0 for attack_pose in WIZARD_ATTACK_POSES})
    phase = phase_map[pose]
    attack_index = int(pose.split("_", 1)[1]) if pose.startswith("attack_") else None
    bob = -scale if pose in ("walk_1", "walk_3") else 0

    outline = colors["outline"]
    skin = colors["skin"]
    beard = colors["beard"]
    beard_shadow = colors["beardShadow"]
    robe = colors["robe"]
    robe_shadow = colors["robeShadow"]
    robe_highlight = colors["robeHighlight"]
    hat = colors["hat"]
    hat_band = colors["hatBand"]
    hat_highlight = colors["hatHighlight"]
    staff = colors["staff"]
    crystal = colors["crystal"]
    crystal_highlight = colors["crystalHighlight"]
    shoes = colors["shoes"]

    body_bottom = ground - 5 * scale + bob
    torso_top = body_bottom - 7 * scale
    head_top = torso_top - 6 * scale
    leg_shift = phase * 2 * scale
    arm_shift = -phase * scale

    # Feet remain visibly separate under the robe so the four-frame gait reads.
    if direction in ("south", "north"):
        left_x = cx - 2 * scale + leg_shift
        right_x = cx + scale - leg_shift
    else:
        facing = 1 if direction == "east" else -1
        left_x = cx - facing * scale + leg_shift
        right_x = cx + facing * scale - leg_shift
    _rect(draw, (left_x - scale, ground - 2 * scale, left_x + scale, ground), shoes)
    _rect(draw, (right_x - scale, ground - 2 * scale, right_x + scale, ground), shoes)

    # Long robe: broad shoulders, belted middle, slightly irregular hem.
    robe_top = torso_top
    robe_bottom = ground - scale
    if direction in ("south", "north"):
        outer = [
            (cx - 3 * scale, robe_top),
            (cx + 3 * scale, robe_top),
            (cx + 4 * scale, robe_bottom - scale),
            (cx + 3 * scale, robe_bottom),
            (cx + scale, robe_bottom),
            (cx, robe_bottom - scale),
            (cx - scale, robe_bottom),
            (cx - 3 * scale, robe_bottom),
            (cx - 4 * scale, robe_bottom - scale),
        ]
        draw.polygon(outer, fill=outline)
        inner = [
            (cx - 2 * scale, robe_top + scale),
            (cx + 2 * scale, robe_top + scale),
            (cx + 3 * scale, robe_bottom - 2 * scale),
            (cx + 2 * scale, robe_bottom - scale),
            (cx + scale, robe_bottom - scale),
            (cx, robe_bottom - 2 * scale),
            (cx - scale, robe_bottom - scale),
            (cx - 2 * scale, robe_bottom - scale),
            (cx - 3 * scale, robe_bottom - 2 * scale),
        ]
        draw.polygon(inner, fill=robe)
        _rect(draw, (cx + scale, robe_top + scale, cx + 2 * scale, robe_bottom - 2 * scale), robe_shadow)
        _rect(draw, (cx - 2 * scale, robe_top + 2 * scale, cx - scale, robe_top + 5 * scale), robe_highlight)
        _rect(draw, (cx - 2 * scale, robe_bottom - 5 * scale, cx - scale, robe_bottom - 2 * scale), robe_highlight)
        fold_x = cx - scale + phase * scale
        _rect(draw, (fold_x, robe_bottom - 4 * scale, fold_x + scale, robe_bottom - scale), robe_shadow)
    else:
        facing = 1 if direction == "east" else -1
        draw.polygon([
            (cx - 2 * scale, robe_top),
            (cx + 2 * scale, robe_top),
            (cx + 3 * scale, robe_bottom - scale),
            (cx + 2 * scale, robe_bottom),
            (cx - 2 * scale, robe_bottom),
            (cx - 3 * scale, robe_bottom - scale),
        ], fill=outline)
        draw.polygon([
            (cx - scale, robe_top + scale),
            (cx + scale, robe_top + scale),
            (cx + 2 * scale, robe_bottom - 2 * scale),
            (cx + scale, robe_bottom - scale),
            (cx - scale, robe_bottom - scale),
            (cx - 2 * scale, robe_bottom - 2 * scale),
        ], fill=robe)
        shade_x = cx - 2 * scale if facing < 0 else cx + scale
        _rect(draw, (shade_x, robe_top + 2 * scale, shade_x + scale, robe_bottom - 2 * scale), robe_shadow)
        light_x = cx - scale if facing > 0 else cx
        _rect(draw, (light_x, robe_top + 2 * scale, light_x + scale, robe_top + 5 * scale), robe_highlight)

    # Puffy sleeves and hands. Opposite arm motion matches the validated gait.
    sleeve_y0 = torso_top + scale
    sleeve_y1 = torso_top + 5 * scale
    if direction in ("south", "north"):
        lx = cx - 5 * scale + arm_shift
        rx = cx + 4 * scale - arm_shift
        for x, fill in ((lx, robe_shadow), (rx, robe)):
            _rect(draw, (x, sleeve_y0, x + 2 * scale, sleeve_y1), outline)
            _rect(draw, (x + scale // 2, sleeve_y0 + scale, x + 2 * scale - scale // 2, sleeve_y1 - scale), fill)
        _rect(draw, (lx, sleeve_y1 - scale, lx + scale, sleeve_y1), skin)
        _rect(draw, (rx + scale, sleeve_y1 - scale, rx + 2 * scale, sleeve_y1), skin)
    else:
        facing = 1 if direction == "east" else -1
        back_x = cx - facing * 4 * scale + arm_shift
        front_x = cx + facing * 3 * scale - arm_shift
        for x, fill in ((back_x, robe_shadow), (front_x, robe)):
            _rect(draw, (x - scale, sleeve_y0, x + scale, sleeve_y1), outline)
            _rect(draw, (x, sleeve_y0 + scale, x + scale, sleeve_y1 - scale), fill)
        _rect(draw, (front_x, sleeve_y1 - scale, front_x + scale, sleeve_y1), skin)

    # Brown belt and small buckle, matching the reference.
    belt_y = torso_top + 4 * scale
    belt = staff
    buckle = (183, 132, 72, 255)
    _rect(draw, (cx - 3 * scale, belt_y, cx + 3 * scale, belt_y + scale), outline)
    _rect(draw, (cx - 2 * scale, belt_y, cx + 2 * scale, belt_y + scale - 1), belt)
    _rect(draw, (cx, belt_y, cx + scale, belt_y + scale), buckle)
    collar_y = torso_top + scale
    if direction == "south":
        draw.polygon([
            (cx - 2 * scale, collar_y),
            (cx + 2 * scale, collar_y),
            (cx + scale, collar_y + 2 * scale),
            (cx - scale, collar_y + 2 * scale),
        ], fill=outline)
        _rect(draw, (cx - scale, collar_y, cx + scale, collar_y + scale), robe_shadow)

    # Square face and large white beard.
    if direction == "south":
        face_y = head_top + 2 * scale
        _rect(draw, (cx - 3 * scale, face_y, cx + 3 * scale, face_y + 3 * scale), outline)
        _rect(draw, (cx - 2 * scale, face_y, cx + 2 * scale, face_y + 2 * scale), skin)
        eye_y = face_y + scale
        _rect(draw, (cx - 2 * scale, eye_y, cx - scale, eye_y + scale - 1), outline)
        _rect(draw, (cx + scale, eye_y, cx + 2 * scale, eye_y + scale - 1), outline)
        _rect(draw, (cx, face_y + 2 * scale, cx + scale, face_y + 2 * scale), skin)
        draw.polygon([
            (cx - 2 * scale, face_y + 2 * scale),
            (cx + 2 * scale, face_y + 2 * scale),
            (cx + 2 * scale, face_y + 4 * scale),
            (cx + scale, face_y + 5 * scale),
            (cx, face_y + 6 * scale),
            (cx - scale, face_y + 5 * scale),
            (cx - 2 * scale, face_y + 4 * scale),
        ], fill=beard)
        _rect(draw, (cx + scale, face_y + 3 * scale, cx + 2 * scale, face_y + 4 * scale), beard_shadow)
    elif direction in ("east", "west"):
        facing = 1 if direction == "east" else -1
        _rect(draw, (cx - 2 * scale, head_top + 2 * scale, cx + 2 * scale, head_top + 5 * scale), outline)
        _rect(draw, (cx - scale, head_top + 2 * scale, cx + scale, head_top + 4 * scale), skin)
        eye_x = cx + facing * scale
        _rect(draw, (eye_x, head_top + 3 * scale, eye_x, head_top + 3 * scale), outline)
        draw.polygon([
            (cx - 2 * scale, head_top + 4 * scale),
            (cx + 2 * scale, head_top + 4 * scale),
            (cx + facing * 2 * scale, head_top + 5 * scale),
            (cx + facing * scale, head_top + 7 * scale),
            (cx - facing * scale, head_top + 6 * scale),
        ], fill=beard)
        shadow_x = cx - scale if facing > 0 else cx
        _rect(draw, (shadow_x, head_top + 5 * scale, shadow_x + scale, head_top + 6 * scale), beard_shadow)
    else:
        _rect(draw, (cx - 2 * scale, head_top + 2 * scale, cx + 2 * scale, head_top + 5 * scale), beard_shadow)

    # Oversized floppy hat, with the characteristic bent tip from the reference.
    brim_y = head_top + scale
    if direction in ("south", "north"):
        _rect(draw, (cx - 6 * scale, brim_y, cx + 6 * scale, brim_y + scale), outline)
        _rect(draw, (cx - 5 * scale, brim_y - scale, cx + 5 * scale, brim_y), hat_band)
        lean = -scale if direction == "south" else scale
        draw.polygon([
            (cx - 3 * scale, brim_y),
            (cx + 3 * scale, brim_y),
            (cx + 3 * scale + lean, head_top - scale),
            (cx + 2 * scale + lean, head_top - 3 * scale),
            (cx + lean, head_top - 4 * scale),
            (cx - 2 * scale + lean, head_top - 3 * scale),
            (cx - 3 * scale + lean, head_top - 2 * scale),
        ], fill=outline)
        draw.polygon([
            (cx - 2 * scale, brim_y - scale),
            (cx + 2 * scale, brim_y - scale),
            (cx + 2 * scale + lean, head_top - scale),
            (cx + scale + lean, head_top - 3 * scale),
            (cx + lean, head_top - 3 * scale),
            (cx - scale + lean, head_top - 2 * scale),
        ], fill=hat)
        # Block highlights reproduce the purple-blue lighting of the reference.
        _rect(draw, (cx + lean, head_top - 2 * scale, cx + lean + scale, head_top - scale), hat_highlight)
        _rect(draw, (cx + scale + lean, head_top - scale, cx + 2 * scale + lean, brim_y - scale), hat_highlight)
    else:
        facing = 1 if direction == "east" else -1
        _rect(draw, (cx - 5 * scale, brim_y, cx + 5 * scale, brim_y + scale), outline)
        _rect(draw, (cx - 4 * scale, brim_y - scale, cx + 4 * scale, brim_y), hat_band)
        tip_x = cx - facing * 5 * scale
        draw.polygon([
            (cx - 2 * scale, brim_y),
            (cx + 2 * scale, brim_y),
            (cx + facing * 2 * scale, head_top - scale),
            (cx + facing * scale, head_top - 3 * scale),
            (tip_x, head_top - 4 * scale),
            (cx - facing * 2 * scale, head_top - 2 * scale),
        ], fill=outline)
        draw.polygon([
            (cx - scale, brim_y - scale),
            (cx + scale, brim_y - scale),
            (cx + facing * scale, head_top - scale),
            (cx, head_top - 3 * scale),
            (cx - facing * 3 * scale, head_top - 3 * scale),
        ], fill=hat)
        highlight_x = cx if facing > 0 else cx - scale
        _rect(draw, (highlight_x, head_top - 2 * scale, highlight_x + scale, head_top - scale), hat_highlight)

    # Staff sits outside the body silhouette during idle/walk. During an attack
    # it is deliberately re-posed and becomes the focal line of action.
    if direction == "south":
        base_staff_x = cx + 6 * scale
        attack_sign = 1
    elif direction == "north":
        base_staff_x = cx - 6 * scale
        attack_sign = -1
    else:
        facing = 1 if direction == "east" else -1
        base_staff_x = cx + facing * 6 * scale
        attack_sign = facing

    if attack_index is None:
        staff_x = base_staff_x + phase * max(1, scale // 2)
        _rect(draw, (staff_x, torso_top + scale, staff_x + scale, ground), outline)
        _rect(draw, (staff_x, torso_top + 2 * scale, staff_x, ground - scale), staff)

        gem_x = staff_x
        gem_y = torso_top
    else:
        # Six-stage cast: ready -> raise -> charge -> peak -> release -> recover.
        raise_steps = (0, 2, 4, 5, 4, 1)
        reach_steps = (0, 1, 2, 3, 3, 1)
        staff_bottom_x = cx + attack_sign * 3 * scale
        staff_bottom_y = ground - scale
        gem_x = base_staff_x + attack_sign * reach_steps[attack_index] * scale
        gem_y = torso_top - raise_steps[attack_index] * scale

        draw.line(
            (staff_bottom_x, staff_bottom_y, gem_x, gem_y + scale),
            fill=outline,
            width=max(1, 2 * scale),
        )
        draw.line(
            (staff_bottom_x, staff_bottom_y, gem_x, gem_y + scale),
            fill=staff,
            width=max(1, scale),
        )

    # Blue faceted crystal.
    draw.polygon([
        (gem_x, gem_y - 3 * scale),
        (gem_x + 2 * scale, gem_y - scale),
        (gem_x + 2 * scale, gem_y + scale),
        (gem_x, gem_y + 3 * scale),
        (gem_x - 2 * scale, gem_y + scale),
        (gem_x - 2 * scale, gem_y - scale),
    ], fill=outline)
    draw.polygon([
        (gem_x, gem_y - 2 * scale),
        (gem_x + scale, gem_y - scale),
        (gem_x + scale, gem_y + scale),
        (gem_x, gem_y + 2 * scale),
        (gem_x - scale, gem_y + scale),
        (gem_x - scale, gem_y - scale),
    ], fill=crystal)
    _rect(draw, (gem_x, gem_y - 2 * scale, gem_x, gem_y - scale), crystal_highlight)

    if attack_index is not None:
        # Deterministic native-pixel spell effect. No blur or interpolation:
        # the orb grows in explicit clusters and the rays are authored lines.
        orb_radius = (0, 1, 2, 3, 4, 1)[attack_index] * scale
        if orb_radius > 0:
            orb_x = gem_x + attack_sign * (3 + attack_index // 2) * scale
            orb_y = gem_y - scale

            outer_radius = orb_radius + scale
            draw.ellipse(
                (orb_x - outer_radius, orb_y - outer_radius,
                 orb_x + outer_radius, orb_y + outer_radius),
                fill=outline,
            )
            draw.ellipse(
                (orb_x - orb_radius, orb_y - orb_radius,
                 orb_x + orb_radius, orb_y + orb_radius),
                fill=crystal,
            )
            core = max(scale, orb_radius // 2)
            draw.rectangle(
                (orb_x - core, orb_y - core, orb_x + core, orb_y + core),
                fill=crystal_highlight,
            )
            if attack_index >= 2:
                ray = (2 + attack_index) * scale
                rays = (
                    (-ray, 0, -outer_radius, 0),
                    (outer_radius, 0, ray, 0),
                    (0, -ray, 0, -outer_radius),
                    (0, outer_radius, 0, ray),
                    (-ray, -ray, -outer_radius, -outer_radius),
                    (outer_radius, -outer_radius, ray, -ray),
                )
                for x0, y0, x1, y1 in rays:
                    draw.line(
                        (orb_x + x0, orb_y + y0, orb_x + x1, orb_y + y1),
                        fill=crystal_highlight,
                        width=max(1, scale),
                    )

        # A small robe recoil makes the cast read as body motion rather than a
        # static character with an effect pasted beside it.
        if attack_index in (2, 3, 4):
            recoil_x = cx - attack_sign * 2 * scale
            _rect(
                draw,
                (recoil_x, robe_top + 2 * scale, recoil_x + scale, robe_top + 5 * scale),
                robe_highlight,
            )


def _compose_wizard_full_attack_preview(
    frame_records: dict[str, dict[str, str]],
    projectile_paths: list[str],
    trajectory: list[list[int]],
    direction: str,
    destination: Path,
    frame_duration_ms: int,
) -> str:
    """Compose cast, projectile travel and recovery into one review GIF."""
    stage_size = (112, 112)
    char_origin = (stage_size[0] // 2 - 16, stage_size[1] // 2 - 24)
    projectile_start = {
        "south": (stage_size[0] // 2, stage_size[1] // 2 + 24),
        "east": (stage_size[0] // 2 + 20, stage_size[1] // 2 - 10),
        "north": (stage_size[0] // 2, stage_size[1] // 2 - 30),
        "west": (stage_size[0] // 2 - 20, stage_size[1] // 2 - 10),
    }[direction]

    sequence: list[Image.Image] = []

    # Cast buildup through the release frame.
    for index in range(5):
        stage = Image.new("RGBA", stage_size, (245, 245, 245, 255))
        with Image.open(frame_records[direction][f"attack_{index}"]) as character:
            stage.alpha_composite(character.convert("RGBA"), char_origin)
        sequence.append(stage)

    # Hold the release pose while the independent projectile moves through space.
    with Image.open(frame_records[direction]["attack_4"]) as release:
        release_frame = release.convert("RGBA")
    for projectile_path, offset in zip(projectile_paths, trajectory):
        stage = Image.new("RGBA", stage_size, (245, 245, 245, 255))
        stage.alpha_composite(release_frame, char_origin)
        with Image.open(projectile_path) as projectile:
            projectile = projectile.convert("RGBA")
            px = projectile_start[0] + offset[0] - projectile.width // 2
            py = projectile_start[1] + offset[1] - projectile.height // 2
            stage.alpha_composite(projectile, (px, py))
        sequence.append(stage)

    # Recovery after the projectile leaves the caster.
    recovery = Image.new("RGBA", stage_size, (245, 245, 245, 255))
    with Image.open(frame_records[direction]["attack_5"]) as character:
        recovery.alpha_composite(character.convert("RGBA"), char_origin)
    sequence.append(recovery)

    destination.parent.mkdir(parents=True, exist_ok=True)
    scale = 4
    gif_frames = [
        frame.resize((stage_size[0] * scale, stage_size[1] * scale), Image.Resampling.NEAREST)
        for frame in sequence
    ]
    gif_frames[0].save(
        destination,
        save_all=True,
        append_images=gif_frames[1:],
        duration=frame_duration_ms,
        loop=0,
        disposal=2,
        optimize=False,
    )
    return str(destination)


def render_pixel_character(recipe_path: Path, output_dir: Path) -> dict[str, Any]:
    recipe_path = recipe_path.resolve()
    recipe = _load_recipe(recipe_path)
    character_id = _safe_id(recipe.get("id"))
    size_raw = recipe.get("canvas", [32, 48])
    if not isinstance(size_raw, list) or len(size_raw) != 2:
        raise ValueError("canvas must be [width, height]")
    size = (int(size_raw[0]), int(size_raw[1]))
    anchor_raw = recipe.get("anchor", [size[0] // 2, size[1] - 2])
    if not isinstance(anchor_raw, list) or len(anchor_raw) != 2:
        raise ValueError("anchor must be [x, y]")
    anchor = [int(anchor_raw[0]), int(anchor_raw[1])]
    if not (0 <= anchor[0] <= size[0] and 0 <= anchor[1] <= size[1]):
        raise ValueError("anchor lies outside canvas")

    colors = _palette(recipe)
    archetype = str(recipe.get("archetype", "adventurer"))
    if archetype not in ("adventurer", "wizard"):
        raise ValueError("archetype must be adventurer or wizard")
    frame_duration = int(recipe.get("walkFrameDurationMs", 140))
    if not (40 <= frame_duration <= 1000):
        raise ValueError("walkFrameDurationMs must be between 40 and 1000")
    attack_frame_duration = int(recipe.get("attackFrameDurationMs", 110))
    if not (40 <= attack_frame_duration <= 1000):
        raise ValueError("attackFrameDurationMs must be between 40 and 1000")
    polish_profile = str(recipe.get("pixelPolishProfile", "conservative"))
    if polish_profile not in PIXEL_POLISH_PROFILES:
        raise ValueError(f"pixelPolishProfile must be one of {PIXEL_POLISH_PROFILES}")

    output_dir.mkdir(parents=True, exist_ok=True)
    frames_dir = output_dir / "frames"
    frames_dir.mkdir(exist_ok=True)
    animation_dir = output_dir / "animations"
    animation_dir.mkdir(exist_ok=True)

    frame_records: dict[str, dict[str, str]] = {}
    polish_records: dict[str, dict[str, dict[str, Any]]] = {}
    walk_packages: dict[str, Any] = {}
    attack_packages: dict[str, Any] = {}
    projectile_packages: dict[str, Any] = {}
    full_attack_previews: dict[str, str] = {}
    base_poses = ("idle", "walk_0", "walk_1", "walk_2", "walk_3")
    poses = base_poses + WIZARD_ATTACK_POSES if archetype == "wizard" else base_poses

    for direction in DIRECTIONS:
        frame_records[direction] = {}
        polish_records[direction] = {}
        walk_frames = []
        attack_frames = []
        for pose in poses:
            image = _pixel_character(size, direction, pose, colors, archetype)
            image, polish_report = polish_native_pixel_art(image, polish_profile)
            polish_records[direction][pose] = polish_report
            name = f"{character_id}_{direction}_{pose}.png"
            destination = frames_dir / name
            image.save(destination, format="PNG", optimize=False)
            frame_records[direction][pose] = str(destination)
            if pose.startswith("walk_"):
                walk_frames.append({
                    "id": pose,
                    "path": str(Path("..") / "frames" / name),
                    "durationMs": frame_duration,
                })
            elif pose.startswith("attack_"):
                attack_frames.append({
                    "id": pose,
                    "path": str(Path("..") / "frames" / name),
                    "durationMs": attack_frame_duration,
                })

        animation_recipe = {
            "contract": ANIMATION_CONTRACT,
            "id": f"{character_id}_{direction}_walk",
            "pixelArt": True,
            "loop": True,
            "frameDurationMs": frame_duration,
            "anchor": anchor,
            "frames": walk_frames,
        }
        recipe_out = animation_dir / f"{character_id}_{direction}_walk.recipe.json"
        recipe_out.write_text(json.dumps(animation_recipe, indent=2) + "\n", encoding="utf-8")
        walk_packages[direction] = package_animation(recipe_out, animation_dir / direction / "walk")

        if attack_frames:
            attack_recipe = {
                "contract": ANIMATION_CONTRACT,
                "id": f"{character_id}_{direction}_attack",
                "pixelArt": True,
                "loop": False,
                "frameDurationMs": attack_frame_duration,
                "anchor": anchor,
                "frames": attack_frames,
            }
            attack_recipe_out = animation_dir / f"{character_id}_{direction}_attack.recipe.json"
            attack_recipe_out.write_text(json.dumps(attack_recipe, indent=2) + "\n", encoding="utf-8")
            attack_packages[direction] = package_animation(
                attack_recipe_out, animation_dir / direction / "attack"
            )

            projectile_dir = output_dir / "projectiles" / direction
            projectile_frames_dir = projectile_dir / "frames"
            projectile_frames_dir.mkdir(parents=True, exist_ok=True)
            trajectory = projectile_trajectory(direction, steps=8, step_px=6)
            projectile_frame_paths: list[str] = []
            projectile_animation_frames: list[dict[str, Any]] = []
            for projectile_index, _offset in enumerate(trajectory):
                projectile = render_energy_orb(direction, projectile_index)
                projectile_path = projectile_frames_dir / (
                    f"{character_id}_{direction}_spell_{projectile_index:02d}.png"
                )
                projectile.save(projectile_path, format="PNG", optimize=False)
                projectile_frame_paths.append(str(projectile_path))
                projectile_animation_frames.append({
                    "id": f"travel_{projectile_index:02d}",
                    "path": str(Path("frames") / projectile_path.name),
                    "durationMs": 70,
                })

            projectile_recipe = {
                "contract": ANIMATION_CONTRACT,
                "id": f"{character_id}_{direction}_spell_travel",
                "pixelArt": True,
                "loop": False,
                "frameDurationMs": 70,
                "anchor": [8, 8],
                "frames": projectile_animation_frames,
            }
            projectile_recipe_path = projectile_dir / (
                f"{character_id}_{direction}_spell_travel.recipe.json"
            )
            projectile_recipe_path.write_text(
                json.dumps(projectile_recipe, indent=2) + "\n",
                encoding="utf-8",
            )
            projectile_package = package_animation(
                projectile_recipe_path, projectile_dir / "animation"
            )
            projectile_packages[direction] = {
                "manifest": projectile_package["manifest"],
                "preview": projectile_package["preview"],
                "trajectory": trajectory,
                "frames": projectile_frame_paths,
                "stepPx": 6,
            }

            full_preview_path = (
                output_dir / "full_attack" / f"{character_id}_{direction}_full_attack.gif"
            )
            full_attack_previews[direction] = _compose_wizard_full_attack_preview(
                frame_records,
                projectile_frame_paths,
                trajectory,
                direction,
                full_preview_path,
                attack_frame_duration,
            )

    # Native-scale board: rows are directions; columns are idle + four walk frames.
    board = Image.new("RGBA", (size[0] * len(poses), size[1] * len(DIRECTIONS)), (0, 0, 0, 0))
    for row, direction in enumerate(DIRECTIONS):
        for col, pose in enumerate(poses):
            with Image.open(frame_records[direction][pose]) as frame:
                board.alpha_composite(frame.convert("RGBA"), (col * size[0], row * size[1]))
    board_path = output_dir / f"{character_id}_pixel_review.png"
    board.save(board_path, format="PNG", optimize=False)

    manifest = {
        "contract": PIXEL_CHARACTER_CONTRACT,
        "id": character_id,
        "pixelArt": True,
        "archetype": archetype,
        "canvas": list(size),
        "anchor": anchor,
        "directions": list(DIRECTIONS),
        "poses": list(poses),
        "palette": {key: recipe.get("palette", {}).get(key, value) for key, value in DEFAULT_PALETTE.items()},
        "pixelPolish": {
            "profile": polish_profile,
            "changedPixels": sum(
                report["changedPixels"]
                for direction_reports in polish_records.values()
                for report in direction_reports.values()
            ),
            "framesChanged": sum(
                1
                for direction_reports in polish_records.values()
                for report in direction_reports.values()
                if report["changedPixels"] > 0
            ),
            "reports": polish_records,
        },
        "frames": frame_records,
        "walkAnimations": {direction: package["manifest"] for direction, package in walk_packages.items()},
        "attackAnimations": {direction: package["manifest"] for direction, package in attack_packages.items()},
        "projectiles": projectile_packages,
        "fullAttackPreviews": full_attack_previews,
        "review": str(board_path),
        "recipeSha256": hashlib.sha256(recipe_path.read_bytes()).hexdigest(),
        "artApproved": False,
        "runtimePromotion": False,
    }
    manifest_path = output_dir / f"{character_id}.pixel_character.json"
    manifest_path.write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")

    return {
        "status": "ok",
        "contract": PIXEL_CHARACTER_CONTRACT,
        "id": character_id,
        "archetype": archetype,
        "canvas": list(size),
        "directions": len(DIRECTIONS),
        "frames": len(DIRECTIONS) * len(poses),
        "pixelPolishProfile": polish_profile,
        "pixelPolishChangedPixels": manifest["pixelPolish"]["changedPixels"],
        "review": str(board_path),
        "manifest": str(manifest_path),
        "animationManifests": {key: value["manifest"] for key, value in walk_packages.items()},
        "attackAnimationManifests": {key: value["manifest"] for key, value in attack_packages.items()},
        "projectileManifests": {key: value["manifest"] for key, value in projectile_packages.items()},
        "fullAttackPreviews": full_attack_previews,
        "artApproved": False,
        "runtimePromotion": False,
    }

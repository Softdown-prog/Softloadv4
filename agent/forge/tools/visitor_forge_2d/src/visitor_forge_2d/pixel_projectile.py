"""Pixel-art spell projectile helpers for A7 Forge 2D."""

from __future__ import annotations

from pathlib import Path
from PIL import Image, ImageDraw

PROJECTILE_DIRECTIONS = ("south", "east", "north", "west")


def projectile_trajectory(direction: str, steps: int = 8, step_px: int = 6) -> list[list[int]]:
    if direction not in PROJECTILE_DIRECTIONS:
        raise ValueError(f"unsupported direction: {direction}")
    if not (2 <= steps <= 32):
        raise ValueError("steps must be between 2 and 32")
    if not (1 <= step_px <= 32):
        raise ValueError("step_px must be between 1 and 32")
    dx, dy = {
        "south": (0, 1),
        "east": (1, 0),
        "north": (0, -1),
        "west": (-1, 0),
    }[direction]
    return [[dx * step_px * i, dy * step_px * i] for i in range(steps)]


def render_energy_orb(direction: str, phase: int, size: tuple[int, int] = (17, 17)) -> Image.Image:
    if direction not in PROJECTILE_DIRECTIONS:
        raise ValueError(f"unsupported direction: {direction}")
    image = Image.new("RGBA", size, (0, 0, 0, 0))
    draw = ImageDraw.Draw(image)
    cx, cy = size[0] // 2, size[1] // 2
    outline = (20, 25, 45, 255)
    blue = (67, 190, 245, 255)
    light = (181, 239, 255, 255)
    core = (245, 253, 255, 255)
    radius = (3, 4, 4, 3)[phase % 4]

    draw.ellipse((cx-radius-1, cy-radius-1, cx+radius+1, cy+radius+1), fill=outline)
    draw.ellipse((cx-radius, cy-radius, cx+radius, cy+radius), fill=blue)
    draw.rectangle((cx-1, cy-1, cx+1, cy+1), fill=light)
    draw.point((cx, cy), fill=core)

    ray = radius + 3
    sparks = ((-ray, 0), (ray, 0), (0, -ray), (0, ray)) if phase % 2 == 0 else (
        (-ray, -ray), (ray, -ray), (-ray, ray), (ray, ray)
    )
    for sx, sy in sparks:
        if 0 <= cx+sx < size[0] and 0 <= cy+sy < size[1]:
            draw.point((cx+sx, cy+sy), fill=light)

    tail = {
        "south": (0, -1),
        "east": (-1, 0),
        "north": (0, 1),
        "west": (1, 0),
    }[direction]
    for distance in range(radius + 2, radius + 5):
        tx, ty = cx + tail[0] * distance, cy + tail[1] * distance
        if 0 <= tx < size[0] and 0 <= ty < size[1]:
            draw.point((tx, ty), fill=light)
    return image

from __future__ import annotations

import hashlib
import json
from pathlib import Path
from typing import Callable

from PIL import Image, ImageChops, ImageDraw, ImageFilter

# V4 keeps the 2D procedural pipeline but shifts the target from "assembled
# cutout" toward an illustrated tycoon character: smaller head/hands/feet,
# softer shoulder and limb joins, more natural taper through torso/legs and a
# depth-led SOUTH walk rather than a lateral scissor.
STYLE_CONTRACT = "CH_VISITOR_FORGE_2D_TYCOON_POSE_V4"
CHARACTER_ID = "visitor_male_01"
DIRECTION = "south"

MaskPainter = Callable[[ImageDraw.ImageDraw], None]
DetailPainter = Callable[[ImageDraw.ImageDraw], None]


def _painted_part(
    size: tuple[int, int],
    paint_mask: MaskPainter,
    *,
    paint_details: DetailPainter | None = None,
    edge_blur: float = 0.35,
    top_value: int = 248,
    bottom_value: int = 184,
    right_shade: int = 22,
) -> Image.Image:
    """Create neutral grayscale RGBA art that remains palette-tintable."""
    width, height = size
    mask = Image.new("L", size, 0)
    draw_mask = ImageDraw.Draw(mask)
    paint_mask(draw_mask)
    if edge_blur > 0:
        mask = mask.filter(ImageFilter.GaussianBlur(edge_blur))

    vertical = Image.new("L", size)
    vdraw = ImageDraw.Draw(vertical)
    for y in range(height):
        t = y / max(1, height - 1)
        value = round(top_value * (1.0 - t) + bottom_value * t)
        vdraw.line((0, y, width, y), fill=value)

    horizontal = Image.new("L", size)
    hdraw = ImageDraw.Draw(horizontal)
    for x in range(width):
        t = x / max(1, width - 1)
        value = 255 - round(right_shade * t)
        hdraw.line((x, 0, x, height), fill=value)

    tone = ImageChops.multiply(vertical, horizontal)

    highlight = Image.new("L", size, 0)
    hldraw = ImageDraw.Draw(highlight)
    hldraw.ellipse(
        (
            -round(width * 0.04),
            -round(height * 0.03),
            round(width * 0.60),
            round(height * 0.50),
        ),
        fill=30,
    )
    highlight = highlight.filter(ImageFilter.GaussianBlur(max(2.0, min(size) * 0.08)))
    tone = ImageChops.add(tone, highlight, scale=1.0, offset=0)

    rgba = Image.merge("RGBA", (tone, tone, tone, mask))
    if paint_details is not None:
        details = Image.new("RGBA", size, (0, 0, 0, 0))
        paint_details(ImageDraw.Draw(details))
        rgba = Image.alpha_composite(rgba, details)
    return rgba


def _head() -> Image.Image:
    """Compact 3/4 head with a visible neck bridge and stronger cheek turn."""

    def mask(draw: ImageDraw.ImageDraw) -> None:
        draw.ellipse((13, 6, 82, 79), fill=255)
        draw.rounded_rectangle((20, 36, 79, 87), radius=25, fill=255)
        draw.ellipse((75, 38, 91, 59), fill=234)
        draw.ellipse((73, 50, 87, 67), fill=214)
        draw.rounded_rectangle((41, 76, 59, 98), radius=7, fill=255)

    def details(draw: ImageDraw.ImageDraw) -> None:
        draw.ellipse((38, 40, 42, 44), fill=(108, 108, 108, 124))
        draw.ellipse((57, 39, 63, 45), fill=(70, 70, 70, 196))
        draw.line((63, 47, 68, 56), fill=(126, 126, 126, 168), width=2)
        draw.line((50, 67, 61, 67), fill=(118, 118, 118, 138), width=2)
        draw.ellipse((27, 32, 47, 51), fill=(255, 255, 255, 17))
        draw.arc((48, 47, 81, 84), 300, 80, fill=(90, 90, 90, 52), width=2)
        draw.line((57, 80, 58, 96), fill=(90, 90, 90, 40), width=2)

    return _painted_part((96, 100), mask, paint_details=details, edge_blur=0.45)


def _hair() -> Image.Image:
    def mask(draw: ImageDraw.ImageDraw) -> None:
        draw.pieslice((11, 2, 87, 76), 180, 360, fill=255)
        draw.polygon(
            [
                (13, 37),
                (16, 21),
                (29, 9),
                (47, 3),
                (67, 7),
                (82, 18),
                (87, 32),
                (85, 46),
                (74, 40),
                (64, 33),
                (53, 30),
                (43, 33),
                (31, 31),
                (20, 40),
            ],
            fill=255,
        )
        draw.polygon([(73, 33), (85, 39), (84, 56), (75, 52)], fill=255)

    def details(draw: ImageDraw.ImageDraw) -> None:
        draw.arc((23, 8, 75, 46), 195, 330, fill=(255, 255, 255, 25), width=3)
        draw.line((49, 8, 45, 24), fill=(88, 88, 88, 80), width=2)
        draw.line((68, 13, 75, 30), fill=(76, 76, 76, 54), width=2)

    return _painted_part(
        (96, 100),
        mask,
        paint_details=details,
        edge_blur=0.35,
        top_value=238,
        bottom_value=166,
        right_shade=27,
    )


def _torso() -> Image.Image:
    """Illustrated shirt mass with sloped shoulders, chest, waist and hem."""

    def mask(draw: ImageDraw.ImageDraw) -> None:
        draw.polygon(
            [
                (31, 28),
                (50, 12),
                (80, 10),
                (107, 27),
                (117, 48),
                (112, 75),
                (104, 107),
                (96, 130),
                (47, 130),
                (38, 112),
                (29, 82),
                (21, 51),
            ],
            fill=255,
        )
        draw.ellipse((20, 19, 58, 55), fill=255)
        draw.ellipse((76, 17, 121, 58), fill=255)
        draw.rounded_rectangle((37, 106, 105, 134), radius=14, fill=255)

    def details(draw: ImageDraw.ImageDraw) -> None:
        draw.polygon(
            [(51, 14), (67, 29), (83, 13), (76, 9), (67, 20), (59, 9)],
            fill=(112, 112, 112, 96),
        )
        draw.line((69, 31, 70, 108), fill=(118, 118, 118, 39), width=2)
        draw.line((43, 114, 100, 114), fill=(86, 86, 86, 48), width=3)
        draw.line((31, 58, 103, 58), fill=(255, 255, 255, 14), width=3)
        draw.line((106, 38, 102, 104), fill=(74, 74, 74, 46), width=3)
        draw.arc((23, 17, 61, 58), 210, 320, fill=(255, 255, 255, 14), width=2)

    return _painted_part((140, 142), mask, paint_details=details, edge_blur=0.5)


def _arm_segment(
    size: tuple[int, int],
    top_width: int,
    bottom_width: int,
    *,
    side: str,
    curve: int,
    cuff: bool = False,
) -> Image.Image:
    """Soft arm segment with narrow overlap caps instead of ball joints."""
    width, height = size
    top_center = width // 2
    bottom_center = top_center + curve
    mid_y = height // 2
    mid_center = round((top_center + bottom_center) / 2)
    mid_width = round((top_width + bottom_width) / 2)

    if side == "right":
        top_width += 1
        bottom_width += 1

    def mask(draw: ImageDraw.ImageDraw) -> None:
        draw.polygon(
            [
                (top_center - top_width // 2, 7),
                (top_center + top_width // 2, 7),
                (mid_center + mid_width // 2, mid_y),
                (bottom_center + bottom_width // 2, height - 9),
                (bottom_center - bottom_width // 2, height - 9),
                (mid_center - mid_width // 2, mid_y),
            ],
            fill=255,
        )
        draw.ellipse(
            (top_center - top_width // 2, 1, top_center + top_width // 2, 20),
            fill=255,
        )
        draw.ellipse(
            (
                bottom_center - bottom_width // 2,
                height - 19,
                bottom_center + bottom_width // 2,
                height - 3,
            ),
            fill=255,
        )

    def details(draw: ImageDraw.ImageDraw) -> None:
        highlight_x = top_center + (top_width // 4 if side == "right" else -top_width // 4)
        draw.line((highlight_x, 11, bottom_center, height - 13), fill=(255, 255, 255, 16), width=2)
        if cuff:
            draw.line(
                (
                    bottom_center - bottom_width // 2 + 3,
                    height - 15,
                    bottom_center + bottom_width // 2 - 3,
                    height - 15,
                ),
                fill=(88, 88, 88, 58),
                width=2,
            )

    return _painted_part(size, mask, paint_details=details, edge_blur=0.45)


def _hand(side: str) -> Image.Image:
    def mask(draw: ImageDraw.ImageDraw) -> None:
        draw.ellipse((8, 5, 28, 32), fill=255)
        if side == "left":
            draw.ellipse((5, 16, 14, 28), fill=232)
        else:
            draw.ellipse((22, 15, 32, 28), fill=234)

    def details(draw: ImageDraw.ImageDraw) -> None:
        if side == "right":
            draw.arc((11, 10, 29, 29), 285, 65, fill=(92, 92, 92, 30), width=2)
        else:
            draw.arc((7, 10, 26, 29), 115, 245, fill=(92, 92, 92, 26), width=2)

    return _painted_part((36, 36), mask, paint_details=details, edge_blur=0.4)


def _upper_leg(side: str) -> Image.Image:
    """Hip-to-knee trouser mass with a narrow, non-circular knee exit."""
    near = 1 if side == "right" else 0

    def mask(draw: ImageDraw.ImageDraw) -> None:
        left = 11 - near
        right = 47 + near
        draw.rounded_rectangle((left, 1, right, 25), radius=12, fill=255)
        draw.polygon(
            [
                (left + 1, 14),
                (right - 1, 14),
                (right - 4, 49),
                (right - 8, 68),
                (right - 11, 81),
                (left + 11, 81),
                (left + 8, 68),
                (left + 4, 49),
            ],
            fill=255,
        )

    def details(draw: ImageDraw.ImageDraw) -> None:
        x = 20 if side == "left" else 38
        draw.line((x, 13, x, 61), fill=(255, 255, 255, 14), width=2)
        draw.line((20, 66, 38, 66), fill=(80, 80, 80, 16), width=2)

    return _painted_part((58, 84), mask, paint_details=details, edge_blur=0.45)


def _lower_leg(side: str) -> Image.Image:
    """Calf taper with a compact knee overlap and a clean ankle exit."""
    near = 1 if side == "right" else 0

    def mask(draw: ImageDraw.ImageDraw) -> None:
        left = 12 - near
        right = 44 + near
        draw.rounded_rectangle((left, 1, right, 18), radius=8, fill=255)
        draw.polygon(
            [
                (left + 1, 10),
                (right - 1, 10),
                (right - 3, 39),
                (right - 6, 58),
                (right - 10, 76),
                (left + 10, 76),
                (left + 6, 58),
                (left + 3, 39),
            ],
            fill=255,
        )
        draw.ellipse((left + 7, 65, right - 7, 79), fill=255)

    def details(draw: ImageDraw.ImageDraw) -> None:
        x = 19 if side == "left" else 36
        draw.line((x, 11, x, 58), fill=(255, 255, 255, 13), width=2)
        draw.line((19, 27, 37, 28), fill=(82, 82, 82, 14), width=2)

    return _painted_part((56, 80), mask, paint_details=details, edge_blur=0.45)


def _shoe(side: str) -> Image.Image:
    """Smaller shoe with one consistent screen-right SOUTH 3/4 direction."""

    def mask(draw: ImageDraw.ImageDraw) -> None:
        if side == "left":
            draw.rounded_rectangle((8, 7, 45, 27), radius=8, fill=255)
            draw.ellipse((34, 9, 57, 30), fill=255)
        else:
            draw.rounded_rectangle((7, 6, 48, 28), radius=9, fill=255)
            draw.ellipse((37, 8, 60, 31), fill=255)

    def details(draw: ImageDraw.ImageDraw) -> None:
        draw.line((7, 27, 56, 27), fill=(68, 68, 68, 82), width=2)
        draw.line((18, 12, 41, 13), fill=(255, 255, 255, 20), width=2)

    return _painted_part(
        (62, 34),
        mask,
        paint_details=details,
        edge_blur=0.35,
        top_value=235,
        bottom_value=154,
    )


def _ground_shadow() -> Image.Image:
    mask = Image.new("L", (104, 32), 0)
    draw = ImageDraw.Draw(mask)
    draw.ellipse((8, 8, 96, 27), fill=105)
    mask = mask.filter(ImageFilter.GaussianBlur(5))
    image = Image.new("RGBA", (104, 32), (28, 31, 34, 0))
    image.putalpha(mask)
    return image


def build_v1_south_parts() -> dict[str, Image.Image]:
    """Return the deterministic SOUTH visual library in neutral RGBA."""
    parts: dict[str, Image.Image] = {
        "ground_shadow": _ground_shadow(),
        "head": _head(),
        "hair": _hair(),
        "torso": _torso(),
    }
    for side in ("left", "right"):
        parts[f"upper_arm_{side}"] = _arm_segment(
            (50, 76), 31, 25, side=side, curve=(-3 if side == "left" else 3), cuff=True
        )
        parts[f"lower_arm_{side}"] = _arm_segment(
            (46, 64), 25, 19, side=side, curve=(2 if side == "left" else -2)
        )
        parts[f"hand_{side}"] = _hand(side)
        parts[f"upper_leg_{side}"] = _upper_leg(side)
        parts[f"lower_leg_{side}"] = _lower_leg(side)
        parts[f"shoe_{side}"] = _shoe(side)
    return parts


def generate_v1_south_assets(asset_root: str | Path, *, overwrite: bool = False) -> list[Path]:
    """Refresh generated parts without overwriting manually refined PNGs."""
    destination = Path(asset_root) / CHARACTER_ID / DIRECTION
    destination.mkdir(parents=True, exist_ok=True)
    manifest_path = destination / "generated_parts.json"
    previous = json.loads(manifest_path.read_text(encoding="utf-8")) if manifest_path.exists() else {}
    previous_hashes = previous.get("generatedHashes", {})
    if not isinstance(previous_hashes, dict):
        raise ValueError(f"Invalid generated-parts manifest: {manifest_path}")

    def digest(path: Path) -> str:
        return hashlib.sha256(path.read_bytes()).hexdigest()

    written: list[Path] = []
    generated_hashes: dict[str, str] = {}
    preserved: list[str] = []
    for part_id, image in build_v1_south_parts().items():
        path = destination / f"{part_id}.png"
        if path.exists() and not overwrite and previous_hashes.get(path.name) != digest(path):
            preserved.append(path.name)
        else:
            image.convert("RGBA").save(path, format="PNG", optimize=False)
            generated_hashes[path.name] = digest(path)
        written.append(path)
    manifest_path.write_text(json.dumps({
        "contract": "CH_VISITOR_2D_GENERATED_PARTS_V1",
        "styleContract": STYLE_CONTRACT,
        "generatedHashes": generated_hashes,
        "preservedOverrides": preserved,
    }, indent=2) + "\n", encoding="utf-8")
    return written

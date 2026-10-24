"""Generic 2D animation packaging for A7 Forge 2D.

This module does not generate motion by itself. Motion remains the responsibility
of a 2D authoring stage (poses, cutout rig, pixel-art pose generator, palette
cycle, etc.). This module validates the resulting frames and packages them into
runtime-friendly artifacts without involving Blender.
"""

from __future__ import annotations

import hashlib
import json
import math
from pathlib import Path
from typing import Any

from PIL import Image


ANIMATION_CONTRACT = "A7_FORGE_2D_ANIMATION_V1"


def _safe_id(value: object) -> str:
    text = str(value or "").strip()
    if not text or any(ch not in "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_-" for ch in text):
        raise ValueError("animation id must contain only letters, digits, '_' or '-'")
    return text


def _anchor(value: object, size: tuple[int, int]) -> list[int] | None:
    if value is None:
        return None
    if not isinstance(value, list) or len(value) != 2:
        raise ValueError("anchor must be [x, y]")
    point = [int(value[0]), int(value[1])]
    if not (0 <= point[0] <= size[0] and 0 <= point[1] <= size[1]):
        raise ValueError("anchor lies outside the frame")
    return point


def _load_recipe(recipe_path: Path) -> dict[str, Any]:
    data = json.loads(recipe_path.read_text(encoding="utf-8"))
    if data.get("contract") != ANIMATION_CONTRACT:
        raise ValueError(f"expected contract {ANIMATION_CONTRACT}")
    return data


def _load_frames(recipe_path: Path, recipe: dict[str, Any]) -> tuple[list[Image.Image], list[dict[str, Any]]]:
    raw_frames = recipe.get("frames")
    if not isinstance(raw_frames, list) or len(raw_frames) < 2:
        raise ValueError("animation requires at least two frames")

    default_duration = int(recipe.get("frameDurationMs", 160))
    if default_duration < 16 or default_duration > 10_000:
        raise ValueError("frameDurationMs must be between 16 and 10000")

    images: list[Image.Image] = []
    metadata: list[dict[str, Any]] = []
    expected_size: tuple[int, int] | None = None
    seen_ids: set[str] = set()

    for index, raw in enumerate(raw_frames):
        if isinstance(raw, str):
            raw = {"path": raw}
        if not isinstance(raw, dict):
            raise ValueError(f"frame {index} must be a path string or object")

        frame_id = _safe_id(raw.get("id") or f"frame_{index:02d}")
        if frame_id in seen_ids:
            raise ValueError(f"duplicate frame id: {frame_id}")
        seen_ids.add(frame_id)

        relative = Path(str(raw.get("path") or ""))
        if not str(relative):
            raise ValueError(f"frame {frame_id} is missing path")
        source_path = relative if relative.is_absolute() else (recipe_path.parent / relative)
        if not source_path.is_file():
            raise ValueError(f"frame does not exist: {source_path}")

        with Image.open(source_path) as source:
            source.load()
            if source.mode != "RGBA":
                raise ValueError(f"frame {frame_id} must be RGBA")
            image = source.copy()

        if image.getchannel("A").getbbox() is None:
            raise ValueError(f"frame {frame_id} has no visible pixels")
        if expected_size is None:
            expected_size = image.size
        elif image.size != expected_size:
            raise ValueError(
                f"all animation frames must use one canvas; {frame_id} is {image.size}, expected {expected_size}"
            )

        duration = int(raw.get("durationMs", default_duration))
        if duration < 16 or duration > 10_000:
            raise ValueError(f"frame {frame_id} duration must be between 16 and 10000 ms")

        images.append(image)
        metadata.append({
            "id": frame_id,
            "source": str(relative).replace("\\", "/"),
            "sha256": hashlib.sha256(source_path.read_bytes()).hexdigest(),
            "durationMs": duration,
        })

    return images, metadata


def package_animation(recipe_path: Path, output_dir: Path) -> dict[str, Any]:
    """Validate and package a sequence of Forge-authored 2D frames."""
    recipe_path = recipe_path.resolve()
    recipe = _load_recipe(recipe_path)
    animation_id = _safe_id(recipe.get("id"))
    images, frames = _load_frames(recipe_path, recipe)
    frame_size = images[0].size
    anchor = _anchor(recipe.get("anchor"), frame_size)

    columns = int(recipe.get("columns", len(images)))
    if columns < 1 or columns > len(images):
        raise ValueError("columns must be between 1 and frame count")
    rows = math.ceil(len(images) / columns)

    output_dir.mkdir(parents=True, exist_ok=True)
    sheet = Image.new("RGBA", (frame_size[0] * columns, frame_size[1] * rows), (0, 0, 0, 0))
    for index, image in enumerate(images):
        x = (index % columns) * frame_size[0]
        y = (index // columns) * frame_size[1]
        sheet.alpha_composite(image, (x, y))
        frames[index]["rect"] = [x, y, frame_size[0], frame_size[1]]

    sheet_path = output_dir / f"{animation_id}_spritesheet.png"
    sheet.save(sheet_path, format="PNG", optimize=False)

    gif_path = output_dir / f"{animation_id}_preview.gif"
    gif_frames = [image.convert("P", palette=Image.Palette.ADAPTIVE, colors=255) for image in images]
    gif_frames[0].save(
        gif_path,
        save_all=True,
        append_images=gif_frames[1:],
        duration=[frame["durationMs"] for frame in frames],
        loop=0 if bool(recipe.get("loop", True)) else 1,
        disposal=2,
        transparency=0,
        optimize=False,
    )

    manifest = {
        "contract": ANIMATION_CONTRACT,
        "id": animation_id,
        "loop": bool(recipe.get("loop", True)),
        "pixelArt": bool(recipe.get("pixelArt", False)),
        "frameSize": list(frame_size),
        "anchor": anchor,
        "frameCount": len(frames),
        "sheet": {
            "path": sheet_path.name,
            "size": list(sheet.size),
            "columns": columns,
            "rows": rows,
            "layout": "row-major",
            "resampling": "none",
        },
        "preview": gif_path.name,
        "frames": frames,
        "recipeSha256": hashlib.sha256(recipe_path.read_bytes()).hexdigest(),
        "runtimePromotion": False,
    }
    manifest_path = output_dir / f"{animation_id}.animation.json"
    manifest_path.write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")

    return {
        "status": "ok",
        "contract": ANIMATION_CONTRACT,
        "id": animation_id,
        "spritesheet": str(sheet_path),
        "preview": str(gif_path),
        "manifest": str(manifest_path),
        "frameCount": len(frames),
        "frameSize": list(frame_size),
        "pixelArt": manifest["pixelArt"],
        "runtimePromotion": False,
    }

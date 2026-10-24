from __future__ import annotations

import json
from pathlib import Path

from PIL import Image

from visitor_forge_2d import FORGE_CONTRACT_VERSION

from .model import CharacterDefinition, PoseSpec


def alpha_safe_resize(image: Image.Image, size: tuple[int, int]) -> Image.Image:
    """Resize RGBA through Pillow's premultiplied-alpha mode when available.

    The Visitor Forge treats halo prevention as part of the export contract, not
    as a cleanup step to perform after assets have already been produced.
    """
    rgba = image.convert("RGBA")
    try:
        premultiplied = rgba.convert("RGBa")
        resized = premultiplied.resize(size, Image.Resampling.LANCZOS)
        return resized.convert("RGBA")
    except (ValueError, OSError):
        return rgba.resize(size, Image.Resampling.LANCZOS)


def export_frame(
    image: Image.Image,
    definition: CharacterDefinition,
    pose: PoseSpec,
    output_dir: str | Path,
    *,
    stem: str | None = None,
    source_parts: dict | None = None,
) -> tuple[Path, Path]:
    """Export one gameplay PNG and its machine-readable frame metadata."""
    if image.size != definition.canvas.working_size:
        raise ValueError(
            f"Working image size {image.size} does not match definition "
            f"{definition.canvas.working_size}"
        )

    destination = Path(output_dir)
    destination.mkdir(parents=True, exist_ok=True)
    name = stem or f"{definition.character_id}_{pose.pose_id}"
    png_path = destination / f"{name}.png"
    json_path = destination / f"{name}.json"

    final_image = alpha_safe_resize(image, definition.canvas.output_size)
    final_image.save(png_path, format="PNG", optimize=False)

    metadata = {
        "characterId": definition.character_id,
        "direction": definition.direction,
        "pose": pose.pose_id,
        "canvasSize": list(definition.canvas.output_size),
        "workingCanvasSize": list(definition.canvas.working_size),
        "anchor": definition.canvas.anchor.as_list(),
        "frameDurationMs": pose.frame_duration_ms,
        "transparent": True,
        "colorMode": "RGBA_FULL_COLOR",
        "downscaleFilter": "LANCZOS_PREMULTIPLIED_ALPHA",
        "forgeContractVersion": definition.forge_contract_version or FORGE_CONTRACT_VERSION,
        "runtimePromotion": False,
    }
    if source_parts is not None:
        metadata["sourceParts"] = source_parts
    json_path.write_text(json.dumps(metadata, indent=2), encoding="utf-8")
    return png_path, json_path

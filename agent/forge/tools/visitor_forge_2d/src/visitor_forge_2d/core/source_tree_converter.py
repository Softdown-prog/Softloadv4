"""Convert an approved 2D tree master into a City Horizon quarter-turn runtime bundle.

This is intentionally deterministic and bounded. It is not a hidden image model: it
extracts alpha from a neutral dark preview background, normalizes the asset to the
CH 256x320 organic-scenery canvas, fixes the ground anchor, and derives four
quarter-turn variants with a conservative canopy warp. The method is suitable for
organic trees whose silhouette is approximately radial; truly directional assets
should still use four authored source views.
"""
from __future__ import annotations

import argparse
import json
import math
from pathlib import Path

import numpy as np
from PIL import Image, ImageFilter

CANVAS = (256, 320)
ANCHOR = (128, 311)
VIEWS = ("south", "west", "north", "east")


def _extract_alpha(source: Image.Image, background=(24, 24, 24)) -> Image.Image:
    rgb = source.convert("RGB")
    data = np.asarray(rgb).astype(np.float32)
    bg = np.asarray(background, dtype=np.float32)
    dist = np.sqrt(((data - bg) ** 2).sum(axis=2))
    chroma = data.max(axis=2) - data.min(axis=2)
    lum = data.mean(axis=2)
    score = np.maximum(dist, chroma * 1.7)
    alpha = np.clip((score - 8.0) / 28.0 * 255.0, 0, 255)
    alpha = np.maximum(alpha, np.clip((lum - 30.0) / 45.0 * 255.0, 0, 255))
    mask = Image.fromarray(alpha.astype(np.uint8)).filter(ImageFilter.GaussianBlur(0.65))
    mask = mask.point(lambda p: 0 if p < 18 else p)
    result = rgb.convert("RGBA")
    result.putalpha(mask)
    return result


def _normalize(tree: Image.Image, canvas=CANVAS, anchor=ANCHOR, max_size=(246, 286)) -> Image.Image:
    bbox = tree.getchannel("A").getbbox()
    if not bbox:
        raise ValueError("source image has no detectable foreground")
    crop = tree.crop(bbox)
    scale = min(max_size[0] / crop.width, max_size[1] / crop.height)
    crop = crop.resize((max(1, round(crop.width * scale)), max(1, round(crop.height * scale))), Image.Resampling.LANCZOS)
    out = Image.new("RGBA", canvas, (0, 0, 0, 0))
    out.alpha_composite(crop, (anchor[0] - crop.width // 2, anchor[1] - crop.height))
    return out


def _row_warp(image: Image.Image, amplitude: float, phase: float, squeeze: float) -> Image.Image:
    width, height = image.size
    squeezed = image.resize((max(1, round(width * squeeze)), height), Image.Resampling.LANCZOS)
    temp = Image.new("RGBA", image.size, (0, 0, 0, 0))
    temp.alpha_composite(squeezed, ((width - squeezed.width) // 2, 0))
    src = np.asarray(temp)
    dst = np.zeros_like(src)
    for y in range(height):
        t = 1.0 - y / max(1, height - 1)
        dx = int(round(amplitude * math.sin((t * 1.4 + phase) * math.pi) * t))
        if dx >= 0:
            dst[y, dx:] = src[y, : width - dx]
        else:
            dst[y, : width + dx] = src[y, -dx:]
    return Image.fromarray(dst, "RGBA")


def derive_views(master: Image.Image) -> dict[str, Image.Image]:
    south = master
    mirrored = master.transpose(Image.Transpose.FLIP_LEFT_RIGHT)
    return {
        "south": south,
        "west": _row_warp(south, -6.0, 0.15, 0.965),
        "north": _row_warp(mirrored, 3.0, 0.45, 0.98),
        "east": _row_warp(mirrored, 6.0, 0.15, 0.965),
    }


def convert(source_path: Path, output_dir: Path, asset_id: str) -> dict[str, str]:
    output_dir.mkdir(parents=True, exist_ok=True)
    master = _normalize(_extract_alpha(Image.open(source_path)))
    outputs = {}
    for view, image in derive_views(master).items():
        target = output_dir / f"{asset_id}_{view}.png"
        image.save(target, optimize=True)
        outputs[view] = str(target)
    return outputs


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("source", type=Path)
    parser.add_argument("output_dir", type=Path)
    parser.add_argument("--asset-id", default="park_tree_source_01")
    args = parser.parse_args()
    print(json.dumps(convert(args.source, args.output_dir, args.asset_id), indent=2))


if __name__ == "__main__":
    main()

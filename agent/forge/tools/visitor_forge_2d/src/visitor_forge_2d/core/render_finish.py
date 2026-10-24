from __future__ import annotations

import hashlib
import json
from pathlib import Path

from PIL import Image, ImageChops, ImageDraw, ImageEnhance, ImageFilter

CONTRACT = "CH_2D_RENDER_FINISH_V1"


def _sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def _load_recipe(path: Path) -> dict:
    recipe = json.loads(path.read_text(encoding="utf-8"))
    if recipe.get("contract") != CONTRACT:
        raise ValueError(f"Expected {CONTRACT}, got {recipe.get('contract')!r}")
    return recipe


def _hex_rgb(value: str) -> tuple[int, int, int]:
    value = value.strip()
    if len(value) != 7 or not value.startswith("#"):
        raise ValueError(f"Expected #RRGGBB color, got {value!r}")
    return tuple(int(value[i:i + 2], 16) for i in (1, 3, 5))


def _clamp01(value: float) -> float:
    return max(0.0, min(1.0, float(value)))


def _vertical_mask(size: tuple[int, int], start_fraction: float, end_fraction: float,
                   rising: bool) -> Image.Image:
    width, height = size
    start = _clamp01(start_fraction) * max(1, height - 1)
    end = _clamp01(end_fraction) * max(1, height - 1)
    if end <= start:
        raise ValueError("vertical mask end fraction must be greater than start fraction")
    values = []
    for y in range(height):
        if y <= start:
            t = 0.0
        elif y >= end:
            t = 1.0
        else:
            t = (y - start) / (end - start)
        if not rising:
            t = 1.0 - t
        values.append(round(255 * t))
    column = Image.new("L", (1, height))
    column.putdata(values)
    return column.resize((width, height))


def _cap_mask(size: tuple[int, int], max_y_fraction: float) -> Image.Image:
    width, height = size
    cutoff = round(_clamp01(max_y_fraction) * height)
    mask = Image.new("L", size, 0)
    if cutoff > 0:
        ImageDraw.Draw(mask).rectangle((0, 0, width, max(0, cutoff - 1)), fill=255)
    return mask


def _shift_l(image: Image.Image, dx: int, dy: int) -> Image.Image:
    shifted = Image.new("L", image.size, 0)
    shifted.paste(image, (int(dx), int(dy)))
    return shifted


def _apply_micro_artifact_cleanup(work: Image.Image, alpha: Image.Image, cfg: dict) -> Image.Image:
    """Suppress isolated dark pinholes inside the canopy without touching silhouette/trunk."""
    if not cfg or not cfg.get("enabled", False):
        return work

    radius = max(1, int(cfg.get("radiusPx", 1)))
    kernel = radius * 2 + 1
    median = work.filter(ImageFilter.MedianFilter(kernel))
    gray = work.convert("L")
    median_gray = median.convert("L")
    dark_delta = ImageChops.subtract(median_gray, gray)
    threshold = max(0, int(cfg.get("threshold", 20)))
    gain = max(0.0, float(cfg.get("gain", 8.0)))
    mask = dark_delta.point(
        lambda p: 0 if p <= threshold else min(255, round((p - threshold) * gain))
    )

    interior = alpha.filter(ImageFilter.MinFilter(kernel))
    mask = ImageChops.multiply(mask, interior)
    mask = ImageChops.multiply(mask, _cap_mask(work.size, float(cfg.get("maxYFraction", 1.0))))
    strength = _clamp01(float(cfg.get("strength", 0.75)))
    mask = mask.point(lambda p: round(p * strength))
    return Image.composite(median, work, mask)


def _apply_vertical_lighting(work: Image.Image, alpha: Image.Image, cfg: dict) -> Image.Image:
    if not cfg:
        return work

    max_y_fraction = float(cfg.get("canopyMaxYFraction", 1.0))
    canopy = _cap_mask(work.size, max_y_fraction)
    opaque = alpha.point(lambda p: 255 if p > 0 else 0)
    canopy = ImageChops.multiply(canopy, opaque)

    top_strength = _clamp01(float(cfg.get("topWarmStrength", 0.0)))
    if top_strength > 0.0:
        top_end = float(cfg.get("topWarmEndFraction", 0.58))
        top_mask = _vertical_mask(work.size, 0.0, top_end, rising=False)
        top_mask = ImageChops.multiply(top_mask, canopy)
        warm = Image.new("RGB", work.size, _hex_rgb(cfg.get("topWarmColor", "#D6B36A")))
        warm_target = Image.blend(work, warm, top_strength)
        work = Image.composite(warm_target, work, top_mask)

    base_strength = _clamp01(float(cfg.get("baseShadeStrength", 0.0)))
    if base_strength > 0.0:
        base_start = float(cfg.get("baseShadeStartFraction", 0.48))
        base_end = max(base_start + 0.01, min(max_y_fraction, 1.0))
        base_mask = _vertical_mask(work.size, base_start, base_end, rising=True)
        base_mask = ImageChops.multiply(base_mask, canopy)
        shade = Image.new("RGB", work.size, _hex_rgb(cfg.get("baseShadeColor", "#27351F")))
        shade_target = Image.blend(work, shade, base_strength)
        work = Image.composite(shade_target, work, base_mask)

    return work


def _apply_internal_separation(work: Image.Image, alpha: Image.Image, cfg: dict) -> Image.Image:
    if not cfg or not cfg.get("enabled", False):
        return work

    radius = max(1, int(cfg.get("radiusPx", 2)))
    kernel = radius * 2 + 1
    gray = work.convert("L")
    local_max = gray.filter(ImageFilter.MaxFilter(kernel))
    local_min = gray.filter(ImageFilter.MinFilter(kernel))
    edges = ImageChops.subtract(local_max, local_min)

    threshold = max(0, int(cfg.get("threshold", 6)))
    gain = max(0.0, float(cfg.get("gain", 4.0)))
    edges = edges.point(lambda p: 0 if p <= threshold else min(255, round((p - threshold) * gain)))

    # Keep the pass inside opaque pixels so outer antialiasing and silhouette stay untouched.
    interior = alpha.filter(ImageFilter.MinFilter(kernel))
    edges = ImageChops.multiply(edges, interior)
    max_y_fraction = float(cfg.get("maxYFraction", 1.0))
    edges = ImageChops.multiply(edges, _cap_mask(work.size, max_y_fraction))

    strength = _clamp01(float(cfg.get("strength", 0.34)))
    edges = edges.point(lambda p: round(p * strength))
    mix = _clamp01(float(cfg.get("colorMix", 0.30)))
    separation_color = Image.new("RGB", work.size, _hex_rgb(cfg.get("color", "#344329")))
    separation_target = Image.blend(work, separation_color, mix)
    return Image.composite(separation_target, work, edges)


def _apply_directional_relief(work: Image.Image, alpha: Image.Image, cfg: dict) -> Image.Image:
    """Bevel existing foliage value boundaries with camera-relative highlight/shadow."""
    if not cfg or not cfg.get("enabled", False):
        return work

    gray = work.convert("L")
    dx = int(cfg.get("offsetX", 1))
    dy = int(cfg.get("offsetY", 1))
    shifted = _shift_l(gray, dx, dy)
    highlight = ImageChops.subtract(gray, shifted)
    shadow = ImageChops.subtract(shifted, gray)

    threshold = max(0, int(cfg.get("threshold", 4)))
    gain = max(0.0, float(cfg.get("gain", 6.0)))
    remap = lambda p: 0 if p <= threshold else min(255, round((p - threshold) * gain))
    highlight = highlight.point(remap)
    shadow = shadow.point(remap)

    radius = max(1, int(cfg.get("interiorRadiusPx", 2)))
    interior = alpha.filter(ImageFilter.MinFilter(radius * 2 + 1))
    cap = _cap_mask(work.size, float(cfg.get("maxYFraction", 1.0)))
    valid = ImageChops.multiply(interior, cap)
    highlight = ImageChops.multiply(highlight, valid)
    shadow = ImageChops.multiply(shadow, valid)

    highlight_strength = _clamp01(float(cfg.get("highlightStrength", 0.22)))
    shadow_strength = _clamp01(float(cfg.get("shadowStrength", 0.30)))
    highlight = highlight.point(lambda p: round(p * highlight_strength))
    shadow = shadow.point(lambda p: round(p * shadow_strength))

    highlight_color = Image.new("RGB", work.size, _hex_rgb(cfg.get("highlightColor", "#D4C277")))
    shadow_color = Image.new("RGB", work.size, _hex_rgb(cfg.get("shadowColor", "#344329")))
    highlight_mix = _clamp01(float(cfg.get("highlightMix", 0.26)))
    shadow_mix = _clamp01(float(cfg.get("shadowMix", 0.34)))

    highlighted = Image.blend(work, highlight_color, highlight_mix)
    work = Image.composite(highlighted, work, highlight)
    shadowed = Image.blend(work, shadow_color, shadow_mix)
    return Image.composite(shadowed, work, shadow)


def finish_render(input_path: Path, output_path: Path, recipe_path: Path,
                  review_path: Path | None = None) -> dict:
    """Apply a deterministic 2D finishing pass without changing silhouette or alpha.

    This pass is intentionally conservative. It is meant for high-resolution Blender
    masters and deterministic 2D masters that already have approved geometry/camera/
    clearance. It may improve color separation, vertical light readability and local
    foliage depth, but alpha, canvas dimensions and object placement remain authoritative
    from the input render.
    """
    recipe = _load_recipe(recipe_path)
    source = Image.open(input_path).convert("RGBA")
    alpha = source.getchannel("A")
    rgb = source.convert("RGB")

    if min(source.size) < int(recipe.get("minimumInputDimensionPx", 1)):
        raise ValueError(
            f"Input {source.size} is below minimumInputDimensionPx="
            f"{recipe.get('minimumInputDimensionPx')}"
        )

    finish = recipe.get("finish", {})
    work = _apply_micro_artifact_cleanup(rgb, alpha, finish.get("microArtifactCleanup", {}))
    work = ImageEnhance.Color(work).enhance(float(finish.get("color", 1.0)))
    work = ImageEnhance.Contrast(work).enhance(float(finish.get("contrast", 1.0)))
    work = work.filter(ImageFilter.UnsharpMask(
        radius=float(finish.get("unsharpRadius", 1.0)),
        percent=int(finish.get("unsharpPercent", 0)),
        threshold=int(finish.get("unsharpThreshold", 0)),
    ))
    work = ImageEnhance.Sharpness(work).enhance(float(finish.get("sharpness", 1.0)))
    work = _apply_vertical_lighting(work, alpha, finish.get("verticalLighting", {}))
    work = _apply_internal_separation(work, alpha, finish.get("internalSeparation", {}))
    work = _apply_directional_relief(work, alpha, finish.get("directionalRelief", {}))

    # Protect antialiased edges so the pass never invents a new silhouette or halo.
    edge_low = int(finish.get("edgeGuardLowAlpha", 18))
    edge_high = int(finish.get("edgeGuardHighAlpha", 150))
    if edge_high <= edge_low:
        raise ValueError("edgeGuardHighAlpha must be greater than edgeGuardLowAlpha")
    edge_guard = alpha.point(
        lambda p: 0 if p <= edge_low else 255 if p >= edge_high
        else int((p - edge_low) * 255 / (edge_high - edge_low))
    )
    finished_rgb = Image.composite(work, rgb, edge_guard)

    # RGB under fully transparent pixels is forced to black to keep alpha-safe edges.
    visible = alpha.point(lambda p: 255 if p > 0 else 0)
    finished_rgb = Image.composite(
        finished_rgb,
        Image.new("RGB", source.size, (0, 0, 0)),
        visible,
    )
    finished = finished_rgb.convert("RGBA")
    finished.putalpha(alpha)

    output_path.parent.mkdir(parents=True, exist_ok=True)
    finished.save(output_path, format="PNG", optimize=False)

    review = None
    if review_path is not None:
        review_w = int(recipe.get("review", {}).get("cellWidth", 600))
        review_h = int(recipe.get("review", {}).get("cellHeight", 600))
        board = Image.new("RGBA", (review_w * 2, review_h), (22, 28, 34, 255))

        def cell(image: Image.Image) -> Image.Image:
            canvas = Image.new("RGBA", (review_w, review_h), (22, 28, 34, 255))
            copy = image.copy()
            copy.thumbnail((review_w - 20, review_h - 50), Image.Resampling.LANCZOS)
            x = (review_w - copy.width) // 2
            y = 35 + (review_h - 35 - copy.height) // 2
            canvas.alpha_composite(copy, (x, y))
            return canvas

        board.alpha_composite(cell(source), (0, 0))
        board.alpha_composite(cell(finished), (review_w, 0))
        draw = ImageDraw.Draw(board)
        draw.text((20, 12), "source master", fill=(235, 235, 235, 255))
        draw.text((review_w + 20, 12), "procedural 2D finish", fill=(235, 235, 235, 255))
        review_path.parent.mkdir(parents=True, exist_ok=True)
        board.save(review_path, format="PNG", optimize=False)
        review = str(review_path)

    return {
        "contract": CONTRACT,
        "status": "ok",
        "input": str(input_path),
        "output": str(output_path),
        "review": review,
        "size": list(source.size),
        "inputSha256": _sha256(input_path),
        "outputSha256": _sha256(output_path),
        "alphaPreserved": True,
        "geometryChanged": False,
        "microArtifactCleanupApplied": bool(finish.get("microArtifactCleanup", {}).get("enabled", False)),
        "verticalLightingApplied": bool(finish.get("verticalLighting")),
        "internalSeparationApplied": bool(finish.get("internalSeparation", {}).get("enabled", False)),
        "directionalReliefApplied": bool(finish.get("directionalRelief", {}).get("enabled", False)),
    }

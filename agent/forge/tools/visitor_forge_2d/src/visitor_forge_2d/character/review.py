"""Gameplay-sized, non-approval visual review of the SOUTH candidate."""

from __future__ import annotations

from PIL import Image, ImageChops, ImageOps

from visitor_forge_2d.core.exporter import alpha_safe_resize


def frame_measurements(frames: list[Image.Image], anchor: tuple[float, float]) -> dict:
    """Measure opaque body geometry, ignoring the separate translucent shadow."""
    if not frames:
        raise ValueError("At least one frame is required")
    size = frames[0].size
    if any(frame.size != size for frame in frames):
        raise ValueError("Every frame must use the same gameplay canvas")

    silhouettes = [frame.convert("RGBA").getchannel("A").point(
        lambda value: 255 if value >= 180 else 0
    ) for frame in frames]
    boxes = [mask.getbbox() for mask in silhouettes]
    if any(box is None for box in boxes):
        raise ValueError("A frame has no opaque character body")
    foot_rows = [box[3] - 1 for box in boxes if box is not None]
    changed = []
    for mask in silhouettes[1:]:
        diff = ImageChops.difference(silhouettes[0], mask)
        changed.append(round(sum(value != 0 for value in diff.tobytes()) /
                             max(1, sum(value != 0 for value in silhouettes[0].tobytes())), 4))

    return {
        "contract": "CH_VISITOR_2D_REVIEW_MEASUREMENTS_V1",
        "canvasSize": list(size),
        "bodyBounds": [list(box) for box in boxes if box is not None],
        "footRows": foot_rows,
        "footRowRangePx": max(foot_rows) - min(foot_rows),
        "anchor": [anchor[0], anchor[1]],
        "footOffsetFromAnchorPx": [round(row - anchor[1], 2) for row in foot_rows],
        "changedSilhouetteFractionFromIdle": changed,
        "artApproved": False,
    }


def gameplay_review(frames: list[Image.Image], background: Image.Image | None = None) -> Image.Image:
    """Display real 128px sprites over a terrain sample, without enlarging them."""
    if not frames:
        raise ValueError("At least one frame is required")
    width, height = frames[0].size
    panel_size = (width + 48, height + 48)
    if background is not None:
        source = background.convert("RGBA")
        # Transparent terrain diamonds are reference textures, not a full
        # screenshot. Sample their opaque center to avoid green panel corners.
        if (source.getchannel("A").getextrema()[0] < 255 and
                source.width >= width * 2 and source.height >= height * 2):
            box = source.getchannel("A").getbbox()
            if box is not None:
                center_x = (box[0] + box[2]) // 2
                center_y = (box[1] + box[3]) // 2
                side = min(source.width // 4, source.height // 3, 256)
                source = source.crop((center_x - side // 2, center_y - side // 2,
                                      center_x + side // 2, center_y + side // 2))
        sample = ImageOps.fit(source, panel_size, method=Image.Resampling.LANCZOS)
        backdrop = Image.alpha_composite(Image.new("RGBA", panel_size, (76, 116, 48, 255)), sample)
    else:
        backdrop = Image.new("RGBA", panel_size, (76, 116, 48, 255))

    result = Image.new("RGBA", (panel_size[0] * len(frames), panel_size[1]), (0, 0, 0, 0))
    for index, frame in enumerate(frames):
        if frame.size != (width, height):
            raise ValueError("Every frame must use the same gameplay canvas")
        panel = backdrop.copy()
        panel.alpha_composite(frame.convert("RGBA"), ((panel_size[0] - width) // 2, 16))
        result.alpha_composite(panel, (index * panel_size[0], 0))
    return result


def map_scale_review(
    frame: Image.Image,
    capture: Image.Image,
    crop: tuple[int, int, int, int],
    foot: tuple[int, int],
    display_height: int,
    anchor: tuple[int, int] = (64, 116),
) -> tuple[Image.Image, dict]:
    """Compare source and proposed display sizes on the same unscaled map crop.

    This is diagnostic. The source frame, its PNG metadata and the runtime are
    untouched; both panels place the same foot anchor on the same map pixel.
    """
    rgba = frame.convert("RGBA")
    if rgba.size != (128, 128):
        raise ValueError("Map scale review expects a 128x128 visitor frame")
    left, top, right, bottom = crop
    if not (0 <= left < right <= capture.width and 0 <= top < bottom <= capture.height):
        raise ValueError("Map crop must lie within the capture")
    if not (left <= foot[0] < right and top <= foot[1] < bottom):
        raise ValueError("Foot position must lie inside the crop")
    if display_height <= 0:
        raise ValueError("Candidate display height must be positive")

    body = rgba.getchannel("A").point(lambda value: 255 if value >= 180 else 0).getbbox()
    if body is None:
        raise ValueError("Visitor frame has no opaque body")
    source_height = body[3] - body[1]
    scale = display_height / source_height
    panel_size = (right - left, bottom - top)
    backdrop = capture.convert("RGBA").crop(crop)
    board = Image.new("RGBA", (panel_size[0] * 2, panel_size[1]))
    for index, ratio in enumerate((1.0, scale)):
        resized = (rgba if index == 0 else
                   alpha_safe_resize(rgba, tuple(max(1, round(dimension * ratio))
                                                 for dimension in rgba.size)))
        origin = (round(foot[0] - left - anchor[0] * ratio),
                  round(foot[1] - top - anchor[1] * ratio))
        panel = backdrop.copy()
        panel.alpha_composite(resized, origin)
        board.alpha_composite(panel, (index * panel_size[0], 0))

    return board, {
        "contract": "CH_VISITOR_2D_MAP_SCALE_REVIEW_V1",
        "sourceBodyHeightPx": source_height,
        "candidateBodyHeightPx": display_height,
        "candidateScale": round(scale, 4),
        "captureCrop": list(crop),
        "footInCapture": list(foot),
        "sourceAnchor": list(anchor),
        "panelSize": list(panel_size),
        "artApproved": False,
        "runtimePromotion": False,
    }

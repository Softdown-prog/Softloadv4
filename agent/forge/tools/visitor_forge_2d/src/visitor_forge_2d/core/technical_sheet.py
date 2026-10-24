"""Reusable technical-sheet preview for A7 Forge 2D assets.

The sheet is a review artifact only. It never replaces or modifies the
transparent runtime PNG.
"""

from __future__ import annotations

from PIL import Image, ImageDraw, ImageFont


def _font():
    return ImageFont.load_default()


def _fit(image: Image.Image, box: tuple[int, int]) -> Image.Image:
    src = image.convert("RGBA")
    w, h = src.size
    max_w, max_h = box
    scale = min(max_w / max(1, w), max_h / max(1, h), 1.5)
    size = (max(1, round(w * scale)), max(1, round(h * scale)))
    if size == src.size:
        return src
    return src.resize(size, Image.Resampling.LANCZOS)


def _paste_center(board: Image.Image, image: Image.Image, rect: tuple[int, int, int, int]) -> None:
    x0, y0, x1, y1 = rect
    fitted = _fit(image, (x1 - x0 - 24, y1 - y0 - 24))
    x = x0 + ((x1 - x0) - fitted.width) // 2
    y = y0 + ((y1 - y0) - fitted.height) // 2
    board.alpha_composite(fitted, (x, y))


def _draw_iso_grid(draw: ImageDraw.ImageDraw, center: tuple[int, int], cols=4, rows=4) -> None:
    gx, gy = center
    hw, hh = 64, 32
    for x in range(-cols // 2, cols // 2 + 1):
        for y in range(-rows // 2, rows // 2 + 1):
            cx = gx + (x - y) * hw
            cy = gy + (x + y) * hh
            poly = [(cx, cy - hh), (cx + hw, cy), (cx, cy + hh), (cx - hw, cy)]
            fill = (109, 142, 82, 255) if (x + y) % 2 == 0 else (101, 134, 76, 255)
            draw.polygon(poly, fill=fill, outline=(76, 103, 62, 255))


def technical_sheet(
    frame: Image.Image,
    *,
    asset_id: str,
    direction: str,
    anchor: tuple[int, int] | list[int],
    contract: str,
    yaw_deg: int | float | None = None,
    tile: tuple[int, int] | list[int] = (128, 64),
) -> Image.Image:
    """Build a light/dark/grid review sheet without changing the source PNG."""
    frame = frame.convert("RGBA")
    width, height = 768, 980
    board = Image.new("RGBA", (width, height), (239, 237, 228, 255))
    draw = ImageDraw.Draw(board)
    font = _font()

    draw.text((18, 14), "A7 Forge 2D technical sheet - synthetic grid, not runtime capture",
              fill=(35, 35, 35, 255), font=font)
    draw.text((18, 34), f"{asset_id} / {frame.width}x{frame.height}",
              fill=(35, 35, 35, 255), font=font)

    margin = 16
    gap = 18
    top_y = 62
    panel_w = (width - margin * 2 - gap) // 2
    panel_h = 318
    left = (margin, top_y, margin + panel_w, top_y + panel_h)
    right_x = margin + panel_w + gap
    right = (right_x, top_y, right_x + panel_w, top_y + panel_h)

    draw.rectangle(left, fill=(247, 245, 237, 255))
    draw.rectangle(right, fill=(36, 42, 50, 255))
    _paste_center(board, frame, left)
    _paste_center(board, frame, right)
    draw.text((left[0], left[3] + 8), "light background", fill=(35, 35, 35, 255), font=font)
    draw.text((right[0], right[3] + 8), "dark background", fill=(35, 35, 35, 255), font=font)

    grid_y = 426
    grid_h = 520
    draw.rectangle((0, grid_y, width, height), fill=(190, 202, 176, 255))
    label_rect = (16, grid_y + 12, 420, grid_y + 62)
    draw.rectangle(label_rect, fill=(247, 245, 237, 245))
    yaw_text = "" if yaw_deg is None else f" / yaw {yaw_deg:g}"
    draw.text((28, grid_y + 23), direction.upper(), fill=(35, 35, 35, 255), font=font)
    draw.text((28, grid_y + 40),
              f"tile {int(tile[0])}x{int(tile[1])} / zoom 1{yaw_text}",
              fill=(35, 35, 35, 255), font=font)

    gx, gy = width // 2, grid_y + 348
    _draw_iso_grid(draw, (gx, gy), 4, 4)

    ax, ay = int(anchor[0]), int(anchor[1])
    scale = min(1.65, 320 / max(1, frame.height), 360 / max(1, frame.width))
    preview = frame.resize((max(1, round(frame.width * scale)),
                            max(1, round(frame.height * scale))),
                           Image.Resampling.LANCZOS)
    px = round(gx - ax * scale)
    py = round(gy - ay * scale)
    board.alpha_composite(preview, (px, py))
    draw.line((gx - 8, gy, gx + 8, gy), fill=(180, 28, 28, 255), width=1)
    draw.line((gx, gy - 8, gx, gy + 8), fill=(180, 28, 28, 255), width=1)

    info_y = height - 26
    draw.text((16, info_y),
              f"{contract} / anchor [{ax},{ay}] / transparent PNG remains canonical",
              fill=(48, 61, 45, 255), font=font)
    return board

from PIL import Image, ImageChops, ImageDraw

from visitor_forge_2d.character.review import map_scale_review


def test_map_scale_review_preserves_map_pixels_and_foot_anchor() -> None:
    frame = Image.new("RGBA", (128, 128))
    ImageDraw.Draw(frame).rectangle((50, 16, 78, 115), fill=(200, 80, 40, 255))
    capture = Image.new("RGBA", (220, 180), (70, 110, 50, 255))
    crop = (20, 10, 180, 170)
    board, metrics = map_scale_review(frame, capture, crop, (100, 145), 50)

    assert board.size == (320, 160)
    assert metrics["sourceBodyHeightPx"] == 100
    assert metrics["candidateScale"] == 0.5
    assert metrics["artApproved"] is False

    backdrop = capture.crop(crop)
    boxes = []
    for index in (0, 1):
        panel = board.crop((index * 160, 0, (index + 1) * 160, 160))
        difference = ImageChops.difference(panel.convert("RGB"), backdrop.convert("RGB"))
        # Ignore subpixel Lanczos tails while measuring the visible body.
        difference = difference.convert("L").point(lambda value: 255 if value >= 25 else 0)
        boxes.append(difference.getbbox())
        assert panel.getpixel((0, 0)) == backdrop.getpixel((0, 0))
    assert boxes[0][3] == boxes[1][3]  # identical foot row in both map panels
    assert boxes[0][3] - boxes[0][1] == 100
    assert boxes[1][3] - boxes[1][1] == 50

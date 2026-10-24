from PIL import Image, ImageDraw

from visitor_forge_2d.character.identity_lock import (
    assert_identity_lock,
    identity_lock_measurements,
)


def _visitor_frame(*, leg_shift: int = 0) -> Image.Image:
    frame = Image.new("RGBA", (128, 128))
    draw = ImageDraw.Draw(frame)
    draw.ellipse((48, 16, 80, 48), fill=(220, 180, 150, 255))
    draw.rectangle((52, 50, 76, 82), fill=(70, 130, 180, 255))
    draw.rectangle((54 + leg_shift, 82, 62 + leg_shift, 115), fill=(60, 70, 90, 255))
    draw.rectangle((66 - leg_shift, 82, 74 - leg_shift, 115), fill=(60, 70, 90, 255))
    return frame


def test_identity_lock_allows_lower_body_walk_changes() -> None:
    frames = [_visitor_frame(), _visitor_frame(leg_shift=3), _visitor_frame(leg_shift=-3)]
    result = assert_identity_lock(frames)
    assert result["passed"] is True
    assert result["contract"] == "CH_VISITOR_IDENTITY_LOCK_V1"
    assert all(comparison["passed"] for comparison in result["comparisons"])


def test_identity_lock_rejects_head_identity_change() -> None:
    idle = _visitor_frame()
    changed = _visitor_frame(leg_shift=3)
    ImageDraw.Draw(changed).rectangle((55, 22, 65, 32), fill=(255, 0, 0, 255))

    result = identity_lock_measurements([idle, changed])
    assert result["passed"] is False
    assert result["comparisons"][0]["zones"]["head"]["passed"] is False


def test_identity_lock_ignores_hidden_transparent_rgb() -> None:
    idle = _visitor_frame()
    changed = _visitor_frame(leg_shift=2)
    changed.putpixel((41, 15), (255, 0, 0, 0))

    result = assert_identity_lock([idle, changed])
    assert result["passed"] is True

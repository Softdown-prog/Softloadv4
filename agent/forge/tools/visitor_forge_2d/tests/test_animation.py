from pathlib import Path
import json

from PIL import Image

from visitor_forge_2d.animation import ANIMATION_CONTRACT, package_animation


def _frame(path: Path, x: int) -> None:
    image = Image.new("RGBA", (16, 16), (0, 0, 0, 0))
    for y in range(5, 13):
        image.putpixel((x, y), (255, 255, 255, 255))
    image.save(path)


def test_package_pixel_animation_preserves_frame_grid(tmp_path: Path) -> None:
    _frame(tmp_path / "a.png", 5)
    _frame(tmp_path / "b.png", 10)
    recipe = {
        "contract": ANIMATION_CONTRACT,
        "id": "walk_south",
        "pixelArt": True,
        "loop": True,
        "frameDurationMs": 120,
        "anchor": [8, 15],
        "frames": [
            {"id": "walk_a", "path": "a.png"},
            {"id": "walk_b", "path": "b.png"},
        ],
    }
    recipe_path = tmp_path / "animation.json"
    recipe_path.write_text(json.dumps(recipe), encoding="utf-8")

    result = package_animation(recipe_path, tmp_path / "out")

    with Image.open(result["spritesheet"]) as sheet:
        assert sheet.mode == "RGBA"
        assert sheet.size == (32, 16)
        assert sheet.getpixel((5, 5))[3] == 255
        assert sheet.getpixel((26, 5))[3] == 255

    manifest = json.loads(Path(result["manifest"]).read_text(encoding="utf-8"))
    assert manifest["contract"] == ANIMATION_CONTRACT
    assert manifest["pixelArt"] is True
    assert manifest["anchor"] == [8, 15]
    assert manifest["sheet"]["resampling"] == "none"
    assert [frame["id"] for frame in manifest["frames"]] == ["walk_a", "walk_b"]


def test_rejects_mixed_frame_sizes(tmp_path: Path) -> None:
    _frame(tmp_path / "a.png", 5)
    Image.new("RGBA", (8, 8), (255, 255, 255, 255)).save(tmp_path / "b.png")
    recipe_path = tmp_path / "animation.json"
    recipe_path.write_text(json.dumps({
        "contract": ANIMATION_CONTRACT,
        "id": "bad",
        "frames": ["a.png", "b.png"],
    }), encoding="utf-8")

    try:
        package_animation(recipe_path, tmp_path / "out")
    except ValueError as exc:
        assert "one canvas" in str(exc)
    else:
        raise AssertionError("mixed frame sizes must be rejected")

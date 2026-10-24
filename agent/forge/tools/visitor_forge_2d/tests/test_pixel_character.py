from pathlib import Path
import json

from PIL import Image

from visitor_forge_2d.pixel_character import (
    PIXEL_CHARACTER_CONTRACT,
    render_pixel_character,
)
from visitor_forge_2d.pixel_polish import polish_native_pixel_art


def test_pixel_character_generates_four_direction_walks(tmp_path: Path) -> None:
    recipe = {
        "contract": PIXEL_CHARACTER_CONTRACT,
        "id": "pilot",
        "canvas": [32, 48],
        "anchor": [16, 46],
        "walkFrameDurationMs": 120,
        "palette": {"shirt": "#4f82c0"},
    }
    recipe_path = tmp_path / "pilot.json"
    recipe_path.write_text(json.dumps(recipe), encoding="utf-8")

    result = render_pixel_character(recipe_path, tmp_path / "out")

    assert result["directions"] == 4
    assert result["frames"] == 20
    manifest = json.loads(Path(result["manifest"]).read_text(encoding="utf-8"))
    assert manifest["pixelArt"] is True
    assert manifest["anchor"] == [16, 46]
    assert set(manifest["directions"]) == {"south", "east", "north", "west"}

    with Image.open(manifest["frames"]["south"]["idle"]) as frame:
        assert frame.mode == "RGBA"
        assert frame.size == (32, 48)
        assert frame.getchannel("A").getbbox() is not None

    south_animation = json.loads(Path(result["animationManifests"]["south"]).read_text(encoding="utf-8"))
    assert south_animation["frameCount"] == 4
    assert south_animation["pixelArt"] is True
    assert south_animation["sheet"]["resampling"] == "none"


def test_pixel_character_is_deterministic(tmp_path: Path) -> None:
    recipe_path = tmp_path / "pilot.json"
    recipe_path.write_text(json.dumps({
        "contract": PIXEL_CHARACTER_CONTRACT,
        "id": "stable",
        "canvas": [32, 48],
    }), encoding="utf-8")

    first = render_pixel_character(recipe_path, tmp_path / "first")
    second = render_pixel_character(recipe_path, tmp_path / "second")

    a = Path(json.loads(Path(first["manifest"]).read_text())["frames"]["east"]["walk_2"])
    b = Path(json.loads(Path(second["manifest"]).read_text())["frames"]["east"]["walk_2"])
    assert a.read_bytes() == b.read_bytes()

def test_pixel_wizard_archetype_is_class_readable(tmp_path: Path) -> None:
    recipe = {
        "contract": PIXEL_CHARACTER_CONTRACT,
        "id": "wizard",
        "archetype": "wizard",
        "canvas": [32, 48],
        "anchor": [16, 46],
        "palette": {
            "robe": "#6750A4",
            "hat": "#4B4597",
            "hatBand": "#D1A93A",
            "staff": "#79502F",
            "crystal": "#77D9FF"
        },
    }
    recipe_path = tmp_path / "wizard.json"
    recipe_path.write_text(json.dumps(recipe), encoding="utf-8")

    result = render_pixel_character(recipe_path, tmp_path / "wizard_out")
    manifest = json.loads(Path(result["manifest"]).read_text(encoding="utf-8"))

    assert manifest["archetype"] == "wizard"
    assert result["archetype"] == "wizard"
    with Image.open(manifest["frames"]["south"]["idle"]) as frame:
        assert frame.size == (32, 48)
        alpha = frame.getchannel("A")
        bounds = alpha.getbbox()
        assert bounds is not None
        assert bounds[1] >= 0
        assert bounds[2] <= 32
        assert bounds[3] <= 48
        # The staff extends the class silhouette beyond the ordinary torso.
        assert bounds[2] - bounds[0] >= 24


def test_pixel_polish_removes_only_true_island_and_fills_enclosed_hole() -> None:
    image = Image.new("RGBA", (7, 7), (0, 0, 0, 0))
    fill = (100, 80, 160, 255)

    # Solid 3x3 cluster with a one-pixel pinhole in the centre.
    for y in range(2, 5):
        for x in range(2, 5):
            image.putpixel((x, y), fill)
    image.putpixel((3, 3), (0, 0, 0, 0))

    # True isolated pixel: no 8-neighbour contact with the main cluster.
    image.putpixel((0, 0), (255, 255, 255, 255))

    polished, report = polish_native_pixel_art(image, "conservative")

    assert polished.getpixel((0, 0))[3] == 0
    assert polished.getpixel((3, 3)) == fill
    assert report["isolatedPixelsRemoved"] == 1
    assert report["pinholesFilled"] == 1
    assert report["changedPixels"] == 2


def test_pixel_polish_preserves_connected_diagonal_detail() -> None:
    image = Image.new("RGBA", (5, 5), (0, 0, 0, 0))
    color = (80, 120, 200, 255)
    image.putpixel((2, 2), color)
    image.putpixel((3, 3), color)

    polished, report = polish_native_pixel_art(image, "conservative")

    assert polished.getpixel((2, 2)) == color
    assert polished.getpixel((3, 3)) == color
    assert report["changedPixels"] == 0


def test_pixel_character_records_polish_audit(tmp_path: Path) -> None:
    recipe_path = tmp_path / "polished.json"
    recipe_path.write_text(json.dumps({
        "contract": PIXEL_CHARACTER_CONTRACT,
        "id": "polished",
        "canvas": [32, 48],
        "pixelPolishProfile": "conservative",
    }), encoding="utf-8")

    result = render_pixel_character(recipe_path, tmp_path / "out")
    manifest = json.loads(Path(result["manifest"]).read_text(encoding="utf-8"))

    assert result["pixelPolishProfile"] == "conservative"
    assert manifest["pixelPolish"]["profile"] == "conservative"
    assert manifest["pixelPolish"]["changedPixels"] >= 0
    assert set(manifest["pixelPolish"]["reports"]) == {"south", "east", "north", "west"}


def test_pixel_wizard_generates_staff_attack_animation(tmp_path: Path) -> None:
    recipe = {
        "contract": PIXEL_CHARACTER_CONTRACT,
        "id": "wizard_attack",
        "archetype": "wizard",
        "canvas": [32, 48],
        "anchor": [16, 46],
        "attackFrameDurationMs": 95,
    }
    recipe_path = tmp_path / "wizard_attack.json"
    recipe_path.write_text(json.dumps(recipe), encoding="utf-8")

    result = render_pixel_character(recipe_path, tmp_path / "wizard_attack_out")
    manifest = json.loads(Path(result["manifest"]).read_text(encoding="utf-8"))

    assert result["frames"] == 44
    assert set(result["attackAnimationManifests"]) == {"south", "east", "north", "west"}
    assert all(pose in manifest["poses"] for pose in (
        "attack_0", "attack_1", "attack_2", "attack_3", "attack_4", "attack_5"
    ))

    attack_manifest = json.loads(
        Path(result["attackAnimationManifests"]["south"]).read_text(encoding="utf-8")
    )
    assert attack_manifest["frameCount"] == 6
    assert attack_manifest["loop"] is False
    assert attack_manifest["pixelArt"] is True
    assert attack_manifest["sheet"]["resampling"] == "none"

    attack_frames = [
        Path(manifest["frames"]["south"][f"attack_{index}"]).read_bytes()
        for index in range(6)
    ]
    assert len(set(attack_frames)) >= 4


def test_pixel_wizard_projectile_trajectory_and_full_preview(tmp_path: Path) -> None:
    recipe = {
        "contract": PIXEL_CHARACTER_CONTRACT,
        "id": "wizard_projectile",
        "archetype": "wizard",
        "canvas": [32, 48],
        "anchor": [16, 46],
    }
    recipe_path = tmp_path / "wizard_projectile.json"
    recipe_path.write_text(json.dumps(recipe), encoding="utf-8")

    result = render_pixel_character(recipe_path, tmp_path / "wizard_projectile_out")
    manifest = json.loads(Path(result["manifest"]).read_text(encoding="utf-8"))

    assert set(result["projectileManifests"]) == {"south", "east", "north", "west"}
    assert set(result["fullAttackPreviews"]) == {"south", "east", "north", "west"}

    east = manifest["projectiles"]["east"]
    assert east["stepPx"] == 6
    assert len(east["trajectory"]) == 8
    assert east["trajectory"][0] == [0, 0]
    assert east["trajectory"][-1][0] > 0
    assert east["trajectory"][-1][1] == 0

    north = manifest["projectiles"]["north"]
    assert north["trajectory"][-1][0] == 0
    assert north["trajectory"][-1][1] < 0

    for preview in result["fullAttackPreviews"].values():
        path = Path(preview)
        assert path.is_file()
        with Image.open(path) as gif:
            # GIF may merge the identical north hold/release frames. The
            # playback still contains the complete 14-frame timeline.
            assert getattr(gif, "n_frames", 1) in {13, 14}
            durations = []
            for index in range(gif.n_frames):
                gif.seek(index)
                durations.append(gif.info["duration"])
            assert sum(durations) == 14 * 110

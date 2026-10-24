import json
from pathlib import Path

from PIL import Image

from visitor_forge_2d.core.flower_bed_scenery import export, render


def _canonical_recipe() -> dict:
    project_root = Path(__file__).resolve().parents[1]
    source = project_root / "examples" / "flower_bed_01.json"
    return json.loads(source.read_text(encoding="utf-8"))


def test_flower_bed_is_deterministic_and_camera_gated(tmp_path: Path) -> None:
    recipe = _canonical_recipe()
    first, metadata = render(recipe)
    second, _ = render(recipe)

    assert first.tobytes() == second.tobytes()
    assert first.mode == "RGBA"
    assert first.size == (160, 144)
    assert metadata["sceneryType"] == "flower_bed"
    assert metadata["camera"]["contract"] == "CH_CAMERA_V1"
    assert metadata["anchor"] == [80, 118]

    bounds = first.getchannel("A").getbbox()
    assert bounds is not None
    assert bounds[2] - bounds[0] >= 140
    assert bounds[3] - bounds[1] >= 80

    source = tmp_path / "flower_bed.json"
    source.write_text(json.dumps(recipe), encoding="utf-8")
    result = export(source, tmp_path / "out")
    with Image.open(result["review"]) as review:
        assert review.size == (528, 328)
    with Image.open(result["isometricReview"]) as review:
        assert review.size == (768, 480)


def test_flower_bed_recipe_keeps_dense_tall_yellow_profile() -> None:
    recipe = _canonical_recipe()
    assert recipe["layout"]["stemCount"] >= 36
    assert recipe["layout"]["minimumFlowerY"] <= 20
    assert len(recipe["palette"]["flower_yellows"]) >= 4
    assert recipe["validation"]["footprint"] == [1, 1]


def test_flower_bed_rejects_noncanonical_camera() -> None:
    recipe = _canonical_recipe()
    recipe["camera"]["tile"] = [64, 64]
    try:
        render(recipe)
        assert False, "noncanonical camera tile accepted"
    except ValueError as exc:
        assert "128x64" in str(exc)

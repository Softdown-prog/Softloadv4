import json
from pathlib import Path

from PIL import Image
import pytest

from visitor_forge_2d.core.fence_scenery import CONTRACT, export_fence_scenery, validate_recipe


def recipe() -> dict:
    return {
        "contract": CONTRACT,
        "id": "park_iron_fence_01",
        "camera": {"contract": "CH_CAMERA_V1", "tile": [128, 64], "yawDeg": 45, "elevationDeg": 30},
        "canvas": [192, 128],
        "anchor": [96, 64],
        "geometry": {"heightPx": 28, "stoneBaseWidthPx": 7, "barSpacingPx": 9,
                     "postWidthPx": 4, "railWidthPx": 2.5},
        "palette": {"metal": "#23282A", "metalHighlight": "#4F5757", "metalShadow": "#101415",
                    "stone": "#676158", "stoneHighlight": "#968C7B", "stoneShadow": "#3F3D3A",
                    "groundShadow": "#000000"},
    }


def test_fence_recipe_requires_project_camera() -> None:
    data = recipe()
    data["camera"]["elevationDeg"] = 35
    with pytest.raises(ValueError, match="CH_CAMERA_V1"):
        validate_recipe(data)


def test_fence_export_is_modular_rgba_and_deterministic(tmp_path: Path) -> None:
    recipe_path = tmp_path / "recipe.json"
    recipe_path.write_text(json.dumps(recipe(), sort_keys=True), encoding="utf-8")
    first = export_fence_scenery(recipe_path, tmp_path / "first")
    second = export_fence_scenery(recipe_path, tmp_path / "second")

    assert first["anchor"] == [96, 64]
    assert first["segmentVectors"] == {"east": [64.0, 32.0], "south": [-64.0, 32.0]}
    assert first["artApproved"] is False and first["runtimePromotion"] is False
    assert set(first["outputs"]) == {"segment_east", "segment_south", "gate_east", "gate_south", "post"}

    for key, path in first["outputs"].items():
        with Image.open(path) as image:
            assert image.mode == "RGBA", key
            assert image.size == (192, 128), key
            assert image.getchannel("A").getbbox() is not None, key
        assert Path(path).read_bytes() == Path(second["outputs"][key]).read_bytes()


def test_gate_keeps_stone_curb_out_of_opening(tmp_path: Path) -> None:
    recipe_path = tmp_path / "recipe.json"
    recipe_path.write_text(json.dumps(recipe()), encoding="utf-8")
    result = export_fence_scenery(recipe_path, tmp_path / "out")
    with Image.open(result["outputs"]["gate_east"]) as gate:
        # The gate may cast a translucent contact shadow, but an opaque stone
        # curb must not cross the walkable center of the opening.
        assert gate.getpixel((128, 80))[3] < 64

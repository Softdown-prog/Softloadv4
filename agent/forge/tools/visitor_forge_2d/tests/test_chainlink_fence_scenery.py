from pathlib import Path

from PIL import Image

from visitor_forge_2d.core.chainlink_fence_scenery import export_chainlink_fence_scenery


def test_chainlink_family_exports_modular_rgba(tmp_path: Path) -> None:
    recipe = Path(__file__).parents[1] / "examples" / "park_chainlink_fence_01.json"
    report = export_chainlink_fence_scenery(recipe, tmp_path)

    assert report["contract"] == "CH_2D_FENCE_SCENERY_V1"
    assert report["variant"] == "chainlink"
    assert report["id"] == "park_chainlink_fence_01"
    assert report["segmentVectors"] == {"east": [64.0, 32.0], "south": [-64.0, 32.0]}
    assert report["artApproved"] is False
    assert report["runtimePromotion"] is False

    for key in ("segment_east", "segment_south", "gate_east", "gate_south", "post"):
        image = Image.open(report["outputs"][key])
        assert image.mode == "RGBA"
        assert image.size == (192, 128)
        assert image.getbbox() is not None


def test_chainlink_output_is_deterministic(tmp_path: Path) -> None:
    recipe = Path(__file__).parents[1] / "examples" / "park_chainlink_fence_01.json"
    first = export_chainlink_fence_scenery(recipe, tmp_path / "a")
    second = export_chainlink_fence_scenery(recipe, tmp_path / "b")

    for key in ("segment_east", "segment_south", "gate_east", "gate_south", "post"):
        assert Path(first["outputs"][key]).read_bytes() == Path(second["outputs"][key]).read_bytes()

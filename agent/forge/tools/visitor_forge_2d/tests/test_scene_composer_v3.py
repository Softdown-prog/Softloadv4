import json
from pathlib import Path

from visitor_forge_2d.core.scene_composer_v3 import render_scene
from visitor_forge_2d.workers import run_workers, validate_recipe


EXAMPLES = Path(__file__).resolve().parents[1] / "examples"


def _recipe() -> dict:
    return json.loads((EXAMPLES / "prop_rowboat_scene_v3.json").read_text(encoding="utf-8"))


def test_scene_v3_is_deterministic_and_uses_camera_contract() -> None:
    recipe = _recipe()
    first, meta1 = render_scene(recipe)
    second, meta2 = render_scene(recipe)
    assert first.mode == "RGBA" and first.size == (256, 192)
    assert first.tobytes() == second.tobytes()
    assert meta1["bounds"] == meta2["bounds"]
    assert meta1["camera"]["contract"] == "CH_CAMERA_V1"


def test_scene_v3_worker_exports_review(tmp_path: Path) -> None:
    source = EXAMPLES / "prop_rowboat_scene_v3.json"
    result = run_workers(source, tmp_path)
    assert result["kind"] == "scene_v3"
    assert Path(result["png"]).is_file()
    assert Path(result["review"]).is_file()
    assert Path(result["isometricReview"]).is_file()
    assert result["audit"]["alpha"] == "RGBA"


def test_scene_v3_clip_group_changes_output() -> None:
    recipe = _recipe()
    base, _ = render_scene(recipe)
    recipe["layers"] = [node for node in recipe["layers"] if node.get("type") != "clip_group"]
    without_clipped_detail, _ = render_scene(recipe)
    assert base.tobytes() != without_clipped_detail.tobytes()


def test_scene_v3_rejects_wrong_camera_and_material() -> None:
    recipe = _recipe()
    recipe["camera"]["tile"] = [64, 64]
    try:
        validate_recipe(recipe)
        assert False, "wrong camera passed"
    except ValueError as exc:
        assert "CH_CAMERA_V1" in str(exc)

    recipe = _recipe()
    for node in recipe["layers"]:
        if node.get("type") == "shape" and isinstance(node.get("material"), dict):
            node["material"]["type"] = "unknown_material"
            break
    try:
        render_scene(recipe)
        assert False, "unknown material passed"
    except ValueError as exc:
        assert "type must be one of" in str(exc)

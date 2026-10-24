import json
from pathlib import Path

from visitor_forge_2d.core.scene_composer_v2 import render_scene
from visitor_forge_2d.workers import run_workers, validate_recipe


def _recipe() -> dict:
    return {
        "contract": "CH_2D_SCENE_RECIPE_V2",
        "id": "scene_v2_compat",
        "canvas": [96, 80],
        "anchor": [48, 72],
        "seed": 7,
        "camera": {"contract": "CH_CAMERA_V1", "tile": [128, 64], "yawDeg": 45, "elevationDeg": 30},
        "lighting": {"direction": [-1, -1], "shadowOffset": [2, 3]},
        "layers": [
            {"type": "shape", "primitive": "polygon", "points": [[18,45],[36,26],[69,26],[82,45],[66,59],[31,60]], "material": {"type": "wood", "light": "#C58A54", "dark": "#60351F", "grainAxis": "x", "grainLines": 14}, "effects": {"bevel": {"width": 1, "strength": 0.25}}}
        ]
    }


def _write(recipe: dict, path: Path) -> Path:
    path.write_text(json.dumps(recipe), encoding="utf-8")
    return path


def test_scene_v2_is_deterministic_and_carries_lighting() -> None:
    recipe = _recipe()
    first, first_meta = render_scene(recipe)
    second, second_meta = render_scene(recipe)
    assert first.mode == "RGBA" and first.size == (96, 80)
    assert first.tobytes() == second.tobytes()
    assert first_meta["bounds"] == second_meta["bounds"]
    assert first_meta["lighting"]["direction"] == [-1, -1]


def test_scene_v2_worker_exports_review(tmp_path: Path) -> None:
    source = _write(_recipe(), tmp_path / "scene_v2.json")
    result = run_workers(source, tmp_path / "out")
    assert result["kind"] == "scene_v2"
    assert Path(result["png"]).is_file()
    assert Path(result["review"]).is_file()
    assert Path(result["isometricReview"]).is_file()
    assert result["audit"]["alpha"] == "RGBA"


def test_scene_v2_rejects_unknown_material() -> None:
    recipe = _recipe()
    recipe["layers"][0]["material"]["type"] = "magic_plastic"
    try:
        render_scene(recipe)
        assert False, "unknown material passed"
    except ValueError as exc:
        assert "type must be one of" in str(exc)


def test_scene_v2_still_requires_ch_camera() -> None:
    recipe = _recipe()
    recipe["camera"]["tile"] = [64, 64]
    try:
        validate_recipe(recipe)
        assert False, "wrong camera passed"
    except ValueError as exc:
        assert "CH_CAMERA_V1" in str(exc)

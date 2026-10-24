import json
from pathlib import Path

from visitor_forge_2d.core.scene_composer import render_scene
from visitor_forge_2d.workers import run_workers, validate_recipe


def _recipe() -> dict:
    return {
        "contract": "CH_2D_SCENE_RECIPE_V1",
        "id": "scene_v1_compat",
        "canvas": [96, 80],
        "anchor": [48, 72],
        "seed": 3,
        "camera": {"contract": "CH_CAMERA_V1", "tile": [128, 64], "yawDeg": 45, "elevationDeg": 30},
        "symbols": {
            "rivet": [{"type": "shape", "primitive": "ellipse", "box": [-1, -1, 1, 1], "material": {"type": "solid", "color": "#B8B8B8"}}]
        },
        "layers": [
            {"type": "shape", "primitive": "polygon", "points": [[18,45],[36,26],[69,26],[82,45],[66,59],[31,60]], "material": {"type": "linear_gradient", "start": "#A76637", "end": "#5B321E"}},
            {"type": "scatter", "symbol": "rivet", "count": 4, "spread": [15,5], "rotationRange": [0,0], "scaleRange": [1,1], "transform": {"translate": [50,45]}}
        ]
    }


def _write(recipe: dict, path: Path) -> Path:
    path.write_text(json.dumps(recipe), encoding="utf-8")
    return path


def test_scene_composer_is_deterministic_and_rgba() -> None:
    recipe = _recipe()
    first, first_meta = render_scene(recipe)
    second, second_meta = render_scene(recipe)
    assert first.mode == "RGBA" and first.size == (96, 80)
    assert first.tobytes() == second.tobytes()
    assert first_meta["bounds"] == second_meta["bounds"]
    assert first_meta["camera"]["contract"] == "CH_CAMERA_V1"


def test_scene_worker_exports_review_and_camera_review(tmp_path: Path) -> None:
    source = _write(_recipe(), tmp_path / "scene_v1.json")
    result = run_workers(source, tmp_path / "out")
    assert result["kind"] == "scene"
    assert Path(result["png"]).is_file()
    assert Path(result["review"]).is_file()
    assert Path(result["isometricReview"]).is_file()
    assert result["audit"]["alpha"] == "RGBA"
    assert result["artApproved"] is False and result["runtimePromotion"] is False


def test_scene_rejects_unknown_symbol_and_unsafe_camera() -> None:
    recipe = _recipe()
    recipe["layers"].append({"type": "symbol", "symbol": "does_not_exist"})
    try:
        render_scene(recipe)
        assert False, "unknown symbol passed"
    except ValueError as exc:
        assert "unknown symbol" in str(exc)

    recipe = _recipe()
    recipe["camera"]["elevationDeg"] = 35.264
    try:
        validate_recipe(recipe)
        assert False, "wrong camera passed"
    except ValueError as exc:
        assert "CH_CAMERA_V1" in str(exc)


def test_scene_rejects_unbounded_scatter() -> None:
    recipe = _recipe()
    recipe["layers"].append({"type": "scatter", "symbol": "rivet", "count": 10000, "spread": [10, 10], "rotationRange": [0, 0], "scaleRange": [1, 1]})
    try:
        render_scene(recipe)
        assert False, "unbounded scatter passed"
    except ValueError as exc:
        assert "1..256" in str(exc)

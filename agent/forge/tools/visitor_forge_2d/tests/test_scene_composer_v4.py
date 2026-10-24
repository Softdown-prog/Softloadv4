import json
from pathlib import Path

from PIL import Image

from visitor_forge_2d.core import localized_finish
from visitor_forge_2d.core.scene_composer_v4 import render_scene
from visitor_forge_2d.workers import run_workers, validate_recipe


EXAMPLES = Path(__file__).resolve().parents[1] / "examples"


def _recipe() -> dict:
    return json.loads((EXAMPLES / "prop_rowboat_scene_v4.json").read_text(encoding="utf-8"))


def test_scene_v4_is_deterministic_and_has_critic() -> None:
    recipe = _recipe()
    first, meta1 = render_scene(recipe)
    second, meta2 = render_scene(recipe)
    assert first.mode == "RGBA" and first.size == (256, 192)
    assert first.tobytes() == second.tobytes()
    assert meta1["critic"] == meta2["critic"]
    assert "edgeComplexity" in meta1["critic"]
    assert meta1["contract"] == "CH_2D_SCENE_RECIPE_V4"
    assert meta1["finishRegionCount"] == 3


def test_scene_v4_worker_exports_visual_critic(tmp_path: Path) -> None:
    result = run_workers(EXAMPLES / "prop_rowboat_scene_v4.json", tmp_path)
    assert result["kind"] == "scene_v4"
    assert "visual_critic" in result["workers"]
    assert result["audit"]["critic"] is not None
    assert Path(result["png"]).is_file()
    assert Path(result["review"]).is_file()
    assert Path(result["isometricReview"]).is_file()


def test_scene_v4_finish_changes_v3_style() -> None:
    recipe = _recipe()
    styled, _ = render_scene(recipe)
    recipe["finish"] = {"edgeBreakupPx": 0, "surfaceVariation": 0, "brushStamps": 0, "brushOpacity": 0}
    recipe["finishRegions"] = []
    plain, _ = render_scene(recipe)
    assert styled.tobytes() != plain.tobytes()


def test_scene_v4_localized_finish_is_deterministic_and_masked() -> None:
    recipe = _recipe()
    recipe["finishRegions"] = [{
        "style": "wood_wear",
        "mask": {"primitive": "smooth_polygon", "samplesPerSegment": 6, "tension": 0.42,
                 "points": [[48,109],[67,84],[107,76],[172,73],[207,101],[182,145],[86,149],[58,130]]},
        "stamps": 38,
        "opacity": 0.16,
        "angleDeg": -6
    }]
    first, meta1 = render_scene(recipe)
    second, meta2 = render_scene(recipe)
    assert first.tobytes() == second.tobytes()
    assert meta1["finishRegionCount"] == 1 == meta2["finishRegionCount"]

    recipe["finishRegions"] = []
    plain, _ = render_scene(recipe)
    assert first.tobytes() != plain.tobytes()


def test_material_finish_vocabulary_is_bounded_and_deterministic() -> None:
    base = Image.new("RGBA", (48, 40), (118, 91, 65, 255))
    mask = {"primitive": "rect", "box": [5, 5, 43, 35]}
    styles = ["plank_seams", "paint_chips", "rust_bloom", "grime", "rope_fibers"]
    for style in styles:
        regions = [{"style": style, "mask": mask, "stamps": 8, "opacity": 0.14, "angleDeg": 12}]
        first = localized_finish.apply_regions(base, regions, 91)
        second = localized_finish.apply_regions(base, regions, 91)
        assert first.tobytes() == second.tobytes()
        assert first.tobytes() != base.tobytes()


def test_scene_v4_rejects_unbounded_finish_and_wrong_camera() -> None:
    recipe = _recipe()
    recipe["finish"]["brushStamps"] = 10000
    try:
        render_scene(recipe)
        assert False, "unbounded finish passed"
    except ValueError as exc:
        assert "brushStamps" in str(exc)

    recipe = _recipe()
    recipe["finishRegions"] = [{"style": "magic", "mask": {"primitive": "ellipse", "box": [1,1,4,4]}}]
    try:
        render_scene(recipe)
        assert False, "unknown localized finish style passed"
    except ValueError as exc:
        assert ".style" in str(exc)

    recipe = _recipe()
    recipe["camera"]["elevationDeg"] = 35.264
    try:
        validate_recipe(recipe)
        assert False, "wrong camera passed"
    except ValueError as exc:
        assert "CH_CAMERA_V1" in str(exc)


def test_scene_v4_resolves_gallery_components_deterministically() -> None:
    recipe = json.loads((EXAMPLES / "prop_component_gallery_demo_v1.json").read_text(encoding="utf-8"))
    first, meta1 = render_scene(recipe)
    second, meta2 = render_scene(recipe)
    assert first.mode == "RGBA" and first.size == (192, 192)
    assert first.tobytes() == second.tobytes()
    assert meta1["componentInstanceCount"] == 7 == meta2["componentInstanceCount"]
    assert set(meta1["componentIds"]) >= {
        "wood_plank_clean_lg_000",
        "metal_pipe_round_lg_090",
        "sign_panel_rounded_md_000",
        "fastener_rivet_sm_000",
    }


def test_scene_v4_rejects_unknown_gallery_component() -> None:
    recipe = json.loads((EXAMPLES / "prop_component_gallery_demo_v1.json").read_text(encoding="utf-8"))
    recipe["layers"][1]["componentId"] = "does_not_exist"
    try:
        render_scene(recipe)
        assert False, "unknown component passed"
    except KeyError as exc:
        assert "does_not_exist" in str(exc)

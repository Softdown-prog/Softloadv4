import pytest

from visitor_forge_2d.prop_sign_grammar import build_sign_recipe
from visitor_forge_2d.workers import validate_recipe


def test_sign_grammar_builds_two_post_weatherable_scene() -> None:
    first = build_sign_recipe("sign_test", 17, material="metal", board_shape="rounded",
                              posts=2, arrow="left", cap=True)
    second = build_sign_recipe("sign_test", 17, material="metal", board_shape="rounded",
                               posts=2, arrow="left", cap=True)
    assert first == second
    assert first["contract"] == "CH_2D_SCENE_RECIPE_V4"
    assert first["camera"]["contract"] == "CH_CAMERA_V1"
    assert first["propGrammar"]["archetype"] == "sign"
    assert first["propGrammar"]["parameters"] == {
        "material": "metal", "boardShape": "rounded", "posts": 2,
        "arrow": "left", "cap": True,
    }
    assert sum(node.get("role") == "sign_post" for node in first["layers"]) == 2
    assert any(node.get("role") == "direction_icon" for node in first["layers"])
    assert {region["style"] for region in first["finishRegions"]} == {"paint_chips", "rust_bloom"}
    validate_recipe(first)


def test_sign_grammar_supports_arrow_board_without_overlay_icon() -> None:
    recipe = build_sign_recipe("sign_arrow", 18, material="wood", board_shape="arrow",
                               posts=1, arrow="right", cap=False)
    assert not any(node.get("role") == "direction_icon" for node in recipe["layers"])
    board = next(node for node in recipe["layers"] if node.get("role") == "sign_board")
    assert board["primitive"] == "polygon"
    assert {region["style"] for region in recipe["finishRegions"]} == {"wood_wear", "edge_wear"}
    validate_recipe(recipe)


def test_sign_grammar_rejects_unbounded_or_unknown_parameters() -> None:
    with pytest.raises(ValueError, match="material"):
        build_sign_recipe("bad_sign", 1, material="plastic")
    with pytest.raises(ValueError, match="posts"):
        build_sign_recipe("bad_sign", 1, posts=3)
    with pytest.raises(ValueError, match="arrow"):
        build_sign_recipe("bad_sign", 1, arrow="up")

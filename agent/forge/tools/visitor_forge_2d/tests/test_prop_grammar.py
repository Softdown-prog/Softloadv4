import json
from pathlib import Path

import pytest

from visitor_forge_2d.prop_grammar import GRAMMAR_CONTRACT, build_pier_recipe, configure_rowboat_recipe
from visitor_forge_2d.workers import validate_recipe

EXAMPLES = Path(__file__).resolve().parents[1] / "examples"


def test_parametric_pier_builds_dimensions_and_features_deterministically() -> None:
    first = build_pier_recipe("pier_long_test", 99, length_tiles=4, width_tiles=2,
                              ladder=False, cleats=True, railing=True)
    second = build_pier_recipe("pier_long_test", 99, length_tiles=4, width_tiles=2,
                               ladder=False, cleats=True, railing=True)
    assert first == second
    assert first["contract"] == "CH_2D_SCENE_RECIPE_V4"
    assert first["camera"]["contract"] == "CH_CAMERA_V1"
    assert first["propGrammar"]["contract"] == GRAMMAR_CONTRACT
    assert first["propGrammar"]["parameters"] == {
        "lengthTiles": 4, "widthTiles": 2, "ladder": False, "cleats": True, "railing": True
    }
    roles = [node.get("role") for node in first["layers"]]
    assert "ladder" not in roles
    assert "railing" in roles
    assert roles.count("cleat") == 2
    validate_recipe(first)


def test_parametric_pier_rejects_unbounded_dimensions() -> None:
    with pytest.raises(ValueError, match="lengthTiles"):
        build_pier_recipe("pier_bad", 1, length_tiles=7)
    with pytest.raises(ValueError, match="widthTiles"):
        build_pier_recipe("pier_bad", 1, width_tiles=0)


def test_rowboat_grammar_scales_and_removes_semantic_parts() -> None:
    template = json.loads((EXAMPLES / "prop_rowboat_scene_v4.json").read_text(encoding="utf-8"))
    small = configure_rowboat_recipe(template, size="small", oar=False, seats=1)
    large = configure_rowboat_recipe(template, size="large", oar=True, seats=2)
    assert small["propGrammar"]["contract"] == GRAMMAR_CONTRACT
    assert small["propGrammar"]["parameters"] == {"size": "small", "oar": False, "seats": 1}
    assert not any(node.get("role") == "oar" for node in small["layers"])
    assert sum(node.get("role") == "seat" for node in small["layers"]) == 1
    assert sum(node.get("role") == "seat" for node in large["layers"]) == 2
    small_hull = next(node for node in small["layers"] if node.get("role") == "outer_hull")
    large_hull = next(node for node in large["layers"] if node.get("role") == "outer_hull")
    small_width = max(p[0] for p in small_hull["points"]) - min(p[0] for p in small_hull["points"])
    large_width = max(p[0] for p in large_hull["points"]) - min(p[0] for p in large_hull["points"])
    assert large_width > small_width
    validate_recipe(small)
    validate_recipe(large)

from visitor_forge_2d.prop_street_grammar import (
    build_bench_recipe,
    build_bollard_recipe,
    build_planter_recipe,
    build_trash_bin_recipe,
)
from visitor_forge_2d.workers import validate_recipe


def test_bench_variants_are_semantic_and_valid() -> None:
    bench = build_bench_recipe("bench_test", 31, material="wood", backrest=True, armrests=False, length="long")
    assert bench["propGrammar"]["archetype"] == "bench"
    assert bench["propGrammar"]["parameters"]["length"] == "long"
    roles = [n.get("role") for n in bench["layers"]]
    assert "backrest" in roles
    assert "armrest" not in roles
    assert any(r["style"] == "wood_wear" for r in bench["finishRegions"])
    validate_recipe(bench)


def test_bollard_planter_and_bin_use_shared_scene_contract() -> None:
    bollard = build_bollard_recipe("bollard_test", 32, material="stone", cap="flat")
    planter = build_planter_recipe("planter_test", 33, material="metal", shape="square")
    bin_scene = build_trash_bin_recipe("bin_test", 34, material="wood", lid=False)
    for recipe in (bollard, planter, bin_scene):
        assert recipe["contract"] == "CH_2D_SCENE_RECIPE_V4"
        assert recipe["camera"]["contract"] == "CH_CAMERA_V1"
        assert recipe["propGrammar"]["contract"] == "CH_2D_PROP_GRAMMAR_V1"
        validate_recipe(recipe)
    assert bollard["propGrammar"]["archetype"] == "bollard"
    assert planter["propGrammar"]["archetype"] == "planter"
    assert bin_scene["propGrammar"]["archetype"] == "trash_bin"
    assert not any(n.get("role") == "lid" for n in bin_scene["layers"])


def test_street_grammar_is_deterministic() -> None:
    a = build_bench_recipe("bench_same", 99, material="metal", backrest=False, armrests=True, length="short")
    b = build_bench_recipe("bench_same", 99, material="metal", backrest=False, armrests=True, length="short")
    assert a == b

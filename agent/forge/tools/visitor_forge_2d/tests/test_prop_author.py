import json
from pathlib import Path

import pytest

from visitor_forge_2d.prop_author import CONTRACT, author_prop_recipe, interpret_prop_prompt, run_prop_author


def test_prop_prompt_routes_boat_pier_and_sign_with_parameters() -> None:
    assert interpret_prop_prompt("barco pequeno usado sem remo") == {
        "archetype": "rowboat", "condition": "used", "size": "small", "oar": False
    }
    assert interpret_prop_prompt("píer longo e largo envelhecido com escada e guarda-corpo") == {
        "archetype": "pier", "condition": "weathered", "lengthTiles": 4, "widthTiles": 2,
        "ladder": True, "railing": True
    }
    assert interpret_prop_prompt("placa nova") == {"archetype": "sign", "condition": "pristine"}
    assert interpret_prop_prompt("placa metálica envelhecida com duas hastes e seta esquerda") == {
        "archetype": "sign", "condition": "weathered", "material": "metal", "posts": 2, "arrow": "left"
    }


def test_prop_author_builds_weathered_parametric_pier_deterministically() -> None:
    brief = {
        "contract": CONTRACT, "id": "pier_weathered_study",
        "prompt": "píer longo de madeira envelhecido sem escada", "seed": 301,
    }
    first, report1 = author_prop_recipe(brief)
    second, report2 = author_prop_recipe(brief)
    assert first == second
    assert report1 == report2
    assert first["contract"] == "CH_2D_SCENE_RECIPE_V4"
    assert first["camera"]["contract"] == "CH_CAMERA_V1"
    assert first["authorIntent"]["archetype"] == "pier"
    assert first["authorIntent"]["condition"] == "weathered"
    assert first["authorIntent"]["lengthTiles"] == 4
    assert first["authorIntent"]["ladder"] is False
    assert first["finish"]["brushStamps"] >= 34
    assert any(region["style"] == "plank_seams" for region in first["finishRegions"])
    assert report1["source"] == "parametric:pier_v1"
    assert report1["grammarContract"] == "CH_2D_PROP_GRAMMAR_V1"
    assert report1["runtimePromotion"] is False


def test_prop_author_condition_changes_scene_without_changing_contract() -> None:
    used, _ = author_prop_recipe({"contract": CONTRACT, "id": "boat_used", "archetype": "rowboat", "condition": "used", "seed": 17})
    pristine, _ = author_prop_recipe({"contract": CONTRACT, "id": "boat_clean", "archetype": "rowboat", "condition": "pristine", "seed": 17})
    assert used["contract"] == pristine["contract"] == "CH_2D_SCENE_RECIPE_V4"
    assert pristine["finish"]["brushStamps"] <= 10
    assert pristine["finish"]["surfaceVariation"] <= used["finish"]["surfaceVariation"]


def test_prop_author_structured_pier_and_rowboat_parameters() -> None:
    pier, pier_report = author_prop_recipe({
        "contract": CONTRACT, "id": "pier_structured", "archetype": "pier", "seed": 44,
        "lengthTiles": 2, "widthTiles": 2, "ladder": False, "cleats": False, "railing": True,
    })
    assert pier["propGrammar"]["parameters"]["lengthTiles"] == 2
    assert pier["propGrammar"]["parameters"]["widthTiles"] == 2
    assert not any(node.get("role") == "ladder" for node in pier["layers"])
    assert not any(node.get("role") == "cleat" for node in pier["layers"])
    assert pier_report["parameters"]["railing"] is True

    boat, boat_report = author_prop_recipe({
        "contract": CONTRACT, "id": "boat_variant", "archetype": "rowboat", "seed": 45,
        "size": "large", "oar": False, "seats": 1,
    })
    assert boat["propGrammar"]["parameters"] == {"size": "large", "oar": False, "seats": 1}
    assert not any(node.get("role") == "oar" for node in boat["layers"])
    assert sum(node.get("role") == "seat" for node in boat["layers"]) == 1
    assert boat_report["source"].startswith("parametric:rowboat_v1")


def test_prop_author_builds_parametric_sign_and_weathering() -> None:
    sign, report = author_prop_recipe({
        "contract": CONTRACT, "id": "sign_variant", "archetype": "sign", "seed": 46,
        "material": "metal", "boardShape": "rounded", "posts": 2,
        "arrow": "left", "cap": True, "condition": "weathered",
    })
    assert sign["contract"] == "CH_2D_SCENE_RECIPE_V4"
    assert sign["camera"]["contract"] == "CH_CAMERA_V1"
    assert sign["propGrammar"]["parameters"] == {
        "material": "metal", "boardShape": "rounded", "posts": 2, "arrow": "left", "cap": True
    }
    assert sum(node.get("role") == "sign_post" for node in sign["layers"]) == 2
    assert any(node.get("role") == "direction_icon" for node in sign["layers"])
    assert {region["style"] for region in sign["finishRegions"]} == {"paint_chips", "rust_bloom"}
    assert sign["finish"]["brushStamps"] >= 34
    assert report["source"] == "parametric:sign_v1"
    assert report["grammarContract"] == "CH_2D_PROP_GRAMMAR_V1"


def test_prop_author_runs_pier_through_workers(tmp_path: Path) -> None:
    result = run_prop_author({"contract": CONTRACT, "id": "pier_worker_study", "archetype": "pier", "seed": 77}, tmp_path)
    assert result["status"] == "review_ready"
    assert Path(result["png"]).is_file()
    assert Path(result["review"]).is_file()
    report = json.loads(Path(result["report"]).read_text(encoding="utf-8"))
    assert report["archetype"] == "pier"
    assert report["render"]["kind"] == "scene_v4"
    assert report["runtimePromotion"] is False


def test_prop_author_rejects_ambiguous_conflicting_or_unsupported_requests() -> None:
    with pytest.raises(ValueError, match="multiple prop archetypes"):
        interpret_prop_prompt("barco ao lado de um píer")
    with pytest.raises(ValueError, match="unsupported prop"):
        interpret_prop_prompt("um avião")
    with pytest.raises(ValueError, match="sign material"):
        author_prop_recipe({"contract": CONTRACT, "id": "bad_sign", "archetype": "sign", "material": "plastic"})
    with pytest.raises(ValueError, match="disagree"):
        author_prop_recipe({"contract": CONTRACT, "id": "pier_conflict", "prompt": "píer longo", "lengthTiles": 2})

import json
from pathlib import Path

import pytest

from visitor_forge_2d.art_author import CONTRACT, author_recipe, interpret_prompt, run_art_author


def test_author_round_trip_from_portuguese_intent(tmp_path: Path) -> None:
    brief = {"contract": CONTRACT, "id": "autumn_tree_case",
             "prompt": "árvore folhosa de outono, copa arredondada e densa"}
    first, report = author_recipe(brief)
    second, _ = author_recipe(brief)
    assert first == second
    assert first["camera"]["contract"] == "CH_CAMERA_V1"
    assert first["broadleafStructure"]["layout"] == "branch_guided_groups"
    assert first["broadleafStructure"]["density"] == 1.28
    assert report["artApproved"] is False

    result = run_art_author(brief, tmp_path)
    saved = json.loads(Path(result["report"]).read_text(encoding="utf-8"))
    assert Path(result["png"]).is_file()
    assert Path(result["isometricReview"]).is_file()
    assert saved["status"] == "review_ready"
    assert saved["critique"]["status"] == "human_visual_review_required"
    assert saved["render"]["pngSha256"]
    assert saved["artApproved"] is False


def test_author_routes_other_families_without_guessing() -> None:
    for subject, contract in (("conifer", "CH_2D_ORGANIC_SCENERY_V1"),
                              ("flower_bed", "CH_2D_ORGANIC_SCENERY_V1"),
                              ("sign", "CH_2D_SHAPE_RECIPE_V1")):
        recipe, _ = author_recipe({"contract": CONTRACT, "id": f"study_{subject}", "subject": subject})
        assert recipe["contract"] == contract
    assert interpret_prompt("um pinheiro alto") == {"subject": "conifer", "silhouette": "tall"}
    custom, _ = author_recipe({"contract": CONTRACT, "id": "custom_tree", "subject": "custom",
                               "template": "park_tree_broadleaf_early_autumn_v1.json",
                               "recipeUpdates": {"broadleafStructure": {"masses": 52}}})
    assert custom["broadleafStructure"]["masses"] == 52


def test_visual_profiles_route_known_tree_and_flower_grammars() -> None:
    tropical, report = author_recipe({
        "contract": CONTRACT,
        "id": "mango_profile_study",
        "visualProfile": "drooping_lanceolate_tropical",
        "seed": 77,
    })
    assert tropical["visualProfile"] == "drooping_lanceolate_tropical"
    assert tropical["authorIntent"]["visualProfile"] == "drooping_lanceolate_tropical"
    assert tropical["broadleafStructure"]["radius"] == [73, 66]
    assert tropical["broadleafStructure"]["layout"] == "branch_guided_groups"
    assert tropical["broadleafStructure"]["density"] == 1.28
    assert tropical["visualProfileData"]["foliage"]["microLeafBrush"] == "leaf_cluster_lanceolate"
    assert "visualProfile=drooping_lanceolate_tropical" in report["decisions"]

    maple, maple_report = author_recipe({
        "contract": CONTRACT,
        "id": "maple_profile_study",
        "visualProfile": "red_mapple_open_branching",
        "seed": 91,
    })
    assert maple["sceneryType"] == "red_mapple"
    assert maple["visualProfile"] == "red_mapple_open_branching"
    assert maple["visualProfileData"]["foliage"]["microLeafBrush"] == "leaf_cluster_maple"
    assert maple_report["subject"] == "custom"

    daisy, daisy_report = author_recipe({
        "contract": CONTRACT,
        "id": "daisy_profile_study",
        "visualProfile": "flower_bed_daisy_clustered",
        "seed": 61,
    })
    assert daisy["sceneryType"] == "flower_bed_v2"
    assert daisy["visualProfile"] == "flower_bed_daisy_clustered"
    assert daisy["visualProfileData"]["foliage"]["flowerBrush"] == "flower_rosette"
    assert daisy["flowerStyle"]["flowerBrush"] == "flower_rosette"
    assert daisy_report["subject"] == "custom"

    with pytest.raises(ValueError, match="unknown visualProfile"):
        author_recipe({"contract": CONTRACT, "id": "bad_profile", "visualProfile": "missing_profile"})


def test_organic_styles_choose_distinct_canopies_and_named_palettes() -> None:
    oiti, _ = author_recipe({"contract": CONTRACT, "id": "oiti_study",
                             "prompt": "oiti de copa fechada, verde fresco", "seed": 11})
    angico, _ = author_recipe({"contract": CONTRACT, "id": "angico_study",
                               "prompt": "angico de copa aberta, verde profundo", "seed": 11})
    assert oiti["broadleafStructure"]["profile"] == "domed"
    assert angico["broadleafStructure"]["profile"] == "branching"
    assert oiti["broadleafStructure"]["layout"] == "branch_guided_groups"
    assert angico["broadleafStructure"]["layout"] == "species_canopy"
    assert oiti["broadleafStructure"]["species"] == "oiti"
    assert angico["broadleafStructure"]["species"] == "angico"
    named, _ = author_recipe({"contract": CONTRACT, "id": "named_oiti",
                              "subject": "broadleaf", "species": "oiti", "seed": 11})
    assert named["broadleafStructure"]["profile"] == "domed"
    leaves, _ = author_recipe({"contract": CONTRACT, "id": "defined_oiti",
                               "subject": "broadleaf", "species": "oiti",
                               "leaf_detail": "defined", "seed": 11})
    assert leaves["broadleafStructure"]["layout"] == "branch_guided_groups"
    assert leaves["broadleafStructure"]["leafDetail"] == "defined"
    assert oiti["palette"]["highlight"] != angico["palette"]["highlight"]
    assert oiti["camera"] == angico["camera"]
    with pytest.raises(ValueError, match="unknown organic palette"):
        author_recipe({"contract": CONTRACT, "id": "bad_palette", "subject": "broadleaf",
                       "palette": "neon"})
    with pytest.raises(ValueError, match="requires style"):
        author_recipe({"contract": CONTRACT, "id": "mismatch", "subject": "broadleaf",
                       "species": "oiti", "style": "open_branching"})
    with pytest.raises(ValueError, match="autumn foliage"):
        author_recipe({"contract": CONTRACT, "id": "evergreen_autumn", "subject": "broadleaf",
                       "species": "oiti", "season": "early_autumn"})
    with pytest.raises(ValueError, match="require species"):
        author_recipe({"contract": CONTRACT, "id": "unknown_leaves", "subject": "broadleaf",
                       "leaf_detail": "defined"})


def test_unknown_subject_and_protected_contract_are_rejected() -> None:
    with pytest.raises(ValueError, match="unsupported"):
        author_recipe({"contract": CONTRACT, "id": "rocket", "prompt": "uma nave espacial"})
    with pytest.raises(ValueError, match="frozen"):
        author_recipe({"contract": CONTRACT, "id": "edited_sign", "subject": "custom",
                       "template": "park_wayfinding_sign.json",
                       "recipeUpdates": {"camera": {"contract": "wrong"}}})
    with pytest.raises(ValueError, match="filename"):
        author_recipe({"contract": CONTRACT, "id": "escape", "subject": "custom", "template": "../escape.json"})

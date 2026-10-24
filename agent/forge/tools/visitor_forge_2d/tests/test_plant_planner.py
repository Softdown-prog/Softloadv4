import math

from visitor_forge_2d.core.art_planner import (
    ART_PLANNER_CONTRACT,
    PLANT_INTENT_CONTRACT,
    plan_plant_four_views,
    profile_from_intent,
)
from visitor_forge_2d.core.field_graph import FIELD_GRAPH_CONTRACT, validate_recipe
from visitor_forge_2d.core.flower_cluster_engine import FLOWER_CLUSTER_CONTRACT
from visitor_forge_2d.core.plant_structure import (
    CARDINAL_VIEWS,
    PLANT_STRUCTURE_CONTRACT,
    generate_plant_structure,
    project_four_views,
    topology_signature,
)


def _intent() -> dict:
    return {
        "contract": PLANT_INTENT_CONTRACT,
        "id": "planner_test_tree",
        "species": "ipe_amarelo",
        "age": "adult",
        "crown": "wide_irregular",
        "flowering": {"amount": 0.75, "color": "#F2C531"},
        "seed": 99173,
        "canvas": [256, 320],
        "anchor": [128, 310],
    }


def _planar_length(branch) -> float:
    start, end = branch.points[0], branch.points[-1]
    return math.hypot(end.x - start.x, end.y - start.y)


def test_structural_plant_engine_is_deterministic() -> None:
    first = generate_plant_structure(12345, {"primaryCount": 5, "secondaryPerPrimary": 2})
    second = generate_plant_structure(12345, {"primaryCount": 5, "secondaryPerPrimary": 2})

    assert PLANT_STRUCTURE_CONTRACT == "A7_PLANT_STRUCTURE_V2"
    assert first == second
    assert topology_signature(first.branches) == topology_signature(second.branches)
    assert len(first.terminal_points) == 20
    assert first.terminal_points == first.flower_bearing_points


def test_v2_ramification_uses_short_flower_bearing_twigs() -> None:
    structure = generate_plant_structure(
        11881,
        {
            "primaryCount": 5,
            "secondaryPerPrimary": 2,
            "tertiaryPerSecondary": 2,
            "visibleWood": 0.34,
        },
    )
    primaries = [branch for branch in structure.branches if branch.order == 1]
    secondaries = [branch for branch in structure.branches if branch.order == 2]
    twigs = [branch for branch in structure.branches if branch.order == 3]

    assert len(primaries) == 5
    assert len(secondaries) == 10
    assert len(twigs) == 20
    assert all(len(branch.points) == 4 for branch in primaries + secondaries + twigs)
    assert all(not branch.terminal for branch in secondaries)
    assert all(branch.terminal and branch.flower_bearing for branch in twigs)
    assert max(_planar_length(branch) for branch in secondaries) < 0.34
    assert max(_planar_length(branch) for branch in twigs) < 0.18
    assert max(branch.exposure for branch in twigs) < min(branch.exposure for branch in secondaries)
    assert max(branch.exposure for branch in secondaries) < min(branch.exposure for branch in primaries)


def test_ipe_profile_matches_approved_four_by_ten_fork_rhythm() -> None:
    profile = profile_from_intent(_intent())
    assert profile["primaryCount"] == 4
    assert profile["secondaryPattern"] == [3, 2, 3, 2]
    assert profile["visibleWood"] == 0.34
    assert profile["secondaryAttach"][0] <= 0.34
    assert profile["primaryRiseRatioMin"] == 0.50

    structure = generate_plant_structure(_intent()["seed"], profile)
    primaries = [branch for branch in structure.branches if branch.order == 1]
    secondaries = [branch for branch in structure.branches if branch.order == 2]
    twigs = [branch for branch in structure.branches if branch.order == 3]

    assert len(primaries) == 4
    assert len(secondaries) == 10
    assert len(twigs) == 20
    assert [sum(branch.parent_id == primary.branch_id for branch in secondaries) for primary in primaries] == [3, 2, 3, 2]
    assert len(structure.terminal_points) == 20


def test_ipe_primary_forks_keep_a_rising_silhouette_in_all_views() -> None:
    profile = profile_from_intent(_intent())
    structure = generate_plant_structure(_intent()["seed"], profile)
    views = project_four_views(structure)

    for projection in views.values():
        primary_paths = [path for path in projection.paths if path["order"] == 1]
        assert len(primary_paths) == 4
        for path in primary_paths:
            start = path["points"][0]
            end = path["points"][-1]
            dx = abs(end[0] - start[0])
            dy = end[1] - start[1]
            assert dy < -0.18 * max(1.0, dx)


def test_four_views_share_topology_but_change_projection() -> None:
    structure = generate_plant_structure(77, {"primaryCount": 6, "secondaryPerPrimary": 2})
    views = project_four_views(structure)

    assert tuple(views) == CARDINAL_VIEWS
    branch_ids = views["south"].branch_ids
    assert all(projection.branch_ids == branch_ids for projection in views.values())
    assert views["south"].terminals != views["west"].terminals
    assert views["north"].terminals != views["east"].terminals
    assert all(len(projection.terminals) == len(structure.terminal_points) for projection in views.values())
    assert all(any(path.get("flowerBearing") for path in projection.paths) for projection in views.values())


def test_art_planner_compiles_valid_v2_recipes_for_all_views() -> None:
    structure, recipes = plan_plant_four_views(_intent())

    assert ART_PLANNER_CONTRACT == "A7_ART_PLANNER_V1"
    assert structure.contract == PLANT_STRUCTURE_CONTRACT
    assert set(recipes) == set(CARDINAL_VIEWS)
    expected_branch_ids = [branch.branch_id for branch in structure.branches]

    for view, recipe in recipes.items():
        validate_recipe(recipe)
        assert recipe["contract"] == FIELD_GRAPH_CONTRACT
        assert recipe["planner"]["contract"] == ART_PLANNER_CONTRACT
        assert recipe["planner"]["view"] == view
        assert recipe["planner"]["branchIds"] == expected_branch_ids
        assert recipe["planner"]["terminalCount"] == len(structure.terminal_points)
        assert recipe["planner"]["temporaryFlowerProxy"] is False
        assert recipe["planner"]["flowerPlacement"] == "terminal_density"
        assert recipe["planner"]["flowerEngineContract"] == FLOWER_CLUSTER_CONTRACT
        assert recipe["planner"]["foliageComposition"] == "rear_meso_front_detail"
        assert recipe["planner"]["mesoFoliage"] == "compound_asymmetric_internal"
        node_types = {node["type"] for node in recipe["graph"]["nodes"]}
        node_ids = {node["id"] for node in recipe["graph"]["nodes"]}
        assert "field_cluster_scatter" in node_types
        assert "field_flower_clusters" in node_types
        assert "image_masked_relief_material" in node_types
        assert "image_contact_occlusion" in node_types
        assert {"meso_foliage", "meso_shadow", "meso_composite"} <= node_ids
        assert {"flower_density", "flower_clusters", "flower_composite"} <= node_ids

        by_id = {node["id"]: node for node in recipe["graph"]["nodes"]}
        assert by_id["meso_foliage"]["inputs"]["density"] == "rear_core_density"
        assert by_id["meso_foliage"]["inputs"]["avoid"] == "wood_mask"
        assert by_id["front_shadow"]["inputs"]["base"] == "meso_composite"
        assert by_id["meso_foliage"]["params"]["count"] < by_id["front_foliage"]["params"]["count"]
        assert len(by_id["meso_foliage"]["params"]["cluster"]["members"]) >= 5

        scatters = [
            node for node in recipe["graph"]["nodes"]
            if node["type"] in {"field_cluster_scatter", "field_mapped_scatter", "field_flower_clusters"}
        ]
        for node in scatters:
            bounds = node.get("params", {}).get("bounds")
            if bounds is not None:
                assert bounds[0] >= 34
                assert bounds[2] <= recipe["canvas"][0] - 34
                assert bounds[1] >= 30
                assert bounds[3] <= recipe["canvas"][1] - 28


def test_planner_crown_and_flowers_are_derived_from_projected_terminals() -> None:
    structure, recipes = plan_plant_four_views(_intent())
    recipe = recipes["south"]
    crown = next(node for node in recipe["graph"]["nodes"] if node["id"] == "crown_density")
    flowers = next(node for node in recipe["graph"]["nodes"] if node["id"] == "flower_density")
    flower_clusters = next(node for node in recipe["graph"]["nodes"] if node["id"] == "flower_clusters")
    meso = next(node for node in recipe["graph"]["nodes"] if node["id"] == "meso_foliage")

    crown_lobes = crown["params"]["lobes"]
    flower_lobes = flowers["params"]["lobes"]
    assert len(crown_lobes) == len(structure.terminal_points) + 1
    assert len(flower_lobes) == len(structure.terminal_points)
    assert all("center" in lobe and "radius" in lobe for lobe in crown_lobes)
    assert all("center" in lobe and "radius" in lobe for lobe in flower_lobes)
    assert meso["inputs"]["density"] == "rear_core_density"
    assert flower_clusters["type"] == "field_flower_clusters"
    assert flower_clusters["params"]["palette"]["midTop"] == _intent()["flowering"]["color"]
    assert flower_clusters["params"]["palette"]["highlight"] != _intent()["flowering"]["color"]
    assert flower_clusters["params"]["gapWindows"] == [2, 3]

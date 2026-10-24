from PIL import Image, ImageDraw

from visitor_forge_2d.core.plant_visual_critic import (
    PLANT_REPAIR_CONTRACT,
    PLANT_VISUAL_CRITIC_CONTRACT,
    aggregate_critic_reports,
    apply_repair_plan,
    evaluate_plant_render,
    propose_repair,
)


def _recipe() -> dict:
    return {
        "contract": "CH_2D_GRAPH_RECIPE_V2",
        "id": "critic_fixture",
        "canvas": [96, 120],
        "anchor": [48, 116],
        "seed": 77,
        "planner": {"branchIds": ["trunk", "p00", "p00s00t00"]},
        "graph": {
            "seed": 77,
            "nodes": [
                {"id": "crown_density", "type": "field_radial_density", "params": {"power": 0.9, "lobes": [{"center": [48, 42], "radius": [31, 24], "weight": 1.0}]}},
                {"id": "wood_structure", "type": "tapered_path", "params": {"paths": [
                    {"points": [[48, 116], [48, 72], [47, 43]], "widthStart": 8, "widthEnd": 3, "fill": "#795337FF", "exposure": 1.0},
                    {"points": [[47, 58], [35, 48], [29, 39]], "widthStart": 4, "widthEnd": 1.2, "fill": "#795337B8", "exposure": 0.72},
                ]}},
                {"id": "rear_foliage", "type": "field_cluster_scatter", "params": {"count": 8, "scale": [0.8, 1.0], "minDistance": 12, "bounds": [8, 8, 88, 94]}},
                {"id": "front_foliage", "type": "field_cluster_scatter", "params": {"count": 14, "scale": [0.7, 1.0], "minDistance": 10, "bounds": [8, 8, 88, 94]}},
                {"id": "detail_foliage", "type": "field_mapped_scatter", "params": {"count": 12, "scale": [0.4, 0.6], "minDistance": 5, "bounds": [8, 8, 88, 94]}},
                {"id": "flower_density", "type": "field_radial_density", "params": {"lobes": [{"center": [32, 38], "radius": [12, 9], "weight": 1.0}]}},
                {"id": "flower_clusters", "type": "field_flower_clusters", "params": {"count": 8, "radiusX": [8, 12], "radiusY": [6, 9], "minDistance": 7, "bounds": [8, 8, 88, 94]}},
                {"id": "wood_visible", "type": "tapered_path", "params": {"paths": [
                    {"points": [[48, 116], [48, 72], [47, 43]], "widthStart": 8, "widthEnd": 3, "fill": "#795337FF", "exposure": 1.0},
                    {"points": [[47, 58], [35, 48], [29, 39]], "widthStart": 4, "widthEnd": 1.2, "fill": "#795337B8", "exposure": 0.72},
                ]}},
            ],
        },
    }


def _good_frame() -> Image.Image:
    image = Image.new("RGBA", (96, 120), (0, 0, 0, 0))
    draw = ImageDraw.Draw(image, "RGBA")
    draw.rounded_rectangle((18, 18, 78, 68), radius=18, fill=(62, 119, 62, 245))
    draw.ellipse((24, 12, 54, 45), fill=(77, 137, 69, 245))
    draw.rectangle((44, 50, 52, 116), fill=(121, 83, 55, 255))
    draw.line((48, 58, 30, 39), fill=(121, 83, 55, 210), width=4)
    return image


def _bad_frame() -> Image.Image:
    image = Image.new("RGBA", (96, 120), (0, 0, 0, 0))
    draw = ImageDraw.Draw(image, "RGBA")
    draw.ellipse((3, 14, 24, 34), fill=(68, 125, 62, 240))
    draw.ellipse((68, 14, 94, 37), fill=(68, 125, 62, 240))
    draw.rectangle((44, 30, 52, 119), fill=(130, 86, 52, 255))
    draw.line((48, 54, 8, 18), fill=(130, 86, 52, 255), width=5)
    draw.line((48, 54, 90, 18), fill=(130, 86, 52, 255), width=5)
    return image


def test_visual_critic_is_deterministic() -> None:
    first = evaluate_plant_render(_recipe(), _good_frame())
    second = evaluate_plant_render(_recipe(), _good_frame())
    assert first == second
    assert first["contract"] == PLANT_VISUAL_CRITIC_CONTRACT
    assert 0.0 <= first["score"] <= 100.0
    assert 0.0 <= first["metrics"]["crownContinuity"] <= 1.0
    assert 0.0 <= first["metrics"]["crownFill"] <= 1.0
    assert 0.0 <= first["metrics"]["crownWoodExposure"] <= 1.0


def test_bad_views_produce_shared_repair_plan() -> None:
    report = evaluate_plant_render(_recipe(), _bad_frame())
    aggregate = aggregate_critic_reports({"south": report, "west": report, "north": report, "east": report})
    plan = propose_repair(aggregate)
    assert plan["contract"] == PLANT_REPAIR_CONTRACT
    assert plan["changed"] is True
    assert plan["reasons"]
    assert plan["frontCountScale"] >= 1.0


def test_repair_changes_visual_parameters_not_identity() -> None:
    recipe = _recipe()
    bad = evaluate_plant_render(recipe, _bad_frame())
    aggregate = aggregate_critic_reports({"south": bad})
    plan = propose_repair(aggregate)
    repaired = apply_repair_plan(recipe, plan)

    assert repaired["seed"] == recipe["seed"]
    assert repaired["planner"]["branchIds"] == recipe["planner"]["branchIds"]
    assert repaired["planner"]["repair"]["contract"] == PLANT_REPAIR_CONTRACT

    original_front = next(node for node in recipe["graph"]["nodes"] if node["id"] == "front_foliage")
    repaired_front = next(node for node in repaired["graph"]["nodes"] if node["id"] == "front_foliage")
    assert repaired_front["params"]["count"] >= original_front["params"]["count"]

    original_crown = next(node for node in recipe["graph"]["nodes"] if node["id"] == "crown_density")
    repaired_crown = next(node for node in repaired["graph"]["nodes"] if node["id"] == "crown_density")
    assert repaired_crown["params"]["lobes"][0]["center"] == original_crown["params"]["lobes"][0]["center"]

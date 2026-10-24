import json
from pathlib import Path

from PIL import Image

from visitor_forge_2d.core.field_brush_engine import FIELD_BRUSH_CONTRACT, FieldBrushEngineV1
from visitor_forge_2d.core.field_cluster_engine import FIELD_CLUSTER_CONTRACT, FieldClusterEngineV1
from visitor_forge_2d.core.field_engine import (
    FIELD_ENGINE_CONTRACT,
    direction_to_point,
    distance_to_mask,
    linear_depth,
    mask_from_alpha,
    multiply_fields,
    radial_density,
    sample_direction_deg,
    sample_scalar,
)
from visitor_forge_2d.core.field_graph import FIELD_GRAPH_CONTRACT, execute, validate_recipe


def _cluster() -> dict:
    leaf = {
        "type": "brush",
        "brushes": ["foliage/leaf_oval_01.png", "foliage/leaf_oval_02.png"],
        "scale": [0.48, 0.62],
        "aspect": [0.8, 1.2],
        "rotationDeg": [-18, 18],
        "opacity": [240, 255],
        "tints": ["#3F7546", "#5A9650"],
    }
    return {
        "members": [
            {**leaf, "offset": [-5, 0]},
            {**leaf, "offset": [0, -5]},
            {**leaf, "offset": [5, 0]},
            {**leaf, "offset": [0, 5]},
        ]
    }


def test_field_primitives_are_deterministic_and_normalized() -> None:
    density_a = radial_density((64, 64), [{"center": [32, 28], "radius": [24, 18], "weight": 1.0}], power=1.0)
    density_b = radial_density((64, 64), [{"center": [32, 28], "radius": [24, 18], "weight": 1.0}], power=1.0)
    assert density_a.mode == "L"
    assert density_a.tobytes() == density_b.tobytes()
    assert sample_scalar(density_a, 32, 28) > sample_scalar(density_a, 8, 8)

    depth = linear_depth((64, 64), [0, 0], [0, 63])
    assert sample_scalar(depth, 20, 2) < sample_scalar(depth, 20, 60)

    direction = direction_to_point((64, 64), [32, 32])
    assert 0.0 <= sample_direction_deg(direction, 10, 32) < 360.0


def test_mask_distance_and_multiply_fields() -> None:
    source = Image.new("RGBA", (64, 64), (0, 0, 0, 0))
    for y in range(22, 42):
        for x in range(29, 35):
            source.putpixel((x, y), (110, 70, 40, 255))
    mask = mask_from_alpha(source, expand_px=2, blur_radius=1.0)
    proximity = distance_to_mask(mask, max_distance=20, proximity=True)
    density = radial_density((64, 64), [{"center": [32, 30], "radius": [26, 24]}], power=0.8)
    combined = multiply_fields(density, proximity)
    assert combined.mode == "L"
    assert sample_scalar(proximity, 32, 30) > sample_scalar(proximity, 4, 4)
    assert sample_scalar(combined, 32, 30) > 0.0


def test_field_brush_distribution_uses_field_sensors_and_spacing() -> None:
    canvas_a = Image.new("RGBA", (96, 96), (0, 0, 0, 0))
    canvas_b = Image.new("RGBA", (96, 96), (0, 0, 0, 0))
    density = radial_density((96, 96), [{"center": [48, 43], "radius": [34, 28]}], power=0.75)
    depth = linear_depth((96, 96), [0, 12], [0, 78])
    direction = direction_to_point((96, 96), [48, 43], offset_deg=180)
    mappings = {
        "scale_mul": {"base": 0.9, "inputs": {"density": [[0, -0.1], [1, 0.2]]}},
        "value_mul": {"base": 0.9, "inputs": {"depth": [[0, -0.05], [1, 0.15]]}},
    }
    dynamics = {
        "scale": [0.45, 0.65],
        "aspect": [0.8, 1.2],
        "rotation_deg": [-12, 12],
        "opacity": [235, 255],
        "tints": ["#3F7546", "#5A9650"],
        "mirror_x_probability": 0.5,
        "hue_jitter_deg": 3,
        "saturation": [0.95, 1.05],
        "value": [0.95, 1.05],
    }
    a = FieldBrushEngineV1(771)
    b = FieldBrushEngineV1(771)
    stamps_a, stats_a = a.scatter(
        canvas_a, ["foliage/leaf_oval_01.png", "foliage/leaf_oval_02.png"], 28,
        density_field=density, depth_field=depth, direction_field=direction,
        bounds=[14, 12, 82, 74], min_distance=6, mappings=mappings, dynamics=dynamics,
    )
    stamps_b, stats_b = b.scatter(
        canvas_b, ["foliage/leaf_oval_01.png", "foliage/leaf_oval_02.png"], 28,
        density_field=density, depth_field=depth, direction_field=direction,
        bounds=[14, 12, 82, 74], min_distance=6, mappings=mappings, dynamics=dynamics,
    )
    assert a.contract == FIELD_BRUSH_CONTRACT
    assert stats_a == stats_b
    assert stamps_a == stamps_b
    assert canvas_a.tobytes() == canvas_b.tobytes()
    assert stats_a["fieldContract"] == FIELD_ENGINE_CONTRACT
    assert stats_a["placed"] == 28
    for index, first in enumerate(stamps_a):
        for second in stamps_a[index + 1:]:
            dx, dy = first.x - second.x, first.y - second.y
            assert (dx * dx + dy * dy) ** 0.5 >= 6 - 1e-9


def test_field_cluster_distribution_is_deterministic() -> None:
    first = Image.new("RGBA", (112, 112), (0, 0, 0, 0))
    second = Image.new("RGBA", (112, 112), (0, 0, 0, 0))
    density = radial_density((112, 112), [{"center": [56, 49], "radius": [42, 34]}], power=0.7)
    depth = linear_depth((112, 112), [0, 16], [0, 88])
    direction = direction_to_point((112, 112), [56, 52], offset_deg=180)
    mappings = {"scale_mul": {"base": 0.9, "inputs": {"density": [[0, -0.08], [1, 0.18]]}}}
    a = FieldClusterEngineV1(884)
    b = FieldClusterEngineV1(884)
    stats_a = a.scatter(
        first, _cluster(), 10,
        density_field=density, depth_field=depth, direction_field=direction,
        bounds=[18, 15, 94, 84], min_distance=13, scale=[0.9, 1.1], mappings=mappings,
    )
    stats_b = b.scatter(
        second, _cluster(), 10,
        density_field=density, depth_field=depth, direction_field=direction,
        bounds=[18, 15, 94, 84], min_distance=13, scale=[0.9, 1.1], mappings=mappings,
    )
    assert a.contract == FIELD_CLUSTER_CONTRACT
    assert stats_a == stats_b
    assert first.tobytes() == second.tobytes()
    assert stats_a["clusterCount"] == 10
    assert stats_a["leafStampCount"] == 40
    assert stats_a["fieldConditioned"] is True


def test_field_graph_tree_pilot_is_deterministic() -> None:
    path = Path(__file__).resolve().parents[1] / "examples" / "draw_engine_field_tree_pilot_01.json"
    recipe = json.loads(path.read_text(encoding="utf-8"))
    assert recipe["contract"] == FIELD_GRAPH_CONTRACT
    validate_recipe(recipe)
    first, meta = execute(recipe)
    second, repeated = execute(recipe)
    assert first.mode == "RGBA"
    assert first.tobytes() == second.tobytes()
    assert meta["pixelSha256"] == repeated["pixelSha256"]
    assert meta["critic"]["fieldAwareDistribution"] is True
    assert meta["critic"]["fieldConditionedClusters"] is True
    assert meta["critic"]["densityField"] is True
    assert meta["critic"]["distanceField"] is True
    assert meta["critic"]["directionField"] is True
    assert meta["critic"]["depthField"] is True
    assert meta["critic"]["layerComposite"] is True
    assert meta["critic"]["contactOcclusion"] is True
    assert meta["critic"]["maskedReliefMaterial"] is True

    # The production benchmark now has explicit rear/front/detail foliage layers.
    layer_ids = ("rear_foliage", "front_foliage", "detail_foliage")
    requested_total = 0
    placed_total = 0
    leaf_total = 0
    for node_id in layer_ids:
        foliage_recipe = next(node for node in recipe["graph"]["nodes"] if node["id"] == node_id)
        requested = int(foliage_recipe["params"]["count"])
        stats = meta["nodes"][node_id]
        assert requested <= 24
        assert stats["requestedClusters"] == requested
        assert stats["clusterCount"] >= max(10, requested - 3)
        requested_total += requested
        placed_total += stats["clusterCount"]
        leaf_total += stats["leafStampCount"]

    # Quality gate: use a few dozen meaningful groups across depth layers,
    # never the old thousand-micro-stamp strategy.
    assert requested_total <= 60
    assert placed_total >= 42
    assert leaf_total >= placed_total * 3
    assert first.getchannel("A").getbbox() is not None

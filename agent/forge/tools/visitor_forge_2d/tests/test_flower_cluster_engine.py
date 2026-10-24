from PIL import Image, ImageDraw

from visitor_forge_2d.core.field_graph import execute
from visitor_forge_2d.core.flower_cluster_engine import (
    FLOWER_CLUSTER_CONTRACT,
    FlowerClusterEngineV1,
)


def _density(size=(96, 96)) -> Image.Image:
    field = Image.new("L", size, 0)
    ImageDraw.Draw(field).ellipse((24, 18, 76, 72), fill=255)
    return field


def test_flower_cluster_engine_is_deterministic_and_field_conditioned() -> None:
    density = _density()
    first = Image.new("RGBA", density.size, (0, 0, 0, 0))
    second = Image.new("RGBA", density.size, (0, 0, 0, 0))

    stats_a = FlowerClusterEngineV1(417).scatter(
        first,
        density,
        count=5,
        bounds=[18, 14, 80, 78],
        min_distance=8,
        radius_x=[5.5, 7.5],
        radius_y=[4.0, 6.0],
        blossom_density=0.7,
        gap_windows=[1, 2],
        max_attempts=4000,
    )
    stats_b = FlowerClusterEngineV1(417).scatter(
        second,
        density,
        count=5,
        bounds=[18, 14, 80, 78],
        min_distance=8,
        radius_x=[5.5, 7.5],
        radius_y=[4.0, 6.0],
        blossom_density=0.7,
        gap_windows=[1, 2],
        max_attempts=4000,
    )

    assert first.tobytes() == second.tobytes()
    assert stats_a == stats_b
    assert stats_a["contract"] == FLOWER_CLUSTER_CONTRACT
    assert stats_a["placedGroups"] == 5
    assert stats_a["compoundSilhouette"] is True
    assert stats_a["compoundLobes"] == [2, 3]
    assert stats_a["negativeSpaceWindows"] is True
    assert stats_a["internalOcclusion"] is True
    assert first.getchannel("A").getbbox() is not None


def test_flower_cluster_engine_honors_avoid_mask() -> None:
    density = _density()
    avoid = Image.new("L", density.size, 255)
    image = Image.new("RGBA", density.size, (0, 0, 0, 0))

    stats = FlowerClusterEngineV1(19).scatter(
        image,
        density,
        avoid_field=avoid,
        count=4,
        bounds=[16, 12, 82, 80],
        radius_x=[5, 6],
        radius_y=[4, 5],
        max_attempts=300,
    )

    assert stats["placedGroups"] == 0
    assert image.getchannel("A").getbbox() is None


def test_graph_v2_reports_flower_cluster_contract() -> None:
    recipe = {
        "contract": "CH_2D_GRAPH_RECIPE_V2",
        "id": "flower_cluster_graph_test",
        "canvas": [96, 96],
        "anchor": [48, 90],
        "seed": 123,
        "camera": {
            "contract": "CH_CAMERA_V1",
            "projection": "orthographic_dimetric",
            "tile": [128, 64],
            "yawDeg": 45,
            "elevationDeg": 30,
        },
        "graph": {
            "seed": 123,
            "nodes": [
                {"id": "base", "type": "canvas", "params": {"color": [0, 0, 0, 0]}},
                {
                    "id": "density",
                    "type": "field_radial_density",
                    "params": {"lobes": [{"center": [48, 42], "radius": [26, 20], "weight": 1.0}], "power": 1.2},
                },
                {
                    "id": "flowers",
                    "type": "field_flower_clusters",
                    "inputs": {"image": "base", "density": "density"},
                    "params": {
                        "count": 4,
                        "bounds": [20, 16, 76, 70],
                        "minDistance": 7,
                        "radiusX": [5.5, 7.0],
                        "radiusY": [4.0, 5.5],
                        "blossomDensity": 0.65,
                        "gapWindows": [1, 2],
                        "palette": {
                            "backTop": "#D59B08",
                            "backBottom": "#9A6700",
                            "midTop": "#F2B705",
                            "midBottom": "#C38300",
                            "frontTop": "#FFD21A",
                            "highlight": "#FFE96A",
                            "occlusion": "#62431B"
                        },
                    },
                },
                {"id": "out", "type": "output", "inputs": {"image": "flowers"}},
            ],
        },
    }

    image, metadata = execute(recipe)
    assert image.getchannel("A").getbbox() is not None
    assert metadata["flowerClusterContract"] == FLOWER_CLUSTER_CONTRACT
    assert metadata["critic"]["fieldConditionedFlowers"] is True
    assert metadata["nodes"]["flowers"]["placedGroups"] == 4
    assert metadata["nodes"]["flowers"]["compoundSilhouette"] is True

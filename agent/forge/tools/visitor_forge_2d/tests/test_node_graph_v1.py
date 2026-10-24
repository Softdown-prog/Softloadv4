import json
import math
from pathlib import Path

from PIL import Image

from visitor_forge_2d.core.brush_engine_v2 import BRUSH_CONTRACT, BrushEngineV2
from visitor_forge_2d.core.brush_engine_v3 import BRUSH_V3_CONTRACT, BrushEngineV3
from visitor_forge_2d.core.cluster_engine import CLUSTER_CONTRACT, ClusterEngineV1
from visitor_forge_2d.core.distribution_engine import DISTRIBUTION_CONTRACT, DistributionEngineV1
from visitor_forge_2d.core.geometry_engine import GEOMETRY_CONTRACT, draw_tapered_paths
from visitor_forge_2d.core.node_graph import GRAPH_CONTRACT, execute, validate_recipe


def _recipe() -> dict:
    path = Path(__file__).resolve().parents[1] / "examples" / "park_tree_brush_graph_pilot_01.json"
    return json.loads(path.read_text(encoding="utf-8"))


def _camera() -> dict:
    return {
        "contract": "CH_CAMERA_V1",
        "projection": "orthographic_dimetric",
        "tile": [128, 64],
        "yawDeg": 45,
        "elevationDeg": 30,
        "worldHeightScreenVertical": True,
    }


def _structural_recipe() -> dict:
    return {
        "contract": GRAPH_CONTRACT,
        "id": "draw_engine_structural_test",
        "canvas": [96, 96],
        "anchor": [48, 94],
        "seed": 20261001,
        "camera": _camera(),
        "graph": {
            "seed": 20261001,
            "nodes": [
                {"id": "base", "type": "canvas", "params": {"color": [0, 0, 0, 0]}},
                {
                    "id": "branch",
                    "type": "tapered_path",
                    "inputs": {"image": "base"},
                    "params": {
                        "supersample": 4,
                        "paths": [{
                            "points": [[48, 91], [48, 72], [46, 55], [40, 39]],
                            "widthStart": 12,
                            "widthEnd": 3,
                            "fill": "#81552F",
                            "outline": "#4E301D",
                            "outlineWidth": 1,
                        }],
                    },
                },
                {
                    "id": "leaves",
                    "type": "spaced_scatter",
                    "inputs": {"image": "branch"},
                    "params": {
                        "brushes": ["foliage/leaf_oval_01.png", "foliage/leaf_oval_02.png"],
                        "regions": [
                            {"center": [39, 36], "radius": [25, 18], "weight": 1.0},
                            {"center": [57, 43], "radius": [22, 17], "weight": 0.8},
                        ],
                        "count": 24,
                        "minDistance": 7,
                        "scale": [0.45, 0.7],
                        "rotationDeg": [-160, 160],
                        "opacity": [235, 255],
                        "tints": ["#3F7546", "#568E50", "#6AA05A"],
                    },
                },
                {"id": "output", "type": "output", "inputs": {"image": "leaves"}},
            ],
        },
    }


def _twig_cluster() -> dict:
    leaf = {
        "type": "brush",
        "brushes": ["foliage/leaf_oval_01.png", "foliage/leaf_oval_02.png", "foliage/leaf_oval_03.png"],
        "scale": [0.52, 0.72],
        "aspect": [0.72, 1.35],
        "rotationDeg": [-28, 28],
        "opacity": [238, 255],
        "tints": ["#3E7445", "#4F864B", "#619957"],
        "mirrorXProbability": 0.5,
        "hueJitterDeg": 5,
        "saturation": [0.92, 1.08],
        "value": [0.92, 1.08],
    }
    child = {
        "members": [
            {**leaf, "offset": [-5, 0]},
            {**leaf, "offset": [0, -4]},
            {**leaf, "offset": [5, 1]},
        ]
    }
    return {
        "members": [
            {**leaf, "offset": [-9, 1]},
            {**leaf, "offset": [0, -8]},
            {**leaf, "offset": [9, 2]},
            {
                "type": "cluster",
                "offset": [0, 7],
                "scale": [0.9, 1.08],
                "rotationDeg": [-18, 18],
                "mirrorXProbability": 0.5,
                "cluster": child,
            },
        ]
    }


def _cluster_recipe() -> dict:
    return {
        "contract": GRAPH_CONTRACT,
        "id": "draw_engine_cluster_test",
        "canvas": [128, 128],
        "anchor": [64, 125],
        "seed": 20261002,
        "camera": _camera(),
        "graph": {
            "seed": 20261002,
            "nodes": [
                {"id": "base", "type": "canvas", "params": {"color": [0, 0, 0, 0]}},
                {
                    "id": "wood",
                    "type": "tapered_path",
                    "inputs": {"image": "base"},
                    "params": {
                        "supersample": 4,
                        "paths": [{
                            "points": [[64, 121], [64, 94], [61, 72], [59, 56]],
                            "widthStart": 13,
                            "widthEnd": 3,
                            "fill": "#765034",
                            "outline": "#4C301F",
                            "outlineWidth": 1,
                        }],
                    },
                },
                {
                    "id": "crown",
                    "type": "cluster_scatter",
                    "inputs": {"image": "wood"},
                    "params": {
                        "cluster": _twig_cluster(),
                        "regions": [
                            {"center": [48, 46], "radius": [28, 20], "weight": 1.0},
                            {"center": [77, 43], "radius": [27, 20], "weight": 1.0},
                        ],
                        "count": 6,
                        "minDistance": 18,
                        "scale": [0.9, 1.12],
                        "rotationDeg": [-20, 20],
                        "mirrorXProbability": 0.5,
                    },
                },
                {"id": "output", "type": "output", "inputs": {"image": "crown"}},
            ],
        },
    }


def test_brush_engine_v2_scatter_is_deterministic() -> None:
    first = Image.new("RGBA", (96, 96))
    second = Image.new("RGBA", (96, 96))
    params = dict(
        brushes=["foliage/leaf_oval_01.png", "foliage/leaf_oval_02.png"],
        regions=[{"center": [48, 48], "radius": [34, 28]}],
        count=120,
        scale=[.35, .65],
        rotation_deg=[-180, 180],
        opacity=[235, 255],
        tints=["#4E824F", "#82B96B"],
    )
    a = BrushEngineV2(44)
    b = BrushEngineV2(44)
    a.scatter_regions(first, **params)
    b.scatter_regions(second, **params)
    assert a.contract == BRUSH_CONTRACT
    assert first.tobytes() == second.tobytes()
    assert first.getchannel("A").getbbox() is not None


def test_brush_engine_v3_dynamics_are_deterministic() -> None:
    first = Image.new("RGBA", (96, 96))
    second = Image.new("RGBA", (96, 96))
    params = dict(
        brushes=["foliage/leaf_oval_01.png", "foliage/leaf_oval_02.png"],
        regions=[{"center": [48, 48], "radius": [30, 24], "weight": 1.0}],
        count=24,
        scale=[0.45, 0.8],
        aspect=[0.65, 1.45],
        rotation_deg=[-70, 70],
        opacity=[225, 255],
        tints=["#4B8149", "#69A15B"],
        mirror_x_probability=0.5,
        hue_jitter_deg=7,
        saturation=[0.9, 1.1],
        value=[0.9, 1.1],
    )
    a = BrushEngineV3(1234)
    b = BrushEngineV3(1234)
    a_stamps = a.scatter_regions(first, **params)
    b_stamps = b.scatter_regions(second, **params)
    assert a.contract == BRUSH_V3_CONTRACT
    assert a_stamps == b_stamps
    assert first.tobytes() == second.tobytes()
    assert any(abs(stamp.scale_x - stamp.scale_y) > 1e-4 for stamp in a_stamps)
    assert any(stamp.mirror_x for stamp in a_stamps)


def test_node_graph_pilot_uses_bitmap_brushes_and_is_deterministic() -> None:
    recipe = _recipe()
    assert recipe["contract"] == GRAPH_CONTRACT
    validate_recipe(recipe)
    first, meta = execute(recipe)
    second, repeated = execute(recipe)
    assert first.mode == "RGBA" and list(first.size) == recipe["canvas"]
    assert first.tobytes() == second.tobytes()
    assert meta["pixelSha256"] == repeated["pixelSha256"]
    assert meta["critic"]["nodeGraph"] is True
    assert meta["critic"]["bitmapBrushTips"] is True
    assert meta["critic"]["assetSpecificRenderer"] is False
    assert meta["brushContract"] == BRUSH_CONTRACT
    assert meta["nodeCount"] == 7
    assert meta["nodes"]["rear"]["stampCount"] == 500
    assert meta["nodes"]["mid"]["stampCount"] == 620
    assert meta["nodes"]["front"]["stampCount"] == 360


def test_tapered_path_is_continuous_and_antialiased() -> None:
    image = Image.new("RGBA", (96, 96), (0, 0, 0, 0))
    stats = draw_tapered_paths(
        image,
        [{
            "points": [[48, 88], [48, 64], [48, 42], [48, 20]],
            "widthStart": 12,
            "widthEnd": 4,
            "fill": "#805432",
            "outline": "#4A2E1D",
            "outlineWidth": 1,
        }],
        supersample=4,
    )
    assert stats["contract"] == GEOMETRY_CONTRACT
    assert stats["pathCount"] == 1
    for y in range(21, 89):
        assert image.getpixel((48, y))[3] > 0
    assert image.getchannel("A").getbbox() is not None


def test_distribution_engine_respects_minimum_distance_and_is_deterministic() -> None:
    regions = [{"center": [48, 48], "radius": [35, 28], "weight": 1.0}]
    first_engine = DistributionEngineV1(77)
    second_engine = DistributionEngineV1(77)
    first, attempts = first_engine.sample_spaced(regions, 30, min_distance=7)
    second, repeated_attempts = second_engine.sample_spaced(regions, 30, min_distance=7)
    assert first_engine.contract == DISTRIBUTION_CONTRACT
    assert first == second
    assert attempts == repeated_attempts
    assert len(first) == 30
    for index, a in enumerate(first):
        for b in first[index + 1:]:
            assert math.hypot(a[0] - b[0], a[1] - b[1]) >= 7 - 1e-9


def test_cluster_engine_groups_leaf_detail_hierarchically() -> None:
    first = Image.new("RGBA", (128, 128))
    second = Image.new("RGBA", (128, 128))
    regions = [{"center": [64, 50], "radius": [40, 26], "weight": 1.0}]
    a = ClusterEngineV1(9001)
    b = ClusterEngineV1(9001)
    first_stats = a.scatter_clusters(
        first, _twig_cluster(), regions, 5,
        min_distance=18, scale=[0.9, 1.1], rotation_deg=[-25, 25],
    )
    second_stats = b.scatter_clusters(
        second, _twig_cluster(), regions, 5,
        min_distance=18, scale=[0.9, 1.1], rotation_deg=[-25, 25],
    )
    assert a.contract == CLUSTER_CONTRACT
    assert first_stats == second_stats
    assert first.tobytes() == second.tobytes()
    assert first_stats["clusterCount"] == 5
    assert first_stats["leafStampCount"] == 30
    assert first_stats["clusterNodeCount"] == 10
    assert first_stats["hierarchical"] is True


def test_node_graph_structural_nodes_are_deterministic() -> None:
    recipe = _structural_recipe()
    validate_recipe(recipe)
    first, meta = execute(recipe)
    second, repeated = execute(recipe)
    assert first.tobytes() == second.tobytes()
    assert meta["pixelSha256"] == repeated["pixelSha256"]
    assert meta["geometryContract"] == GEOMETRY_CONTRACT
    assert meta["distributionContract"] == DISTRIBUTION_CONTRACT
    assert meta["critic"]["continuousGeometry"] is True
    assert meta["critic"]["minimumDistanceDistribution"] is True
    assert meta["nodes"]["branch"]["pathCount"] == 1
    assert meta["nodes"]["leaves"]["minDistance"] == 7.0
    assert 12 <= meta["nodes"]["leaves"]["stampCount"] <= 24


def test_node_graph_cluster_scatter_uses_v3_and_hierarchy() -> None:
    recipe = _cluster_recipe()
    validate_recipe(recipe)
    first, meta = execute(recipe)
    second, repeated = execute(recipe)
    assert first.tobytes() == second.tobytes()
    assert meta["pixelSha256"] == repeated["pixelSha256"]
    assert meta["brushDynamicsContract"] == BRUSH_V3_CONTRACT
    assert meta["clusterContract"] == CLUSTER_CONTRACT
    assert meta["critic"]["brushDynamics"] is True
    assert meta["critic"]["hierarchicalClusters"] is True
    assert meta["critic"]["continuousGeometry"] is True
    assert meta["nodes"]["crown"]["clusterCount"] == 6
    assert meta["nodes"]["crown"]["leafStampCount"] == 36
    assert meta["nodes"]["crown"]["clusterNodeCount"] == 12
    assert first.getchannel("A").getbbox() is not None


def test_node_graph_rejects_forward_references() -> None:
    recipe = _recipe()
    recipe["graph"]["nodes"][0]["inputs"] = {"image": "future"}
    try:
        validate_recipe(recipe)
    except ValueError as error:
        assert "unavailable node" in str(error)
    else:
        raise AssertionError("forward reference should fail validation")

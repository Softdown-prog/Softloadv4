from PIL import Image

from visitor_forge_2d.core.mapped_brush_engine import (
    MAPPED_BRUSH_CONTRACT,
    MappedBrushEngineV1,
)
from visitor_forge_2d.core.node_graph import GRAPH_CONTRACT, execute, validate_recipe


MAPPINGS = {
    "scale_mul": {
        "base": 1.0,
        "inputs": {"radial": [[0.0, 0.25], [1.0, -0.20]]},
    },
    "opacity_mul": {
        "base": 1.0,
        "inputs": {"stroke": [[0.0, 0.0], [1.0, -0.25]]},
    },
    "rotation_add_deg": {
        "base": 0.0,
        "inputs": {"direction": [[0.0, -8.0], [360.0, 8.0]]},
    },
}


def _dynamics() -> dict:
    return {
        "scale": [0.45, 0.70],
        "aspect": [0.8, 1.2],
        "rotation_deg": [-12, 12],
        "opacity": [230, 255],
        "tints": ["#4D804C", "#6B9E59"],
        "mirror_x_probability": 0.5,
        "mirror_y_probability": 0.0,
        "hue_jitter_deg": 3,
        "saturation": [0.95, 1.05],
        "value": [0.95, 1.05],
    }


def test_mapped_brush_is_deterministic_and_uses_curve_outputs() -> None:
    a = Image.new("RGBA", (96, 96), (0, 0, 0, 0))
    b = Image.new("RGBA", (96, 96), (0, 0, 0, 0))
    regions = [{"center": [48, 48], "radius": [30, 24], "weight": 1.0}]

    first = MappedBrushEngineV1(2026)
    second = MappedBrushEngineV1(2026)
    stamps_a, stats_a = first.scatter_regions(
        a,
        ["foliage/leaf_oval_01.png", "foliage/leaf_oval_02.png"],
        regions,
        20,
        mappings=MAPPINGS,
        dynamics=_dynamics(),
    )
    stamps_b, stats_b = second.scatter_regions(
        b,
        ["foliage/leaf_oval_01.png", "foliage/leaf_oval_02.png"],
        regions,
        20,
        mappings=MAPPINGS,
        dynamics=_dynamics(),
    )

    assert first.contract == MAPPED_BRUSH_CONTRACT
    assert a.tobytes() == b.tobytes()
    assert stamps_a == stamps_b
    assert stats_a == stats_b
    assert stats_a["mappingOutputs"] == ["opacity_mul", "rotation_add_deg", "scale_mul"]
    assert a.getchannel("A").getbbox() is not None


def test_node_graph_executes_mapped_dynamic_scatter() -> None:
    recipe = {
        "contract": GRAPH_CONTRACT,
        "id": "mapped_dynamic_scatter_test",
        "canvas": [96, 96],
        "anchor": [48, 94],
        "seed": 73,
        "camera": {
            "contract": "CH_CAMERA_V1",
            "projection": "orthographic_dimetric",
            "tile": [128, 64],
            "yawDeg": 45,
            "elevationDeg": 30,
            "worldHeightScreenVertical": True,
        },
        "graph": {
            "nodes": [
                {"id": "base", "type": "canvas", "params": {"color": [0, 0, 0, 0]}},
                {
                    "id": "mapped",
                    "type": "mapped_dynamic_scatter",
                    "inputs": {"image": "base"},
                    "params": {
                        "brushes": ["foliage/leaf_oval_01.png"],
                        "regions": [{"center": [48, 44], "radius": [25, 18]}],
                        "count": 12,
                        "mappings": MAPPINGS,
                        **_dynamics(),
                    },
                },
                {"id": "output", "type": "output", "inputs": {"image": "mapped"}},
            ]
        },
    }
    validate_recipe(recipe)
    first, meta = execute(recipe)
    second, repeated = execute(recipe)
    assert first.tobytes() == second.tobytes()
    assert meta["pixelSha256"] == repeated["pixelSha256"]
    assert meta["nodes"]["mapped"]["mappingContract"] == "A7_DYNAMICS_MAPPING_V1"
    assert meta["nodes"]["mapped"]["stampCount"] == 12

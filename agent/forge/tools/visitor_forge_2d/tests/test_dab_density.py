import math

from PIL import Image

from visitor_forge_2d.core.brush_engine_v3 import BrushEngineV3
from visitor_forge_2d.core.dab_density import (
    DAB_DENSITY_CONTRACT,
    dabs_for_motion,
    spacing_from_density,
)
from visitor_forge_2d.core.node_graph import GRAPH_CONTRACT, execute


def test_mypaint_informed_density_formula() -> None:
    assert DAB_DENSITY_CONTRACT == "A7_DAB_DENSITY_V1"
    value = dabs_for_motion(
        20.0,
        actual_radius=10.0,
        base_radius=5.0,
        dabs_per_actual_radius=2.0,
        dabs_per_basic_radius=1.0,
        delta_time=0.5,
        dabs_per_second=4.0,
    )
    assert math.isclose(value, 10.0)


def test_spacing_scales_with_actual_radius() -> None:
    small = spacing_from_density(
        actual_radius=4.0,
        base_radius=8.0,
        dabs_per_actual_radius=2.0,
    )
    large = spacing_from_density(
        actual_radius=12.0,
        base_radius=8.0,
        dabs_per_actual_radius=2.0,
    )
    assert math.isclose(small, 2.0)
    assert math.isclose(large, 6.0)
    assert large > small


def test_brush_v3_large_tip_uses_fewer_dabs_at_same_relative_density() -> None:
    path = [[[8, 48], [88, 48]]]
    small_canvas = Image.new("RGBA", (96, 96), (0, 0, 0, 0))
    large_canvas = Image.new("RGBA", (96, 96), (0, 0, 0, 0))

    small = BrushEngineV3(91).stroke_paths(
        small_canvas,
        "foliage/leaf_oval_01.png",
        path,
        scale=[0.5, 0.5],
        aspect=[1.0, 1.0],
        dabs_per_actual_radius=2.0,
    )
    large = BrushEngineV3(91).stroke_paths(
        large_canvas,
        "foliage/leaf_oval_01.png",
        path,
        scale=[1.5, 1.5],
        aspect=[1.0, 1.0],
        dabs_per_actual_radius=2.0,
    )
    assert len(large) < len(small)


def test_node_graph_reports_radius_aware_density() -> None:
    recipe = {
        "contract": GRAPH_CONTRACT,
        "id": "radius_aware_path_test",
        "canvas": [96, 96],
        "anchor": [48, 94],
        "seed": 17,
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
                    "id": "stroke",
                    "type": "dynamic_path_brush",
                    "inputs": {"image": "base"},
                    "params": {
                        "brush": "foliage/leaf_oval_01.png",
                        "paths": [[[10, 48], [86, 48]]],
                        "scale": [0.8, 0.8],
                        "aspect": [1.0, 1.0],
                        "dabsPerActualRadius": 2.0,
                        "dabsPerBasicRadius": 0.0,
                        "rotationDeg": [0, 0],
                        "opacity": [255, 255],
                        "tints": ["#5A9258"],
                    },
                },
                {"id": "output", "type": "output", "inputs": {"image": "stroke"}},
            ]
        },
    }
    first, meta = execute(recipe)
    second, repeated = execute(recipe)
    assert first.tobytes() == second.tobytes()
    assert meta["pixelSha256"] == repeated["pixelSha256"]
    assert meta["dabDensityContract"] == DAB_DENSITY_CONTRACT
    assert meta["nodes"]["stroke"]["radiusAwareSpacing"] is True
    assert meta["critic"]["radiusAwareDabDensity"] is True

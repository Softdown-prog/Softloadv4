from PIL import Image

from visitor_forge_2d.core.node_graph import GRAPH_CONTRACT, execute, validate_recipe
from visitor_forge_2d.core.vector_path import (
    VECTOR_PATH_CONTRACT,
    AffineTransform,
    draw_vector_paths,
    flatten_commands,
)


def _commands() -> list[dict]:
    return [
        {"op": "move", "to": [16, 48]},
        {"op": "quad", "control": [32, 12], "to": [48, 44]},
        {"op": "cubic", "control1": [58, 64], "control2": [76, 8], "to": [82, 44]},
        {"op": "line", "to": [72, 70]},
        {"op": "line", "to": [24, 70]},
        {"op": "close"},
    ]


def test_vector_path_flattens_curves_and_applies_transform() -> None:
    contours, command_count = flatten_commands(
        _commands(),
        tolerance=0.25,
        transform=AffineTransform.from_spec({
            "scale": [1.1, 0.9],
            "rotateDeg": 12,
            "translate": [3, -2],
            "origin": [48, 48],
        }),
    )
    assert command_count == 6
    assert len(contours) == 1
    assert contours[0].closed is True
    assert len(contours[0].points) > 8
    assert contours[0].points[0] != (16.0, 48.0)


def test_vector_path_render_is_deterministic_and_antialiased() -> None:
    first = Image.new("RGBA", (96, 96), (0, 0, 0, 0))
    second = Image.new("RGBA", (96, 96), (0, 0, 0, 0))
    paths = [{
        "commands": _commands(),
        "fill": "#4C8C57",
        "stroke": "#274A32",
        "strokeWidth": 2.5,
        "cap": "round",
        "tolerance": 0.25,
    }]
    stats_a = draw_vector_paths(first, paths, supersample=4)
    stats_b = draw_vector_paths(second, paths, supersample=4)
    assert stats_a == stats_b
    assert stats_a["contract"] == VECTOR_PATH_CONTRACT
    assert stats_a["pathCount"] == 1
    assert stats_a["contourCount"] == 1
    assert stats_a["flattenedPointCount"] > 8
    assert first.tobytes() == second.tobytes()
    assert first.getchannel("A").getbbox() is not None
    alpha_values = set(first.getchannel("A").getdata())
    assert any(0 < value < 255 for value in alpha_values)


def test_node_graph_executes_vector_path_node() -> None:
    recipe = {
        "contract": GRAPH_CONTRACT,
        "id": "vector_path_node_test",
        "canvas": [96, 96],
        "anchor": [48, 94],
        "seed": 20261002,
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
                    "id": "shape",
                    "type": "vector_path",
                    "inputs": {"image": "base"},
                    "params": {
                        "supersample": 4,
                        "paths": [{
                            "commands": _commands(),
                            "fill": "#568F59",
                            "stroke": "#2C5033",
                            "strokeWidth": 2,
                            "transform": {"translate": [1, -1], "rotateDeg": 3, "origin": [48, 48]},
                        }],
                    },
                },
                {"id": "output", "type": "output", "inputs": {"image": "shape"}},
            ]
        },
    }
    validate_recipe(recipe)
    first, meta = execute(recipe)
    second, repeated = execute(recipe)
    assert first.tobytes() == second.tobytes()
    assert meta["pixelSha256"] == repeated["pixelSha256"]
    assert meta["vectorPathContract"] == VECTOR_PATH_CONTRACT
    assert meta["nodes"]["shape"]["contract"] == VECTOR_PATH_CONTRACT
    assert meta["critic"]["vectorGeometry"] is True

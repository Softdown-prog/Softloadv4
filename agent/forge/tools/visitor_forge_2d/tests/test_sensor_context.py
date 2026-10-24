from visitor_forge_2d.core.brush_option_bindings import (
    BRUSH_OPTION_BINDINGS_CONTRACT,
    BrushOptionBindings,
)
from visitor_forge_2d.core.sensor_context import (
    SENSOR_CONTEXT_CONTRACT,
    SensorContext,
    canonical_sensor_names,
)


def test_scatter_sensor_context_normalizes_common_inputs() -> None:
    ctx = SensorContext.scatter(
        index=4,
        count=9,
        random_value=0.25,
        direction_deg=450,
        radial=0.75,
        x=48,
        y=24,
        canvas_width=96,
        canvas_height=96,
        region=2,
        depth=0.4,
        density=0.8,
    )
    values = ctx.as_dict()
    assert SENSOR_CONTEXT_CONTRACT == "A7_SENSOR_CONTEXT_V1"
    assert values["stroke"] == 0.5
    assert values["direction"] == 90.0
    assert values["direction_01"] == 0.25
    assert values["x_norm"] == 0.5
    assert values["y_norm"] == 0.25
    assert values["radial"] == 0.75
    assert values["region"] == 2.0
    assert values["depth"] == 0.4
    assert values["density"] == 0.8
    assert "pressure" in canonical_sensor_names()


def test_path_sensor_context_tracks_distance_progress() -> None:
    ctx = SensorContext.path(
        index=2,
        count=5,
        random_value=0.5,
        tangent_deg=-45,
        distance=30,
        total_distance=120,
        x=10,
        y=20,
        canvas_width=100,
        canvas_height=100,
    )
    assert ctx.get("stroke") == 0.5
    assert ctx.get("distance") == 30.0
    assert ctx.get("distance_norm") == 0.25
    assert ctx.get("direction") == 315.0


def test_brush_option_bindings_map_sensors_without_knowing_brush_engine() -> None:
    bindings = BrushOptionBindings({
        "scale_mul": {
            "base": 1.0,
            "inputs": {"radial": [[0.0, 0.4], [1.0, -0.2]]},
        },
        "opacity_mul": {
            "base": 1.0,
            "inputs": {"depth": [[0.0, -0.2], [1.0, 0.0]]},
        },
        "rotation_add_deg": {
            "base": 0.0,
            "inputs": {"direction_01": [[0.0, -20.0], [1.0, 20.0]]},
        },
    })
    ctx = SensorContext.scatter(
        index=0,
        count=1,
        random_value=0.5,
        direction_deg=180,
        radial=0.5,
        x=32,
        y=32,
        canvas_width=64,
        canvas_height=64,
        depth=0.5,
    )
    values = bindings.evaluate(ctx)
    assert bindings.contract == BRUSH_OPTION_BINDINGS_CONTRACT
    assert values["scale_mul"] == 1.1
    assert values["opacity_mul"] == 0.9
    assert values["rotation_add_deg"] == 0.0
    assert values["aspect_mul"] == 1.0

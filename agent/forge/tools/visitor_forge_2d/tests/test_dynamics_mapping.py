import math

import pytest

from visitor_forge_2d.core.dynamics_mapping import (
    DYNAMICS_MAPPING_CONTRACT,
    DynamicsMapping,
    MappingCurve,
    evaluate_mapping,
    evaluate_mapping_set,
)


def test_mapping_contract_and_piecewise_interpolation() -> None:
    assert DYNAMICS_MAPPING_CONTRACT == "A7_DYNAMICS_MAPPING_V1"
    mapping = DynamicsMapping.from_spec({
        "base": 1.0,
        "inputs": {
            "stroke": [[0.0, 0.0], [0.5, 1.0], [1.0, 0.0]],
        },
    })
    assert math.isclose(mapping.evaluate({"stroke": 0.25}), 1.5)
    assert math.isclose(mapping.evaluate({"stroke": 0.5}), 2.0)
    assert math.isclose(mapping.evaluate({"stroke": 0.75}), 1.5)


def test_mapping_adds_multiple_named_inputs() -> None:
    value = evaluate_mapping(
        {
            "base": 2.0,
            "inputs": {
                "stroke": [[0.0, 0.0], [1.0, 1.0]],
                "random": [[0.0, -0.5], [1.0, 0.5]],
            },
        },
        {"stroke": 0.75, "random": 0.25},
    )
    assert math.isclose(value, 2.5)


def test_curve_matches_libmypaint_linear_extrapolation_behavior() -> None:
    curve = MappingCurve.from_spec([[0.0, 0.0], [1.0, 2.0]])
    assert math.isclose(curve.evaluate(-0.5), -1.0)
    assert math.isclose(curve.evaluate(1.5), 3.0)


def test_mapping_set_reuses_one_context_for_multiple_outputs() -> None:
    result = evaluate_mapping_set(
        {
            "scale": {"base": 1.0, "inputs": {"stroke": [[0, 0], [1, 0.5]]}},
            "opacity": {"base": 0.8, "inputs": {"radial": [[0, 0.2], [1, -0.3]]}},
        },
        {"stroke": 0.4, "radial": 0.5},
    )
    assert math.isclose(result["scale"], 1.2)
    assert math.isclose(result["opacity"], 0.75)


def test_mapping_rejects_single_point_and_unsorted_curves() -> None:
    with pytest.raises(ValueError):
        MappingCurve.from_spec([[0.0, 1.0]])
    with pytest.raises(ValueError):
        MappingCurve.from_spec([[1.0, 0.0], [0.0, 1.0]])

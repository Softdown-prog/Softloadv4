import pytest

from visitor_forge_2d.fence_connectivity import (
    EAST,
    NORTH,
    SOUTH,
    WEST,
    classify_mask,
    mask_from_connections,
    resolve_modules,
)


def test_all_16_masks_classify_without_gaps() -> None:
    expected = {
        0: "isolated",
        NORTH: "end", EAST: "end", SOUTH: "end", WEST: "end",
        NORTH | SOUTH: "straight", EAST | WEST: "straight",
        NORTH | EAST: "corner", EAST | SOUTH: "corner",
        SOUTH | WEST: "corner", WEST | NORTH: "corner",
        NORTH | EAST | SOUTH: "tee", EAST | SOUTH | WEST: "tee",
        SOUTH | WEST | NORTH: "tee", WEST | NORTH | EAST: "tee",
        NORTH | EAST | SOUTH | WEST: "cross",
    }
    assert {mask: classify_mask(mask) for mask in range(16)} == expected


def test_cardinal_edges_resolve_to_canonical_east_south_modules() -> None:
    result = resolve_modules(mask_from_connections({"north", "east", "south", "west"}))
    by_direction = {item["direction"]: item for item in result["modules"]}
    assert by_direction["east"]["spriteDirection"] == "east"
    assert by_direction["east"]["vertexOffset"] == [0, 0]
    assert by_direction["south"]["spriteDirection"] == "south"
    assert by_direction["south"]["vertexOffset"] == [0, 0]
    assert by_direction["north"]["spriteDirection"] == "south"
    assert by_direction["north"]["vertexOffset"] == [0, -1]
    assert by_direction["west"]["spriteDirection"] == "east"
    assert by_direction["west"]["vertexOffset"] == [-1, 0]
    assert result["topology"] == "cross"
    assert result["postRequired"] is True


def test_gate_replaces_only_requested_connected_edge() -> None:
    result = resolve_modules(NORTH | EAST | SOUTH, gate_direction="east")
    assert result["topology"] == "tee"
    assert [item["kind"] for item in result["modules"]].count("gate") == 1
    gate = next(item for item in result["modules"] if item["kind"] == "gate")
    assert gate["direction"] == "east"
    with pytest.raises(ValueError, match="part of the fence mask"):
        resolve_modules(NORTH | SOUTH, gate_direction="east")


def test_invalid_direction_and_mask_are_rejected() -> None:
    with pytest.raises(ValueError, match="unknown fence direction"):
        mask_from_connections({"northwest"})
    with pytest.raises(ValueError, match="0 to 15"):
        classify_mask(16)

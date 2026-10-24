"""Deterministic fence topology resolver for tile-edge construction.

The renderer only needs canonical east/south modules. North/west edges are
resolved to the same canonical modules on the neighbouring vertex, which keeps
one visual source for every shared edge and prevents double-post seams.
"""
from __future__ import annotations

from dataclasses import dataclass

NORTH = 1
EAST = 2
SOUTH = 4
WEST = 8
ALL = NORTH | EAST | SOUTH | WEST

_DIRECTION_BITS = {
    "north": NORTH,
    "east": EAST,
    "south": SOUTH,
    "west": WEST,
}


@dataclass(frozen=True)
class FenceModulePlacement:
    direction: str
    sprite_direction: str
    vertex_offset: tuple[int, int]
    kind: str = "segment"


def mask_from_connections(directions: set[str] | list[str] | tuple[str, ...]) -> int:
    mask = 0
    for direction in directions:
        if direction not in _DIRECTION_BITS:
            raise ValueError(f"unknown fence direction {direction!r}")
        mask |= _DIRECTION_BITS[direction]
    return mask


def directions_from_mask(mask: int) -> tuple[str, ...]:
    if type(mask) is not int or mask < 0 or mask > ALL:
        raise ValueError("fence mask must be an integer from 0 to 15")
    return tuple(name for name, bit in _DIRECTION_BITS.items() if mask & bit)


def classify_mask(mask: int) -> str:
    directions = directions_from_mask(mask)
    count = len(directions)
    if count == 0:
        return "isolated"
    if count == 1:
        return "end"
    if count == 4:
        return "cross"
    if count == 3:
        return "tee"
    if mask in (NORTH | SOUTH, EAST | WEST):
        return "straight"
    return "corner"


def resolve_modules(mask: int, gate_direction: str | None = None) -> dict:
    """Resolve N/E/S/W connectivity into canonical east/south sprite modules.

    Coordinates are grid-vertex offsets relative to the requested vertex.
    A north edge is the south sprite owned by the vertex one cell north; a west
    edge is the east sprite owned by the vertex one cell west. This ownership
    convention means adjacent tiles request the same physical edge.
    """
    directions = directions_from_mask(mask)
    if gate_direction is not None:
        if gate_direction not in _DIRECTION_BITS:
            raise ValueError(f"unknown gate direction {gate_direction!r}")
        if gate_direction not in directions:
            raise ValueError("gate direction must be part of the fence mask")

    canonical = {
        "east": ("east", (0, 0)),
        "south": ("south", (0, 0)),
        "north": ("south", (0, -1)),
        "west": ("east", (-1, 0)),
    }
    placements = []
    for direction in directions:
        sprite_direction, vertex_offset = canonical[direction]
        placements.append(FenceModulePlacement(
            direction=direction,
            sprite_direction=sprite_direction,
            vertex_offset=vertex_offset,
            kind="gate" if direction == gate_direction else "segment",
        ))

    return {
        "mask": mask,
        "topology": classify_mask(mask),
        "directions": list(directions),
        "postRequired": bool(mask),
        "modules": [
            {
                "direction": item.direction,
                "spriteDirection": item.sprite_direction,
                "vertexOffset": list(item.vertex_offset),
                "kind": item.kind,
            }
            for item in placements
        ],
    }

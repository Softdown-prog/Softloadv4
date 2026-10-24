# Procedural 2D fence scenery

Status: VISUAL STUDY / NOT RUNTIME-PROMOTED

`CH_2D_FENCE_SCENERY_V1` generates the modular park fence family requested for City Horizon from deterministic 2D geometry. The visual target is a restrained dark metal fence on a low stone curb, with dense vertical bars, capped posts and a two-leaf gate. A reference image may guide proportions and visual language, but no reference pixels are sampled or copied by the generator.

## Why segments, not one rectangular sprite

`FenceManager` already stores the fence as grid vertices and connected segments. Segment-level gates are the authoritative gameplay representation. The art therefore follows the same model:

```text
regular segment EAST
regular segment SOUTH
openable gate segment EAST
openable gate segment SOUTH
post at each occupied fence vertex
```

NORTH/WEST use the same physical edges from the opposite endpoint; corners, tees and crosses are created by composing connected segments plus one post at the shared vertex. This avoids maintaining hand-authored corner combinations and preserves continuity while the player drags a fence run.

## Camera / grid contract

The V1 recipe is locked to:

- `CH_CAMERA_V1`
- 128x64 reference tile
- 45 degree yaw
- 30 degree elevation
- one projected grid-edge vector of `[64,32]` or `[-64,32]`
- 192x128 transparent module canvas
- common first-vertex anchor `[96,64]`

The generator renders at 4x and returns to gameplay resolution through the existing premultiplied-alpha Lanczos exporter.

## Canonical recipe

`examples/park_iron_fence_01.json`

The recipe exposes height, stone-base width, bar spacing, post width, rail width and the metal/stone palette. Edit the recipe rather than hard-coding a second fence implementation.

## Generate

After installing the Visitor Forge package in editable mode:

```bash
ch-fence-2d \
  --recipe tools/visitor_forge_2d/examples/park_iron_fence_01.json \
  --output out/visitor_forge_2d/park_iron_fence_01
```

Outputs:

- `park_iron_fence_01_segment_east.png`
- `park_iron_fence_01_segment_south.png`
- `park_iron_fence_01_gate_east.png`
- `park_iron_fence_01_gate_south.png`
- `park_iron_fence_01_post.png`
- `park_iron_fence_01_enclosure_review.png`
- `park_iron_fence_01_metadata.json`

The gate intentionally has no stone curb across its ground opening. Posts are separate so adjacent segments do not double-author corner geometry.

## Visual gate

The enclosure review is only a proof of composition. Before runtime promotion, inspect at actual map scale for:

- bar thickness and readability;
- fence height relative to visitors and buildings;
- stone-base alignment to tile edges;
- shared posts at corners;
- gate opening clarity;
- halo/fringe on transparent module PNGs;
- depth ordering on all four sides of an enclosure.

Do not copy the generated candidates into `assets/` until that map-scale review is approved.

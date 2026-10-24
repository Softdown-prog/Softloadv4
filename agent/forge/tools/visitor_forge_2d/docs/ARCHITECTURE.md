# Visitor Forge 2D — Architecture V0.1

## Goal

The Visitor Forge is a procedural **2D** compositor. It is not a miniature 3D renderer and it is not a runtime system. Its job is to create readable City Horizon sprites from reusable 2D parts, poses and palettes.

The first consumer is a male SOUTH visitor, but the core must remain generic enough for future employees, mascots, small animals, animated props and other layered 2D assets.

## Separation of responsibilities

```text
visitor_forge_2d.core
  generic canvas / skeleton / pose / layer composition / export

visitor_forge_2d.character
  visitor-specific V1 contract and quality gates

assets/
  authored 2D part art (not created until there is real art)

definitions/
  character assembly data

poses/
  reusable animation pose data
```

The core must not contain assumptions such as "shirt", "human" or "male". Human semantics live in the character module and JSON definitions.

## Coordinate spaces

There are two explicit spaces:

1. **working canvas** — high-resolution composition space, currently 512×512 for V1;
2. **gameplay canvas** — final sprite size, currently 128×128 for the first gate.

The anchor is stored in gameplay-canvas coordinates. It belongs to the character definition, never to an individual pose. This prevents idle/walk frames from silently shifting their feet anchor through metadata.

## Articulation model

The V1 uses a 2D cutout skeleton:

- pelvis/spine/neck/head;
- shoulder → elbow → wrist per arm;
- hip → knee → ankle per leg.

Each visual part is a normal RGBA image with:

- base position on the working canvas;
- local pivot inside its source image;
- optional palette slot;
- z-order;
- optional skeleton joint binding.

Pose JSON changes joint rotation/translation/scale. Parent transforms propagate to children. No mesh deformation is required.

This is intentionally closer to articulated illustration than to a 3D rig.

## Identity lock

Animation must preserve the approved character instead of redrawing a new one for each pose. `character/identity_lock.py` defines the first mechanical identity gate, `CH_VISITOR_IDENTITY_LOCK_V1`.

The V1 gate compares only conservative gameplay-canvas zones for the head and torso core. Outer shoulders/arms and the lower body remain outside the lock so short walk motion is still allowed. Comparisons ignore hidden RGB under transparent pixels and report changed-pixel fractions for every animated frame relative to idle.

The directional gait study applies this gate after generating `walk_a` and `walk_b`. If a locked region changes beyond the configured tolerance, generation fails instead of silently emitting the candidate. The resulting metrics are also stored under `identityLock` in the gait review JSON.

This is a mechanical preservation check, not an art-approval system. A passing lock does not prove that anatomy, gait, direction, contact, scale or style are correct. Gameplay-scale visual review remains mandatory.

## Palette model

Palette slots are named semantically by the character definition (`skin`, `shirt`, `pants`, etc.), but the compositor only sees named colors.

A palette tint multiplies source RGB by the requested color while keeping source luminance and alpha. Recommended source art for recolorable pieces is neutral/light grayscale with painted 2D shading.

## Alpha and downscale policy

The final resize is part of the pipeline, not an afterthought.

- compose at high resolution;
- keep a transparent RGBA canvas;
- resize with Lanczos through premultiplied-alpha mode when supported;
- export full-color PNG RGBA;
- do not impose retro 128/256-color palette limits;
- do not remove antialiasing simply because edge pixels are semi-transparent.

This is specifically intended to avoid the halo/fringe problems seen in earlier asset workflows.

## V1 visual gate

Only these outputs matter initially:

- `south_idle`
- `south_walk_a`
- `south_walk_b`

Animation policy:

- short step;
- conservative arm swing;
- no artificial root bob;
- same gameplay anchor for all frames;
- judge the result at actual gameplay scale before expanding directions.

## Runtime boundary

Visitor Forge outputs are staging artifacts until approved. The game runtime should consume only PNG RGBA + metadata and must not depend on Pillow, Visitor Forge internals, MPFB or Blender.

The existing Sprite Workshop can later perform alpha/bounds/anchor/animation inspection before runtime promotion.

# A7 open-source reference matrix

This file records what the Draw Engine studies, what may be reused directly,
and what is reference-only. The goal is to learn from mature 2D engines without
creating an unauditable license mix.

## Rules

1. Every direct port or copied algorithm must name its upstream project, source
   file, pinned commit and license.
2. Copyleft/GPL code is reference-only unless a separate license audit approves
   that exact file or component.
3. Reimplementing an idea from a reference-only project must be independently
   written in A7 code; do not paste upstream implementation text.
4. Third-party license notices live under `tools/visitor_forge_2d/third_party/`.
5. Provenance is part of the feature contract, not cleanup work for later.

## Current sources

| Project | License posture for A7 | Studied subsystem | A7 status |
| --- | --- | --- | --- |
| mypaint/libmypaint | ISC; direct adaptation allowed with notice | brush inputs, setting mappings, radius/opacity/dab dynamics | `A7_DYNAMICS_MAPPING_V1` and `A7_DAB_DENSITY_V1` adapt permissively licensed concepts with notice |
| KDE/krita | GPL repository; reference-only by default | dynamic sensors, brush-option separation, masked/texture/scatter concepts | `A7_SENSOR_CONTEXT_V1` and `A7_BRUSH_OPTION_BINDINGS_V1` are independent A7 implementations inspired only by the architectural separation |
| inkscape/inkscape | copyleft/GPL family; reference-only until file-level audit | paths, vector editing, transforms, geometry workflows | architecture reference only; no Inkscape source copied |
| google/skia | BSD-style permissive | path verbs, contours, vector geometry organization, rasterization architecture | `A7_VECTOR_PATH_V1` independently implements the useful path model in Python/Pillow; no Skia code copied |
| G'MIC | mixed/project-specific licensing; audit before reuse | morphology, filtering, local processing, image pipelines | not integrated |

## Pinned references from the first study

### libmypaint

Pinned commit:
`d5a88fbe6649d5ec776bc42ec8c1f4bb29d7fd7f`

Studied files:

- `brushsettings.json`
- `mypaint-mapping.c`
- `mypaint-mapping.h`
- `mypaint-brush.c`
- `COPYING`

The useful architectural lesson is that a setting is not just a random range.
A base value can be driven by named inputs through editable curves. In MyPaint,
examples of inputs include pressure, random, stroke progress, direction, speed,
tilt and custom channels. A7 uses the same kind of mapping for deterministic
asset-authoring signals such as stroke progress, radial position, branch depth,
cluster index, direction, density and seeded random values.

Two permissively licensed ideas are now adapted with provenance:

- `A7_DYNAMICS_MAPPING_V1`: additive piecewise-linear setting mappings;
- `A7_DAB_DENSITY_V1`: radius-aware dab density for path strokes.

### Krita

Studied architecture:

- `plugins/paintops/libpaintop/sensors/KisDynamicSensor.h`
- `plugins/paintops/libpaintop/KisCurveOptionDataCommon.h`
- related dynamic sensor implementations

The useful lesson is the separation of *sensor/input* from *brush option*.
Krita remains GPL reference material. No Krita implementation code is copied.

A7 applies the same architectural separation independently:

- `A7_SENSOR_CONTEXT_V1` produces generic named signals (`stroke`, `direction`,
  `radial`, normalized position, depth, density, pressure, speed, etc.);
- `A7_BRUSH_OPTION_BINDINGS_V1` maps those signals through A7 dynamics curves
  into semantic brush options (`scale_mul`, `opacity_mul`, rotation, color,
  offsets and aspect);
- `A7_MAPPED_BRUSH_ENGINE_V1` consumes those two layers instead of fabricating
  sensor semantics internally.

The sensor context is intentionally not brush-specific. Future cluster, field,
mask, lighting and image-processing nodes can consume the same signal contract.

### Skia

Pinned commit studied:
`4d6eee4bf6f6a17ff4963374d6b7fd5a0984c72d`

Studied files:

- `include/core/SkPath.h`
- `LICENSE`

Skia's useful architectural lesson is that generic vector geometry should be
stored as contours composed from verbs rather than as asset-specific drawing
functions. A7 independently implements this idea as `A7_VECTOR_PATH_V1` with:

- `move`, `line`, `quad`, `cubic`, `close` commands;
- multiple contours;
- adaptive curve flattening;
- scale/rotation/translation around an authored origin;
- fill and stroke;
- round/butt caps;
- supersampled antialiasing;
- Node Graph node `vector_path`.

A7 currently does not link to Skia and contains no copied Skia source code.
The BSD license makes future direct integration possible if it becomes useful,
but that should be a deliberate dependency decision rather than an automatic
step.

## Imported/adapted capability summary

`A7_DYNAMICS_MAPPING_V1` implements:

`output = base + curve(input_1) + curve(input_2) + ...`

with piecewise-linear control points and the interpolation/extrapolation
behavior used by libmypaint's permissively licensed mapping engine.

`A7_DAB_DENSITY_V1` adapts the idea that dab density should be relative to the
brush radius instead of using only fixed pixel spacing.

`A7_SENSOR_CONTEXT_V1` and `A7_BRUSH_OPTION_BINDINGS_V1` are original A7 code
created after studying Krita's GPL architecture. They copy no Krita code and
exist specifically to keep sensor production separate from option behavior.

`A7_VECTOR_PATH_V1` is original A7 code informed by the general path/contour
organization seen in Skia. It extends the Forge beyond polylines and tapered
ribbons into reusable Bézier geometry.

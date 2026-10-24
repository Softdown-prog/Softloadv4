# Procedural 2D Flower Beds

The flower-bed study uses the existing `CH_2D_ORGANIC_SCENERY_V1` contract with `sceneryType: "flower_bed"` and the frozen `CH_CAMERA_V1` tile contract (`128x64`). It is a deterministic 2D raster-painted generator inside Visitor Forge 2D; Blender is not involved.

The original canonical study recipe is `examples/flower_bed_01.json`. It targets a 1x1 decorative footprint and intentionally favors a dense, irregular green mound with tall yellow flower stalks, visible warm soil/stone edging, gameplay-scale texture and small raster accents rather than clean vector petals.

The flower family now also has a reusable deterministic brush library at `src/visitor_forge_2d/core/flower_brushes.py`:

- `flower_rosette`: compact radial bloom for daisies and park bedding;
- `flower_star`: crisp star bloom that survives 1x gameplay downsampling;
- `flower_bud`: small unopened bud for variation and less repetition;
- `stem_curve`: quadratic curved stem rather than a rigid straight line;
- `leaf_pair_small`: paired pointed leaves for stems and low foliage;
- `clip_to_mask`: alpha-safe ownership for authored bed masks.

These are drawing primitives, not complete assets. Production flower renderers should compose them in the same order used for tree quality work: macro foliage mass -> stem structure -> leaf groups -> flower heads/buds -> occlusion/highlight -> gameplay finish.

## Visual profiles

Versioned flower visual profiles live in `examples/reference_profiles/flower_visual_profiles_v1.json` under contract `CH_2D_FLOWER_VISUAL_REFERENCE_V1`.

Current profiles:

- `flower_bed_daisy_clustered`: low dense park bed with medium clustered rosette blooms;
- `flower_bed_wildflower_tall`: airier patch with stronger height variation and taller stems;
- `flower_groundcover_compact`: very low dense groundcover with many small blooms.

Each profile points to an authored recipe so the Art Author can start from a deliberate flower grammar instead of the same generic flower bed every time:

- `examples/flower_bed_daisy_v2.json`
- `examples/flower_bed_wildflower_v2.json`
- `examples/flower_bed_groundcover_v2.json`

A structured brief can therefore use only `visualProfile` plus an id/seed and still resolve a bounded deterministic design intent.

Render a recipe directly with:

```bash
PYTHONPATH=tools/visitor_forge_2d/src \
python -m visitor_forge_2d.core.flower_bed_scenery \
  --recipe tools/visitor_forge_2d/examples/flower_bed_daisy_v2.json \
  --output out/flower_bed
```

Outputs:

- `<id>.png`: transparent RGBA gameplay sprite;
- `<id>_review.png`: 1x gameplay plus 2x nearest-neighbor inspection;
- `<id>_isometric_review.png`: placement on the canonical isometric grid;
- `<id>.json`: provenance and bounds.

The generator is seed-driven and deterministic. Edit the recipe for palette, flower density, mound density, footprint shape and raster density. Keep the camera, tile and anchor contract unchanged unless a real placement defect is proven in MapForge/runtime.

The reference target for this family is a classic raster/pre-rendered tycoon read: dense organic foliage, a slightly pixel-textured finish and flowers that remain legible at gameplay scale. Do not promote generated output to runtime solely because tests pass; inspect the 1x review and in-grid review first.

The next renderer step is to replace the legacy rectangular/cross bloom construction inside `flower_bed_scenery.py` with these shared brush primitives while preserving the legacy recipe contract. That change should be made behind explicit recipe/profile controls so old assets remain deterministic.

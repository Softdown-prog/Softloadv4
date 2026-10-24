# Pine family V1 — Visitor Forge 2D candidates

Three independent procedural conifer recipes based on the supplied reference
of a short pine, a tall pine with visible lower trunk and a broad dense pine.
The PNGs here were exported by `visitor_forge_2d.core.organic_scenery`, with
no image-generation input. The comparison board only composites those three
exported transparent PNGs on one baseline.

| Candidate | Canvas | Opaque bounds height | Crown intent |
| --- | --- | ---: | --- |
| `pine_small_v1` | 152×150 | 136 px | Short, low branches |
| `pine_tall_v1` | 176×264 | 252 px | Slender, exposed lower trunk |
| `pine_robust_v1` | 220×231 | 220 px | Broad, dense, low branches |

Each variant has a transparent sprite, a 1x/2x review board, a `CH_CAMERA_V1`
isometric grid board and export metadata. All heights above include the soft
contact shadow. The comparison board is a quick family inspection; use the
individual 1x and isometric boards to judge map readability.

Regenerate from the source recipes in `../../../examples/` with:

```bash
for name in pine_small_v1 pine_tall_v1 pine_robust_v1; do
  PYTHONPATH=tools/visitor_forge_2d/src python -m visitor_forge_2d.core.organic_scenery \
    --recipe "tools/visitor_forge_2d/examples/$name.json" \
    --output tools/visitor_forge_2d/art/concepts/pine_family_v1
done
```

The silhouette and palette are closer to the reference, but the procedural
branch brush still reads more layered and graphic than the soft rendered
needle clumps in the reference. Keep these as review candidates until the
gameplay appearance is approved; do not replace the existing runtime pine yet.

# Early autumn broadleaf study

Generated from `examples/briefs/park_tree_early_autumn.json` using `author-art`.
The four directions were visually approved and copied byte for byte into
`assets/tree/park_tree_early_autumn_01_{south,west,north,east}.png`.

Inspection at 1x and on the canonical grid: the canopy is one connected,
rounded mass with separate olive/gold clusters. The earlier `organic_02`
candidate had four visible horizontal shelves and a nearly flat gold front.
The approved style retains large painterly clumps and similarly shaped views;
the source boards remain here for future provenance.

The deterministic author selected the new continuous broadleaf template,
kept the `CH_CAMERA_V1` anchor/canvas, used seed `84317` and density `dense`.
To regenerate the study:

```bash
PYTHONPATH=tools/visitor_forge_2d/src python -m visitor_forge_2d author-art \
  --brief tools/visitor_forge_2d/examples/briefs/park_tree_early_autumn.json \
  --output out/visitor_forge_2d/author
```

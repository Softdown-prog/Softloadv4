# Organic scenery 2D

`CH_2D_ORGANIC_SCENERY_V1` extends Visitor Forge 2D for foliage and other
organic props that do not read well as stacks of rigid polygons.

For deciduous trees, `broadleafStructure.layout: "continuous"` opts into a
single irregular canopy envelope with separately shaded leaf clusters. Set
`center`, `radius` and `masses` on that object; the legacy tier renderer is
preserved when `layout` is absent. See the early-autumn study in `examples/`.

`layout: "painted_canopy"` is a separate opt-in shape vocabulary. `profile:
"domed"` paints a connected umbrella crown with fused leaf strokes;
`profile: "branching"` follows authored `trunkBranches` and leaves open gaps.
Both use `center`, `radius`, and `density`, and the same deterministic seed.
The four complete named palettes in `examples/palettes/organic_canopy_v2.json`
can be selected through an art brief. The oiti and angico v3 examples exercise
these profiles. The v2 `crown_groups` layout, continuous recipes and approved
sprites retain their original painter.

`layout: "species_canopy"` uses `species: "oiti"` or `species: "angico"`.
The former adds simple elongated leaves to an evergreen globose crown; the
latter keeps the irregular branching umbrella readable and adds paired fine
leaflets. The v4 examples carry their own palettes and deterministic seeds.
Changing a seed varies the foliage; the angico's primary branch skeleton is
still authored in `trunkBranches` rather than randomly regenerated. These
are individual tree assets for groves and forestry as well as park placement.

`layout: "leaf_canopy"` is an opt-in v5 renderer. It shades the crown first,
then draws tapered simple leaves for oiti or paired leaflets for angico at 4x
before alpha-safe downsampling. The density, seed, four views and camera remain
the same contract. Existing v4 `species_canopy` sprites are not repainted.

The renderer is `core/organic_scenery.py`. It is deterministic: the JSON recipe,
palette and integer `seed` reproduce the same PNG without an image model or a
hidden raster source.

## Why this path exists

`CH_2D_SHAPE_RECIPE_V1` remains the compact editor for signs, furniture and
simple props. Organic scenery needs a different vocabulary: tapered quadratic
brushes, feathered branch clusters, irregular foliage masses, broad 2D light
and deliberate front/back depth. Keeping that logic in Visitor Forge avoids
turning every tree recipe into hundreds of hand-authored triangles.

## Dense raster foliage pass

Organic scenery is still authored procedurally, but the final look is no longer
limited to clean vector-like masks. The renderer now builds a denser crown from
branch clusters plus irregular clumps, fuses nearby foliage masses at working
resolution and applies deterministic raster paint inside the authored masks.

The recipe can expose a `raster` object with five density controls:

- `shadowDabs` — small occlusion/color dabs inside the crown;
- `highlightDabs` — light paint variation on front foliage;
- `needleStrokes` — directional high-resolution strokes before downsample;
- `finalGrain` — final-scale raster speckle after supersampling;
- `finalNeedles` — final-scale pointed strokes that keep foliage readable at 1x.

These passes are generated from the same integer seed, so repeated builds remain
byte-stable for the same renderer, recipe and Pillow version. They are not
external textures and do not use image generation. Work happens at 4x; final
RGBA is reduced through alpha-safe Lanczos filtering and then receives the
final-scale raster pass. This avoids the vector-clean look while keeping the
asset deterministic and background-free.

Use crown filling to remove large accidental holes, not to turn the tree into a
solid triangular cone. The final silhouette should preserve irregular branch
breaks while reading as one dense organism at gameplay scale.

## Classic tycoon conifer reference target

The current pine study uses classic pre-rendered tycoon vegetation as a visual
reference for density, raster richness and gameplay readability. The goal is to
capture those structural qualities without copying any source sprite.

Target traits:

- dense overlapping primary and secondary boughs rather than flat shelf tiers;
- a dark interior crown with brighter upper-left branch surfaces;
- many small pointed needle clusters at the silhouette edge;
- a tall tapered conifer shape with a narrow, mostly hidden trunk;
- controlled negative space: some branch gaps remain, but no large empty bands;
- visible raster texture at gameplay size instead of broad clean vector fills;
- foliage depth that still reads correctly under `CH_CAMERA_V1`.

The renderer therefore favors multiple branch fans per tier, interstitial
partial whorls, narrow central fill masses and a final-scale raster texture
pass. This reference direction is specifically for organic scenery; it should
not change the general game camera or the procedural contracts used by other
asset families.

## Camera gate

Gameplay scenery must declare `CH_CAMERA_V1` and the canonical `[128, 64]`
ground tile. The renderer exports an additional `*_isometric_review.png` with
the sprite anchor placed on the canonical 2:1 dimetric grid. This board is a
visual gate only; runtime projection remains authoritative.

For a tree, world height stays screen vertical. Rear/uphill boughs are painted
slightly higher and darker, while front/downhill boughs hang lower and expose
more of their top-facing surfaces. That gives the crown the 30-degree camera
read instead of a flat front-view Christmas-tree silhouette.

## Pine study

The canonical study is `examples/pine_tree_organic_v1.json`.

```bash
PYTHONPATH=tools/visitor_forge_2d/src python -m visitor_forge_2d.core.organic_scenery \
  --recipe tools/visitor_forge_2d/examples/pine_tree_organic_v1.json \
  --output out/visitor_forge_2d/pine_tree_v1
```

Review all three outputs before runtime promotion:

- `pine_tree_v1.png` — transparent gameplay sprite;
- `pine_tree_v1_review.png` — 1x / 2x art inspection;
- `pine_tree_v1_isometric_review.png` — camera/grid/anchor inspection.

Generated files under `out/` are review artifacts. Promote a PNG into `assets/`
only after the gameplay-size and isometric boards are visually approved.

## Three-tree conifer family

`examples/pine_small_v1.json`, `pine_tall_v1.json` and `pine_robust_v1.json`
author independent branch tiers and deterministic seeds for a short full-crown
tree, a taller slender tree with exposed trunk, and a broad dense tree. They
share the existing organic renderer, camera contract and raster passes. Recipes
may set `crownCx`, `trunk.topY`, `trunk.topWidth`, `trunk.baseWidth`, and
`shadow.width` / `shadow.height`; omitted values preserve the canonical pine.

The candidate PNGs, 1x/2x boards, map-grid boards and export metadata live in
`art/concepts/pine_family_v1/`. Opaque bounds are 136, 252 and 220 pixels high,
respectively (including the soft contact shadow). These are art candidates;
runtime promotion awaits visual approval. The workflow above now regenerates
all four pines with Visitor Forge 2D and runs the focused size test.


## Ficha técnica visual

Além do PNG RGBA transparente, do board 1x/2x e do review isométrico, o export
orgânico gera `*_technical_sheet.png`.

Essa ficha é somente um artefato de revisão. Ela não substitui o PNG canônico e
não altera seus pixels. O layout reúne:

- preview em fundo claro;
- preview em fundo escuro;
- preview ampliado sobre grid 2:1 sintético;
- ID do asset e resolução;
- direção, yaw e tile;
- anchor e contrato do renderer.

O cabeçalho deixa explícito que o grid é sintético e não é uma captura do
runtime. Isso permite usar a mesma linguagem visual de revisão adotada em outras
ferramentas sem acoplar o Forge 2D ao CH Blender.

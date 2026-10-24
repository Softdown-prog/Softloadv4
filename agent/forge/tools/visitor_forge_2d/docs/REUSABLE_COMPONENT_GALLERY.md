# Visitor Forge 2D — Reusable Component Gallery

The component gallery is the shared vocabulary used to build larger 2D props
without redrawing every nut, plank, pipe, hinge, leaf cluster or wear mark.

Contract: `CH_2D_REUSABLE_COMPONENT_GALLERY_V1`

Target: **at least 700 reusable components**.

## Batch 1

The first seed batch contains **192 components** across 12 families:

- wood planks and beams;
- metal pipes and plates;
- fasteners;
- hinges and brackets;
- rope/chain segments;
- marine fittings;
- street hardware;
- organic detail stamps;
- surface decals;
- decorative trim.

Each component is data, not a promoted runtime asset. Scene/prop grammars may
look components up by id, family, category or tags, then instantiate them with a
position, scale, rotation and an allowed material. This keeps the Forge
composable and makes the library useful to benches, signs, piers, boats, fences,
planters and future decorations.

The gallery lives at
`examples/component_gallery/reusable_components_v1.json`; the access layer is
`visitor_forge_2d.component_gallery`.

New batches should extend the same gallery contract and keep ids unique. Do not
create obsolete duplicate recipe files for each placement of a component.

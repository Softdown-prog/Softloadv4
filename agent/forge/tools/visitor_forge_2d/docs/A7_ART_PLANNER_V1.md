# A7 Art Planner V1

`A7_ART_PLANNER_V1` is the deterministic planning layer between a semantic art request and `CH_2D_GRAPH_RECIPE_V2`.

The current plant pipeline is intentionally split into independent responsibilities:

1. `A7_PLANT_INTENT_V1` describes species, age, crown intent, flowering amount/color, seed and target canvas.
2. `A7_PLANT_STRUCTURE_V2` builds one canonical lightweight 3D plant identity. The same branch IDs/topology are projected into SOUTH, WEST, NORTH and EAST.
3. `A7_ART_PLANNER_V1` compiles each projection into ordinary Draw Engine V2 nodes instead of calling an asset-specific renderer.
4. Fields derive crown density, branch proximity, depth, direction and terminal flowering zones from the projected structure.
5. Foliage uses the field-conditioned cluster/brush engines.
6. Flowering uses `A7_FLOWER_CLUSTER_ENGINE_V1`, which reuses the proven flowering grammar from the approved Ipê Amarelo work: many small rounded blossoms, warm-gold depth, bright lemon highlights, internal occlusion, edge sprays and negative-space windows.
7. Layer/Material/Image Processing nodes finish the asset.
8. `A7_PLANT_VISUAL_CRITIC_V1` evaluates the rendered result and `A7_PLANT_REPAIR_LOOP_V1` may propose one deterministic cross-view repair pass.

## Four-view identity gate

All four views must preserve the same canonical branch IDs and parent/order topology. A view is a projection of one plant, not an independently generated tree. `plant_planner_worker.py` validates this before publishing review artifacts.

## Structural Plant V2 gate

V2 uses a botanical hierarchy instead of ending the crown on long secondary branches:

- order 0: trunk
- order 1: primary structural branches
- order 2: shorter secondary branches
- order 3: compact terminal twigs

Order-3 twigs are explicitly `flowerBearing=true`. They end inside the crown/flowering zones and become the canonical terminal points used by the Art Planner. The default topology uses two terminal twigs per secondary branch.

`secondaryShortenFactor` keeps secondaries compact. `tertiaryLength`, `tertiaryRise`, `tertiaryFanDeg` and `tertiaryAttach` control terminal ramification without introducing a species-specific renderer.

`visibleWood` is an explicit structural target. Trunk and primary wood remain readable; secondary wood is reduced; flower-bearing twigs receive the lowest exposure. Low-exposure twigs remain present in the alpha/field structure, so foliage and flowers can still follow them even when they are visually hidden by the crown.

For the current default `visibleWood = 0.34`, the intention is readable trunk/forks with terminal ramification mostly absorbed by foliage and blossoms.

## Flowering gate

Flowers are not generic foliage tips tinted yellow. `flower_density` is derived from terminal branch positions, and `field_flower_clusters` paints flowering macro-groups inside those terminal zones. The node itself remains species-neutral; the Art Planner chooses palette and density presets.

For the Ipê Amarelo preset, the planner currently carries forward the approved palette grammar:

- back gold: `#D59B08` / `#9A6700`
- mid yellow: `#F2B705` / `#C38300`
- front yellow: `#FFD21A`
- lemon highlight: `#FFE96A`
- warm internal occlusion: `#62431B`

This is a derivation of the existing approved project grammar, not a copy of the production PNG.

## Plant Visual Critic V1

`A7_PLANT_VISUAL_CRITIC_V1` is plant-specific on purpose. It does not pretend that tree aesthetics can be reused as a building or vehicle score.

The critic combines semantic graph intent with final pixels. V1 currently measures:

- crown continuity: how much non-wood crown artwork belongs to the largest connected mass;
- crown fill: rendered crown coverage inside the authored `crown_density` zone;
- isolated masses: significant disconnected crown components;
- crown wood exposure: warm/brown visible wood inside the crown compared with authored wood geometry;
- silhouette imbalance: left/right crown area around the authored crown center;
- clipping safety: minimum opaque margin to the canvas edge.

Each view gets a score and explicit pass/fail gates. The four reports are then aggregated so one bad cardinal view cannot be hidden by three good views.

Cluster-shape repetition/perceptual similarity is **not yet measured by V1**. That remains a later critic layer; the current implementation does not claim otherwise.

## Deterministic Repair Loop V1

`A7_PLANT_REPAIR_LOOP_V1` converts critic failures into a single repair plan shared by SOUTH/WEST/NORTH/EAST. A repair may change only visual graph parameters such as crown lobe radius, foliage/flower counts, brush scale, minimum spacing, terminal wood alpha and safe bounds.

The repair pass must not change:

- canonical plant seed;
- branch IDs;
- parent/order topology;
- branch point geometry;
- cardinal-view identity.

The worker always renders the baseline first. If a repair is proposed, it renders the repaired four-view set and accepts it only when the aggregate critic score improves. Both baseline and repaired review boards are retained in the artifact when a repair was attempted.

`criticPassed=true` is **not** the same as `artApproved=true`. The critic is an automatic quality gate, while production art approval remains a separate visual decision. The worker never promotes an asset to runtime automatically.

## Current visual status

The planner now supports semantic intent -> canonical botanical structure -> field-aware four-view rendering -> plant visual critique -> deterministic repair comparison.

The next critic work should add perceptual repetition detection and stronger species/profile-specific targets. Technical graph success or critic success alone is not sufficient for production approval.

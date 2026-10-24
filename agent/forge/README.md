# A7 Forge for Solaris Code

This is a tool bundle shared by the Softload web pipeline and Worker Agent.
`tools/` is imported from the two tool directories of
`Softdown-prog/A7-forge-2D-` at the commit in `UPSTREAM.json`. No `games/`, game
code, game assets, game saves or game workflows are included. Authored masters,
brushes, component libraries, recipes, tests and upstream documentation belong
to the tool and are included because several renderers need them at runtime.
The libmypaint notice remains under `tools/visitor_forge_2d/third_party/`.
All renderer/recipe/resource files are unchanged. One test was adapted to
verify GIF playback duration when identical frames are merged; see `PATCHES.md`.

## Structure and runtime

- `catalog.cjs`: enumerates actual recipes and supported data contracts.
- `index.cjs`: validates requests, stages jobs, bounds output and publishes an
  immutable bundle under `assets/<id>/`. CommonJS is intentional: the app uses
  CommonJS and the Agent imports this same implementation from ESM.
- `render.py`: calls the original Python renderers; it never executes model code.
- `html5/`: newly authored reusable Canvas engine primitives and seeded code
  recipes. No game implementation was extracted from LHS or Magic Castle.
- `UPSTREAM.json`, `verify-source.cjs`: exact file hashes for all imported tools.

Python 3.11+, Pillow from `requirements.txt`, ffmpeg/ffprobe and Node 20+ are
required. Both Dockerfiles install an isolated Python environment and execute
`smoke.cjs` during their build. For local use, set `SOLARIS_FORGE_PYTHON` to its
Python executable or provide `python3` with Pillow on PATH. No editable pip
installation is required: the adapter loads the included source and libraries.

## Supported operations

`catalog()` lists commands, recipe IDs and contracts. `readRecipe(recipeId)`
returns full recipe data. `render({id, command, recipeId}, {baseDir})` generates
real files; use `recipe` (object) or `receitaJson` (JSON string) instead of
`recipeId` for a custom recipe. Exactly one recipe source is allowed.
`html5-runtime` requires no recipe. Outputs include paths, checksums, bounded
metadata, reproducible recipe and a `solaris-asset.json` provenance file.

Supported commands: draw-graph, draw-recipe, run-workers, plan-plant,
render-pixel-character, author-art, author-prop, pack-animation, audio-synth,
html5-runtime. The full original CLI and source remain available for manual
authoring workflows, including localized finishing and character rigging.

The catalog marks palette/profile/library JSON without an executable command;
those are reference data, not standalone render jobs. To adapt a recipe, read
it first and keep its contract. `pack-animation` accepts 2–64 RGBA frame paths
relative to the current project, rather than arbitrary filesystem paths.

## Solaris integration

The brainstorm prompt receives the catalogue for game/asset requests. The
manifest has an optional `assets` array. Server validation checks every task
and contract before execution; assets render before per-file model calls.
Those calls receive real output paths, animation metadata and the Canvas API.
Generated code cannot overwrite asset bundles. The final ZIP includes all
binary files, recipes and provenance. Game projects using Forge are also
attached to the session with the existing quota/retention system.

The attached-project editor exposes `catalogoAssetForge`,
`lerReceitaAssetForge` and `proporAssetForge`. Proposals store recipe data,
never base64 sprite sheets in the chat/session. Generation happens only after
confirmation in a later turn, through the existing apply-proposals flow. Read
the resulting manifests before proposing code that consumes the new bundle.
Choose a new bundle ID for revisions; existing bundles are not overwritten.

Worker Agent protocol:

```json
{
  "request_id": "asset-job",
  "task": "execute",
  "actions": [{
    "id": "tree",
    "capability": "forge",
    "operation": "render",
    "input": {
      "id": "tree",
      "command": "run-workers",
      "recipe_id": "tools/visitor_forge_2d/examples/park_tree_oiti_species_v4.json"
    }
  }]
}
```

`forge.catalog` and `forge.recipe` are read-only. `forge.render` is granted to
the Coder role; the default and other roles cannot render. `output_path`, if
provided, must be an existing directory inside the workspace. No unrestricted
shell permission is granted by this integration.

## Limits and honest capability boundaries

These are deterministic procedural tools, not a diffusion image service.
Technical checks never constitute visual approval. Original art-review flags
remain false. Exports are candidates for the generated project; no source-game
catalog is modified and no art is silently promoted into an existing game.

Each request is limited to 128 KiB of recipe JSON, 1024-pixel authored canvas
dimensions, 90 seconds wall time, 75 CPU seconds, 1 GiB address space, 512 output
files and 32 MiB of exported files. A manifest allows at most 12 asset jobs.
Recipes are not programs. Subprocesses receive no app credentials; renderer
reads/writes are confined, sockets and arbitrary commands are blocked. This is
an adapter over trusted bundled renderers, not a sandbox for arbitrary Python.

Audio Lab's optional Stable Audio local/API providers were retained as tool
source but are not executed by model recipes. The automatic audio command
supports only deterministic synthesis, at most 30 seconds, plus the original
OGG mastering worker. It does not download weights, incur API charges or use
external providers. Configure and validate those separately before exposing
them as another capability. Blender is not a dependency of this bundle.

## Verification

```bash
node agent/forge/verify-source.cjs
node agent/forge/smoke.cjs
node --test agent/forge/test/runtime.test.cjs
node src/solaris/tools/assetForge.test.js
node src/solaris/tools/projectStorage.binary.test.js
cd agent && npm test
```

For the original renderer suite, from `agent/forge/`:
`PYTHONPATH=tools/visitor_forge_2d/src python -m pytest -q tools/visitor_forge_2d/tests`.

The migration CI exercises the original renderer tests, Solaris asset/ZIP/
editor/storage regression tests, Worker Agent and a production Agent image.
No test uses a live LLM, paid audio provider or real GCS/Firestore account.

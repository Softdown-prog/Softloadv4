# Solaris Canvas 2D runtime

These ES modules contain reusable engine primitives, not a game. Serve the
project through HTTP and import `runtime.mjs` and `procedural.mjs` by relative URL.

- `createLoop({update, render})`: fixed step in seconds; interpolation ratio for rendering.
- `createInput(canvas)`: keyboard actions and captured touch pointers. Set
  `canvas.style.touchAction = 'none'` on the game surface only; call `destroy()`
  when leaving a scene and `loop.stop()` when pausing/disposing.
- `fitCanvas(canvas, cssWidth, cssHeight)`: CSS pixels, DPR capped at 2.
- `isoToScreen` / `screenToIso`: 2:1 ground projection, default 128×64.
- `intersects`, `moveAndCollide`: axis-aligned rectangles in world coordinates;
  movement clamps at walls even with large deltas. Start from a non-overlapping position.
- `drawAnimation(ctx, image, manifest, elapsedMs, x, y)`: consumes the A7
  `animation.json` frames (`rect`, `durationMs`, `anchor`) without guessing cells.
- `seededRandom`, `generateTerrain`, `drawTree`: deterministic procedural code.

Create game-specific simulation, scenes, audio policy, save versioning and UI in
separate modules. Load assets once, await image decoding, use relative URLs,
handle loading failures, pause on visibility changes, and make audio opt-in on
the first user gesture. Technical validation is not artistic approval.

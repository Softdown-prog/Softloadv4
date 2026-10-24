# Documented import adaptations

The renderers, recipes, artwork and audio tools are unchanged from the pinned
upstream commit. One imported **test** has a local adaptation:

`tools/visitor_forge_2d/tests/test_pixel_character.py`,
`test_pixel_wizard_projectile_trajectory_and_full_preview`:

- Reproduced the same failure in the original A7 checkout, before changing the
  import: the north GIF has 13 encoded frames instead of 14.
- The north hold/release includes adjacent identical images. Pillow merges
  those into a single frame lasting 220 ms; total playback remains 1540 ms,
  exactly the original 14 × 110 ms timeline. The other three directions encode
  14 frames and also last 1540 ms.
- The test now accepts 13 or 14 encoded frames and explicitly verifies total
  duration. It does not change character pixels, motion, spritesheet frames,
  recipes, runtime manifests or the GIF encoder.

`UPSTREAM.json` retains the original SHA-256 and records `localSha256` for this
one test. `verify-source.cjs` checks the documented local hash for that entry
and the original hash for every other tool file. No upstream repository was
modified by the migration.

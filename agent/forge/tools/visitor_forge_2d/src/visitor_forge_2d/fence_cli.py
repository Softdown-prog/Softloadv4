from __future__ import annotations

import argparse
import json
from pathlib import Path

from .core.chainlink_fence_scenery import export_chainlink_fence_scenery
from .core.fence_scenery import export_fence_scenery


def main() -> int:
    parser = argparse.ArgumentParser(
        prog="ch-fence-2d",
        description="Render modular City Horizon procedural 2D fence families.",
    )
    parser.add_argument("--recipe", required=True, help="CH_2D_FENCE_SCENERY_V1 JSON recipe")
    parser.add_argument("--output", required=True, help="Review/output directory")
    args = parser.parse_args()

    recipe_path = Path(args.recipe)
    recipe = json.loads(recipe_path.read_text(encoding="utf-8"))
    if recipe.get("variant") == "chainlink":
        result = export_chainlink_fence_scenery(recipe_path, Path(args.output))
    else:
        result = export_fence_scenery(recipe_path, Path(args.output))

    print(json.dumps({"status": "ok", **result}, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

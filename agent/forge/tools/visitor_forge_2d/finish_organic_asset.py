#!/usr/bin/env python3
"""Apply an optional CH_2D_RENDER_FINISH_V1 recipe to an organic scenery render."""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from PIL import Image

HERE = Path(__file__).resolve().parent
SRC = HERE / "src"
if str(SRC) not in sys.path:
    sys.path.insert(0, str(SRC))

from visitor_forge_2d.core.organic_scenery import isometric_board, review_board  # noqa: E402
from visitor_forge_2d.core.render_finish import finish_render  # noqa: E402

CONTRACT = "CH_2D_ORGANIC_FINISH_BRIDGE_V1"


def apply(recipe_path: Path, output_dir: Path) -> dict:
    recipe = json.loads(recipe_path.read_text(encoding="utf-8"))
    finish_recipe_value = recipe.get("finishRecipe")
    if not finish_recipe_value:
        return {"contract": CONTRACT, "status": "skipped", "reason": "recipe has no finishRecipe"}

    finish_recipe = Path(finish_recipe_value)
    stem = recipe["id"]
    base = output_dir / f"{stem}.png"
    if not base.is_file():
        raise FileNotFoundError(f"organic render not found: {base}")

    temporary = output_dir / f"{stem}.finished.tmp.png"
    comparison = output_dir / f"{stem}_finish_review.png"
    result = finish_render(base, temporary, finish_recipe, comparison)
    temporary.replace(base)

    with Image.open(base) as image:
        final = image.convert("RGBA")
    review_board(final).save(output_dir / f"{stem}_review.png")
    isometric_board(final, recipe.get("anchor", [96, 239])).save(
        output_dir / f"{stem}_isometric_review.png"
    )

    report = {
        "contract": CONTRACT,
        "status": "ok",
        "id": stem,
        "organicRecipe": str(recipe_path),
        "finishRecipe": str(finish_recipe),
        "finish": result,
        "png": str(base),
        "review": str(output_dir / f"{stem}_review.png"),
        "isometricReview": str(output_dir / f"{stem}_isometric_review.png"),
        "comparisonReview": str(comparison),
    }
    report_path = output_dir / f"{stem}_finish.json"
    report_path.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    report["report"] = str(report_path)
    return report


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--recipe", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    print(json.dumps(apply(args.recipe, args.output), indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

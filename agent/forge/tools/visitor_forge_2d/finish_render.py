#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
SRC = HERE / "src"
if str(SRC) not in sys.path:
    sys.path.insert(0, str(SRC))

from visitor_forge_2d.core.render_finish import finish_render  # noqa: E402


def main() -> int:
    parser = argparse.ArgumentParser(description="Alpha-safe procedural 2D finish for approved RGBA renders")
    parser.add_argument("--input", required=True)
    parser.add_argument("--recipe", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--review")
    args = parser.parse_args()
    result = finish_render(
        Path(args.input),
        Path(args.output),
        Path(args.recipe),
        Path(args.review) if args.review else None,
    )
    print(json.dumps(result, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

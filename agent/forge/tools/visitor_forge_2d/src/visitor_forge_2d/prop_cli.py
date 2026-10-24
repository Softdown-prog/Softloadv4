"""Standalone CLI for the parametric Visitor Forge 2D prop author.

Usage:
  python -m visitor_forge_2d.prop_cli --brief brief.json --output out/
  python -m visitor_forge_2d.prop_cli --id pier_01 --prompt "píer longo envelhecido" --output out/
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path

from .prop_author import CONTRACT, run_prop_author


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="ch-forge2d-prop-author")
    source = parser.add_mutually_exclusive_group(required=True)
    source.add_argument("--brief", help="CH_2D_PROP_BRIEF_V1 JSON file")
    source.add_argument("--prompt", help="Controlled-language prop prompt")
    parser.add_argument("--id", help="Required with --prompt")
    parser.add_argument("--output", required=True, help="Output root")
    return parser


def main() -> int:
    args = build_parser().parse_args()
    if args.brief:
        brief = json.loads(Path(args.brief).read_text(encoding="utf-8"))
    else:
        if not args.id:
            raise ValueError("--id is required with --prompt")
        brief = {"contract": CONTRACT, "id": args.id, "prompt": args.prompt}
    result = run_prop_author(brief, Path(args.output))
    print(json.dumps(result, indent=2, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

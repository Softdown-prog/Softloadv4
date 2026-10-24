from __future__ import annotations

import json
from pathlib import Path

from .model import CharacterDefinition, PoseSpec


def _read_json(path: str | Path) -> dict:
    source = Path(path)
    try:
        return json.loads(source.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        raise ValueError(f"Invalid JSON in {source}: {exc}") from exc


def load_character_definition(path: str | Path) -> CharacterDefinition:
    return CharacterDefinition.from_dict(_read_json(path))


def load_pose(path: str | Path) -> PoseSpec:
    return PoseSpec.from_dict(_read_json(path))

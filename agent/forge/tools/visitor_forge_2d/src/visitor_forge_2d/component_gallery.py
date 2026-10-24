"""Reusable component gallery for Visitor Forge 2D.

The gallery is data-driven and intentionally separate from runtime assets. It
stores authored building blocks that scene grammars can query by id, family,
category or tags and instantiate inside larger props.
"""
from __future__ import annotations

import copy
import json
from pathlib import Path

CONTRACT = "CH_2D_REUSABLE_COMPONENT_GALLERY_V1"
GALLERY_DIR = Path(__file__).resolve().parent / "component_library"
DEFAULT_GALLERY = GALLERY_DIR / "reusable_components_v1.json"
DEFAULT_GALLERY_SHARDS = (
    GALLERY_DIR / "reusable_components_v1.json",
    GALLERY_DIR / "reusable_components_v2.json",
)


def _expand_family(name: str, spec: dict) -> list[dict]:
    items = []
    for size in spec.get("sizes", []):
        for style in spec.get("styles", []):
            for orientation in spec.get("orientationsDeg", []):
                item_id = f"{name}_{style}_{size['name']}_{int(orientation):03d}"
                items.append({
                    "id": item_id,
                    "family": name,
                    "category": spec["category"],
                    "primitive": spec["primitive"],
                    "sizePx": list(size["sizePx"]),
                    "orientationDeg": orientation,
                    "style": style,
                    "materials": list(spec["materials"]),
                    "tags": list(spec.get("tags", [])) + [size["name"], style],
                    "defaults": copy.deepcopy(spec.get("defaults", {})),
                    "status": "seed_library",
                    "runtimePromotion": False,
                })
    return items


def _load_shard(path: Path) -> dict:
    data = json.loads(path.read_text(encoding="utf-8"))
    if data.get("contract") != CONTRACT:
        raise ValueError(f"component gallery requires {CONTRACT}")
    families = data.get("familyDefinitions")
    if not isinstance(families, dict) or not families:
        raise ValueError("component gallery familyDefinitions must be a non-empty object")
    items = []
    for name, spec in families.items():
        items.extend(_expand_family(name, spec))
    ids = [item["id"] for item in items]
    if len(ids) != len(set(ids)):
        raise ValueError("component gallery item ids must be unique within a shard")
    if data.get("currentCount") != len(items):
        raise ValueError("component gallery currentCount does not match expanded items")
    result = copy.deepcopy(data)
    result["items"] = items
    return result


def load_component_gallery(path: Path = DEFAULT_GALLERY) -> dict:
    # The default gallery is now a versioned aggregate. Explicit non-default
    # paths still load one shard so tests/tools can inspect a batch in isolation.
    paths = DEFAULT_GALLERY_SHARDS if Path(path) == DEFAULT_GALLERY else (Path(path),)
    shards = [_load_shard(p) for p in paths]
    families: dict[str, dict] = {}
    items: list[dict] = []
    for shard in shards:
        overlap = set(families).intersection(shard["familyDefinitions"])
        if overlap:
            raise ValueError(f"component gallery family ids must be unique across shards: {sorted(overlap)}")
        families.update(copy.deepcopy(shard["familyDefinitions"]))
        items.extend(copy.deepcopy(shard["items"]))
    ids = [item["id"] for item in items]
    if len(ids) != len(set(ids)):
        raise ValueError("component gallery item ids must be unique across shards")
    target = max(int(shard.get("targetCount", 0)) for shard in shards)
    return {
        "contract": CONTRACT,
        "version": max(int(shard.get("version", 1)) for shard in shards),
        "targetCount": target,
        "currentCount": len(items),
        "status": "target_reached" if len(items) >= target else "seed_library",
        "familyDefinitions": families,
        "generation": {
            "sizesPerFamily": 4,
            "stylesPerFamily": 2,
            "orientationsPerFamily": 2,
            "itemsPerFamily": 16,
            "familyCount": len(families),
            "shardCount": len(shards),
        },
        "items": items,
    }


def get_component(component_id: str, path: Path = DEFAULT_GALLERY) -> dict:
    for item in load_component_gallery(path)["items"]:
        if item["id"] == component_id:
            return copy.deepcopy(item)
    raise KeyError(component_id)


def search_components(*, family: str | None = None, category: str | None = None,
                      tags: tuple[str, ...] | list[str] = (), path: Path = DEFAULT_GALLERY) -> list[dict]:
    wanted = {tag.lower() for tag in tags}
    out = []
    for item in load_component_gallery(path)["items"]:
        if family is not None and item.get("family") != family:
            continue
        if category is not None and item.get("category") != category:
            continue
        item_tags = {str(tag).lower() for tag in item.get("tags", [])}
        if not wanted.issubset(item_tags):
            continue
        out.append(copy.deepcopy(item))
    return out


def instantiate_component(component_id: str, *, x: float = 0, y: float = 0,
                          scale: float = 1.0, rotate_deg: float | None = None,
                          material: str | None = None, path: Path = DEFAULT_GALLERY) -> dict:
    if scale <= 0:
        raise ValueError("component scale must be positive")
    item = get_component(component_id, path)
    chosen_material = material or item["materials"][0]
    if chosen_material not in item["materials"]:
        raise ValueError(f"material {chosen_material!r} is not supported by {component_id}")
    return {
        "componentId": component_id,
        "primitive": item["primitive"],
        "sizePx": [round(v * scale, 4) for v in item["sizePx"]],
        "style": item["style"],
        "material": chosen_material,
        "transform": {
            "translate": [x, y],
            "scale": scale,
            "rotateDeg": item["orientationDeg"] if rotate_deg is None else rotate_deg,
        },
        "defaults": copy.deepcopy(item.get("defaults", {})),
        "tags": list(item.get("tags", [])),
    }

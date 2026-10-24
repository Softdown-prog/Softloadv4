"""Resolve reusable Forge 2D gallery components into bounded scene nodes.

Scene recipes may use ``type: component`` nodes with a concrete gallery ID.
This module resolves those references before Scene Composer V3 validation so
components remain data-driven, deterministic and subject to the same node,
material and transform guardrails as hand-authored scene nodes.
"""
from __future__ import annotations

from copy import deepcopy

from ..component_gallery import get_component
from .component_templates import build_component


_MATERIAL_PRESETS = {
    "wood": {"type":"wood","light":"#C08A55","dark":"#5A311E","grainSpacing":4.5,"grainColor":"#2B160F38"},
    "painted_wood": {"type":"painted_wood","light":"#B98A62","dark":"#553522","paintColor":"#8E6548B8","grainSpacing":4.6},
    "metal": {"type":"painted_metal","base":"#626C72","highlight":"#CBD2D5","brushAngleDeg":-24},
    "painted_metal": {"type":"painted_metal","base":"#59666D","highlight":"#C7D0D4","brushAngleDeg":-24},
    "stone": {"type":"stone","light":"#B7AEA0","dark":"#625C54"},
    "concrete": {"type":"stone","light":"#B8B5AD","dark":"#67645E"},
    "brick": {"type":"stone","light":"#B66F54","dark":"#65392E"},
    "rope": {"type":"rope","light":"#D9BC7A","dark":"#79582E","twistSpacing":4.5},
    "rubber": {"type":"solid","color":"#303538"},
    "glass": {"type":"linear_gradient","start":"#D8EEF0B8","end":"#7FA6ADB0","axis":"y"},
    "organic": {"type":"linear_gradient","start":"#78A85B","end":"#31583A","axis":"y"},
    "overlay": {"type":"solid","color":"#E7DED0C8"},
    "paint": {"type":"solid","color":"#E9E2D2"},
    "fabric": {"type":"linear_gradient","start":"#C75F4E","end":"#76382F","axis":"y"},
}


def _material(alias: str) -> dict:
    try:
        return {**deepcopy(_MATERIAL_PRESETS[alias]), "space": "object"}
    except KeyError as exc:
        raise ValueError(f"component material alias {alias!r} has no Scene Composer preset") from exc


def _effects(item: dict, supplied: object) -> dict:
    if supplied is not None:
        if not isinstance(supplied, dict):
            raise ValueError("component effects must be an object")
        return deepcopy(supplied)
    defaults = item.get("defaults", {})
    out = {}
    bevel = float(defaults.get("bevel", 0))
    outline = float(defaults.get("outline", 0))
    if bevel > 0:
        out["bevel"] = {"width": bevel, "strength": 0.28}
    if outline > 0:
        out["outline"] = {"width": outline, "color": "#302A26A8"}
    return out


def _resolve_component(node: dict) -> dict:
    allowed = {"type", "componentId", "material", "transform", "effects", "role"}
    extra = set(node) - allowed
    if extra:
        raise ValueError(f"component node contains unsupported keys: {sorted(extra)}")
    component_id = node.get("componentId")
    if not isinstance(component_id, str) or not component_id:
        raise ValueError("component node requires non-empty componentId")
    item = get_component(component_id)
    alias = node.get("material") or item["materials"][0]
    if alias not in item["materials"]:
        raise ValueError(f"material {alias!r} is not supported by {component_id}")
    transform = deepcopy(node.get("transform", {}))
    if "rotateDeg" not in transform:
        transform["rotateDeg"] = item["orientationDeg"]
    shapes = build_component(item, _material(alias), _effects(item, node.get("effects")), node.get("role"))
    return {
        "type": "group",
        "transform": transform,
        "children": shapes,
        "componentId": component_id,
    }


def _expand_nodes(nodes: list[dict]) -> list[dict]:
    out = []
    for node in nodes:
        if not isinstance(node, dict):
            out.append(node)
            continue
        kind = node.get("type", "shape")
        if kind == "component":
            resolved = _resolve_component(node)
            # componentId is provenance only and V3 group nodes do not accept
            # arbitrary behavior; strip it before handing off to V3.
            resolved.pop("componentId", None)
            out.append(resolved)
            continue
        clone = deepcopy(node)
        if kind in ("group", "clip_group") and isinstance(clone.get("children"), list):
            clone["children"] = _expand_nodes(clone["children"])
        out.append(clone)
    return out


def expand_recipe(recipe: dict) -> dict:
    expanded = deepcopy(recipe)
    if isinstance(expanded.get("layers"), list):
        expanded["layers"] = _expand_nodes(expanded["layers"])
    symbols = expanded.get("symbols")
    if isinstance(symbols, dict):
        expanded["symbols"] = {name: _expand_nodes(nodes) if isinstance(nodes, list) else nodes
                               for name, nodes in symbols.items()}
    return expanded


def component_usage(recipe: dict) -> dict:
    ids: list[str] = []
    def walk(nodes):
        if not isinstance(nodes, list):
            return
        for node in nodes:
            if not isinstance(node, dict):
                continue
            if node.get("type") == "component" and isinstance(node.get("componentId"), str):
                ids.append(node["componentId"])
            walk(node.get("children"))
    walk(recipe.get("layers"))
    for nodes in (recipe.get("symbols") or {}).values():
        walk(nodes)
    return {"count": len(ids), "componentIds": sorted(set(ids))}

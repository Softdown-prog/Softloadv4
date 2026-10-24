"""High-level deterministic prop author for Visitor Forge 2D.

A structured brief or controlled-language prompt is converted into a bounded
parametric prop grammar and then into a CH_2D_SCENE_RECIPE_V4 scene. The author
covers boats, piers, signs and reusable street/decor props while keeping every
decision explicit, deterministic and review-gated.
"""
from __future__ import annotations

import hashlib
import json
import re
import unicodedata
from pathlib import Path

from .prop_grammar import GRAMMAR_CONTRACT, build_pier_recipe, configure_rowboat_recipe
from .prop_sign_grammar import build_sign_recipe
from .prop_street_grammar import (
    build_bench_recipe,
    build_bollard_recipe,
    build_planter_recipe,
    build_trash_bin_recipe,
)
from .workers import run_workers, validate_recipe

CONTRACT = "CH_2D_PROP_BRIEF_V1"
EXAMPLES = Path(__file__).resolve().parents[2] / "examples"
ARCHETYPES = ("rowboat", "pier", "sign", "bench", "bollard", "planter", "trash_bin")
TEMPLATES = {"rowboat": "prop_rowboat_scene_v4.json"}
ALIASES = {
    "rowboat": ("barco", "barquinho", "boat", "rowboat", "bote"),
    "pier": ("pier", "píer", "cais", "doca", "dock"),
    "sign": ("placa", "sinalizacao", "sinalização", "sign", "wayfinding"),
    "bench": ("banco de parque", "banco", "bench", "park bench"),
    "bollard": ("bollard", "balizador", "balizador urbano", "poste baixo"),
    "planter": ("vaso", "floreira", "planter", "flower pot"),
    "trash_bin": ("lixeira", "trash bin", "waste bin", "garbage bin"),
}
CONDITIONS = {
    "pristine": ("novo", "nova", "limpo", "limpa", "pristine", "new", "clean"),
    "used": ("usado", "usada", "uso", "used", "worn"),
    "weathered": ("envelhecido", "envelhecida", "gasto", "gasta", "weathered", "aged", "rustico", "rústico"),
}
COMMON_FIELDS = {"contract", "id", "prompt", "archetype", "condition", "seed"}
PARAM_FIELDS = {
    "pier": {"lengthTiles", "widthTiles", "ladder", "cleats", "railing"},
    "rowboat": {"size", "oar", "seats"},
    "sign": {"material", "boardShape", "posts", "arrow", "cap"},
    "bench": {"material", "backrest", "armrests", "length"},
    "bollard": {"material", "cap"},
    "planter": {"material", "shape"},
    "trash_bin": {"material", "lid"},
}


def _normalized(value: str) -> str:
    value = unicodedata.normalize("NFKD", value.lower())
    return "".join(char for char in value if not unicodedata.combining(char))


def _safe_id(value: object) -> str:
    if not isinstance(value, str) or not re.fullmatch(r"[a-z0-9][a-z0-9_-]*", value):
        raise ValueError("prop brief id must use lowercase letters, digits, _ or -")
    return value


def interpret_prop_prompt(prompt: str) -> dict:
    if not isinstance(prompt, str) or not prompt.strip():
        raise ValueError("prompt must be a non-empty string")
    text = _normalized(prompt)
    archetypes = [name for name, aliases in ALIASES.items() if any(_normalized(alias) in text for alias in aliases)]
    # 'banco' may appear in rowboat prompts as seat; prefer rowboat when boat words are present.
    if "rowboat" in archetypes and "bench" in archetypes:
        archetypes.remove("bench")
    if len(archetypes) != 1:
        if not archetypes:
            raise ValueError(f"unsupported prop; choose {', '.join(ARCHETYPES)}")
        raise ValueError("prompt mentions multiple prop archetypes; author one asset at a time")
    archetype = archetypes[0]
    result = {"archetype": archetype}
    conditions = [name for name, aliases in CONDITIONS.items() if any(_normalized(alias) in text for alias in aliases)]
    if len(conditions) > 1:
        raise ValueError("prompt mentions conflicting prop conditions")
    if conditions:
        result["condition"] = conditions[0]

    if archetype == "pier":
        if any(term in text for term in ("comprido", "comprida", "longo", "long pier", "long dock")):
            result["lengthTiles"] = 4
        elif any(term in text for term in ("curto", "curta", "short pier", "short dock")):
            result["lengthTiles"] = 2
        if any(term in text for term in ("largo", "larga", "wide pier", "wide dock")):
            result["widthTiles"] = 2
        if any(term in text for term in ("sem escada", "without ladder", "no ladder")):
            result["ladder"] = False
        elif any(term in text for term in ("com escada", "with ladder")):
            result["ladder"] = True
        if any(term in text for term in ("sem cunho", "sem cunhos", "without cleats", "no cleats")):
            result["cleats"] = False
        if any(term in text for term in ("sem guarda-corpo", "sem corrimao", "without railing", "no railing")):
            result["railing"] = False
        elif any(term in text for term in ("guarda-corpo", "corrimao", "with railing")):
            result["railing"] = True
    elif archetype == "rowboat":
        if any(term in text for term in ("pequeno", "pequena", "small boat", "small rowboat")):
            result["size"] = "small"
        elif any(term in text for term in ("grande", "large boat", "large rowboat")):
            result["size"] = "large"
        if any(term in text for term in ("sem remo", "without oar", "no oar")):
            result["oar"] = False
        elif any(term in text for term in ("com remo", "with oar")):
            result["oar"] = True
        if any(term in text for term in ("um banco", "1 banco", "one seat")):
            result["seats"] = 1
        elif any(term in text for term in ("dois bancos", "2 bancos", "two seats")):
            result["seats"] = 2
    elif archetype == "sign":
        if any(term in text for term in ("metal", "metalica", "metalico", "metálica", "metálico")):
            result["material"] = "metal"
        elif any(term in text for term in ("madeira", "wood", "wooden")):
            result["material"] = "wood"
        if any(term in text for term in ("duas hastes", "dois postes", "2 postes", "two posts")):
            result["posts"] = 2
        elif any(term in text for term in ("uma haste", "um poste", "1 poste", "one post")):
            result["posts"] = 1
        if any(term in text for term in ("seta esquerda", "arrow left", "left arrow")):
            result["arrow"] = "left"
        elif any(term in text for term in ("sem seta", "no arrow", "without arrow")):
            result["arrow"] = "none"
        elif any(term in text for term in ("seta direita", "arrow right", "right arrow")):
            result["arrow"] = "right"
        if any(term in text for term in ("formato seta", "placa seta", "arrow board", "arrow-shaped")):
            result["boardShape"] = "arrow"
        elif any(term in text for term in ("retangular", "rectangular", "rectangle")):
            result["boardShape"] = "rect"
        elif any(term in text for term in ("arredondada", "arredondado", "rounded")):
            result["boardShape"] = "rounded"
        if any(term in text for term in ("sem tampa", "sem topo", "no cap")):
            result["cap"] = False
    elif archetype == "bench":
        if "metal" in text:
            result["material"] = "metal"
        elif any(term in text for term in ("madeira", "wood", "wooden")):
            result["material"] = "wood"
        if any(term in text for term in ("sem encosto", "without backrest", "no backrest")):
            result["backrest"] = False
        if any(term in text for term in ("sem bracos", "sem braços", "without armrests", "no armrests")):
            result["armrests"] = False
        if any(term in text for term in ("curto", "short bench")):
            result["length"] = "short"
        elif any(term in text for term in ("longo", "comprido", "long bench")):
            result["length"] = "long"
    elif archetype == "bollard":
        result["material"] = "stone" if any(term in text for term in ("pedra", "stone")) else "metal"
        if any(term in text for term in ("topo reto", "flat cap", "flat top")):
            result["cap"] = "flat"
    elif archetype == "planter":
        if "metal" in text:
            result["material"] = "metal"
        elif any(term in text for term in ("madeira", "wood", "wooden")):
            result["material"] = "wood"
        else:
            result["material"] = "stone"
        if any(term in text for term in ("quadrado", "quadrada", "square")):
            result["shape"] = "square"
    elif archetype == "trash_bin":
        result["material"] = "wood" if any(term in text for term in ("madeira", "wood", "wooden")) else "metal"
        if any(term in text for term in ("sem tampa", "without lid", "no lid")):
            result["lid"] = False
    return result


def _condition_scene(recipe: dict, condition: str) -> None:
    if condition not in ("pristine", "used", "weathered"):
        raise ValueError("condition must be pristine, used or weathered")
    finish = recipe.setdefault("finish", {})
    regions = recipe.setdefault("finishRegions", [])
    if condition == "pristine":
        finish["surfaceVariation"] = min(float(finish.get("surfaceVariation", 0.04)), 0.035)
        finish["brushStamps"] = min(int(finish.get("brushStamps", 12)), 10)
        for region in regions:
            region["opacity"] = round(min(float(region.get("opacity", 0.1)), 0.07), 3)
            region["stamps"] = max(0, round(int(region.get("stamps", 12)) * 0.55))
    elif condition == "weathered":
        finish["surfaceVariation"] = round(min(0.18, float(finish.get("surfaceVariation", 0.06)) * 1.45), 3)
        finish["brushStamps"] = min(120, max(int(finish.get("brushStamps", 18)), 34))
        for region in regions:
            region["opacity"] = round(min(0.30, float(region.get("opacity", 0.1)) * 1.45), 3)
            region["stamps"] = min(120, max(1, round(int(region.get("stamps", 12)) * 1.35)))


def _merge_parameters(archetype: str, brief: dict, parsed: dict) -> dict:
    defaults = {
        "pier": {"lengthTiles": 3, "widthTiles": 1, "ladder": True, "cleats": True, "railing": False},
        "rowboat": {"size": "medium", "oar": True, "seats": 2},
        "sign": {"material": "wood", "boardShape": "rounded", "posts": 1, "arrow": "right", "cap": True},
        "bench": {"material": "wood", "backrest": True, "armrests": True, "length": "medium"},
        "bollard": {"material": "metal", "cap": "round"},
        "planter": {"material": "stone", "shape": "round"},
        "trash_bin": {"material": "metal", "lid": True},
    }[archetype]
    params = dict(defaults)
    for key in PARAM_FIELDS[archetype]:
        if key in parsed:
            params[key] = parsed[key]
        if key in brief:
            if key in parsed and brief[key] != parsed[key]:
                raise ValueError(f"prompt and structured field {key} disagree")
            params[key] = brief[key]
    return params


def author_prop_recipe(brief: dict, examples: Path = EXAMPLES) -> tuple[dict, dict]:
    if not isinstance(brief, dict) or brief.get("contract") != CONTRACT:
        raise ValueError(f"prop brief requires {CONTRACT}")
    asset_id = _safe_id(brief.get("id"))
    parsed = interpret_prop_prompt(brief["prompt"]) if "prompt" in brief else {}
    archetype = brief.get("archetype", parsed.get("archetype"))
    if archetype not in ARCHETYPES:
        raise ValueError(f"unsupported prop archetype {archetype!r}; choose {', '.join(ARCHETYPES)}")
    if parsed and parsed["archetype"] != archetype:
        raise ValueError("prompt archetype and structured archetype disagree")
    condition = brief.get("condition", parsed.get("condition", "pristine" if archetype == "sign" else "used"))
    if "condition" in parsed and "condition" in brief and parsed["condition"] != brief["condition"]:
        raise ValueError("prompt condition and structured condition disagree")
    unknown = set(brief) - COMMON_FIELDS - PARAM_FIELDS[archetype]
    if unknown:
        raise ValueError(f"prop brief contains unsupported fields: {', '.join(sorted(unknown))}")
    params = _merge_parameters(archetype, brief, parsed)

    if "seed" in brief:
        seed = brief["seed"]
        if type(seed) is not int or not 0 <= seed < 2**32:
            raise ValueError("seed must be a non-negative 32-bit integer")
    else:
        fingerprint = json.dumps({"id": asset_id, "archetype": archetype, "condition": condition, "parameters": params}, sort_keys=True)
        seed = int.from_bytes(hashlib.sha256(fingerprint.encode()).digest()[:4], "big")

    if archetype == "pier":
        recipe = build_pier_recipe(asset_id, seed, length_tiles=params["lengthTiles"], width_tiles=params["widthTiles"],
                                   ladder=params["ladder"], cleats=params["cleats"], railing=params["railing"])
        source = "parametric:pier_v1"
    elif archetype == "rowboat":
        filename = TEMPLATES[archetype]
        template = json.loads((examples / filename).read_text(encoding="utf-8"))
        recipe = configure_rowboat_recipe(template, size=params["size"], oar=params["oar"], seats=params["seats"])
        recipe["id"] = asset_id
        recipe["seed"] = seed
        source = f"parametric:rowboat_v1<{filename}>"
    elif archetype == "sign":
        recipe = build_sign_recipe(asset_id, seed, material=params["material"], board_shape=params["boardShape"],
                                   posts=params["posts"], arrow=params["arrow"], cap=params["cap"])
        source = "parametric:sign_v1"
    elif archetype == "bench":
        recipe = build_bench_recipe(asset_id, seed, material=params["material"], backrest=params["backrest"],
                                    armrests=params["armrests"], length=params["length"])
        source = "parametric:bench_v1"
    elif archetype == "bollard":
        recipe = build_bollard_recipe(asset_id, seed, material=params["material"], cap=params["cap"])
        source = "parametric:bollard_v1"
    elif archetype == "planter":
        recipe = build_planter_recipe(asset_id, seed, material=params["material"], shape=params["shape"])
        source = "parametric:planter_v1"
    else:
        recipe = build_trash_bin_recipe(asset_id, seed, material=params["material"], lid=params["lid"])
        source = "parametric:trash_bin_v1"

    _condition_scene(recipe, condition)
    recipe["authorIntent"] = {"archetype": archetype, "condition": condition, **params}
    validate_recipe(recipe)
    report = {
        "contract": "CH_2D_PROP_AUTHOR_REPORT_V1",
        "id": asset_id,
        "archetype": archetype,
        "condition": condition,
        "parameters": params,
        "source": source,
        "grammarContract": recipe.get("propGrammar", {}).get("contract"),
        "seed": seed,
        "artApproved": False,
        "runtimePromotion": False,
    }
    return recipe, report


def run_prop_author(brief: dict, output_root: Path, examples: Path = EXAMPLES) -> dict:
    recipe, author = author_prop_recipe(brief, examples)
    folder = output_root / recipe["id"]
    folder.mkdir(parents=True, exist_ok=True)
    recipe_path = folder / "authored_prop_recipe.json"
    recipe_path.write_text(json.dumps(recipe, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    result = run_workers(recipe_path, output_root)
    report = {**author, "render": result, "status": "review_ready"}
    report_path = folder / "prop_author_report.json"
    report_path.write_text(json.dumps(report, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    return {"report": str(report_path), "recipe": str(recipe_path), "png": result["png"],
            "review": result["review"], "isometricReview": result["isometricReview"],
            "status": "review_ready"}

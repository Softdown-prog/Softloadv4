"""Deterministic, bounded art author for the Forge's supported 2D families.

An agent can supply a structured brief or a short controlled-language prompt.
This module chooses a golden recipe, makes reproducible design decisions, then
hands the authored recipe to the existing render/audit workers. Unknown asset
families are reported explicitly; no model or image service is hidden here.
"""
from __future__ import annotations

import copy
import hashlib
import json
import re
import unicodedata
from pathlib import Path

from PIL import Image

from .workers import run_workers, validate_recipe
from .visual_profiles import apply_profile_defaults, resolve_visual_profile

CONTRACT = "CH_2D_ART_BRIEF_V1"
EXAMPLES = Path(__file__).resolve().parents[2] / "examples"
TEMPLATES = {
    "broadleaf": "park_tree_broadleaf_early_autumn_v1.json",
    "conifer": "pine_small_v1.json",
    "flower_bed": "flower_bed_01.json",
    "sign": "park_wayfinding_sign.json",
}
BROADLEAF_STYLES = {
    "rounded": "park_tree_broadleaf_early_autumn_v1.json",
    "umbrella": "park_tree_oiti_species_v4.json",
    "open_branching": "park_tree_angico_species_v4.json",
}
BROADLEAF_SPECIES = {"oiti": "umbrella", "angico": "open_branching"}
BROADLEAF_DEFINED_LEAVES = {
    "oiti": "park_tree_oiti_leaves_v5.json",
    "angico": "park_tree_angico_leaves_v5.json",
}
PALETTE_LIBRARY = "palettes/organic_canopy_v3.json"
TERMS = {
    "conifer": ("pinheiro", "pine", "conifer", "abeto"),
    "broadleaf": ("broadleaf", "folhosa", "arvore", "tree", "decidua", "oiti", "angico"),
    "flower_bed": ("canteiro", "flower bed", "flores", "flowerbed"),
    "sign": ("placa", "sinalizacao", "wayfinding sign", "sign"),
}
ALLOWED = {
    "broadleaf": {"species", "leaf_detail", "season", "style", "silhouette", "density", "palette", "seed", "visualProfile"},
    "conifer": {"silhouette", "density", "palette", "seed"},
    "flower_bed": {"palette", "seed"},
    "sign": {"palette", "seed"},
    "custom": {"seed", "visualProfile"},
}


def _normalized(value: str) -> str:
    value = unicodedata.normalize("NFKD", value.lower())
    return "".join(char for char in value if not unicodedata.combining(char))


def interpret_prompt(prompt: str) -> dict:
    """Interpret only documented words; the result is visible and editable."""
    if not isinstance(prompt, str) or not prompt.strip():
        raise ValueError("prompt must be a non-empty string")
    words = _normalized(prompt)
    matches = [family for family, aliases in TERMS.items() if any(term in words for term in aliases)]
    if not matches:
        raise ValueError("unsupported subject; choose broadleaf, conifer, flower_bed or sign, or write a custom recipe")
    family = "conifer" if "conifer" in matches else matches[0]
    if len(set(matches) - {"broadleaf", "conifer"}) or ("broadleaf" in matches and "conifer" not in matches and len(matches) > 1):
        raise ValueError("prompt mentions multiple asset families; submit one asset at a time")
    result = {"subject": family}
    if any(term in words for term in ("outono", "autumn", "amarel", "alaranj")):
        result["season"] = "early_autumn"
    if any(term in words for term in ("angico", "copa aberta", "open branching", "galhos aparentes")):
        result["style"] = "open_branching"
    elif any(term in words for term in ("oiti", "copa guarda-chuva", "umbrella canopy", "copa fechada")):
        result["style"] = "umbrella"
    if "angico" in words:
        result["species"] = "angico"
    elif "oiti" in words:
        result["species"] = "oiti"
    if any(term in words for term in ("folhas definidas", "folhas individuais", "defined leaves")):
        result["leaf_detail"] = "defined"
    if any(term in words for term in ("verde claro", "verde fresco", "spring green")):
        result["palette"] = "spring_lime"
    elif any(term in words for term in ("verde escuro", "verde profundo", "deep green")):
        result["palette"] = "summer_deep"
    elif any(term in words for term in ("oliva", "olive")):
        result["palette"] = "dry_olive"
    elif any(term in words for term in ("ambar", "amber")):
        result["palette"] = "autumn_amber"
    if any(term in words for term in ("arredond", "rounded", "redonda")):
        result["silhouette"] = "rounded"
    elif any(term in words for term in ("larga", "wide", "broad")):
        result["silhouette"] = "wide"
    elif any(term in words for term in ("alta", "alto", "tall", "esguia", "esguio")):
        result["silhouette"] = "tall"
    if any(term in words for term in ("densa", "dense", "cheia")):
        result["density"] = "dense"
    elif any(term in words for term in ("rala", "sparse")):
        result["density"] = "sparse"
    return result


def _safe_id(value: object) -> str:
    if not isinstance(value, str) or not re.fullmatch(r"[a-z0-9][a-z0-9_-]*", value):
        raise ValueError("art brief id must use lowercase letters, digits, _ or -")
    return value


def _apply_updates(target: dict, updates: dict, *, root: bool = True) -> None:
    """Patch authored fields that a template already defines, without changing contracts."""
    if not isinstance(updates, dict):
        raise ValueError("recipeUpdates must be an object")
    frozen = {"contract", "id", "camera", "rotation", "finishRecipe", "canvas", "anchor"}
    for key, value in updates.items():
        if key not in target or (root and key in frozen):
            raise ValueError(f"recipeUpdates cannot change unknown or frozen field {key!r}")
        if isinstance(target[key], dict):
            _apply_updates(target[key], value, root=False)
        elif type(value) is not type(target[key]):
            raise ValueError(f"recipeUpdates.{key} must keep its template type")
        else:
            target[key] = copy.deepcopy(value)


def author_recipe(brief: dict, examples: Path = EXAMPLES) -> tuple[dict, dict]:
    """Return recipe and a trace of decisions without writing or rendering."""
    if not isinstance(brief, dict) or brief.get("contract") != CONTRACT:
        raise ValueError(f"art brief requires {CONTRACT}")
    asset_id = _safe_id(brief.get("id"))

    profile = None
    if "visualProfile" in brief:
        profile = resolve_visual_profile(examples, brief["visualProfile"])
        brief = apply_profile_defaults(brief, profile)

    parsed = interpret_prompt(brief["prompt"]) if "prompt" in brief else {}
    subject = brief.get("subject", parsed.get("subject"))
    if subject not in TEMPLATES and subject != "custom":
        raise ValueError(f"unsupported subject {subject!r}; available: {', '.join(TEMPLATES)}, custom")
    if parsed and parsed["subject"] != subject:
        raise ValueError("prompt subject and structured subject disagree")
    intent = {**parsed, **{key: brief[key] for key in ("species", "leaf_detail", "season", "style", "silhouette", "density", "palette", "seed", "visualProfile") if key in brief}}
    unknown = set(intent) - ALLOWED.get(subject, {"seed"}) - {"subject"}
    if unknown:
        raise ValueError(f"{subject} does not support {', '.join(sorted(unknown))}; use a custom recipe")
    if subject == "broadleaf" and "species" in intent:
        species = intent["species"]
        if species not in BROADLEAF_SPECIES:
            raise ValueError(f"unknown broadleaf species {species!r}; choose {', '.join(BROADLEAF_SPECIES)}")
        expected_style = BROADLEAF_SPECIES[species]
        if "style" in intent and intent["style"] != expected_style:
            raise ValueError(f"species {species} requires style {expected_style}")
        intent["style"] = expected_style
    elif subject == "broadleaf":
        species_for_style = {style: species for species, style in BROADLEAF_SPECIES.items()}
        if intent.get("style") in species_for_style:
            intent["species"] = species_for_style[intent["style"]]
    if subject == "broadleaf" and intent.get("leaf_detail", "painted") not in ("painted", "defined"):
        raise ValueError("leaf_detail must be painted or defined")
    if subject == "broadleaf" and intent.get("leaf_detail") == "defined" and "species" not in intent:
        raise ValueError("defined leaves require species oiti or angico")

    if subject == "custom":
        filename = brief.get("template")
        if not isinstance(filename, str) or not re.fullmatch(r"[a-z0-9][a-z0-9_-]*\.json", filename):
            raise ValueError("custom subject requires a versioned JSON filename under examples/")
    else:
        if subject == "broadleaf" and intent.get("leaf_detail") == "defined":
            filename = BROADLEAF_DEFINED_LEAVES[intent["species"]]
        else:
            filename = BROADLEAF_STYLES.get(intent.get("style", "rounded")) if subject == "broadleaf" else TEMPLATES[subject]
        if filename is None:
            raise ValueError(f"unknown broadleaf style {intent['style']!r}; choose {', '.join(BROADLEAF_STYLES)}")
    recipe = copy.deepcopy(json.loads((examples / filename).read_text(encoding="utf-8")))
    recipe["id"] = asset_id
    if "seed" in intent:
        if type(intent["seed"]) is not int or not 0 <= intent["seed"] < 2**32:
            raise ValueError("seed must be a non-negative 32-bit integer")
        recipe["seed"] = intent["seed"]
    else:
        fingerprint = json.dumps({"id": asset_id, "intent": intent}, sort_keys=True, ensure_ascii=False)
        recipe["seed"] = int.from_bytes(hashlib.sha256(fingerprint.encode()).digest()[:4], "big")

    decisions = [f"template={filename}", f"seed={recipe['seed']}"]
    if profile is not None:
        recipe["visualProfile"] = brief["visualProfile"]
        recipe["visualProfileData"] = {
            "silhouette": profile.get("silhouette", {}),
            "branching": profile.get("branching", {}),
            "foliage": profile.get("foliage", {}),
            "paletteIntent": profile.get("paletteIntent", {}),
        }
        decisions.append(f"visualProfile={brief['visualProfile']}")

    if subject == "broadleaf":
        style = intent.get("style", "rounded")
        season = intent.get("season", "early_autumn" if style == "rounded" else "summer")
        if season not in ("early_autumn", "summer"):
            raise ValueError("broadleaf supports early_autumn or summer; other seasons need a new palette recipe")
        if "species" in intent and season == "early_autumn":
            raise ValueError("species-specific autumn foliage needs its own recipe; keep oiti/angico morphology and palette")
        palette_id = intent.get("palette")
        if palette_id is not None:
            palettes = json.loads((examples / PALETTE_LIBRARY).read_text(encoding="utf-8"))["palettes"]
            if palette_id not in palettes:
                raise ValueError(f"unknown organic palette {palette_id!r}; choose {', '.join(palettes)}")
            recipe["palette"].update(palettes[palette_id])
            decisions.append(f"palette={palette_id}")
        elif season == "summer" and style == "rounded":
            recipe["palette"].update({
                "back_top": "#3C6542", "back_bottom": "#243E2B",
                "mid_top": "#60844D", "mid_bottom": "#37583A",
                "front_top": "#83A65C", "front_bottom": "#4F7342",
                "highlight": "#A5C774", "occlusion": "#263D2C",
            })
        elif season == "early_autumn" and style != "rounded":
            palettes = json.loads((examples / PALETTE_LIBRARY).read_text(encoding="utf-8"))["palettes"]
            recipe["palette"].update(palettes["autumn_amber"])
            decisions.append("palette=autumn_amber")
        decisions.extend((f"style={style}", f"season={season}"))
        if "species" in intent:
            decisions.append(f"species={intent['species']}")
            decisions.append(f"leaf_detail={intent.get('leaf_detail', 'painted')}")
        density = intent.get("density", "balanced")
        if density not in ("sparse", "balanced", "dense"):
            raise ValueError("density must be sparse, balanced or dense")
        structure = recipe["broadleafStructure"]
        if structure.get("layout") == "continuous":
            structure["masses"] = {"sparse": 35, "balanced": 48, "dense": 59}[density]
        else:
            structure["density"] = {"sparse": .72, "balanced": 1.0, "dense": 1.28}[density]
        decisions.append(f"density={density}")
        silhouette = intent.get("silhouette", "rounded")
        if silhouette not in ("rounded", "wide", "tall"):
            raise ValueError("silhouette must be rounded, wide or tall")
        if structure.get("layout") == "continuous":
            structure["radius"] = {
                "rounded": [68, 72], "wide": [78, 64], "tall": [60, 78],
            }[silhouette]
        elif "silhouette" in intent:
            width, height = structure["radius"]
            scale = {"rounded": (.94, 1.03), "wide": (1.07, .92), "tall": (.88, 1.12)}[silhouette]
            structure["radius"] = [round(width * scale[0]), round(height * scale[1])]
        decisions.append(f"silhouette={silhouette}")
    elif subject == "conifer":
        if "palette" in intent and intent["palette"] != "evergreen":
            raise ValueError("conifer currently supports only the evergreen palette")
        silhouette = intent.get("silhouette", "rounded")
        conifer_templates = {"rounded": "pine_small_v1.json", "tall": "pine_tall_v1.json", "wide": "pine_robust_v1.json"}
        if silhouette not in conifer_templates:
            raise ValueError("conifer silhouette must be rounded, wide or tall")
        if silhouette != "rounded":
            recipe = copy.deepcopy(json.loads((examples / conifer_templates[silhouette]).read_text(encoding="utf-8")))
            recipe["id"] = asset_id
            recipe["seed"] = intent.get("seed", int.from_bytes(hashlib.sha256(
                json.dumps({"id": asset_id, "intent": intent}, sort_keys=True).encode()).digest()[:4], "big"))
            decisions[0] = f"template={conifer_templates[silhouette]}"
        if "density" in intent:
            density = intent["density"]
            if density not in ("sparse", "balanced", "dense"):
                raise ValueError("density must be sparse, balanced or dense")
            factor = {"sparse": .70, "balanced": 1.0, "dense": 1.28}[density]
            for key in ("shadowDabs", "highlightDabs", "needleStrokes", "finalGrain", "finalNeedles"):
                if key in recipe.get("raster", {}):
                    recipe["raster"][key] = round(recipe["raster"][key] * factor)
        decisions.append(f"silhouette={silhouette}")
    else:
        if "palette" in intent:
            raise ValueError(f"{subject} palette variants require a custom recipe or the draw-recipe palette CLI")

    if "recipeUpdates" in brief:
        _apply_updates(recipe, brief["recipeUpdates"])
        decisions.append("recipeUpdates=explicit")

    recipe["authorIntent"] = {key: value for key, value in intent.items() if key != "subject"}
    validate_recipe(recipe)
    return recipe, {"subject": subject, "decisions": decisions, "interpreted": intent,
                    "freeTextPartiallyInterpreted": bool(brief.get("prompt")), "artApproved": False}


def _mechanical_review(recipe: dict, png: Path) -> dict:
    """Surface actionable measurements, never pretend to approve aesthetics."""
    with Image.open(png) as source:
        image = source.convert("RGBA")
    bounds = image.getchannel("A").getbbox()
    result = {"opaqueBounds": list(bounds), "status": "human_visual_review_required", "observations": []}
    if recipe.get("crownStyle") == "broadleaf" and isinstance(recipe.get("broadleafStructure"), dict):
        center = recipe["broadleafStructure"].get("center")
        radius = recipe["broadleafStructure"].get("radius")
        if center and radius:
            top = max(0, round(center[1] - radius[1] * .8))
            bottom = min(image.height, round(center[1] + radius[1] * .8))
            alpha = image.getchannel("A")
            occupied = [any(alpha.getpixel((x, y)) > 160 for x in range(max(0, center[0] - radius[0]),
                             min(image.width, center[0] + radius[0]))) for y in range(top, bottom)]
            longest = max((len(part) for part in "".join("1" if v else "0" for v in occupied).split("1")), default=0)
            result["canopyEmptyRowRunPx"] = longest
            if longest >= 5:
                if recipe["broadleafStructure"].get("profile") == "branching":
                    result["observations"].append("open branch gap; inspect foliage support and readability")
                else:
                    result["observations"].append("canopy has a horizontal gap; inspect crown continuity")
    return result


def run_art_author(brief: dict, output_root: Path, examples: Path = EXAMPLES) -> dict:
    recipe, author = author_recipe(brief, examples)
    folder = output_root / recipe["id"]
    folder.mkdir(parents=True, exist_ok=True)
    recipe_path = folder / "authored_recipe.json"
    recipe_path.write_text(json.dumps(recipe, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    result = run_workers(recipe_path, output_root)
    report = {"contract": "CH_2D_ART_AUTHOR_REPORT_V1", "id": recipe["id"],
              "author": author, "recipe": str(recipe_path), "render": result,
              "critique": _mechanical_review(recipe, Path(result["png"])),
              "status": "review_ready", "artApproved": False, "runtimePromotion": False}
    report_path = folder / "art_author_report.json"
    report_path.write_text(json.dumps(report, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    return {"report": str(report_path), "recipe": str(recipe_path), "png": result["png"],
            "review": result["review"], "isometricReview": result["isometricReview"],
            "status": report["status"]}

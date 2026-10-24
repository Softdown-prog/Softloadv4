"""Versioned visual-profile support for Visitor Forge 2D art authoring."""
from __future__ import annotations

import copy
import json
from pathlib import Path

LIBRARIES = (
    ("CH_2D_TREE_VISUAL_REFERENCE_V1", "reference_profiles/tree_visual_profiles_v1.json"),
    ("CH_2D_FLOWER_VISUAL_REFERENCE_V1", "reference_profiles/flower_visual_profiles_v1.json"),
)


def _load_library(examples: Path, contract: str, library: str) -> dict:
    path = examples / library
    payload = json.loads(path.read_text(encoding="utf-8"))
    if payload.get("contract") != contract or not isinstance(payload.get("profiles"), dict):
        raise ValueError(f"visual profile library must declare {contract}")
    return payload["profiles"]


def load_visual_profiles(examples: Path) -> dict:
    profiles: dict[str, dict] = {}
    for contract, library in LIBRARIES:
        for name, profile in _load_library(examples, contract, library).items():
            if name in profiles:
                raise ValueError(f"duplicate visual profile {name!r}")
            profiles[name] = profile
    return profiles


def resolve_visual_profile(examples: Path, name: str) -> dict:
    if not isinstance(name, str) or not name:
        raise ValueError("visualProfile must be a non-empty string")
    profiles = load_visual_profiles(examples)
    if name not in profiles:
        raise ValueError(f"unknown visualProfile {name!r}; choose {', '.join(sorted(profiles))}")
    profile = copy.deepcopy(profiles[name])
    authoring = profile.get("authoring")
    if not isinstance(authoring, dict) or authoring.get("subject") not in {"broadleaf", "flower_bed", "custom"}:
        raise ValueError(f"visualProfile {name!r} is missing supported authoring metadata")
    return profile


def apply_profile_defaults(brief: dict, profile: dict) -> dict:
    """Return a copy of the brief with profile defaults filled, never overriding explicit intent."""
    authored = copy.deepcopy(brief)
    defaults = profile["authoring"]
    if "subject" not in authored:
        authored["subject"] = defaults["subject"]
    elif authored["subject"] != defaults["subject"]:
        raise ValueError(
            f"visualProfile requires subject {defaults['subject']!r}, got {authored['subject']!r}"
        )
    for key in ("species", "style", "leaf_detail", "season", "silhouette", "density", "palette", "template"):
        if key not in authored and key in defaults:
            authored[key] = copy.deepcopy(defaults[key])
    return authored

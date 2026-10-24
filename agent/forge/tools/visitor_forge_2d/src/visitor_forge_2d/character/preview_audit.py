"""Mechanical checks for a four-direction visitor preview catalogue.

These checks cannot approve art or establish that a walk works in the engine.
"""

from __future__ import annotations

import json
from pathlib import Path

from PIL import Image, ImageChops

from .review import frame_measurements


DIRECTIONS = ("south", "east", "north", "west")
EXPECTED_SIZE = (128, 128)
EXPECTED_FOOT_ROW = 115  # Anchor [64, 116] in the current preview contract.


def audit_preview(manifest_path: Path, repo_root: Path) -> dict:
    """Check paths, format, distinct poses and foot placement; return JSON data."""
    catalogue = json.loads(manifest_path.read_text(encoding="utf-8"))
    errors: list[str] = []
    results: dict[str, dict] = {}
    clips = catalogue.get("clips")
    if not isinstance(clips, list):
        return {"status": "error", "errors": ["Manifest must contain a clips list"],
                "directions": {}, "artApproved": False, "runtimePromotion": False}

    for direction in DIRECTIONS:
        frames: dict[str, Image.Image] = {}
        paths: dict[str, str] = {}
        for state, names in (("idle", ("idle",)), ("walking", ("walk_a", "walk_b"))):
            matching = [clip for clip in clips if isinstance(clip, dict) and
                        clip.get("direction") == direction and clip.get("state") == state]
            if len(matching) != 1:
                errors.append(f"{direction}/{state}: expected one clip, found {len(matching)}")
                continue
            clip = matching[0]
            files = clip.get("frames")
            if not isinstance(files, list) or len(files) != len(names):
                errors.append(f"{direction}/{state}: expected {len(names)} frame path(s)")
                continue
            if not isinstance(clip.get("fps"), (int, float)) or clip["fps"] <= 0:
                errors.append(f"{direction}/{state}: fps must be positive")
            for name, value in zip(names, files):
                if not isinstance(value, str) or not value.endswith(".png"):
                    errors.append(f"{direction}/{name}: expected a PNG path")
                    continue
                path = (repo_root / value).resolve()
                if not path.is_relative_to(repo_root.resolve()):
                    errors.append(f"{direction}/{name}: path escapes repository")
                    continue
                if not path.is_file():
                    errors.append(f"{direction}/{name}: missing {value}")
                    continue
                try:
                    with Image.open(path) as source:
                        source.load()
                        if source.format != "PNG" or source.mode != "RGBA" or source.size != EXPECTED_SIZE:
                            errors.append(f"{direction}/{name}: expected RGBA PNG {EXPECTED_SIZE}, "
                                          f"got {source.format} {source.mode} {source.size}")
                            continue
                        frame = source.copy()
                except OSError as exc:
                    errors.append(f"{direction}/{name}: cannot read {value}: {exc}")
                    continue
                if not frame.getchannel("A").point(lambda alpha: 255 if alpha >= 180 else 0).getbbox():
                    errors.append(f"{direction}/{name}: no opaque body")
                    continue
                frames[name] = frame
                paths[name] = value

        if set(frames) != {"idle", "walk_a", "walk_b"}:
            continue
        measured = frame_measurements([frames[name] for name in ("idle", "walk_a", "walk_b")],
                                      (64, 116))
        if any(abs(row - EXPECTED_FOOT_ROW) > 1 for row in measured["footRows"]):
            errors.append(f"{direction}: foot rows {measured['footRows']} drift from row 115")
        if measured["footRowRangePx"] > 1:
            errors.append(f"{direction}: foot row changes by {measured['footRowRangePx']}px")

        # Composite on a neutral background: hidden RGB in fully transparent pixels
        # must not count as a different visible pose.
        visible = [Image.alpha_composite(Image.new("RGBA", EXPECTED_SIZE, (76, 116, 48, 255)),
                                         frames[name]).convert("RGB")
                   for name in ("idle", "walk_a", "walk_b")]
        for left, right in ((0, 1), (0, 2), (1, 2)):
            if ImageChops.difference(visible[left], visible[right]).getbbox() is None:
                errors.append(f"{direction}: {('idle', 'walk_a', 'walk_b')[left]} and "
                              f"{('idle', 'walk_a', 'walk_b')[right]} look identical")
        results[direction] = {"frames": paths, "footRows": measured["footRows"],
                              "changedSilhouetteFractionFromIdle":
                              measured["changedSilhouetteFractionFromIdle"]}

    return {"status": "ok" if not errors else "error", "errors": errors,
            "directions": results, "artApproved": False, "runtimePromotion": False,
            "nextGate": "Inspect all 12 frames at gameplay scale and test walking in the engine"}

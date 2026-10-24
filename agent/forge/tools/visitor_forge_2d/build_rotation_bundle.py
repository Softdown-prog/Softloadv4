"""Build deterministic camera-relative rotation slots for 2D scenery assets."""
from __future__ import annotations

import argparse
import hashlib
import json
import shutil
from pathlib import Path

CONTRACT = "CH_2D_ROTATION_BUNDLE_V1"
VALID_VIEWS = ("south", "west", "north", "east")
DEFAULT_YAWS = {"south": 45, "west": 135, "north": 225, "east": 315}


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def build(recipe_path: Path, output_dir: Path) -> dict:
    recipe = json.loads(recipe_path.read_text(encoding="utf-8"))
    rotation = recipe.get("rotation")
    if not rotation:
        return {"contract": CONTRACT, "status": "skipped", "reason": "recipe has no rotation block"}

    mode = rotation.get("mode", "camera_invariant")
    if mode != "camera_invariant":
        raise ValueError(f"unsupported rotation mode {mode!r}; expected 'camera_invariant'")

    views = rotation.get("views", list(VALID_VIEWS))
    if not views or any(view not in VALID_VIEWS for view in views):
        raise ValueError(f"rotation views must be a non-empty subset of {VALID_VIEWS}")
    if len(set(views)) != len(views):
        raise ValueError("rotation views must not contain duplicates")

    stem = recipe["id"]
    source = output_dir / f"{stem}.png"
    if not source.is_file():
        raise FileNotFoundError(f"base render not found: {source}")

    slots = {}
    for view in views:
        destination = output_dir / f"{stem}_{view}.png"
        shutil.copyfile(source, destination)
        slots[view] = {
            "path": str(destination),
            "yawDeg": int(rotation.get("yawDeg", {}).get(view, DEFAULT_YAWS[view])),
            "sha256": _sha256(destination),
        }

    source_hash = _sha256(source)
    if any(slot["sha256"] != source_hash for slot in slots.values()):
        raise RuntimeError("camera-invariant rotation slot changed PNG bytes")

    manifest = {
        "contract": CONTRACT,
        "id": stem,
        "mode": mode,
        "cameraInvariant": True,
        "lightingSpace": rotation.get("lightingSpace", "screen_camera_relative"),
        "source": str(source),
        "sourceSha256": source_hash,
        "views": slots,
    }
    manifest_path = output_dir / f"{stem}_rotation.json"
    manifest_path.write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    manifest["manifest"] = str(manifest_path)
    return manifest


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--recipe", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    print(json.dumps(build(args.recipe, args.output), indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

import json
from pathlib import Path

from PIL import Image, ImageDraw

from visitor_forge_2d.character.preview_audit import audit_preview


def _catalogue(root: Path) -> Path:
    clips = []
    for direction in ("south", "east", "north", "west"):
        for state, names in (("idle", ("idle",)), ("walking", ("walk_a", "walk_b"))):
            files = []
            for name in names:
                path = root / f"{direction}_{name}.png"
                frame = Image.new("RGBA", (128, 128))
                shift = {"idle": 0, "walk_a": 1, "walk_b": 2}[name]
                ImageDraw.Draw(frame).rectangle((55 + shift, 25, 72 + shift, 115),
                                                fill=(100, 150, 80, 255))
                frame.save(path)
                files.append(path.name)
            clips.append({"direction": direction, "state": state, "fps": 4.5,
                          "frames": files})
    manifest = root / "preview.json"
    manifest.write_text(json.dumps({"clips": clips}), encoding="utf-8")
    return manifest


def test_preview_audit_passes_distinct_frames_with_shared_foot(tmp_path: Path) -> None:
    manifest = _catalogue(tmp_path)
    result = audit_preview(manifest, tmp_path)
    assert result["status"] == "ok"
    assert len(result["directions"]) == 4
    assert result["artApproved"] is False


def test_preview_audit_rejects_missing_and_static_walk(tmp_path: Path) -> None:
    manifest = _catalogue(tmp_path)
    (tmp_path / "east_walk_b.png").unlink()
    # Differ only in hidden RGB: this is still the same pose to a player.
    with Image.open(tmp_path / "south_idle.png") as image:
        same_pose = image.copy()
    same_pose.putpixel((0, 0), (255, 0, 0, 0))
    same_pose.save(tmp_path / "south_walk_a.png")
    result = audit_preview(manifest, tmp_path)
    assert result["status"] == "error"
    assert any("east/walk_b: missing" in error for error in result["errors"])
    assert any("south: idle and walk_a look identical" in error for error in result["errors"])

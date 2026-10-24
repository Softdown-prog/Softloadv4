import json
import sys
from pathlib import Path

from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from build_rotation_bundle import build


def test_camera_invariant_rotation_bundle_is_byte_identical(tmp_path: Path) -> None:
    recipe = {
        "id": "tree_test",
        "rotation": {
            "mode": "camera_invariant",
            "lightingSpace": "screen_camera_relative",
            "views": ["south", "west", "north", "east"],
        },
    }
    recipe_path = tmp_path / "tree.json"
    recipe_path.write_text(json.dumps(recipe), encoding="utf-8")

    output = tmp_path / "out"
    output.mkdir()
    base = output / "tree_test.png"
    Image.new("RGBA", (32, 48), (120, 140, 80, 255)).save(base)

    manifest = build(recipe_path, output)
    assert manifest["contract"] == "CH_2D_ROTATION_BUNDLE_V1"
    assert manifest["cameraInvariant"] is True
    assert set(manifest["views"]) == {"south", "west", "north", "east"}
    assert {slot["sha256"] for slot in manifest["views"].values()} == {manifest["sourceSha256"]}
    assert (output / "tree_test_rotation.json").is_file()

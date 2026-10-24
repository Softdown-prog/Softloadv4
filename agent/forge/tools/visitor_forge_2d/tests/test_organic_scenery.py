import json
import hashlib
from pathlib import Path

import pytest
from PIL import Image

from visitor_forge_2d.core.organic_scenery import export, render


def _recipe() -> dict:
    return {
        "contract": "CH_2D_ORGANIC_SCENERY_V1",
        "id": "test_pine",
        "canvas": [192, 256],
        "anchor": [96, 239],
        "seed": 7,
        "camera": {"contract": "CH_CAMERA_V1", "tile": [128, 64]},
        "palette": {
            "ground_shadow": "#17271F", "trunk_top": "#B87948", "trunk_bottom": "#6E4128",
            "trunk_light": "#DCA066", "back_top": "#245540", "back_bottom": "#10342B",
            "mid_top": "#4E855F", "mid_bottom": "#235440", "front_top": "#67A071",
            "front_bottom": "#326A50", "highlight": "#ADD18A", "occlusion": "#123B30"
        },
        "tiers": [
            {"y": 34, "span": 22, "thickness": 16, "skew": 0},
            {"y": 72, "span": 40, "thickness": 21, "skew": -1},
            {"y": 116, "span": 58, "thickness": 25, "skew": 1},
            {"y": 166, "span": 74, "thickness": 28, "skew": -1},
            {"y": 201, "span": 82, "thickness": 27, "skew": 0}
        ]
    }


def _anchor_has_contact(frame: Image.Image, anchor: list[int]) -> bool:
    """Anchor is a ground-contact coordinate; visible sprite may end just above it after Lanczos."""
    x, y = anchor
    alpha = frame.getchannel("A")
    for yy in range(max(0, y - 2), min(frame.height, y + 2)):
        for xx in range(max(0, x - 2), min(frame.width, x + 3)):
            if alpha.getpixel((xx, yy)) > 0:
                return True
    return False


def test_organic_scenery_is_deterministic_and_camera_gated(tmp_path: Path) -> None:
    recipe = _recipe()
    first, metadata = render(recipe)
    second, _ = render(recipe)
    assert first.tobytes() == second.tobytes()
    assert first.mode == "RGBA" and first.size == (192, 256)
    assert metadata["camera"]["contract"] == "CH_CAMERA_V1"
    assert metadata["anchor"] == [96, 239]

    source = tmp_path / "pine.json"
    source.write_text(json.dumps(recipe), encoding="utf-8")
    result = export(source, tmp_path / "out")
    with Image.open(result["isometricReview"]) as review:
        assert review.size == (768, 480)


def test_canonical_pine_stays_above_minimum_opaque_height() -> None:
    project_root = Path(__file__).resolve().parents[1]
    source = project_root / "examples" / "pine_tree_organic_v1.json"
    recipe = json.loads(source.read_text(encoding="utf-8"))
    frame, _ = render(recipe)
    bounds = frame.getchannel("A").getbbox()
    assert bounds is not None
    opaque_height = bounds[3] - bounds[1]
    minimum = int(recipe.get("validation", {}).get("minimumOpaqueHeightPx", 200))
    assert minimum >= 200
    assert opaque_height >= minimum, f"canonical pine opaque height {opaque_height}px is below {minimum}px"


def test_pine_family_has_requested_heights_and_distinct_silhouettes() -> None:
    project_root = Path(__file__).resolve().parents[1]
    sizes = {}
    for name in ("pine_small_v1", "pine_tall_v1", "pine_robust_v1"):
        recipe = json.loads((project_root / "examples" / f"{name}.json").read_text(encoding="utf-8"))
        frame, metadata = render(recipe)
        left, top, right, bottom = metadata["bounds"]
        height = bottom - top
        limits = recipe["validation"]
        assert limits["minimumOpaqueHeightPx"] <= height <= limits["maximumOpaqueHeightPx"]
        assert _anchor_has_contact(frame, recipe["anchor"])
        sizes[name] = (right - left, height)
    assert sizes["pine_small_v1"][1] > 100
    assert sizes["pine_tall_v1"][1] > sizes["pine_robust_v1"][1] > sizes["pine_small_v1"][1]
    assert sizes["pine_robust_v1"][0] > sizes["pine_tall_v1"][0]


def test_organic_scenery_rejects_wrong_camera() -> None:
    recipe = _recipe()
    recipe["camera"]["tile"] = [64, 64]
    try:
        render(recipe)
        assert False, "noncanonical camera tile accepted"
    except ValueError as exc:
        assert "128x64" in str(exc)


def test_broadleaf_crown_is_deterministic_and_differs_from_conifer(tmp_path: Path) -> None:
    recipe = _recipe()
    recipe["crownStyle"] = "broadleaf"

    first, meta_first = render(recipe)
    second, _ = render(recipe)
    assert first.tobytes() == second.tobytes(), "broadleaf render is not deterministic"
    assert first.mode == "RGBA" and first.size == (192, 256)
    assert meta_first["crownStyle"] == "broadleaf"

    conifer_recipe = dict(recipe)
    conifer_recipe["crownStyle"] = "conifer"
    conifer_frame, conifer_meta = render(conifer_recipe)
    assert conifer_meta["crownStyle"] == "conifer"
    assert first.tobytes() != conifer_frame.tobytes(), "broadleaf and conifer produced identical pixels"


def test_authored_mango_has_four_stable_views_and_source_provenance(tmp_path: Path) -> None:
    examples = Path(__file__).resolve().parents[1] / "examples"
    source_recipe = examples / "park_tree_mango_01.json"
    recipe = json.loads(source_recipe.read_text())
    hashes = set()
    for view in ("south", "west", "north", "east"):
        frame, meta = render(recipe, view=view, source_root=examples)
        repeat, _ = render(recipe, view=view, source_root=examples)
        assert frame.tobytes() == repeat.tobytes()
        assert _anchor_has_contact(frame, recipe["anchor"])
        assert frame.getchannel("A").getbbox() == tuple(meta["bounds"])
        assert [layer["name"] for layer in meta["sourceLayers"]] == ["wood", "foliage"]
        hashes.add(hashlib.sha256(frame.tobytes()).hexdigest())
    assert len(hashes) == 4

    recipe["sourceArt"]["layersByView"]["south"][0]["sha256"] = "0" * 64
    with pytest.raises(ValueError, match="hash mismatch"):
        render(recipe, source_root=examples)

    result = export(source_recipe, tmp_path / "out")
    with Image.open(result["isometricReview"]) as review:
        assert review.size == (768, 480)


def test_current_broadleaf_applies_finish_and_exports_distinct_four_views(tmp_path: Path) -> None:
    project_root = Path(__file__).resolve().parents[1]
    recipe = _recipe()
    recipe.update(id="broadleaf_finish_fixture", crownStyle="broadleaf",
                  rotation={"mode": "procedural_quarter_turns", "views": ["south", "west", "north", "east"]})
    # Resolve repository-relative finishRecipe when test runs from a temporary cwd.
    recipe["finishRecipe"] = str(project_root / "examples" / "finish" / "park_tree_broadleaf_organic_02.json")
    local_recipe = tmp_path / "broadleaf_finish_fixture.json"
    local_recipe.write_text(json.dumps(recipe), encoding="utf-8")

    result = export(local_recipe, tmp_path / "out")
    assert set(result["views"]) == {"south", "west", "north", "east"}
    hashes = set()
    for view, path_value in result["views"].items():
        path = Path(path_value)
        source = path.with_name(path.name.replace(f"_{view}.png", f"_{view}_source.png"))
        assert path.is_file() and source.is_file()
        with Image.open(path) as final, Image.open(source) as raw:
            assert final.getchannel("A").tobytes() == raw.getchannel("A").tobytes(), "finish changed alpha"
        hashes.add(path.read_bytes())
    assert len(hashes) >= 2, "procedural quarter-turn views are byte-identical"

    manifest = json.loads(Path(result["rotationManifest"]).read_text(encoding="utf-8"))
    assert manifest["mode"] == "procedural_quarter_turns"
    assert manifest["generatedViews"] is True


def test_organic_scenery_rejects_unknown_crown_style() -> None:
    recipe = _recipe()
    recipe["crownStyle"] = "mushroom"
    try:
        render(recipe)
        assert False, "unknown crownStyle accepted"
    except ValueError as exc:
        assert "crownStyle" in str(exc)
        assert "mushroom" in str(exc)

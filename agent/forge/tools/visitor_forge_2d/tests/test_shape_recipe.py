import json
from pathlib import Path

from PIL import Image

from visitor_forge_2d.core.shape_recipe import (
    export_palette_family, export_shape_recipe, render_shape_recipe,
)


def _recipe() -> dict:
    return {
        "contract": "CH_2D_SHAPE_RECIPE_V1", "id": "test_sign", "canvas": [32, 32],
        "anchor": [16, 30], "layers": [
            {"name": "panel", "fill": {"top": "#BBDDAA", "bottom": "#335544"},
             "shapes": [{"type": "rounded_rect", "box": [4, 4, 28, 26], "radius": 2},
                        {"type": "ellipse", "box": [12, 10, 20, 18], "operation": "erase"}],
             "shadow": {"offset": [1, 1], "blur": 0, "opacity": 0.4}},
            {"name": "icon", "fill": {"top": "#FFEABB"},
             "shapes": [{"type": "polygon", "points": [[6, 19], [9, 18], [8, 22]]},
                        {"type": "quadratic", "points": [[22, 20], [24, 17], [27, 19]], "width": 1}]},
        ],
    }


def test_shape_recipe_renders_transparent_prop_and_review(tmp_path: Path) -> None:
    recipe = _recipe()
    frame, metadata = render_shape_recipe(recipe)
    assert frame.mode == "RGBA" and frame.size == (32, 32)
    assert frame.getpixel((0, 0))[3] == 0
    assert frame.getpixel((16, 14))[3] == 0  # erased opening
    assert frame.getpixel((16, 6))[3] > 200
    assert frame.getpixel((16, 24))[3] > 200
    assert frame.getpixel((16, 6)) != frame.getpixel((16, 24))  # painted gradient
    assert metadata["anchor"] == [16.0, 30.0]
    assert metadata["runtimePromotion"] is False

    path = tmp_path / "sign.json"
    path.write_text(json.dumps(recipe), encoding="utf-8")
    result = export_shape_recipe(path, tmp_path / "out")
    first_export = Path(result["png"]).read_bytes()
    export_shape_recipe(path, tmp_path / "out")
    assert Path(result["png"]).read_bytes() == first_export
    with Image.open(result["review"]) as board:
        assert board.size == (32 * 3 + 48, 32 * 2 + 40)
    assert json.loads(Path(result["metadata"]).read_text())["artApproved"] is False


def test_shape_recipe_rejects_invalid_palette_and_geometry() -> None:
    recipe = _recipe()
    recipe["layers"][0]["fill"]["top"] = "green"
    try:
        render_shape_recipe(recipe)
        assert False, "invalid color accepted"
    except ValueError as exc:
        assert "fill.top" in str(exc)
    recipe["layers"][0]["fill"]["top"] = "#BBDDAA"
    recipe["layers"][0]["shapes"][0]["box"] = [12, 8, 4, 20]
    try:
        render_shape_recipe(recipe)
        assert False, "invalid box accepted"
    except ValueError as exc:
        assert "x0<x1" in str(exc)


def test_palette_family_keeps_recipe_and_seed_reproducible(tmp_path: Path) -> None:
    recipe = _recipe()
    recipe["layers"][0]["paletteSlot"] = "panel"
    recipe_path = tmp_path / "prop.json"
    authored = json.dumps(recipe)
    recipe_path.write_text(authored, encoding="utf-8")
    palette_path = tmp_path / "palette.json"
    palette_path.write_text(json.dumps({
        "contract": "CH_2D_PALETTE_V1",
        "slots": {"panel": {"top": "#BBDDAA", "bottom": "#335544"}},
        "variants": {"blue": {"panel": {"top": "#5577CC"}},
                     "red": {"panel": {"top": "#CC5544"}}},
    }), encoding="utf-8")
    output = tmp_path / "out"
    family = export_palette_family(recipe_path, output, palette_path)
    assert set(family["variants"]) == {"blue", "red"}
    assert Path(family["review"]).is_file()
    with Image.open(family["variants"]["blue"]) as blue, Image.open(family["variants"]["red"]) as red:
        assert blue.getpixel((16, 6)) != red.getpixel((16, 6))
        assert blue.getpixel((0, 0))[3] == red.getpixel((0, 0))[3] == 0
    first = export_shape_recipe(recipe_path, output, palette_path=palette_path, seed=42)
    old_bytes = Path(first["png"]).read_bytes()
    second = export_shape_recipe(recipe_path, output, palette_path=palette_path, seed=42)
    assert first == second
    assert Path(second["png"]).read_bytes() == old_bytes
    assert recipe_path.read_text(encoding="utf-8") == authored
    assert json.loads(Path(first["metadata"]).read_text())["palette"]["seed"] == 42


def test_palette_rejects_unknown_slot_and_variant(tmp_path: Path) -> None:
    recipe_path = tmp_path / "prop.json"
    recipe = _recipe()
    recipe["layers"][0]["paletteSlot"] = "panel"
    recipe_path.write_text(json.dumps(recipe), encoding="utf-8")
    palette_path = tmp_path / "palette.json"
    palette_path.write_text(json.dumps({"contract": "CH_2D_PALETTE_V1",
                                        "slots": {"different": {"top": "#FFFFFF"}}}),
                            encoding="utf-8")
    try:
        export_shape_recipe(recipe_path, tmp_path / "out", palette_path=palette_path)
        assert False, "unknown slot accepted"
    except ValueError as exc:
        assert "not used by recipe" in str(exc)
    palette_path.write_text(json.dumps({"contract": "CH_2D_PALETTE_V1",
                                        "slots": {"panel": {"top": "#FFFFFF"}},
                                        "variants": {"blue": {"panel": {"top": "#0000FF"}}}}),
                            encoding="utf-8")
    try:
        export_shape_recipe(recipe_path, tmp_path / "out", palette_path=palette_path,
                            variant="green")
        assert False, "unknown variant accepted"
    except ValueError as exc:
        assert "Unknown palette variant" in str(exc)


def test_pieslice_renders_wedge_and_rejects_degenerate() -> None:
    """Pieslice fills a wedge region and rejects start == end."""
    recipe = {
        "contract": "CH_2D_SHAPE_RECIPE_V1",
        "id": "test_pie",
        "canvas": [32, 32],
        "anchor": [16, 30],
        "layers": [
            {
                "name": "wedge",
                "fill": {"top": "#AABBCC"},
                # A right-angle wedge in the top-right quadrant (0..90 degrees).
                "shapes": [{"type": "pieslice", "box": [4, 4, 28, 28], "start": 0, "end": 90}],
            }
        ],
    }
    frame, metadata = render_shape_recipe(recipe)
    # The wedge covers the bottom-right area of the bounding ellipse (Pillow
    # measures clockwise from 3-o'clock, so 0..90 is the lower-right quadrant).
    assert frame.mode == "RGBA" and frame.size == (32, 32)
    # At least one pixel inside the wedge region must be opaque.
    assert frame.getpixel((24, 20))[3] > 200, "expected wedge pixels to be opaque"
    # Top-left corner stays transparent (outside the wedge and the ellipse).
    assert frame.getpixel((0, 0))[3] == 0

    # start == end is a no-op wedge and must be rejected.
    bad = dict(recipe)
    bad["layers"] = [
        {
            "name": "bad_wedge",
            "fill": {"top": "#AABBCC"},
            "shapes": [{"type": "pieslice", "box": [4, 4, 28, 28], "start": 45, "end": 45}],
        }
    ]
    try:
        render_shape_recipe(bad)
        assert False, "degenerate pieslice accepted"
    except ValueError as exc:
        assert "start != end" in str(exc)

    # Unknown shape type must name pieslice in its error message.
    unknown = dict(recipe)
    unknown["layers"] = [
        {
            "name": "unknown_type",
            "fill": {"top": "#AABBCC"},
            "shapes": [{"type": "hexagon", "box": [4, 4, 28, 28]}],
        }
    ]
    try:
        render_shape_recipe(unknown)
        assert False, "unknown shape type accepted"
    except ValueError as exc:
        assert "pieslice" in str(exc)

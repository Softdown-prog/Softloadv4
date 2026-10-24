"""Regression coverage for region-driven surface finishing."""
from copy import deepcopy

import pytest
from PIL import Image, ImageDraw

from visitor_forge_2d.core import localized_finish as finish
from visitor_forge_2d.core.scene_composer_v4 import render_scene

STYLES = sorted(finish._ALLOWED_STYLES)


def region(style, **kwargs):
    return dict(style=style, sampling="mask", stamps=12, opacity=0.5,
                mask={"primitive": "rect", "box": [40, 35, 54, 49]}, **kwargs)


@pytest.mark.parametrize("style", STYLES)
def test_small_region_receives_finish_without_changing_alpha(style):
    frame = Image.new("RGBA", (192, 128), (21, 32, 43, 0))
    ImageDraw.Draw(frame).rectangle((40, 35, 54, 49), fill=(130, 110, 90, 128))
    spec = region(style)
    original = deepcopy(spec)
    result = finish.apply_regions(frame, [spec], 14)
    assert result.tobytes() == finish.apply_regions(frame, [spec], 14).tobytes()
    assert result.getchannel("A").tobytes() == frame.getchannel("A").tobytes()
    assert result.convert("RGB").tobytes() != frame.convert("RGB").tobytes()
    assert result.getpixel((0, 0)) == frame.getpixel((0, 0))
    assert spec == original


@pytest.mark.parametrize("style", STYLES)
@pytest.mark.parametrize("disabled", [{"stamps": 0}, {"opacity": 0}])
def test_disabled_pass_is_exact_noop(style, disabled):
    frame = Image.new("RGBA", (64, 64), (100, 90, 80, 127))
    spec = region(style)
    spec.update(disabled)
    assert finish.apply_regions(frame, [spec], 0).tobytes() == frame.tobytes()


@pytest.mark.parametrize("style", STYLES)
def test_empty_surface_does_not_create_pixels(style):
    frame = Image.new("RGBA", (64, 64))
    assert finish.apply_regions(frame, [region(style)], 0).tobytes() == frame.tobytes()


@pytest.mark.parametrize("style", [s for s in STYLES if s != "plank_seams"])
def test_mask_sampling_does_not_dilute_with_canvas_padding(style):
    small = Image.new("RGBA", (64, 64), (120, 100, 80, 255))
    large = Image.new("RGBA", (256, 256), (120, 100, 80, 255))
    a = finish.apply_regions(small, [region(style)], 91)
    b = finish.apply_regions(large, [region(style)], 91)
    assert a.tobytes() == b.crop((0, 0, 64, 64)).tobytes()


def test_sampling_validation_and_legacy_default():
    frame = Image.new("RGBA", (64, 64), (120, 100, 80, 255))
    spec = region("scratches")
    spec.pop("sampling")
    legacy = finish.apply_regions(frame, [spec], 1)
    spec["sampling"] = "canvas"
    assert legacy.tobytes() == finish.apply_regions(frame, [spec], 1).tobytes()
    spec["sampling"] = "unknown"
    with pytest.raises(ValueError, match="sampling"):
        finish.apply_regions(frame, [spec], 1)


def test_hole_in_mask_stays_untouched():
    frame = Image.new("RGBA", (64, 64), (120, 100, 80, 255))
    spec = region("paint_chips")
    spec["mask"]["cutouts"] = [{"primitive": "rect", "box": [44, 39, 50, 45]}]
    result = finish.apply_regions(frame, [spec], 14)
    assert result.getpixel((47, 42)) == frame.getpixel((47, 42))


def test_demo_runs_through_scene_composer():
    import json
    from pathlib import Path
    recipe = json.loads((Path(__file__).resolve().parents[1] / "examples" /
                         "localized_finish_mask_demo.json").read_text())
    frame, metadata = render_scene(recipe)
    assert frame.getbbox()
    assert metadata["finishRegionCount"] == 3

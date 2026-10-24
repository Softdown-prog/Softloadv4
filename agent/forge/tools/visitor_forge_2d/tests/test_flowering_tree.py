import json
import random
from pathlib import Path

from PIL import Image

from visitor_forge_2d import workers
from visitor_forge_2d.core import flowering_brushes, flowering_tree_scenery


EXAMPLES = Path(__file__).resolve().parents[1] / "examples"


def test_flower_cluster_small_round_is_deterministic_and_clipped():
    mask = Image.new("L", (256 * 4, 320 * 4))
    from visitor_forge_2d.core import brushes
    brushes.leaf_cluster_round(mask, random.Random(7), 128, 120, 34, 25)

    a = Image.new("RGBA", mask.size)
    b = Image.new("RGBA", mask.size)
    args = ((128, 120), (34, 25), ("#D59B08", "#F2B705", "#FFD21A"))
    flowering_brushes.flower_cluster_small_round(a, random.Random(99), mask, *args, highlight_color="#FFE96A", shadow_color="#8A5B00")
    flowering_brushes.flower_cluster_small_round(b, random.Random(99), mask, *args, highlight_color="#FFE96A", shadow_color="#8A5B00")
    assert a.tobytes() == b.tobytes()
    assert a.getchannel("A").getbbox() is not None


def test_flower_spray_is_deterministic():
    a = Image.new("RGBA", (256 * 4, 320 * 4))
    b = Image.new("RGBA", a.size)
    flowering_brushes.flower_spray(a, random.Random(13), (128, 90), ("#F2B705", "#FFD21A"), highlight_color="#FFE96A")
    flowering_brushes.flower_spray(b, random.Random(13), (128, 90), ("#F2B705", "#FFD21A"), highlight_color="#FFE96A")
    assert a.tobytes() == b.tobytes()


def test_flowering_tree_recipe_routes_to_family_renderer():
    recipe_path = EXAMPLES / "park_tree_flowering_open_v1.json"
    recipe = json.loads(recipe_path.read_text(encoding="utf-8"))
    assert workers.validate_recipe(recipe) == "flowering_tree"
    south, meta = flowering_tree_scenery.render(recipe, "south")
    west, west_meta = flowering_tree_scenery.render(recipe, "west")
    assert south.mode == "RGBA"
    assert list(south.size) == recipe["canvas"]
    assert south.getchannel("A").getbbox() is not None
    assert meta["anchor"] == recipe["anchor"]
    assert meta["sceneryType"] == "flowering_tree"
    assert west_meta["yawDeg"] == 135
    assert south.tobytes() != west.tobytes()


def test_flowering_tree_render_is_deterministic():
    recipe = json.loads((EXAMPLES / "park_tree_flowering_open_v1.json").read_text(encoding="utf-8"))
    a, _ = flowering_tree_scenery.render(recipe, "south")
    b, _ = flowering_tree_scenery.render(recipe, "south")
    assert a.tobytes() == b.tobytes()

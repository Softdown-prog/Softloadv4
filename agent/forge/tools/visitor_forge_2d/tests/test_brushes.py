import random

from PIL import Image

from visitor_forge_2d.core import brushes, flower_brushes


def test_leaf_cluster_broadleaf_is_deterministic():
    a = Image.new("L", (256 * 4, 320 * 4))
    b = Image.new("L", a.size)
    brushes.leaf_cluster_broadleaf(a, random.Random(1234), 128, 120, 36, 24, satellites=5)
    brushes.leaf_cluster_broadleaf(b, random.Random(1234), 128, 120, 36, 24, satellites=5)
    assert a.tobytes() == b.tobytes()
    assert a.getbbox() is not None


def test_maple_brush_respects_group_mask():
    mask = Image.new("L", (256 * 4, 320 * 4))
    brushes.leaf_cluster_round(mask, random.Random(7), 128, 120, 32, 24)
    layer = Image.new("RGBA", mask.size)
    brushes.leaf_cluster_maple(layer, random.Random(7), mask, (128, 120), (32, 24), ("#C42130", "#F33D31", "#B61B25"), highlight_color="#FF694B", shadow_color="#6B1123")
    alpha = layer.getchannel("A")
    assert alpha.getbbox() is not None
    leaked = Image.eval(alpha, lambda px: 255 if px else 0)
    outside = Image.frombytes("L", mask.size, bytes(255 - value for value in mask.tobytes()))
    assert Image.composite(leaked, Image.new("L", mask.size), outside).getbbox() is None


def test_lanceolate_brush_respects_group_mask():
    mask = Image.new("L", (256 * 4, 320 * 4))
    brushes.leaf_cluster_round(mask, random.Random(11), 128, 120, 36, 28)
    layer = Image.new("RGBA", mask.size)
    brushes.leaf_cluster_lanceolate(layer, random.Random(11), mask, (128, 120), (36, 28), ("#1C5A36", "#3C7D40", "#87B83E"), highlight_color="#C9D94A")
    assert layer.getchannel("A").getbbox() is not None


def test_rosette_droop_draws_radial_leaf_group():
    layer = Image.new("RGBA", (256 * 4, 320 * 4))
    brushes.leaf_rosette_droop(layer, random.Random(13), (128, 120), ("#235E39", "#4F8E42"), leaves=10, radius=10, highlight_color="#A9C94A")
    assert layer.getchannel("A").getbbox() is not None


def test_bark_highlight_strokes_follow_branch():
    layer = Image.new("RGBA", (256 * 4, 320 * 4))
    brushes.bark_highlight_strokes(layer, random.Random(17), (128, 300), (120, 240), (100, 180), "#D8A36A", strokes=4)
    assert layer.getchannel("A").getbbox() is not None


def test_gap_cutter_removes_alpha_from_existing_mass():
    mask = Image.new("L", (256 * 4, 320 * 4))
    brushes.leaf_cluster_round(mask, random.Random(9), 128, 120, 48, 34)
    before = sum(mask.getdata())
    brushes.silhouette_gap_cutter(mask, random.Random(9), 128, 120, 48, 34, count=5)
    after = sum(mask.getdata())
    assert after < before


def test_branch_tapered_draws_continuous_branch():
    mask = Image.new("L", (256 * 4, 320 * 4))
    brushes.branch_tapered(mask, (128, 300), (118, 235), (92, 170), 14, 2.2)
    assert mask.getbbox() is not None


def test_flower_rosette_is_deterministic():
    a = Image.new("RGBA", (160 * 4, 144 * 4))
    b = Image.new("RGBA", a.size)
    flower_brushes.flower_rosette(a, random.Random(17), (80, 60), ("#FFF1D2", "#F7D95E"), "#D89D23")
    flower_brushes.flower_rosette(b, random.Random(17), (80, 60), ("#FFF1D2", "#F7D95E"), "#D89D23")
    assert a.tobytes() == b.tobytes()
    assert a.getchannel("A").getbbox() is not None


def test_flower_star_and_bud_are_visible():
    layer = Image.new("RGBA", (160 * 4, 144 * 4))
    flower_brushes.flower_star(layer, random.Random(4), (72, 54), "#EF7BA5", "#F3C64D")
    flower_brushes.flower_bud(layer, (92, 58), "#F4A4C5")
    assert layer.getchannel("A").getbbox() is not None


def test_stem_and_leaf_pair_are_deterministic():
    a = Image.new("RGBA", (160 * 4, 144 * 4))
    b = Image.new("RGBA", a.size)
    for layer in (a, b):
        rng = random.Random(9)
        flower_brushes.stem_curve(layer, (80, 100), (77, 78), (83, 48), "#27663C")
        flower_brushes.leaf_pair_small(layer, rng, (79, 76), "#3F7C4A", angle=-1.4)
    assert a.tobytes() == b.tobytes()

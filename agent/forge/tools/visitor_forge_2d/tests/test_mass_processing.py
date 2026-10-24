from PIL import Image

from visitor_forge_2d.core.field_engine import linear_depth, radial_density
from visitor_forge_2d.core.field_mass_engine import FIELD_MASS_CONTRACT, paint_field_mass
from visitor_forge_2d.core.image_processing import (
    IMAGE_PROCESSING_CONTRACT,
    alpha_cleanup,
    depth_lighting,
    local_contrast,
    masked_material_variation,
)


def test_field_mass_is_deterministic_and_coherent() -> None:
    density = radial_density(
        (96, 96),
        [
            {"center": [37, 43], "radius": [29, 24], "weight": 1.0},
            {"center": [60, 42], "radius": [27, 22], "weight": 0.92},
        ],
        power=0.65,
    )
    depth = linear_depth((96, 96), [0, 12], [0, 82])
    first = Image.new("RGBA", (96, 96), (0, 0, 0, 0))
    second = Image.new("RGBA", (96, 96), (0, 0, 0, 0))
    stats_a = paint_field_mass(
        first, density, depth_field=depth, color="#285332", threshold=0.18,
        feather=0.08, close_px=2, edge_noise=0.12, seed=55,
    )
    stats_b = paint_field_mass(
        second, density, depth_field=depth, color="#285332", threshold=0.18,
        feather=0.08, close_px=2, edge_noise=0.12, seed=55,
    )
    assert stats_a == stats_b
    assert stats_a["contract"] == FIELD_MASS_CONTRACT
    assert stats_a["noiseFieldGated"] is True
    assert first.tobytes() == second.tobytes()
    assert first.getchannel("A").getbbox() is not None
    assert 0.03 < stats_a["coverage"] < 0.8


def test_field_mass_noise_cannot_spawn_outside_zero_density() -> None:
    density = Image.new("L", (72, 72), 0)
    for y in range(26, 46):
        for x in range(28, 44):
            density.putpixel((x, y), 180)
    canvas = Image.new("RGBA", (72, 72), (0, 0, 0, 0))
    paint_field_mass(
        canvas,
        density,
        color="#285332",
        threshold=0.08,
        feather=0.04,
        close_px=1,
        edge_noise=0.45,
        noise_cell_px=5,
        seed=123,
    )
    alpha = canvas.getchannel("A")
    # The engine may feather by one pixel around authored support, but it must
    # never create disconnected islands/tendrils in distant zero-density space.
    assert alpha.getpixel((0, 0)) == 0
    assert alpha.getpixel((71, 71)) == 0
    assert alpha.getpixel((10, 36)) == 0
    assert alpha.getpixel((60, 36)) == 0
    assert alpha.getbbox() is not None
    assert alpha.getbbox()[0] >= 27
    assert alpha.getbbox()[1] >= 25
    assert alpha.getbbox()[2] <= 45
    assert alpha.getbbox()[3] <= 47


def test_alpha_cleanup_closes_small_hole() -> None:
    image = Image.new("RGBA", (32, 32), (0, 0, 0, 0))
    for y in range(8, 24):
        for x in range(8, 24):
            image.putpixel((x, y), (50, 100, 55, 255))
    image.putpixel((16, 16), (0, 0, 0, 0))
    cleaned = alpha_cleanup(
        image, close_px=1, feather_radius=0.0,
        fill_color="#32653A", fill_strength=1.0,
    )
    assert cleaned.getpixel((16, 16))[3] > 0
    assert cleaned.getpixel((0, 0))[3] == 0


def test_masked_material_only_changes_masked_region_and_is_deterministic() -> None:
    image = Image.new("RGBA", (48, 48), (120, 80, 48, 255))
    mask = Image.new("L", (48, 48), 0)
    for y in range(8, 40):
        for x in range(18, 30):
            mask.putpixel((x, y), 255)
    first = masked_material_variation(image, mask, seed=77, coarse_amount=0.18, fine_amount=0.05)
    second = masked_material_variation(image, mask, seed=77, coarse_amount=0.18, fine_amount=0.05)
    assert first.tobytes() == second.tobytes()
    assert first.getpixel((2, 2)) == image.getpixel((2, 2))
    assert first.getpixel((24, 24)) != image.getpixel((24, 24))


def test_depth_light_preserves_alpha_and_local_contrast_contract() -> None:
    image = Image.new("RGBA", (40, 40), (70, 120, 75, 0))
    for y in range(8, 32):
        for x in range(8, 32):
            image.putpixel((x, y), (70 + (x % 5) * 3, 120, 75, 220))
    depth = linear_depth((40, 40), [0, 0], [0, 39])
    lit = depth_lighting(image, depth, strength=0.2)
    finished = local_contrast(lit, radius=1.0, amount=0.35, global_contrast=1.02)
    assert lit.getchannel("A").tobytes() == image.getchannel("A").tobytes()
    assert finished.getchannel("A").tobytes() == image.getchannel("A").tobytes()
    assert finished.mode == "RGBA"
    assert IMAGE_PROCESSING_CONTRACT == "A7_IMAGE_PROCESSING_V1"

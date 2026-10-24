from PIL import Image

from visitor_forge_2d.core.layer_engine import (
    LAYER_ENGINE_CONTRACT,
    composite,
    contact_occlusion,
)
from visitor_forge_2d.core.material_engine import (
    MATERIAL_ENGINE_CONTRACT,
    masked_relief_material,
)


def test_layer_composite_and_contact_occlusion_preserve_empty_canvas() -> None:
    base = Image.new("RGBA", (48, 48), (0, 0, 0, 0))
    for y in range(18, 38):
        for x in range(10, 38):
            base.putpixel((x, y), (100, 80, 55, 255))
    layer = Image.new("RGBA", (48, 48), (0, 0, 0, 0))
    for y in range(12, 25):
        for x in range(18, 34):
            layer.putpixel((x, y), (45, 110, 55, 220))

    shadowed = contact_occlusion(base, layer, radius=2.0, strength=0.35, offset=[0, 2])
    merged = composite(shadowed, layer)

    assert LAYER_ENGINE_CONTRACT == "A7_LAYER_ENGINE_V1"
    assert shadowed.getpixel((0, 0))[3] == 0
    assert merged.getpixel((0, 0))[3] == 0
    assert shadowed.getpixel((24, 24))[:3] != base.getpixel((24, 24))[:3]
    assert merged.getpixel((24, 18))[3] > 0


def test_masked_relief_material_is_deterministic_and_mask_limited() -> None:
    image = Image.new("RGBA", (56, 64), (0, 0, 0, 0))
    mask = Image.new("L", image.size, 0)
    for y in range(8, 58):
        for x in range(20, 36):
            image.putpixel((x, y), (128, 86, 52, 255))
            mask.putpixel((x, y), 255)

    first = masked_relief_material(
        image, mask, seed=991, light_direction=[-0.9, -0.35],
        relief_strength=0.3, grain_axis="vertical", grain_amount=0.12,
    )
    second = masked_relief_material(
        image, mask, seed=991, light_direction=[-0.9, -0.35],
        relief_strength=0.3, grain_axis="vertical", grain_amount=0.12,
    )

    assert MATERIAL_ENGINE_CONTRACT == "A7_MATERIAL_ENGINE_V2"
    assert first.tobytes() == second.tobytes()
    assert first.getchannel("A").tobytes() == image.getchannel("A").tobytes()
    assert first.getpixel((2, 2)) == image.getpixel((2, 2))
    assert first.getpixel((28, 30)) != image.getpixel((28, 30))

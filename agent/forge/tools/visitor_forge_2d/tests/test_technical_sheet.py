from PIL import Image

from visitor_forge_2d.core.technical_sheet import technical_sheet


def test_technical_sheet_keeps_source_untouched() -> None:
    source = Image.new("RGBA", (64, 96), (0, 0, 0, 0))
    source.putpixel((32, 48), (20, 180, 60, 255))
    before = source.tobytes()

    sheet = technical_sheet(
        source,
        asset_id="tree_test",
        direction="south",
        anchor=[32, 90],
        contract="CH_2D_ORGANIC_SCENERY_V1",
        yaw_deg=45,
    )

    assert sheet.mode == "RGBA"
    assert sheet.size == (768, 980)
    assert source.tobytes() == before
    assert source.size == (64, 96)

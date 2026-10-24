from PIL import Image, ImageChops, ImageDraw

from visitor_forge_2d.character.gait_warp import LOCKED_MASTER_ROWS, warp_intact_master


def test_gait_warp_preserves_locked_upper_body_pixels() -> None:
    master = Image.new("RGBA", (512, 512))
    draw = ImageDraw.Draw(master)
    draw.ellipse((180, 60, 330, 210), fill=(220, 180, 150, 255))
    draw.rectangle((175, 205, 335, 350), fill=(70, 130, 180, 255))
    draw.rectangle((190, 330, 250, 470), fill=(60, 70, 90, 255))
    draw.rectangle((260, 330, 320, 470), fill=(60, 70, 90, 255))

    warped = warp_intact_master(master, (20, 8), (-15, -14))

    locked_box = (0, 0, master.width, LOCKED_MASTER_ROWS)
    assert ImageChops.difference(master.crop(locked_box), warped.crop(locked_box)).getbbox() is None
    assert ImageChops.difference(master, warped).getbbox() is not None

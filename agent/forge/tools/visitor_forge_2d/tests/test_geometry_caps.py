import pytest
from PIL import Image
from visitor_forge_2d.core.geometry_engine import draw_tapered_paths


def render(**caps):
    image=Image.new('RGBA',(64,64))
    draw_tapered_paths(image,[dict(points=[[32,16],[32,48]],width=10,fill='#795337',**caps)])
    return image


def test_butt_caps_remove_endpoint_bulges_but_keep_the_ribbon():
    rounded=render()
    flat=render(startCap='butt',endCap='butt')
    assert rounded.getpixel((32,12))[3]>200
    assert rounded.getpixel((32,52))[3]>200
    assert flat.getpixel((32,12))[3]<8
    assert flat.getpixel((32,52))[3]<8
    assert flat.getpixel((32,32))[3]==255


def test_default_caps_keep_legacy_round_output():
    assert render().tobytes()==render(startCap='round',endCap='round').tobytes()


def test_unknown_cap_is_rejected():
    with pytest.raises(ValueError,match='caps'):
        render(startCap='squareish')


def test_butt_plane_clips_nearby_round_joins_without_erasing_previous_paths():
    image=Image.new('RGBA',(64,64))
    draw_tapered_paths(image,[
        dict(points=[[10,10],[54,10]],width=2,fill='#FF0000'),
        dict(points=[[32,16],[32,18],[34,40]],width=10,fill='#795337',startCap='butt'),
    ])
    assert image.getpixel((32,14))[3]<8
    assert image.getpixel((32,24))[3]>200
    assert image.getpixel((32,10))[:3]==(255,0,0)

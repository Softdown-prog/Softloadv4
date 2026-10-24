"""General drawing contracts: transformed geometry, holes and gallery meaning."""
from collections import defaultdict
import pytest
from PIL import Image, ImageChops
from visitor_forge_2d.component_gallery import load_component_gallery
from visitor_forge_2d.core import scene_composer, scene_composer_v2, scene_composer_v3
from visitor_forge_2d.core.component_templates import build_component
from visitor_forge_2d.core.scene_geometry import shift_mask
from visitor_forge_2d.core.scene_composer_v4 import _surface_finish

COMPOSERS=[scene_composer,scene_composer_v2,scene_composer_v3]
TRANSFORM={'translate':[32,32],'scale':[1,1],'rotateDeg':45}

@pytest.mark.parametrize('composer',COMPOSERS)
def test_rotated_rectangle_uses_contour_instead_of_bounding_box(composer):
    mask=composer._shape_mask((256,256),{'primitive':'rect','box':[-20,-2,20,2]},TRANSFORM,'test')
    assert mask.getpixel((128,128))==255
    assert mask.getpixel((100,160))==0
    assert mask.getpixel((168,168))==255

@pytest.mark.parametrize('composer',COMPOSERS)
def test_rotated_ellipse_has_true_major_axis(composer):
    mask=composer._shape_mask((256,256),{'primitive':'ellipse','box':[-20,-3,20,3]},TRANSFORM,'test')
    assert mask.getpixel((168,168))==255
    assert mask.getpixel((128,168))==0

@pytest.mark.parametrize('composer',COMPOSERS)
def test_cutouts_are_transparent_and_transform_with_shape(composer):
    shape={'primitive':'ellipse','box':[-12,-12,12,12],'cutouts':[{'primitive':'ellipse','box':[-6,-6,6,6]}]}
    mask=composer._shape_mask((256,256),shape,TRANSFORM,'test')
    assert mask.getpixel((128,128))==0
    assert mask.getpixel((164,128))==255
    background=Image.new('RGBA',mask.size,'#AABDCC')
    foreground=Image.new('RGBA',mask.size,'#334455');foreground.putalpha(mask)
    assert Image.alpha_composite(background,foreground).getpixel((128,128))==(170,189,204,255)

@pytest.mark.parametrize('composer',COMPOSERS)
def test_uniform_scale_scales_stroke_width(composer):
    shape={'primitive':'line','points':[[-10,0],[10,0]],'width':2}
    bounds=[]
    for factor in [1,2]:
        mask=composer._shape_mask((256,256),shape,{'translate':[32,32],'scale':[factor,factor]},'test')
        box=mask.getbbox();bounds.append(box[3]-box[1])
    assert bounds==[8,16]

@pytest.mark.parametrize('composer',COMPOSERS)
def test_cutouts_reject_nested_or_unbounded_lists(composer):
    shape={'primitive':'rect','box':[1,1,10,10]}
    for holes in [[{**shape,'cutouts':[]}],[shape]*33]:
        with pytest.raises(ValueError,match='cutouts'):
            composer._shape_mask((64,64),{**shape,'cutouts':holes},{},'test')


def test_shift_does_not_wrap_at_canvas_edge():
    mask=Image.new('L',(20,20));mask.putpixel((19,10),255)
    assert shift_mask(mask,2,0).getbbox() is None
    mask.putpixel((0,5),128)
    assert shift_mask(mask,2,0).getpixel((2,5))==128


def test_finish_preserves_every_alpha_value():
    image=Image.new('RGBA',(32,32),(104,75,59,0))
    image.putalpha(Image.linear_gradient('L').resize(image.size))
    result=_surface_finish(image,13,{'brushStamps':40,'surfaceVariation':.2})
    assert result.getchannel('A').tobytes()==image.getchannel('A').tobytes()
    assert result.convert('RGB').tobytes()!=image.convert('RGB').tobytes()


def test_object_gradient_uses_material_bounds_and_retains_legacy_canvas_space():
    size=(128,128);a=Image.new('L',size);a.paste(255,(8,8,24,24))
    b=Image.new('L',size);b.paste(255,(72,72,88,88))
    spec={'type':'linear_gradient','start':'#FFFFFF','end':'#000000','space':'object'}
    first=scene_composer_v3._material(size,a,spec,'test',11,{})
    second=scene_composer_v3._material(size,b,spec,'test',11,{})
    assert first.crop((8,8,24,24)).tobytes()==second.crop((72,72,88,88)).tobytes()
    spec.pop('space')
    assert scene_composer_v3._material(size,a,spec,'test',11,{}).getpixel((16,8))[:3]!=(255,255,255)


def test_all_704_gallery_variants_have_bounded_geometry_and_distinct_styles():
    gallery=load_component_gallery();pairs=defaultdict(dict)
    assert len(gallery['items'])==704
    for item in gallery['items']:
        nodes=build_component(item,{'type':'solid','color':'#FFFFFF'},{})
        construction=[]
        assert 1<=len(nodes)<=40
        mask=Image.new('L',(256,256))
        transform={'translate':[32,32],'scale':[1,1],'rotateDeg':item['orientationDeg']}
        for node in nodes:
            part=scene_composer_v3._shape_mask(mask.size,node,transform,item['id'])
            mask=ImageChops.lighter(mask,part)
            construction.append(part.tobytes())
        bounds=mask.getbbox();assert bounds is not None,item['id']
        assert min(bounds)>0 and max(bounds)<256,item['id']
        if '_md_000' in item['id']:pairs[item['family']][item['style']]=tuple(construction)
    assert len(pairs)==44
    for family,styles in pairs.items():
        assert len(styles)==2 and len(set(styles.values()))==2,family

@pytest.mark.parametrize('composer',COMPOSERS)
def test_surface_effects_preserve_material_opacity(composer):
    mask=Image.new('L',(40,40));mask.paste(255,(10,10,30,30))
    base=Image.new('RGBA',mask.size,(100,80,60,0));base.putalpha(mask.point(lambda v:v//2))
    effects={'highlight':{'width':1,'color':'#FFFFFF88'}}
    if composer is scene_composer:
        result=composer._apply_effects(base,mask,effects,'test')
    else:
        effects['bevel']={'width':1,'strength':.4}
        result=composer._effects(base,mask,effects,'test',{})
    assert result.getchannel('A').tobytes()==base.getchannel('A').tobytes()


def test_packaged_gallery_matches_documented_example_shards():
    from pathlib import Path
    from visitor_forge_2d.component_gallery import GALLERY_DIR
    examples=Path(__file__).resolve().parents[1]/'examples'/'component_gallery'
    for source in examples.glob('*.json'):
        assert source.read_bytes()==(GALLERY_DIR/source.name).read_bytes()

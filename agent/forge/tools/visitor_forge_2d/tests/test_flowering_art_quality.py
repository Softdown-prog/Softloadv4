import copy
import random

import pytest
from PIL import Image

from visitor_forge_2d.core.art_planner import plan_plant_four_views
from visitor_forge_2d.core.flower_cluster_engine import _masked_gradient
from visitor_forge_2d.core.flowering_brushes import flower_cluster_small_round


def intent():
    return dict(species='ipe_amarelo', seed=73, canvas=[256,320], anchor=[128,310],
                flowering=dict(amount=.96,color='#FFD21A',leafRetention=.04))


def nodes(recipe):
    return {node['id']: node for node in recipe['graph']['nodes']}


def test_requested_flower_color_is_respected_and_keeps_volume():
    raw=intent(); raw['flowering']['color']='#E05AAD'
    _,recipes=plan_plant_four_views(raw)
    palette=nodes(recipes['south'])['flower_clusters']['params']['palette']
    assert palette['midTop']=='#E05AAD'
    assert len(set(palette.values()))>=5
    assert all(int(value[1:3],16)>int(value[3:5],16) for value in palette.values())
    raw['flowering']['color']='purple'
    with pytest.raises(ValueError,match='color'):
        plan_plant_four_views(raw)


def test_leaf_retention_controls_support_without_reducing_bloom():
    raw=intent(); _,bare=plan_plant_four_views(raw)
    raw['flowering']['leafRetention']=1
    _,leafy=plan_plant_four_views(raw)
    for view in bare:
        a,b=nodes(bare[view]),nodes(leafy[view])
        assert a['front_foliage']['params']['count'] < b['front_foliage']['params']['count']
        assert a['flower_clusters']==b['flower_clusters']
        assert a['flower_clusters']['params']['blossomStyle']=='petalled'


def test_fit_uses_shared_scale_and_foot_for_every_direction():
    raw=intent(); _,recipes=plan_plant_four_views(raw)
    assert len({recipe['planner']['projectionScale'] for recipe in recipes.values()})==1
    assert all(recipe['anchor']==[128,310] for recipe in recipes.values())
    for recipe in recipes.values():
        for path in nodes(recipe)['wood_structure']['params']['paths']:
            assert all(35<=x<=221 and 25<=y<=310 for x,y in path['points'])
    large=copy.deepcopy(raw); large.update(canvas=[512,640],anchor=[256,620])
    _,larger=plan_plant_four_views(large)
    assert larger['south']['planner']['projectionScale'] > recipes['south']['planner']['projectionScale']*1.8


def test_cluster_gradient_is_local_and_translation_invariant():
    first=Image.new('L',(80,100)); second=Image.new('L',(80,100))
    first.paste(255,(10,10,30,30)); second.paste(255,(10,60,30,80))
    a=_masked_gradient(first,'#FFFF00','#804000')
    b=_masked_gradient(second,'#FFFF00','#804000')
    assert a.crop((10,10,30,30)).tobytes()==b.crop((10,60,30,80)).tobytes()
    assert a.getpixel((15,10))[:3]==(255,255,0)
    assert a.getpixel((15,29))[:3]==(128,64,0)


def test_petalled_brush_is_deterministic_and_clipped():
    mask=Image.new('L',(128,128)); mask.paste(255,(32,32,96,96))
    def paint(style):
        image=Image.new('RGBA',mask.size)
        flower_cluster_small_round(image,random.Random(19),mask,(16,16),(10,10),['#FFD21A'],count=60,blossom_style=style)
        return image
    petals=paint('petalled')
    assert petals.tobytes()==paint('petalled').tobytes()
    assert petals.tobytes()!=paint('round').tobytes()
    assert petals.getbbox() is not None
    assert petals.getchannel('A').getbbox()[0]>=32
    assert petals.getchannel('A').getbbox()[2]<=96


def test_critic_does_not_count_gold_blossoms_as_bark():
    from visitor_forge_2d.core.plant_visual_critic import _brown_mask
    image=Image.new('RGBA',(3,1))
    image.putdata([(121,83,55,255),(255,210,26,255),(154,103,0,255)])
    mask=_brown_mask(image)
    assert mask.getpixel((0,0))==255
    assert mask.getpixel((1,0))==0
    assert mask.getpixel((2,0))==0


def test_nonflowering_tree_keeps_green_rear_surface():
    raw=intent();raw['flowering']['amount']=0
    _,recipes=plan_plant_four_views(raw)
    recipe=recipes['south']
    assert recipe['planner']['rearCanopySurface']=='leaves'
    assert nodes(recipe)['rear_foliage']['type']=='field_cluster_scatter'
    assert 'flower_clusters' not in nodes(recipe)

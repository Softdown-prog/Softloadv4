"""Semantic gallery silhouettes, built entirely from bounded scene primitives.

Coordinates are normalized to each declared size. Styles change construction,
not just labels. Openings are real alpha cutouts, never painted black disks.
"""
import math
from copy import deepcopy


def build_component(item, material, effects, role=None):
    w,h=map(float,item['sizePx']); family=item['family']; style=item['style']; nodes=[]
    material=deepcopy(material)
    if material.get('type')=='linear_gradient' and material.get('start')=='#78A85B':
        if family=='flower_cluster': material.update(start='#F6CF73',end='#B05D45')
        elif style=='stone_cluster': material.update(start='#B6ADA0',end='#67655E')
    def box(kind,x0,y0,x1,y1,**extra):
        return dict(primitive=kind,box=[x0*w,y0*h,x1*w,y1*h],**extra)
    def polygon(points):
        return {'primitive':'polygon','points':[[x*w,y*h] for x,y in points]}
    def add(shape, accent=False):
        node={'type':'shape',**shape,'material':deepcopy(material),'effects':deepcopy(effects)}
        if accent:
            node['material']={'type':'solid','color':'#E7D8B780'};node['effects']={}
        if role: node['role']=role
        nodes.append(node)
    def rect(x0,y0,x1,y1): add(box('rect',x0,y0,x1,y1))
    def ellipse(x0,y0,x1,y1): add(box('ellipse',x0,y0,x1,y1))
    def poly(points): add(polygon(points))
    def line(points,width=.09):
        for a,b in zip(points,points[1:]):
            add({'primitive':'line','points':[[a[0]*w,a[1]*h],[b[0]*w,b[1]*h]],'width':min(w,h)*width})
    def ring(x0,y0,x1,y1,thickness=.14,kind='ellipse'):
        outer=box(kind,x0,y0,x1,y1);dx=(x1-x0)*thickness;dy=(y1-y0)*thickness
        outer['cutouts']=[box(kind,x0+dx,y0+dy,x1-dx,y1-dy)];add(outer)
    def spokes(count=6):
        for i in range(count):
            a=i*math.tau/count;line([(0,0),(.36*math.cos(a),.36*math.sin(a))],.07)
    def rivets():
        for x in [-.34,.34]:
            for y in [-.30,.30]: add(box('ellipse',x-.035,y-.055,x+.035,y+.055),True)
    if family in ('wood_plank','wood_beam','metal_pipe','metal_plate','stone_block','brick_tile','sign_panel','tool_handle','lamp_post_segment'):
        if style in ('rough','tapered'):
            poly([(-.5,-.36),(-.3,-.5),(.46,-.42),(.5,.25),(.35,.5),(-.45,.42)])
        elif style in ('square','rect','flat','brick','paver','straight_handle','straight'):
            rect(-.5,-.5,.5,.5)
        else:
            add(box('rounded_rect',-.5,-.5,.5,.5,radius=min(w,h)*.25))
        if style in ('beveled','paver'):
            add(polygon([(-.45,-.40),(.45,-.40),(.36,-.24),(-.36,-.24)]),True)
        if style=='ornate':
            ring(-.35,-.45,.05,.45);ring(-.05,-.45,.35,.45)
        if style=='grip_handle':
            for x in [-.3,-.15,0,.15,.3]:line([(x,-.4),(x,.4)],.055)
    elif family=='fastener':
        if style=='bolt':poly([(math.cos(i*math.tau/6)*.5,math.sin(i*math.tau/6)*.5) for i in range(6)])
        else:ellipse(-.5,-.5,.5,.5)
        add(box('ellipse',-.18,-.18,.18,.18),True)
    elif family=='washer_nut':
        shape=box('ellipse',-.5,-.5,.5,.5) if style=='washer' else polygon([(math.cos(i*math.tau/6)*.5,math.sin(i*math.tau/6)*.5) for i in range(6)])
        shape['cutouts']=[box('ellipse',-.23,-.23,.23,.23)];add(shape)
    elif family=='hinge_bracket':
        if style=='hinge':
            rect(-.48,-.4,-.10,.4);rect(.10,-.4,.48,.4);rect(-.12,-.5,.12,.5);rivets()
        else:poly([(-.5,-.5),(-.28,-.5),(-.28,.28),(.5,.28),(.5,.5),(-.5,.5)])
    elif family in ('rope_chain','cable_wire','decorative_trim','boat_rib','water_edge_detail'):
        if style=='chain':
            for i in range(6):ring(-.5+i*.15,-.5,-.23+i*.15,.5,.2)
        elif style=='bead':
            for i in range(9):ellipse(-.5+i*.11,-.4,-.4+i*.11,.4)
        else:
            amp={'rib':.48,'gunwale':.22,'foam_line':.26,'ripple_line':.42,'rope':.25,'cable':.18,'wire':.08,'groove':0}.get(style,.15)
            line([(i/16-.5,amp*math.sin(i/16*math.pi*2)) for i in range(17)],.2 if style in ('rope','rib') else .12)
    elif family=='marine_fitting':
        if style=='mooring_ring':ring(-.4,-.5,.4,.35);rect(-.5,.3,.5,.5)
        else:rect(-.18,-.2,.18,.45);poly([(-.5,-.45),(-.32,-.15),(.32,-.15),(.5,-.45),(.5,-.1),(.24,.12),(-.24,.12),(-.5,-.1)])
    elif family=='street_hardware':
        if style=='post_cap':poly([(-.5,.0),(0,-.5),(.5,0),(.4,.22),(-.4,.22)]);rect(-.32,.2,.32,.5)
        else:rect(-.5,.22,.5,.5);rect(-.2,-.5,.2,.25);rivets()
    elif family in ('natural_detail','flower_cluster','shrub_cluster'):
        if style=='stone_cluster':
            for x,y,r in [(-.25,.17,.25),(.22,.20,.26),(0,-.2,.28)]:poly([(x+r*math.cos(i*math.tau/6),y+r*math.sin(i*math.tau/6)) for i in range(6)])
        elif style=='spiky_shrub':
            poly([(math.cos(i*math.tau/24)*(.5 if i%2==0 else .28),math.sin(i*math.tau/24)*(.5 if i%2==0 else .28)) for i in range(24)])
        elif family=='flower_cluster':
            centers=[(0,0)] if style=='round_bloom' else [(-.27,.18),(.26,.15),(0,-.25)]
            r=.22 if style=='round_bloom' else .12
            for x,y in centers:
                for i in range(5):
                    a=i*math.tau/5;cx=x+r*math.cos(a);cy=y+r*math.sin(a);ellipse(cx-r,cy-r,cx+r,cy+r)
                add(box('ellipse',x-r*.45,y-r*.45,x+r*.45,y+r*.45),True)
        else:
            for x,y,rx,ry in [(-.25,.1,.24,.3),(.25,.1,.24,.3),(0,-.17,.28,.31)]:ellipse(x-rx,y-ry,x+rx,y+ry)
            if style=='leaf_cluster':line([(-.38,.4),(0,-.25),(.32,.4)],.08)
    elif family=='surface_decal':
        if style=='scratch':
            for y in [-.3,0,.3]:line([(-.45,y),(.4,y-.13)],.055)
        else:poly([(-.5,-.25),(-.1,-.5),(.17,-.15),(.5,-.2),(.28,.32),(-.2,.5)])
    elif family=='hook_latch':
        if style=='hook':line([(0,-.5),(0,.20),(.28,.4),(.48,.12)],.18)
        else:rect(-.5,-.20,.3,.20);ring(.1,-.45,.5,.45,.26)
    elif family=='handle_grip':
        if style=='loop_handle':ring(-.5,-.5,.5,.5,.2,kind='rounded_rect')
        else:line([(-.45,.45),(-.45,-.2),(.45,-.2),(.45,.45)],.22)
    elif family=='mesh_panel':
        shape=box('rect',-.5,-.5,.5,.5);holes=[]
        if style=='wire_grid':
            for x in range(5):
                for y in range(4):holes.append(box('rect',-.46+x*.19,-.45+y*.24,-.31+x*.19,-.27+y*.24))
        else:
            for x in range(5):
                for y in range(4):
                    cx=-.38+x*.19;cy=-.34+y*.23
                    holes.append(polygon([(cx,cy-.09),(cx+.08,cy),(cx,cy+.09),(cx-.08,cy)]))
        shape['cutouts']=holes;add(shape)
    elif family in ('railing_segment','ladder_segment'):
        if family=='railing_segment':
            rect(-.48,-.5,-.42,.5);rect(.42,-.5,.48,.5)
            for y in ([-.35,.25] if style=='two_rail' else [-.35,0,.35]):rect(-.5,y-.035,.5,y+.035)
        else:
            line([(-.40,-.5),(-.40,.5)],.10);line([(.40,-.5),(.40,.5)],.10)
            for y in [-.35,-.12,.12,.35]:line([(-.4,y),(.4,y)],.1)
            if style=='marine':line([(-.4,-.5),(-.2,-.5),(-.2,-.3)],.10)
    elif family=='oar_paddle':
        rect(-.5,-.12,.15,.12)
        poly([(.10,-.22),(.40,-.5),(.5,-.3),(.5,.3),(.4,.5),(.1,.22)] if style=='paddle' else [(.08,-.34),(.5,-.5),(.5,.5),(.08,.34)])
    elif family=='dock_bumper':
        if style=='rubber_fender':ring(-.5,-.5,.5,.5,.23)
        else:
            add(box('capsule',-.5,-.5,.5,.5))
            for x in [-.3,-.1,.1,.3]:line([(x-.08,-.4),(x+.08,.4)],.10)
    elif family=='lamp_fixture':
        if style=='lantern':
            ring(-.18,-.5,.18,-.18,.24);poly([(-.4,-.22),(.4,-.22),(.3,.38),(-.3,.38)]);rect(-.42,.38,.42,.5)
            add(box('rect',-.18,-.12,.18,.27),True);line([(0,-.22),(0,.38)],.08)
        else:poly([(-.15,-.5),(.15,-.5),(.5,.2),(-.5,.2)]);rect(-.06,.2,.06,.5)
    elif family=='sign_icon':
        if style=='arrow':poly([(-.5,-.16),(.1,-.16),(.1,-.5),(.5,0),(.1,.5),(.1,.16),(-.5,.16)])
        else:ellipse(-.14,-.5,.14,-.23);rect(-.12,-.10,.12,.5)
    elif family=='bench_support':
        line([(-.35,-.5),(-.15,.1),(-.4,.5)],.14);line([(-.15,.1),(.4,.5)],.14)
        if style=='arm_support':line([(-.35,-.5),(.4,-.5),(.4,-.1)],.13)
    elif family=='bin_component':
        if style=='opening':ring(-.5,-.5,.5,.5,.13,kind='rounded_rect')
        else:poly([(-.5,.1),(-.35,-.35),(.35,-.35),(.5,.1),(.5,.5),(-.5,.5)]);rect(-.13,-.5,.13,-.35)
    elif family=='planter_rim':ring(-.5,-.5,.5,.5,.18,kind='ellipse' if style=='round_rim' else 'rect')
    elif family=='fabric_flag':
        poly([(-.5,-.5),(.5,-.36),(.36,0),(.5,.4),(-.5,.5)] if style=='flag' else [(-.38,-.5),(.38,-.5),(.38,.3),(0,.5),(-.38,.3)])
        line([(-.5,-.5),(-.5,.5)],.07)
    elif family=='wheel_pulley':
        ring(-.5,-.5,.5,.5,.13);spokes(6 if style=='wheel' else 3);ellipse(-.12,-.12,.12,.12)
        if style=='pulley':ring(-.43,-.43,.43,.43,.05)
    elif family=='marine_anchor':
        ring(-.16,-.5,.16,-.22,.22);line([(0,-.22),(0,.4)],.12)
        if style=='anchor':line([(-.3,-.13),(.3,-.13)],.10);poly([(-.5,.07),(-.36,.4),(0,.5),(.36,.4),(.5,.07),(.26,.22),(.25,.30),(0,.37),(-.25,.30),(-.26,.22)])
        else:line([(-.45,.07),(0,.4),(.45,.07)],.12);line([(-.24,.5),(0,.15),(.24,.5)],.12)
    elif family=='buoy_float':
        if style=='round_buoy':ellipse(-.48,-.25,.48,.5);ring(-.15,-.5,.15,-.17,.2)
        else:poly([(-.38,.5),(-.25,-.25),(0,-.5),(.25,-.25),(.38,.5)]);line([(-.27,0),(.27,0)],.12)
    elif family=='crate_panel':
        for y in [-.4,-.14,.14,.4]:rect(-.5,y-.09,.5,y+.09)
        rect(-.5,-.5,-.39,.5);rect(.39,-.5,.5,.5)
        if style=='reinforced':line([(-.4,-.4),(.4,.4)],.13);line([(-.4,.4),(.4,-.4)],.13)
    elif family=='barrel_stave':
        if style=='hoop':ring(-.5,-.5,.5,.5,.1)
        else:poly([(-.35,-.5),(.35,-.5),(.5,0),(.35,.5),(-.35,.5),(-.5,0)]);line([(0,-.46),(0,.46)],.035)
    elif family=='awning_canopy':
        poly([(-.38,-.5),(.38,-.5),(.5,.25),(.5,.5),(.3,.35),(.1,.5),(-.1,.35),(-.3,.5),(-.5,.35),(-.5,.25)])
        if style=='striped_awning':
            for x in [-.28,0,.28]:add(polygon([(x-.05,-.4),(x+.05,-.4),(x+.07,.26),(x-.07,.26)]),True)
    elif family=='pavement_marking':
        if style=='stripe':rect(-.5,-.3,.5,.3)
        else:poly([(-.5,-.5),(-.3,-.5),(.3,0),(-.3,.5),(-.5,.5),(.1,0)])
    elif family=='decorative_finial':
        rect(-.18,.18,.18,.5)
        if style=='ball_finial':ellipse(-.45,-.5,.45,.27)
        else:poly([(0,-.5),(.38,.04),(0,.27),(-.38,.04)])
    else:
        raise ValueError(f'No semantic template registered for {family!r}/{style!r}')
    return nodes

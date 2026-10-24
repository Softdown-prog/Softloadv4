"""Material-aware deterministic scene composer for general 2D game props.

V2 keeps the bounded scene-graph approach from V1 but adds a small reusable
material system, directional light, cavity/ambient-occlusion and bevel shading.
The goal is a painted/pre-rendered game look for signs, piers, boats and props
without requiring a 3D asset.
"""
from __future__ import annotations

from .scene_geometry import box_contour, shift_mask, stroke_scale

import hashlib
import json
import math
import random
from copy import deepcopy
from pathlib import Path

from PIL import Image, ImageChops, ImageDraw, ImageFilter, ImageOps

from .exporter import alpha_safe_resize

CONTRACT = "CH_2D_SCENE_RECIPE_V2"
SCALE = 4
_MAX_DEPTH = 12
_MAX_NODES = 1600
_ALLOWED_PRIMITIVES = {"ellipse", "rect", "rounded_rect", "polygon", "line", "quadratic", "cubic", "diamond", "capsule"}
_ALLOWED_MATERIALS = {"solid", "linear_gradient", "radial_gradient", "wood", "painted_metal", "stone", "rope"}


def _num(value: object, label: str) -> float:
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value):
        raise ValueError(f"{label} must be a finite number")
    return float(value)


def _pair(value: object, label: str) -> tuple[float, float]:
    if not isinstance(value, list) or len(value) != 2:
        raise ValueError(f"{label} must be [x, y]")
    return _num(value[0], label), _num(value[1], label)


def _color(value: object, label: str) -> tuple[int, int, int, int]:
    if not isinstance(value, str) or len(value) not in (7, 9) or not value.startswith("#"):
        raise ValueError(f"{label} must be #RRGGBB or #RRGGBBAA")
    try:
        rgb = tuple(int(value[i:i + 2], 16) for i in (1, 3, 5))
        a = int(value[7:9], 16) if len(value) == 9 else 255
    except ValueError as exc:
        raise ValueError(f"{label} has invalid hex color") from exc
    return (*rgb, a)


def _lerp(a, b, t: float):
    return tuple(round(x * (1 - t) + y * t) for x, y in zip(a, b))


def _transform_point(point: tuple[float, float], transform: dict) -> tuple[float, float]:
    x, y = point
    sx, sy = transform.get("scale", [1.0, 1.0]); x *= sx; y *= sy
    angle = math.radians(transform.get("rotateDeg", 0.0))
    if angle:
        c, s = math.cos(angle), math.sin(angle); x, y = x*c-y*s, x*s+y*c
    tx, ty = transform.get("translate", [0.0, 0.0]); return x+tx, y+ty


def _combine(a: dict, b: dict | None) -> dict:
    b = b or {}; bt = b.get("translate", [0.0, 0.0]); moved = _transform_point((float(bt[0]), float(bt[1])), a); bs = b.get("scale", [1.0, 1.0])
    return {"translate": [moved[0], moved[1]], "scale": [a.get("scale", [1,1])[0]*float(bs[0]), a.get("scale", [1,1])[1]*float(bs[1])], "rotateDeg": float(a.get("rotateDeg",0))+float(b.get("rotateDeg",0))}


def _validate_transform(value: object, label: str) -> dict:
    if value is None: return {"translate":[0.0,0.0],"scale":[1.0,1.0],"rotateDeg":0.0}
    if not isinstance(value, dict) or any(k not in ("translate","scale","rotateDeg") for k in value): raise ValueError(f"{label} contains unsupported transform keys")
    t=_pair(value.get("translate",[0,0]),label+".translate"); s=_pair(value.get("scale",[1,1]),label+".scale"); r=_num(value.get("rotateDeg",0),label+".rotateDeg")
    if s[0]==0 or s[1]==0 or abs(s[0])>20 or abs(s[1])>20: raise ValueError(f"{label}.scale is outside safe limits")
    return {"translate":list(t),"scale":list(s),"rotateDeg":r}


def _curve(kind: str, points: list[tuple[float,float]]) -> list[tuple[float,float]]:
    if kind == "line": return points
    out=[]
    for i in range(49):
        t=i/48
        if kind=="quadratic":
            a,b,c=points; x=(1-t)**2*a[0]+2*(1-t)*t*b[0]+t*t*c[0]; y=(1-t)**2*a[1]+2*(1-t)*t*b[1]+t*t*c[1]
        else:
            a,b,c,d=points; x=(1-t)**3*a[0]+3*(1-t)**2*t*b[0]+3*(1-t)*t*t*c[0]+t**3*d[0]; y=(1-t)**3*a[1]+3*(1-t)**2*t*b[1]+3*(1-t)*t*t*c[1]+t**3*d[1]
        out.append((x,y))
    return out


def _shape_mask(size, primitive: dict, transform: dict, label: str) -> Image.Image:
    kind=primitive.get("primitive")
    if kind not in _ALLOWED_PRIMITIVES: raise ValueError(f"{label}.primitive must be one of {sorted(_ALLOWED_PRIMITIVES)}")
    mask=Image.new("L",size); draw=ImageDraw.Draw(mask)
    def px(p): x,y=_transform_point(p,transform); return round(x*SCALE),round(y*SCALE)
    if kind in ("ellipse", "rect", "rounded_rect", "capsule"):
        draw.polygon([px(p) for p in box_contour(primitive, label)], fill=255)
    elif kind=="diamond":
        cx,cy=_pair(primitive.get("center"),label+".center"); rx,ry=_pair(primitive.get("radius"),label+".radius"); draw.polygon([px((cx,cy-ry)),px((cx+rx,cy)),px((cx,cy+ry)),px((cx-rx,cy))],fill=255)
    elif kind=="polygon":
        raw=primitive.get("points")
        if not isinstance(raw,list) or len(raw)<3: raise ValueError(f"{label}.points needs at least 3 points")
        draw.polygon([px(_pair(p,label+".points")) for p in raw],fill=255)
    else:
        raw=primitive.get("points"); need={"line":2,"quadratic":3,"cubic":4}[kind]
        if not isinstance(raw,list) or len(raw)!=need: raise ValueError(f"{label}.points needs {need} points")
        width=_num(primitive.get("width",1),label+".width")
        if width<=0: raise ValueError(f"{label}.width must be positive")
        draw.line([px(p) for p in _curve(kind,[_pair(p,label+".points") for p in raw])],fill=255,width=max(1,round(width*SCALE*stroke_scale(transform))),joint="curve")
    holes = primitive.get("cutouts", [])
    if not isinstance(holes, list) or len(holes) > 32:
        raise ValueError(f"{label}.cutouts must contain at most 32 shapes")
    for hole in holes:
        if not isinstance(hole, dict) or "cutouts" in hole or hole.get("primitive") not in ("ellipse", "rect", "rounded_rect", "capsule", "polygon", "diamond"):
            raise ValueError(f"{label}.cutouts require closed shapes without nested cutouts")
        mask = ImageChops.subtract(mask, _shape_mask(size, hole, transform, label + ".cutouts"))
    return mask


def _noise_field(size, seed: int, coarse: int=8) -> Image.Image:
    rng=random.Random(seed); small=(max(2,size[0]//coarse),max(2,size[1]//coarse)); noise=Image.new("L",small); pix=noise.load()
    for y in range(small[1]):
        for x in range(small[0]): pix[x,y]=rng.randrange(72,184)
    return noise.resize(size,Image.Resampling.BILINEAR).filter(ImageFilter.GaussianBlur(0.7*SCALE))


def _gradient(size,start,end,vertical=True):
    image=Image.new("RGBA",size); d=ImageDraw.Draw(image); span=size[1] if vertical else size[0]
    for i in range(span):
        c=_lerp(start,end,i/max(1,span-1)); d.line((0,i,size[0],i) if vertical else (i,0,i,size[1]),fill=c)
    return image


def _material(size, mask, spec: dict, label: str, seed: int) -> Image.Image:
    if not isinstance(spec,dict): raise ValueError(f"{label} material must be an object")
    kind=spec.get("type","solid")
    if kind not in _ALLOWED_MATERIALS: raise ValueError(f"{label}.type must be one of {sorted(_ALLOWED_MATERIALS)}")
    opacity=_num(spec.get("opacity",1),label+".opacity")
    if not 0<=opacity<=1: raise ValueError(f"{label}.opacity must be 0..1")
    if kind=="solid": image=Image.new("RGBA",size,_color(spec.get("color"),label+".color"))
    elif kind=="linear_gradient": image=_gradient(size,_color(spec.get("start"),label+".start"),_color(spec.get("end"),label+".end"),spec.get("axis","y")!="x")
    elif kind=="radial_gradient":
        inner=_color(spec.get("inner"),label+".inner"); outer=_color(spec.get("outer"),label+".outer"); center=_pair(spec.get("center",[size[0]/SCALE/2,size[1]/SCALE/2]),label+".center"); radius=max(1.0,_num(spec.get("radius",max(size)/SCALE/2),label+".radius"))*SCALE
        image=Image.new("RGBA",size); pix=image.load(); cx,cy=center[0]*SCALE,center[1]*SCALE
        for y in range(size[1]):
            for x in range(size[0]): pix[x,y]=_lerp(inner,outer,min(1.0,math.hypot(x-cx,y-cy)/radius))
    elif kind=="wood":
        image=_gradient(size,_color(spec.get("light","#C08A55"),label+".light"),_color(spec.get("dark","#5A311E"),label+".dark"),True); grain=Image.new("RGBA",size,(0,0,0,0)); gd=ImageDraw.Draw(grain); rng=random.Random(seed); axis=spec.get("grainAxis","x")
        for _ in range(int(_num(spec.get("grainLines",46),label+".grainLines"))):
            tone=_color(spec.get("grainColor","#2B160F45"),label+".grainColor")
            if axis=="x":
                y=rng.randrange(size[1]); x0=rng.randrange(max(1,size[0]//4)); x1=rng.randrange(max(x0+1,size[0]//2),size[0]+1); gd.line((x0,y,x1,y+rng.randint(-2,2)*SCALE),fill=tone,width=max(1,SCALE//2))
            else:
                x=rng.randrange(size[0]); y0=rng.randrange(max(1,size[1]//4)); y1=rng.randrange(max(y0+1,size[1]//2),size[1]+1); gd.line((x,y0,x+rng.randint(-2,2)*SCALE,y1),fill=tone,width=max(1,SCALE//2))
        image=Image.alpha_composite(image,grain.filter(ImageFilter.GaussianBlur(0.3*SCALE)))
    elif kind=="painted_metal":
        image=_gradient(size,_color(spec.get("highlight","#C8D0D4"),label+".highlight"),_color(spec.get("base","#68737B"),label+".base"),True); noise=_noise_field(size,seed,9); tint=ImageOps.colorize(noise,"#000000","#FFFFFF").convert("RGBA"); tint.putalpha(mask.point(lambda v: round(v*0.07))); image=Image.alpha_composite(image,tint)
    elif kind=="stone":
        image=_gradient(size,_color(spec.get("light","#A89F90"),label+".light"),_color(spec.get("dark","#5B544A"),label+".dark"),True); n=ImageOps.autocontrast(_noise_field(size,seed,10)); flecks=n.point(lambda v: 46 if v>150 else 0); layer=Image.new("RGBA",size,(39,34,30,0)); layer.putalpha(ImageChops.multiply(flecks,mask)); image=Image.alpha_composite(image,layer)
    else:
        image=_gradient(size,_color(spec.get("light","#D9BC7A"),label+".light"),_color(spec.get("dark","#79582E"),label+".dark"),False); stripe=Image.new("RGBA",size,(0,0,0,0)); sd=ImageDraw.Draw(stripe); spacing=max(4,int(_num(spec.get("twistSpacing",5),label+".twistSpacing")*SCALE))
        for x in range(-size[1],size[0]+size[1],spacing): sd.line((x,0,x+size[1],size[1]),fill=(74,49,25,66),width=max(1,SCALE//2))
        image=Image.alpha_composite(image,stripe)
    alpha=ImageChops.multiply(image.getchannel("A"),mask)
    if opacity!=1: alpha=alpha.point(lambda v: round(v*opacity))
    image.putalpha(alpha); return image


def _effects(base, mask, effects: dict | None, label: str, light: dict) -> Image.Image:
    effects=effects or {}
    if not isinstance(effects,dict): raise ValueError(f"{label}.effects must be an object")
    if any(k not in {"shadow","outline","highlight","bevel","ambientOcclusion"} for k in effects): raise ValueError(f"{label}.effects contains unsupported keys")
    out=Image.new("RGBA",base.size)
    shadow=effects.get("shadow")
    if shadow:
        dx,dy=_pair(shadow.get("offset",light.get("shadowOffset",[3,4])),label+".shadow.offset"); blur=_num(shadow.get("blur",3),label+".shadow.blur"); color=_color(shadow.get("color","#11151A88"),label+".shadow.color"); shifted=shift_mask(mask,round(dx*SCALE),round(dy*SCALE)).filter(ImageFilter.GaussianBlur(max(0,blur*SCALE))); layer=Image.new("RGBA",base.size,color); layer.putalpha(ImageChops.multiply(layer.getchannel("A"),shifted)); out.alpha_composite(layer)
    outline=effects.get("outline")
    if outline:
        width=max(1,int(_num(outline.get("width",1),label+".outline.width")*SCALE)); color=_color(outline.get("color","#30261FFF"),label+".outline.color"); expanded=mask.filter(ImageFilter.MaxFilter(width*2+1)); ring=ImageChops.subtract(expanded,mask); layer=Image.new("RGBA",base.size,color); layer.putalpha(ImageChops.multiply(layer.getchannel("A"),ring)); out.alpha_composite(layer)
    out.alpha_composite(base)
    surface_alpha = out.getchannel("A")
    ao=effects.get("ambientOcclusion")
    if ao:
        width=max(1,int(_num(ao.get("width",3),label+".ambientOcclusion.width")*SCALE)); strength=_num(ao.get("strength",0.28),label+".ambientOcclusion.strength"); k=width*2+1; inner=mask.filter(ImageFilter.MinFilter(k)); ring=ImageChops.subtract(mask,inner).filter(ImageFilter.GaussianBlur(0.5*SCALE)); layer=Image.new("RGBA",base.size,(20,16,13,0)); layer.putalpha(ring.point(lambda v: round(v*strength))); out.alpha_composite(layer)
    bevel=effects.get("bevel")
    if bevel:
        width=max(1,int(_num(bevel.get("width",1.5),label+".bevel.width")*SCALE)); strength=_num(bevel.get("strength",0.32),label+".bevel.strength"); dx,dy=_pair(light.get("direction",[-1,-1]),"lighting.direction"); lit=ImageChops.subtract(mask,shift_mask(mask,round(dx*width),round(dy*width))); layer=Image.new("RGBA",base.size,(255,240,208,0)); layer.putalpha(lit.point(lambda v: round(v*strength))); out.alpha_composite(layer); shade=ImageChops.subtract(mask,shift_mask(mask,-round(dx*width),-round(dy*width))); layer2=Image.new("RGBA",base.size,(37,24,18,0)); layer2.putalpha(shade.point(lambda v: round(v*strength*0.85))); out.alpha_composite(layer2)
    highlight=effects.get("highlight")
    if highlight:
        width=max(1,int(_num(highlight.get("width",1),label+".highlight.width")*SCALE)); color=_color(highlight.get("color","#FFFFFF55"),label+".highlight.color"); edge=ImageChops.subtract(mask,shift_mask(mask,-width,-width)); layer=Image.new("RGBA",base.size,color); layer.putalpha(ImageChops.multiply(layer.getchannel("A"),edge)); out.alpha_composite(layer)
    out.putalpha(surface_alpha)
    return out


def validate_recipe(recipe: dict) -> None:
    if not isinstance(recipe,dict) or recipe.get("contract")!=CONTRACT: raise ValueError(f"scene recipe must declare {CONTRACT}")
    canvas=recipe.get("canvas")
    if not isinstance(canvas,list) or len(canvas)!=2 or any(type(v) is not int or v<=0 or v>1024 for v in canvas): raise ValueError("canvas must be two positive integers <=1024")
    anchor=recipe.get("anchor")
    if not isinstance(anchor,list) or len(anchor)!=2 or any(not isinstance(v,(int,float)) for v in anchor): raise ValueError("anchor must be [x,y]")
    if not (0<=anchor[0]<=canvas[0] and 0<=anchor[1]<=canvas[1]): raise ValueError("anchor must lie within canvas")
    if not isinstance(recipe.get("layers"),list) or not recipe["layers"]: raise ValueError("layers must be a non-empty list")
    symbols=recipe.get("symbols",{})
    if not isinstance(symbols,dict) or any(not isinstance(k,str) or not isinstance(v,list) for k,v in symbols.items()): raise ValueError("symbols must map names to node lists")
    if len(recipe["layers"])+sum(len(v) for v in symbols.values())>_MAX_NODES: raise ValueError("scene recipe exceeds node budget")
    lighting=recipe.get("lighting",{})
    if not isinstance(lighting,dict): raise ValueError("lighting must be an object")
    _pair(lighting.get("direction",[-1,-1]),"lighting.direction")


def _render_nodes(work,nodes,symbols,parent,rng,light,depth=0,prefix="layers"):
    if depth>_MAX_DEPTH: raise ValueError("scene graph exceeds maximum depth")
    for i,node in enumerate(nodes):
        label=f"{prefix}[{i}]"
        if not isinstance(node,dict): raise ValueError(f"{label} must be an object")
        transform=_combine(parent,_validate_transform(node.get("transform"),label+".transform")); kind=node.get("type","shape")
        if kind=="group":
            children=node.get("children")
            if not isinstance(children,list): raise ValueError(f"{label}.children must be a list")
            _render_nodes(work,children,symbols,transform,rng,light,depth+1,label+".children")
        elif kind=="symbol":
            name=node.get("symbol")
            if name not in symbols: raise ValueError(f"{label} references unknown symbol {name!r}")
            _render_nodes(work,deepcopy(symbols[name]),symbols,transform,rng,light,depth+1,f"symbol:{name}")
        elif kind=="scatter":
            name=node.get("symbol"); count=node.get("count")
            if name not in symbols: raise ValueError(f"{label} references unknown symbol {name!r}")
            if type(count) is not int or not 1<=count<=256: raise ValueError(f"{label}.count must be 1..256")
            spread=_pair(node.get("spread",[0,0]),label+".spread"); r0,r1=_pair(node.get("rotationRange",[0,0]),label+".rotationRange"); s0,s1=_pair(node.get("scaleRange",[1,1]),label+".scaleRange")
            if r0>r1 or s0<=0 or s0>s1: raise ValueError(f"{label} has invalid scatter ranges")
            for n in range(count):
                local={"translate":[rng.uniform(-spread[0],spread[0]),rng.uniform(-spread[1],spread[1])],"scale":[rng.uniform(s0,s1)]*2,"rotateDeg":rng.uniform(r0,r1)}; _render_nodes(work,deepcopy(symbols[name]),symbols,_combine(transform,local),rng,light,depth+1,f"{label}.item{n}")
        elif kind=="shape":
            mask=_shape_mask(work.size,node,transform,label)
            if mask.getbbox() is None: continue
            material=_material(work.size,mask,node.get("material"),label+".material",rng.randrange(1<<30)); work.alpha_composite(_effects(material,mask,node.get("effects"),label,light))
        else: raise ValueError(f"{label}.type must be shape, group, symbol or scatter")


def render_scene(recipe: dict) -> tuple[Image.Image,dict]:
    validate_recipe(recipe); canvas=tuple(recipe["canvas"]); work=Image.new("RGBA",(canvas[0]*SCALE,canvas[1]*SCALE)); seed=recipe.get("seed",0)
    if type(seed) is not int or seed<0: raise ValueError("seed must be a nonnegative integer")
    rng=random.Random(seed); light=recipe.get("lighting",{}); _render_nodes(work,recipe["layers"],recipe.get("symbols",{}),{"translate":[0,0],"scale":[1,1],"rotateDeg":0},rng,light); frame=alpha_safe_resize(work,canvas); bounds=frame.getchannel("A").getbbox()
    if bounds is None: raise ValueError("scene recipe rendered fully transparent")
    meta={"contract":CONTRACT,"id":recipe["id"],"canvas":list(canvas),"anchor":recipe["anchor"],"bounds":list(bounds),"seed":seed,"lighting":light,"artApproved":False,"runtimePromotion":False}
    if isinstance(recipe.get("camera"),dict): meta["camera"]=recipe["camera"]
    return frame,meta


def export(recipe_path: Path, output_dir: Path) -> dict:
    raw=recipe_path.read_bytes(); recipe=json.loads(raw); frame,metadata=render_scene(recipe); output_dir.mkdir(parents=True,exist_ok=True); stem=recipe["id"]; png=output_dir/f"{stem}.png"; meta=output_dir/f"{stem}.json"; review=output_dir/f"{stem}_review.png"; iso=output_dir/f"{stem}_isometric_review.png"; frame.save(png,format="PNG",optimize=False); meta.write_text(json.dumps(metadata,indent=2)+"\n",encoding="utf-8")
    w,h=frame.size; panel=Image.new("RGBA",(w*3+48,h*2+40),(66,86,59,255)); panel.alpha_composite(frame,(16,20+h//2)); panel.alpha_composite(frame.resize((w*2,h*2),Image.Resampling.NEAREST),(w+32,20)); d=ImageDraw.Draw(panel); d.text((16,4),"1x gameplay",fill=(245,245,230,255)); d.text((w+32,4),"2x inspection",fill=(245,245,230,255)); panel.save(review,format="PNG",optimize=False)
    iso_panel=Image.new("RGBA",(max(320,w+96),max(220,h+96)),(82,119,65,255)); cx,cy=iso_panel.size[0]//2,iso_panel.size[1]-46; d=ImageDraw.Draw(iso_panel); d.polygon([(cx,cy-32),(cx+64,cy),(cx,cy+32),(cx-64,cy)],fill=(100,145,78,255),outline=(63,97,52,255)); iso_panel.alpha_composite(frame,(cx-recipe["anchor"][0],cy-recipe["anchor"][1])); iso_panel.save(iso,format="PNG",optimize=False); metadata["recipeSha256"]=hashlib.sha256(raw).hexdigest(); meta.write_text(json.dumps(metadata,indent=2)+"\n",encoding="utf-8"); return {"png":str(png),"metadata":str(meta),"review":str(review),"isometricReview":str(iso)}

"""Parametric street/decor prop grammars for Visitor Forge 2D.

Creates benches, bollards, planters and litter bins directly as bounded
CH_2D_SCENE_RECIPE_V4 scenes so the high-level Prop Author can expand beyond
boats/piers/signs without adding one-off renderers.
"""
from __future__ import annotations

from .prop_grammar import GRAMMAR_CONTRACT, SCENE_CONTRACT


def _camera() -> dict:
    return {"contract":"CH_CAMERA_V1","tile":[128,64],"yawDeg":45,"elevationDeg":30,
            "projection":"orthographic_dimetric"}


def _base(asset_id: str, seed: int, canvas=(192,192), anchor=(96,174)) -> dict:
    return {"contract":SCENE_CONTRACT,"id":asset_id,"canvas":list(canvas),"anchor":list(anchor),"seed":seed,
            "camera":_camera(),"lighting":{"direction":[-1,-1],"shadowOffset":[3,5]},
            "finish":{"edgeBreakupPx":0.36,"surfaceVariation":0.04,"brushStamps":14,"brushOpacity":0.055},
            "validation":{"minimumOpaqueHeightPx":54,"maximumOpaqueHeightPx":176},
            "symbols":{},"layers":[],"finishRegions":[]}


def build_bench_recipe(asset_id: str, seed: int, *, material: str="wood", backrest: bool=True,
                       armrests: bool=True, length: str="medium") -> dict:
    if material not in ("wood","metal"):
        raise ValueError("bench material must be wood or metal")
    if type(backrest) is not bool or type(armrests) is not bool:
        raise ValueError("backrest and armrests must be true or false")
    if length not in ("short","medium","long"):
        raise ValueError("bench length must be short, medium or long")
    r=_base(asset_id,seed)
    half={"short":34,"medium":43,"long":52}[length]
    x0,x1=96-half,96+half
    wood={"type":"wood","light":"#C88C55","dark":"#704128","grainAngleDeg":0,"grainSpacing":4.0,"grainColor":"#3B211542"}
    metal={"type":"painted_metal","base":"#515C63","highlight":"#B7C0C4","brushAngleDeg":-18}
    seat_mat=wood if material=="wood" else metal
    leg_mat=metal
    L=r["layers"]
    L.append({"type":"shape","primitive":"ellipse","box":[x0-10,145,x1+10,177],"material":{"type":"solid","color":"#1119233A"},"role":"ground_shadow"})
    for x in (x0+10,x1-10):
        L.append({"type":"shape","primitive":"rounded_rect","box":[x-3,115,x+3,164],"radius":1.5,"material":leg_mat,
                  "effects":{"bevel":{"width":0.7,"strength":0.25},"outline":{"width":0.3,"color":"#283038A8"}},"role":"leg"})
    L.append({"type":"shape","primitive":"rounded_rect","box":[x0,107,x1,122],"radius":3,"material":seat_mat,
              "effects":{"ambientOcclusion":{"width":1.8,"strength":0.20},"bevel":{"width":1.0,"strength":0.3},"outline":{"width":0.36,"color":"#38251AB0"}},"role":"seat"})
    if backrest:
        L.append({"type":"shape","primitive":"rounded_rect","box":[x0+2,78,x1-2,103],"radius":3,"material":seat_mat,
                  "effects":{"shadow":{"offset":[2,4],"blur":2,"color":"#10151B55"},"bevel":{"width":1.0,"strength":0.3},"outline":{"width":0.36,"color":"#38251AB0"}},"role":"backrest"})
    if armrests:
        for x in (x0+4,x1-4):
            L.append({"type":"shape","primitive":"line","points":[[x,103],[x,126]],"width":2.5,"material":leg_mat,"role":"armrest"})
            L.append({"type":"shape","primitive":"line","points":[[x,103],[x+8 if x<96 else x-8,103]],"width":2.5,"material":leg_mat,"role":"armrest"})
    mask={"primitive":"rounded_rect","box":[x0,78 if backrest else 107,x1,122],"radius":3}
    if material=="wood":
        r["finishRegions"]=[{"style":"wood_wear","mask":mask,"stamps":24,"opacity":0.08,"angleDeg":0},
                            {"style":"edge_wear","mask":mask,"stamps":18,"opacity":0.08,"angleDeg":0}]
    else:
        r["finishRegions"]=[{"style":"paint_chips","mask":mask,"stamps":14,"opacity":0.07,"angleDeg":0}]
    r["propGrammar"]={"contract":GRAMMAR_CONTRACT,"archetype":"bench","parameters":{"material":material,"backrest":backrest,"armrests":armrests,"length":length}}
    return r


def build_bollard_recipe(asset_id: str, seed: int, *, material: str="metal", cap: str="round") -> dict:
    if material not in ("metal","stone"):
        raise ValueError("bollard material must be metal or stone")
    if cap not in ("round","flat"):
        raise ValueError("bollard cap must be round or flat")
    r=_base(asset_id,seed)
    mat={"type":"painted_metal","base":"#59636A","highlight":"#C2C9CC"} if material=="metal" else {"type":"stone","light":"#B9B2A2","dark":"#5E5A53","grain":0.35}
    r["layers"]=[{"type":"shape","primitive":"ellipse","box":[70,153,122,178],"material":{"type":"solid","color":"#11192338"},"role":"ground_shadow"},
                 {"type":"shape","primitive":"rounded_rect","box":[86,86,106,166],"radius":4,"material":mat,
                  "effects":{"ambientOcclusion":{"width":1.8,"strength":0.2},"bevel":{"width":1.0,"strength":0.32},"outline":{"width":0.35,"color":"#33383AA0"}},"role":"body"}]
    if cap=="round":
        r["layers"].append({"type":"shape","primitive":"ellipse","box":[84,80,108,94],"material":mat,"effects":{"bevel":{"width":0.8,"strength":0.28}},"role":"cap"})
    else:
        r["layers"].append({"type":"shape","primitive":"rounded_rect","box":[84,81,108,92],"radius":2,"material":mat,"role":"cap"})
    style="paint_chips" if material=="metal" else "grime"
    r["finishRegions"]=[{"style":style,"mask":{"primitive":"rounded_rect","box":[86,86,106,166],"radius":4},"stamps":12,"opacity":0.07,"angleDeg":0}]
    r["propGrammar"]={"contract":GRAMMAR_CONTRACT,"archetype":"bollard","parameters":{"material":material,"cap":cap}}
    return r


def build_planter_recipe(asset_id: str, seed: int, *, material: str="stone", shape: str="round") -> dict:
    if material not in ("stone","metal","wood"):
        raise ValueError("planter material must be stone, metal or wood")
    if shape not in ("round","square"):
        raise ValueError("planter shape must be round or square")
    r=_base(asset_id,seed)
    mats={"stone":{"type":"stone","light":"#B5AA95","dark":"#655E53","grain":0.35},
          "metal":{"type":"painted_metal","base":"#5F6A70","highlight":"#C1C8CA"},
          "wood":{"type":"wood","light":"#B97847","dark":"#5A321F","grainAngleDeg":90,"grainSpacing":4.2}}
    prim="ellipse" if shape=="round" else "rounded_rect"
    body={"type":"shape","primitive":prim,"box":[59,119,133,164],"material":mats[material],
          "effects":{"ambientOcclusion":{"width":2.0,"strength":0.22},"bevel":{"width":1.0,"strength":0.28},"outline":{"width":0.36,"color":"#332D27A8"}},"role":"container"}
    if prim=="rounded_rect": body["radius"]=5
    r["layers"]=[{"type":"shape","primitive":"ellipse","box":[52,150,140,178],"material":{"type":"solid","color":"#11192338"},"role":"ground_shadow"},body,
                 {"type":"shape","primitive":"ellipse","box":[66,113,126,135],"material":{"type":"solid","color":"#33261C"},"role":"soil"},
                 {"type":"shape","primitive":"ellipse","box":[72,99,96,128],"material":{"type":"radial_gradient","inner":"#7CC565","outer":"#2F6F3C","center":[84,111],"radius":18},"role":"foliage"},
                 {"type":"shape","primitive":"ellipse","box":[93,96,119,128],"material":{"type":"radial_gradient","inner":"#8BD36B","outer":"#326E3D","center":[106,109],"radius":18},"role":"foliage"}]
    r["finishRegions"]=[{"style":"grime","mask":{"primitive":prim,"box":[59,119,133,164],**({"radius":5} if prim=="rounded_rect" else {})},"stamps":12,"opacity":0.06,"angleDeg":0}]
    r["propGrammar"]={"contract":GRAMMAR_CONTRACT,"archetype":"planter","parameters":{"material":material,"shape":shape}}
    return r


def build_trash_bin_recipe(asset_id: str, seed: int, *, material: str="metal", lid: bool=True) -> dict:
    if material not in ("metal","wood"):
        raise ValueError("trash bin material must be metal or wood")
    if type(lid) is not bool:
        raise ValueError("lid must be true or false")
    r=_base(asset_id,seed)
    mat={"type":"painted_metal","base":"#46545A","highlight":"#AEB9BD"} if material=="metal" else {"type":"wood","light":"#A96C40","dark":"#4D2A1C","grainAngleDeg":90,"grainSpacing":4.2}
    r["layers"]=[{"type":"shape","primitive":"ellipse","box":[59,151,137,178],"material":{"type":"solid","color":"#11192338"},"role":"ground_shadow"},
                 {"type":"shape","primitive":"rounded_rect","box":[70,99,122,166],"radius":6,"material":mat,
                  "effects":{"ambientOcclusion":{"width":2.2,"strength":0.22},"bevel":{"width":1.0,"strength":0.3},"outline":{"width":0.36,"color":"#2D3133A8"}},"role":"body"},
                 {"type":"shape","primitive":"rounded_rect","box":[78,112,114,130],"radius":4,"material":{"type":"solid","color":"#20282BC8"},"role":"opening"}]
    if lid:
        r["layers"].append({"type":"shape","primitive":"rounded_rect","box":[67,91,125,105],"radius":4,"material":mat,"effects":{"bevel":{"width":0.8,"strength":0.28}},"role":"lid"})
    style="paint_chips" if material=="metal" else "wood_wear"
    r["finishRegions"]=[{"style":style,"mask":{"primitive":"rounded_rect","box":[70,99,122,166],"radius":6},"stamps":16,"opacity":0.07,"angleDeg":0}]
    r["propGrammar"]={"contract":GRAMMAR_CONTRACT,"archetype":"trash_bin","parameters":{"material":material,"lid":lid}}
    return r

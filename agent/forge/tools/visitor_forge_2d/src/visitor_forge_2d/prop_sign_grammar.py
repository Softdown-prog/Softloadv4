"""Parametric sign grammar for Visitor Forge 2D.

Builds review-gated CH_2D_SCENE_RECIPE_V4 wayfinding/decorative signs from
semantic parameters instead of hand-authored coordinates.  This intentionally
shares the same materials, finish passes and CH_CAMERA_V1 contract as boats and
piers so signs remain part of the generic Forge rather than a one-off renderer.
"""
from __future__ import annotations

from .prop_grammar import GRAMMAR_CONTRACT, SCENE_CONTRACT


def _bool(value: object, label: str) -> bool:
    if type(value) is not bool:
        raise ValueError(f"{label} must be true or false")
    return value


def build_sign_recipe(
    asset_id: str,
    seed: int,
    *,
    material: str = "wood",
    board_shape: str = "rounded",
    posts: int = 1,
    arrow: str = "right",
    cap: bool = True,
) -> dict:
    if material not in ("wood", "metal"):
        raise ValueError("sign material must be wood or metal")
    if board_shape not in ("rect", "rounded", "arrow"):
        raise ValueError("boardShape must be rect, rounded or arrow")
    if type(posts) is not int or posts not in (1, 2):
        raise ValueError("posts must be 1 or 2")
    if arrow not in ("none", "left", "right"):
        raise ValueError("arrow must be none, left or right")
    cap = _bool(cap, "cap")

    canvas = [192, 192]
    anchor = [96, 174]
    board_box = [48, 55, 144, 91]
    board_points = None
    if board_shape == "arrow":
        if arrow == "left":
            board_points = [[42,73],[58,55],[145,55],[145,91],[58,91]]
        else:
            board_points = [[47,55],[133,55],[150,73],[133,91],[47,91]]

    if material == "wood":
        board_material = {"type":"wood","light":"#C58A53","dark":"#6A3D24","grainAngleDeg":0,
                          "grainSpacing":4.2,"grainColor":"#3B211542"}
        post_material = {"type":"wood","light":"#A96E43","dark":"#4F2C1D","grainAngleDeg":90,
                         "grainSpacing":4.0,"grainColor":"#29160F46"}
        finish_regions = [{"style":"wood_wear","mask":{"primitive":"rounded_rect","box":board_box,"radius":7},
                           "stamps":28,"opacity":0.09,"angleDeg":0},
                          {"style":"edge_wear","mask":{"primitive":"rounded_rect","box":board_box,"radius":7},
                           "stamps":20,"opacity":0.09,"angleDeg":0}]
    else:
        board_material = {"type":"painted_metal","base":"#66747B","highlight":"#C7D0D3","brushAngleDeg":-22}
        post_material = {"type":"painted_metal","base":"#566168","highlight":"#B9C2C6","brushAngleDeg":-18}
        finish_regions = [{"style":"paint_chips","mask":{"primitive":"rounded_rect","box":board_box,"radius":7},
                           "stamps":18,"opacity":0.08,"angleDeg":0},
                          {"style":"rust_bloom","mask":{"primitive":"rounded_rect","box":board_box,"radius":7},
                           "stamps":8,"opacity":0.055,"angleDeg":0}]

    board_node = {
        "type":"shape",
        "primitive":"polygon" if board_points else ("rounded_rect" if board_shape == "rounded" else "rect"),
        "material":board_material,
        "effects":{"shadow":{"offset":[3,5],"blur":2.4,"color":"#10151B78"},
                   "ambientOcclusion":{"width":1.8,"strength":0.18},
                   "bevel":{"width":1.0,"strength":0.30},
                   "outline":{"width":0.42,"color":"#302219B8"}},
        "role":"sign_board",
    }
    if board_points:
        board_node["points"] = board_points
    else:
        board_node["box"] = board_box
        if board_shape == "rounded":
            board_node["radius"] = 7

    layers = [
        {"type":"shape","primitive":"ellipse","box":[57,157,137,181],
         "material":{"type":"solid","color":"#1119233E"},"role":"ground_shadow"},
    ]
    post_xs = [96] if posts == 1 else [77,115]
    for x in post_xs:
        layers.append({"type":"shape","primitive":"rounded_rect","box":[x-4,84,x+4,169],"radius":2,
                       "material":post_material,
                       "effects":{"ambientOcclusion":{"width":1.5,"strength":0.20},
                                  "bevel":{"width":0.8,"strength":0.27},
                                  "outline":{"width":0.35,"color":"#31231AB0"}},
                       "role":"sign_post"})
        if cap:
            layers.append({"type":"shape","primitive":"ellipse","box":[x-5,80,x+5,89],
                           "material":post_material,
                           "effects":{"bevel":{"width":0.7,"strength":0.24}},"role":"post_cap"})
    layers.append(board_node)

    if arrow != "none" and board_shape != "arrow":
        if arrow == "right":
            pts = [[78,68],[111,68],[111,62],[127,73],[111,84],[111,78],[78,78]]
        else:
            pts = [[114,68],[81,68],[81,62],[65,73],[81,84],[81,78],[114,78]]
        layers.append({"type":"shape","primitive":"polygon","points":pts,
                       "material":{"type":"solid","color":"#F1E4C8E8"},
                       "effects":{"outline":{"width":0.25,"color":"#33271FA0"}},"role":"direction_icon"})

    if board_points:
        # Finish masks follow the actual arrow-board silhouette.
        for region in finish_regions:
            region["mask"] = {"primitive":"polygon","points":board_points}

    return {
        "contract":SCENE_CONTRACT,
        "id":asset_id,
        "canvas":canvas,
        "anchor":anchor,
        "seed":seed,
        "camera":{"contract":"CH_CAMERA_V1","tile":[128,64],"yawDeg":45,"elevationDeg":30,
                  "projection":"orthographic_dimetric"},
        "lighting":{"direction":[-1,-1],"shadowOffset":[3,5]},
        "finish":{"edgeBreakupPx":0.34,"surfaceVariation":0.035,"brushStamps":12,"brushOpacity":0.05},
        "validation":{"minimumOpaqueHeightPx":82,"maximumOpaqueHeightPx":176},
        "symbols":{},
        "layers":layers,
        "finishRegions":finish_regions,
        "propGrammar":{"contract":GRAMMAR_CONTRACT,"archetype":"sign",
                       "parameters":{"material":material,"boardShape":board_shape,"posts":posts,
                                     "arrow":arrow,"cap":cap}},
    }

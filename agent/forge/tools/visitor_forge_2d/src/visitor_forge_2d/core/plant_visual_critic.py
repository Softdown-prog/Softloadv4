"""A7 Plant Visual Critic V1 and deterministic repair helpers.

The critic is intentionally semantic rather than a generic image aesthetic score.
It reads the plant recipe's crown field and wood geometry, compares those intents
with the rendered pixels, and produces auditable metrics.  The repair stage only
changes existing graph parameters and never changes the canonical plant seed or
topology.
"""
from __future__ import annotations

import copy
from collections import deque

from PIL import Image, ImageChops

from .field_engine import radial_density
from .geometry_engine import draw_tapered_paths

PLANT_VISUAL_CRITIC_CONTRACT = "A7_PLANT_VISUAL_CRITIC_V1"
PLANT_REPAIR_CONTRACT = "A7_PLANT_REPAIR_LOOP_V1"


def _node(recipe: dict, node_id: str) -> dict | None:
    for node in recipe.get("graph", {}).get("nodes", []):
        if node.get("id") == node_id:
            return node
    return None


def _mask_count(mask: Image.Image, threshold: int = 1) -> int:
    return sum(1 for value in mask.convert("L").getdata() if value >= threshold)


def _wood_mask(recipe: dict) -> Image.Image:
    canvas = Image.new("RGBA", tuple(recipe["canvas"]), (0, 0, 0, 0))
    node = _node(recipe, "wood_structure")
    if node is None:
        return Image.new("L", tuple(recipe["canvas"]), 0)
    draw_tapered_paths(canvas, node.get("params", {}).get("paths", []), supersample=4)
    return canvas.getchannel("A")


def _crown_field(recipe: dict) -> Image.Image:
    node = _node(recipe, "crown_density")
    if node is None:
        return Image.new("L", tuple(recipe["canvas"]), 0)
    params = node.get("params", {})
    return radial_density(recipe["canvas"], params.get("lobes", []), power=float(params.get("power", 1.5)))


def _brown_mask(frame: Image.Image) -> Image.Image:
    rgba = frame.convert("RGBA")
    out = Image.new("L", rgba.size, 0)
    src = rgba.load(); dst = out.load()
    for y in range(rgba.height):
        for x in range(rgba.width):
            r, g, b, a = src[x, y]
            if a < 20:
                continue
            # Warm wood family.  This intentionally ignores dark green/gold crown
            # pixels while tolerating the relief/material variations used by V2.
            if r >= 52 and r > g * 1.08 and g > b * 1.08 and (r - b) >= 24 and g < r * 0.78 and b > g * 0.30:
                dst[x, y] = a
    return out


def _threshold(mask: Image.Image, value: int) -> Image.Image:
    return mask.convert("L").point(lambda px: 255 if px >= value else 0)


def _connected_components(mask: Image.Image, *, min_area: int = 8) -> list[int]:
    binary = _threshold(mask, 1)
    width, height = binary.size
    px = binary.load()
    visited = bytearray(width * height)
    areas: list[int] = []
    for y in range(height):
        for x in range(width):
            idx = y * width + x
            if visited[idx] or px[x, y] == 0:
                continue
            q = deque([(x, y)])
            visited[idx] = 1
            area = 0
            while q:
                cx, cy = q.popleft(); area += 1
                for nx, ny in ((cx - 1, cy), (cx + 1, cy), (cx, cy - 1), (cx, cy + 1)):
                    if nx < 0 or ny < 0 or nx >= width or ny >= height:
                        continue
                    nidx = ny * width + nx
                    if visited[nidx] or px[nx, ny] == 0:
                        continue
                    visited[nidx] = 1
                    q.append((nx, ny))
            if area >= min_area:
                areas.append(area)
    areas.sort(reverse=True)
    return areas


def _silhouette_balance(mask: Image.Image, center_x: float) -> tuple[float, int, int]:
    binary = _threshold(mask, 1)
    px = binary.load()
    split = int(round(center_x))
    left = right = 0
    for y in range(binary.height):
        for x in range(binary.width):
            if px[x, y] == 0:
                continue
            if x < split:
                left += 1
            else:
                right += 1
    total = left + right
    imbalance = abs(left - right) / total if total else 1.0
    return imbalance, left, right


def _crown_center(recipe: dict) -> float:
    node = _node(recipe, "crown_density")
    lobes = node.get("params", {}).get("lobes", []) if node else []
    centers = [float(lobe.get("center", [recipe["canvas"][0] / 2, 0])[0]) for lobe in lobes]
    return sum(centers) / len(centers) if centers else recipe["canvas"][0] / 2


def evaluate_plant_render(recipe: dict, frame: Image.Image) -> dict:
    """Return semantic visual metrics for one rendered plant view."""
    if frame.mode != "RGBA":
        frame = frame.convert("RGBA")
    if frame.size != tuple(recipe["canvas"]):
        raise ValueError("critic frame size must match recipe canvas")

    alpha = _threshold(frame.getchannel("A"), 18)
    crown_field = _crown_field(recipe)
    crown_zone = _threshold(crown_field, 42)
    crown_alpha = ImageChops.multiply(alpha, crown_zone)

    wood_geom = _threshold(_wood_mask(recipe), 8)
    brown = _threshold(_brown_mask(frame), 20)
    visible_wood = ImageChops.multiply(wood_geom, brown)
    crown_wood_geom = ImageChops.multiply(wood_geom, crown_zone)
    crown_visible_wood = ImageChops.multiply(visible_wood, crown_zone)

    # Crown continuity is evaluated on non-wood crown pixels so branches cannot
    # falsely connect otherwise isolated foliage masses.
    non_wood = ImageChops.subtract(crown_alpha, visible_wood)
    components = _connected_components(non_wood, min_area=12)
    crown_pixels = sum(components)
    continuity = (components[0] / crown_pixels) if crown_pixels else 0.0
    isolated = max(0, len([area for area in components[1:] if area >= 22]))

    zone_pixels = _mask_count(crown_zone)
    crown_fill = crown_pixels / zone_pixels if zone_pixels else 0.0
    wood_total = _mask_count(crown_wood_geom)
    wood_visible = _mask_count(crown_visible_wood)
    crown_wood_exposure = wood_visible / wood_total if wood_total else 0.0

    imbalance, left, right = _silhouette_balance(non_wood, _crown_center(recipe))
    bbox = alpha.getbbox()
    if bbox is None:
        clipping_margin = 0
        bounds = [0, 0, 0, 0]
    else:
        left_b, top_b, right_b, bottom_b = bbox
        clipping_margin = min(left_b, top_b, frame.width - right_b, frame.height - bottom_b)
        bounds = [left_b, top_b, right_b, bottom_b]

    gates = {
        "continuity": continuity >= 0.78,
        "crownFill": 0.32 <= crown_fill <= 0.82,
        "isolatedMasses": isolated <= 4,
        "crownWoodExposure": crown_wood_exposure <= 0.70,
        "silhouetteBalance": imbalance <= 0.42,
        "clipping": clipping_margin >= 4,
    }

    penalties = 0.0
    penalties += max(0.0, 0.78 - continuity) / 0.78 * 24.0
    if crown_fill < 0.32:
        penalties += min(20.0, (0.32 - crown_fill) / 0.32 * 20.0)
    elif crown_fill > 0.82:
        penalties += min(16.0, (crown_fill - 0.82) / 0.18 * 16.0)
    penalties += min(16.0, isolated * 3.2)
    penalties += max(0.0, crown_wood_exposure - 0.70) / 0.30 * 14.0
    penalties += max(0.0, imbalance - 0.42) / 0.58 * 10.0
    penalties += max(0.0, 4 - clipping_margin) / 4.0 * 16.0
    score = round(max(0.0, min(100.0, 100.0 - penalties)), 2)

    return {
        "contract": PLANT_VISUAL_CRITIC_CONTRACT,
        "score": score,
        "passed": all(gates.values()),
        "metrics": {
            "crownContinuity": round(continuity, 4),
            "crownFill": round(crown_fill, 4),
            "isolatedMasses": isolated,
            "crownWoodExposure": round(crown_wood_exposure, 4),
            "silhouetteImbalance": round(imbalance, 4),
            "leftCrownPixels": left,
            "rightCrownPixels": right,
            "clippingMarginPx": int(clipping_margin),
            "opaqueBounds": bounds,
        },
        "gates": gates,
    }


def aggregate_critic_reports(reports: dict[str, dict]) -> dict:
    if not reports:
        raise ValueError("critic aggregation requires at least one view")
    values = list(reports.values())
    metrics = [report["metrics"] for report in values]
    aggregate = {
        "score": round(sum(report["score"] for report in values) / len(values), 2),
        "passed": all(report["passed"] for report in values),
        "worstScore": min(report["score"] for report in values),
        "failedViews": [view for view, report in reports.items() if not report["passed"]],
        "failedGatesByView": {view: [gate for gate, passed in report["gates"].items() if not passed]
                              for view, report in reports.items()},
        "meanContinuity": round(sum(item["crownContinuity"] for item in metrics) / len(metrics), 4),
        "meanCrownFill": round(sum(item["crownFill"] for item in metrics) / len(metrics), 4),
        "maxIsolatedMasses": max(item["isolatedMasses"] for item in metrics),
        "meanCrownWoodExposure": round(sum(item["crownWoodExposure"] for item in metrics) / len(metrics), 4),
        "maxSilhouetteImbalance": round(max(item["silhouetteImbalance"] for item in metrics), 4),
        "minClippingMarginPx": min(item["clippingMarginPx"] for item in metrics),
    }
    return aggregate


def propose_repair(aggregate: dict) -> dict:
    """Translate critic failures into one cross-view deterministic repair plan."""
    plan = {
        "contract": PLANT_REPAIR_CONTRACT,
        "crownRadiusScale": 1.0,
        "foliageCountScale": 1.0,
        "frontCountScale": 1.0,
        "flowerCountScale": 1.0,
        "brushScale": 1.0,
        "minDistanceScale": 1.0,
        "terminalWoodAlphaScale": 1.0,
        "boundsInsetPx": 0,
        "reasons": [],
    }
    continuity = float(aggregate.get("meanContinuity", 1.0))
    fill = float(aggregate.get("meanCrownFill", 0.5))
    isolated = int(aggregate.get("maxIsolatedMasses", 0))
    wood = float(aggregate.get("meanCrownWoodExposure", 0.0))
    clipping = int(aggregate.get("minClippingMarginPx", 99))

    if continuity < 0.78 or fill < 0.32 or isolated > 4:
        plan["crownRadiusScale"] = 1.06
        plan["foliageCountScale"] = 1.16
        plan["frontCountScale"] = 1.20
        plan["flowerCountScale"] = 1.10
        plan["brushScale"] = 1.07
        plan["minDistanceScale"] = 0.90
        plan["reasons"].append("close_sparse_or_fragmented_crown")
    elif fill > 0.82:
        # Preserve the authored crown zone: shrinking the measurement field
        # can increase reported fill even when the painted masses get smaller.
        plan["crownRadiusScale"] = 1.0
        plan["flowerCountScale"] = 0.92
        plan["foliageCountScale"] = 0.92
        plan["frontCountScale"] = 0.92
        plan["brushScale"] = 0.95
        plan["minDistanceScale"] = 1.08
        plan["reasons"].append("open_overfilled_crown")

    if wood > 0.70:
        plan["terminalWoodAlphaScale"] = 0.76
        plan["frontCountScale"] = max(plan["frontCountScale"], 1.12)
        plan["flowerCountScale"] = max(plan["flowerCountScale"], 1.08)
        plan["reasons"].append("reduce_exposed_terminal_wood")

    if clipping < 4:
        plan["brushScale"] = min(plan["brushScale"], 0.92)
        plan["boundsInsetPx"] = 5
        plan["reasons"].append("restore_canvas_safety_margin")

    plan["changed"] = bool(plan["reasons"])
    return plan


def _scale_pair(value, factor: float):
    if not isinstance(value, list) or len(value) != 2:
        return value
    return [round(float(value[0]) * factor, 4), round(float(value[1]) * factor, 4)]


def _scale_hex_alpha(color: str, factor: float) -> str:
    text = str(color)
    if not text.startswith("#") or len(text) != 9:
        return text
    alpha = int(text[7:9], 16)
    alpha = max(0, min(255, round(alpha * factor)))
    return text[:7] + f"{alpha:02X}"


def apply_repair_plan(recipe: dict, plan: dict) -> dict:
    """Apply one shared repair plan without changing seed/topology/branch points."""
    out = copy.deepcopy(recipe)
    if not plan.get("changed"):
        out.setdefault("planner", {})["repair"] = copy.deepcopy(plan)
        return out

    crown_scale = float(plan.get("crownRadiusScale", 1.0))
    foliage_scale = float(plan.get("foliageCountScale", 1.0))
    front_scale = float(plan.get("frontCountScale", 1.0))
    flower_scale = float(plan.get("flowerCountScale", 1.0))
    brush_scale = float(plan.get("brushScale", 1.0))
    distance_scale = float(plan.get("minDistanceScale", 1.0))
    wood_alpha_scale = float(plan.get("terminalWoodAlphaScale", 1.0))
    inset = int(plan.get("boundsInsetPx", 0))

    for node in out.get("graph", {}).get("nodes", []):
        node_id = node.get("id")
        params = node.get("params", {})
        if node_id in {"crown_density", "flower_density"}:
            for lobe in params.get("lobes", []):
                if isinstance(lobe.get("radius"), list):
                    lobe["radius"] = _scale_pair(lobe["radius"], crown_scale)

        if node_id == "rear_foliage":
            params["count"] = max(1, round(int(params.get("count", 0)) * foliage_scale))
        elif node_id == "front_foliage":
            params["count"] = max(1, round(int(params.get("count", 0)) * front_scale))
        elif node_id == "detail_foliage":
            params["count"] = max(1, round(int(params.get("count", 0)) * ((foliage_scale + front_scale) * 0.5)))
        elif node_id == "flower_clusters":
            params["count"] = max(1, round(int(params.get("count", 0)) * flower_scale))

        if node_id in {"rear_foliage", "front_foliage", "detail_foliage"}:
            if "scale" in params:
                params["scale"] = _scale_pair(params["scale"], brush_scale)
            if "minDistance" in params:
                params["minDistance"] = round(float(params["minDistance"]) * distance_scale, 4)
        if node.get("type") == "field_flower_clusters":
            if "radiusX" in params:
                params["radiusX"] = _scale_pair(params["radiusX"], brush_scale)
            if "radiusY" in params:
                params["radiusY"] = _scale_pair(params["radiusY"], brush_scale)
            if "minDistance" in params and node_id not in {"rear_foliage", "front_foliage", "detail_foliage"}:
                params["minDistance"] = round(float(params["minDistance"]) * distance_scale, 4)

        if inset > 0 and isinstance(params.get("bounds"), list) and len(params["bounds"]) == 4:
            left, top, right, bottom = map(int, params["bounds"])
            params["bounds"] = [left + inset, top + inset, max(left + inset + 1, right - inset), max(top + inset + 1, bottom - inset)]

        if node_id in {"wood_structure", "wood_visible"} and wood_alpha_scale < 0.999:
            for path in params.get("paths", []):
                if float(path.get("exposure", 1.0)) <= 0.72:
                    path["fill"] = _scale_hex_alpha(path.get("fill", "#795337FF"), wood_alpha_scale)
                    if "outline" in path:
                        path["outline"] = _scale_hex_alpha(path["outline"], wood_alpha_scale)

    out.setdefault("planner", {})["repair"] = copy.deepcopy(plan)
    return out

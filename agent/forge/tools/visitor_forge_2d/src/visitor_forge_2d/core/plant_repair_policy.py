"""Cross-gate repair policy for A7 Plant Visual Critic V1.

The base critic proposes independent fixes. This policy resolves conflicts
between them before the shared four-view repair is applied. Structural clipping
is repaired by uniformly scaling the projected graph around the same anchor in
all four views; canonical 3D seed/topology remains untouched.

V1.1 also handles a failure mode that an aggregate mean can hide: one cardinal
view may have a broken crown while the other three are strong. In that case we
close *internal* gaps with small midpoint crown lobes and tighter foliage
spacing, without expanding the authored outer silhouette or changing flowers.
"""
from __future__ import annotations

import math

from .plant_visual_critic import (
    apply_repair_plan as _base_apply_repair_plan,
    propose_repair as _base_propose_repair,
)

PLANT_REPAIR_POLICY_REVISION = "A7_PLANT_REPAIR_POLICY_INTERNAL_BRIDGE_V1"


def evaluate_repair_selection(baseline: dict, repaired: dict) -> dict:
    """Accept a gain only when no cardinal view or previously passing gate regresses."""
    from .plant_structure import CARDINAL_VIEWS

    if set(baseline) != set(CARDINAL_VIEWS) or set(repaired) != set(CARDINAL_VIEWS):
        raise ValueError("repair comparison requires the same four cardinal views")
    reasons = []
    before_scores, after_scores = [], []
    before_failures = after_failures = 0
    for view in CARDINAL_VIEWS:
        old, new = baseline[view], repaired[view]
        old_score, new_score = float(old["score"]), float(new["score"])
        if not all(math.isfinite(score) and 0 <= score <= 100 for score in (old_score, new_score)):
            raise ValueError("repair comparison scores must be finite within 0..100")
        if set(old["gates"]) != set(new["gates"]):
            raise ValueError("repair comparison gate sets must match")
        before_scores.append(old_score)
        after_scores.append(new_score)
        before_failures += sum(not passed for passed in old["gates"].values())
        after_failures += sum(not passed for passed in new["gates"].values())
        if new_score < old_score - 0.05:
            reasons.append(f"{view}:score_regression")
        for gate, passed in old["gates"].items():
            if passed and not new["gates"][gate]:
                reasons.append(f"{view}:new_failure:{gate}")
    before_mean = sum(before_scores) / 4
    after_mean = sum(after_scores) / 4
    improved = (after_mean > before_mean + 0.05 or
                (after_failures < before_failures and after_mean >= before_mean - 0.05))
    if not improved:
        reasons.append("no_measurable_gain")
    return {
        "accepted": not reasons,
        "reasons": reasons,
        "baselineMeanScore": round(before_mean, 2),
        "repairedMeanScore": round(after_mean, 2),
        "baselineWorstScore": min(before_scores),
        "repairedWorstScore": min(after_scores),
        "baselineFailedGates": before_failures,
        "repairedFailedGates": after_failures,
    }


def _single_view_fragmentation(aggregate: dict) -> bool:
    """Detect a likely hidden bad view without treating a healthy open crown as sparse.

    `passed == False` matters here: with a healthy mean continuity but one failed
    view, the old mean-only policy produced no repair at all.  Fill/clipping
    guards keep this path from solving other failures by blindly adding foliage.
    """
    return (
        not bool(aggregate.get("passed", True))
        and 0.78 <= float(aggregate.get("meanContinuity", 1.0)) < 0.94
        and 0.32 <= float(aggregate.get("meanCrownFill", 0.5)) <= 0.82
        and int(aggregate.get("maxIsolatedMasses", 0)) <= 4
        and float(aggregate.get("meanCrownWoodExposure", 0.0)) <= 0.70
        and int(aggregate.get("minClippingMarginPx", 99)) >= 4
    )


def propose_repair(aggregate: dict) -> dict:
    plan = _base_propose_repair(aggregate)
    clipping = int(aggregate.get("minClippingMarginPx", 99))
    fragmented = (
        float(aggregate.get("meanContinuity", 1.0)) < 0.78
        or float(aggregate.get("meanCrownFill", 0.5)) < 0.32
        or int(aggregate.get("maxIsolatedMasses", 0)) > 4
    )
    plan.setdefault("projectionScale", 1.0)
    plan.setdefault("bridgeCrownLobes", False)

    # A single bad view can be hidden by the four-view mean. Do not enlarge the
    # crown here: add density *inside* the current convex envelope instead.
    if _single_view_fragmentation(aggregate):
        plan["crownRadiusScale"] = 1.0
        plan["brushScale"] = min(float(plan.get("brushScale", 1.0)), 1.0)
        plan["foliageCountScale"] = max(float(plan.get("foliageCountScale", 1.0)), 1.10)
        plan["frontCountScale"] = max(float(plan.get("frontCountScale", 1.0)), 1.14)
        plan["flowerCountScale"] = min(float(plan.get("flowerCountScale", 1.0)), 1.0)
        plan["minDistanceScale"] = min(float(plan.get("minDistanceScale", 1.0)), 0.88)
        plan["bridgeCrownLobes"] = True
        if "close_internal_crown_gaps" not in plan["reasons"]:
            plan["reasons"].append("close_internal_crown_gaps")
        plan["changed"] = True

    if clipping < 4:
        # Clipping can come from projected wood itself, not only brush stamps.
        # Pull the whole projected recipe inward while keeping density high.
        plan["projectionScale"] = 0.95
        plan["crownRadiusScale"] = min(float(plan.get("crownRadiusScale", 1.0)), 1.0)
        plan["brushScale"] = min(float(plan.get("brushScale", 1.0)), 0.96)
        plan["boundsInsetPx"] = max(int(plan.get("boundsInsetPx", 0)), 5)
        if fragmented:
            plan["minDistanceScale"] = min(float(plan.get("minDistanceScale", 1.0)), 0.88)
            plan["foliageCountScale"] = max(float(plan.get("foliageCountScale", 1.0)), 1.16)
            plan["frontCountScale"] = max(float(plan.get("frontCountScale", 1.0)), 1.20)
        if "uniform_projection_fit" not in plan["reasons"]:
            plan["reasons"].append("uniform_projection_fit")
        plan["changed"] = True

    return plan


def _scale_point(point, anchor, factor: float):
    if not isinstance(point, list) or len(point) != 2:
        return point
    ax, ay = float(anchor[0]), float(anchor[1])
    return [
        round(ax + (float(point[0]) - ax) * factor, 4),
        round(ay + (float(point[1]) - ay) * factor, 4),
    ]


def _scale_pair(value, factor: float):
    if not isinstance(value, list) or len(value) != 2:
        return value
    return [round(float(value[0]) * factor, 4), round(float(value[1]) * factor, 4)]


def _add_internal_crown_bridges(recipe: dict) -> int:
    """Add conservative midpoint lobes between nearby terminal crown lobes.

    The Art Planner emits terminal lobes first and a broad center-support lobe
    last. Midpoints of terminal pairs lie inside their envelope, and the bridge
    radii are deliberately smaller than the endpoint radii, so this increases
    valley density without growing a new outer silhouette.
    """
    planner = recipe.get("planner", {})
    terminal_count = max(0, int(planner.get("terminalCount", 0)))
    if terminal_count < 2:
        return 0

    crown = next(
        (node for node in recipe.get("graph", {}).get("nodes", []) if node.get("id") == "crown_density"),
        None,
    )
    if crown is None:
        return 0
    lobes = crown.get("params", {}).get("lobes", [])
    terminal_lobes = lobes[: min(terminal_count, len(lobes))]
    if len(terminal_lobes) < 2:
        return 0

    candidates: list[tuple[float, int, int]] = []
    for i, a in enumerate(terminal_lobes):
        ac = a.get("center", [])
        if not isinstance(ac, list) or len(ac) != 2:
            continue
        for j in range(i + 1, len(terminal_lobes)):
            b = terminal_lobes[j]
            bc = b.get("center", [])
            if not isinstance(bc, list) or len(bc) != 2:
                continue
            distance = math.hypot(float(ac[0]) - float(bc[0]), float(ac[1]) - float(bc[1]))
            # Tiny gaps already overlap; very distant pairs would create a plate.
            if 30.0 <= distance <= 78.0:
                candidates.append((distance, i, j))
    candidates.sort(key=lambda item: (item[0], item[1], item[2]))

    max_bridges = max(2, min(6, terminal_count // 3))
    degree = [0] * len(terminal_lobes)
    bridges: list[dict] = []
    for distance, i, j in candidates:
        if degree[i] >= 1 or degree[j] >= 1:
            continue
        a, b = terminal_lobes[i], terminal_lobes[j]
        ac, bc = a["center"], b["center"]
        ar, br = a.get("radius", [28, 22]), b.get("radius", [28, 22])
        if not isinstance(ar, list) or len(ar) != 2 or not isinstance(br, list) or len(br) != 2:
            continue
        # A slightly stronger bridge for a wider gap, still well below endpoint size.
        gap_mix = max(0.0, min(1.0, (distance - 30.0) / 48.0))
        rx_factor = 0.50 + 0.06 * gap_mix
        ry_factor = 0.54 + 0.06 * gap_mix
        bridges.append({
            "center": [round((float(ac[0]) + float(bc[0])) * 0.5, 2), round((float(ac[1]) + float(bc[1])) * 0.5, 2)],
            "radius": [round(min(float(ar[0]), float(br[0])) * rx_factor, 2), round(min(float(ar[1]), float(br[1])) * ry_factor, 2)],
            "weight": 0.70,
            "repairBridge": True,
        })
        degree[i] += 1
        degree[j] += 1
        if len(bridges) >= max_bridges:
            break

    lobes.extend(bridges)
    return len(bridges)


def apply_repair_plan(recipe: dict, plan: dict) -> dict:
    """Apply visual repair plus optional internal bridges/projected fit.

    These transforms never change canonical branch IDs/seed/topology. They only
    change visual density or the 2D projection already compiled into Graph V2.
    """
    out = _base_apply_repair_plan(recipe, plan)

    bridge_count = 0
    if bool(plan.get("bridgeCrownLobes", False)):
        bridge_count = _add_internal_crown_bridges(out)
    repair_meta = out.setdefault("planner", {}).setdefault("repair", {})
    repair_meta["crownBridgeCount"] = bridge_count

    factor = float(plan.get("projectionScale", 1.0))
    if abs(factor - 1.0) <= 1e-6:
        return out

    anchor = out.get("anchor", [out["canvas"][0] / 2, out["canvas"][1]])
    for node in out.get("graph", {}).get("nodes", []):
        node_id = node.get("id")
        node_type = node.get("type")
        params = node.get("params", {})

        if node_id in {"wood_structure", "wood_visible", "root_structure", "root_visible"}:
            for path in params.get("paths", []):
                path["points"] = [_scale_point(point, anchor, factor) for point in path.get("points", [])]
                if "widthStart" in path:
                    path["widthStart"] = round(float(path["widthStart"]) * factor, 4)
                if "widthEnd" in path:
                    path["widthEnd"] = round(float(path["widthEnd"]) * factor, 4)
                if "widths" in path and isinstance(path["widths"], list):
                    path["widths"] = [round(float(value) * factor, 4) for value in path["widths"]]
                if "outlineWidth" in path:
                    path["outlineWidth"] = round(float(path["outlineWidth"]) * factor, 4)

        if node_id in {"crown_density", "flower_density"}:
            for lobe in params.get("lobes", []):
                lobe["center"] = _scale_point(lobe.get("center"), anchor, factor)
                if "radius" in lobe:
                    lobe["radius"] = _scale_pair(lobe["radius"], factor)

        if node_type == "field_linear_depth":
            if "start" in params:
                params["start"] = _scale_point(params["start"], anchor, factor)
            if "end" in params:
                params["end"] = _scale_point(params["end"], anchor, factor)
        elif node_type == "field_direction_to_point" and "point" in params:
            params["point"] = _scale_point(params["point"], anchor, factor)

        if node_type in {"field_mapped_scatter", "field_cluster_scatter", "field_flower_clusters"}:
            for key in ("scale", "radiusX", "radiusY"):
                if key in params:
                    params[key] = _scale_pair(params[key], factor)
            if "minDistance" in params:
                params["minDistance"] = round(float(params["minDistance"]) * factor, 4)

        if isinstance(params.get("bounds"), list) and len(params["bounds"]) == 4:
            left, top, right, bottom = params["bounds"]
            p0 = _scale_point([left, top], anchor, factor)
            p1 = _scale_point([right, bottom], anchor, factor)
            params["bounds"] = [
                int(round(min(p0[0], p1[0]))),
                int(round(min(p0[1], p1[1]))),
                int(round(max(p0[0], p1[0]))),
                int(round(max(p0[1], p1[1]))),
            ]

    repair_meta["projectionScale"] = factor
    return out

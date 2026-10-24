"""Worker that compiles one semantic plant intent into four coherent Graph V2 views."""
from __future__ import annotations

import hashlib
import json
from pathlib import Path

from PIL import Image, ImageDraw

from .core import field_graph
from .core.art_planner import ART_PLANNER_CONTRACT, PLANT_INTENT_CONTRACT, plan_plant_four_views
from .core.branch_geometry_v2 import BRANCH_GEOMETRY_CONTRACT, upgrade_plant_wood_recipe
from .core.plant_repair_policy import apply_repair_plan, propose_repair, evaluate_repair_selection
from .core.plant_structure import CARDINAL_VIEWS, PLANT_STRUCTURE_CONTRACT, topology_signature
from .core.plant_visual_critic import (
    PLANT_REPAIR_CONTRACT,
    PLANT_VISUAL_CRITIC_CONTRACT,
    aggregate_critic_reports,
    evaluate_plant_render,
)

WORKER_CONTRACT = "A7_PLANT_PLANNER_WORKER_V1"


def _sha(image: Image.Image) -> str:
    return hashlib.sha256(image.tobytes()).hexdigest()


def _structure_payload(structure) -> dict:
    return {
        "contract": structure.contract,
        "seed": structure.seed,
        "profile": structure.profile,
        "topology": [
            {
                "id": branch.branch_id,
                "parentId": branch.parent_id,
                "order": branch.order,
                "widthStart": branch.width_start,
                "widthEnd": branch.width_end,
                "terminal": branch.terminal,
                "flowerBearing": branch.flower_bearing,
                "exposure": branch.exposure,
                "points": [[point.x, point.y, point.z] for point in branch.points],
            }
            for branch in structure.branches
        ],
    }


def _four_view_board(frames: dict[str, Image.Image]) -> Image.Image:
    first = frames[CARDINAL_VIEWS[0]]
    margin = 18
    label_h = 22
    cell_w = first.width + margin * 2
    cell_h = first.height + margin * 2 + label_h
    board = Image.new("RGBA", (cell_w * 2, cell_h * 2), (20, 23, 25, 255))
    draw = ImageDraw.Draw(board)
    for index, view in enumerate(CARDINAL_VIEWS):
        col = index % 2
        row = index // 2
        ox = col * cell_w + margin
        oy = row * cell_h + margin + label_h
        preview = frames[view]
        board.alpha_composite(preview, (ox, oy))
        draw.text((ox, row * cell_h + margin), view.upper(), fill=(235, 238, 240, 255))
    return board


def _render_recipe_set(recipes: dict[str, dict], expected_ids: list[str]) -> tuple[dict[str, Image.Image], dict[str, dict], dict[str, dict]]:
    frames: dict[str, Image.Image] = {}
    graph_reports: dict[str, dict] = {}
    visual_reports: dict[str, dict] = {}
    for view in CARDINAL_VIEWS:
        recipe = recipes[view]
        planner = recipe.get("planner", {})
        if planner.get("branchIds") != expected_ids:
            raise ValueError(f"{view} planner lost canonical branch identity")
        if planner.get("branchGeometryContract") != BRANCH_GEOMETRY_CONTRACT:
            raise ValueError(f"{view} planner lost Branch Geometry V2 contract")
        frame, metadata = field_graph.execute(recipe)
        if frame.getchannel("A").getbbox() is None:
            raise ValueError(f"{view} planner render is fully transparent")
        frames[view] = frame
        graph_reports[view] = metadata
        visual_reports[view] = evaluate_plant_render(recipe, frame)
    return frames, graph_reports, visual_reports


def run_plant_planner(intent_path: Path, output_root: Path) -> dict:
    raw = intent_path.read_bytes()
    intent = json.loads(raw)
    if intent.get("contract") != PLANT_INTENT_CONTRACT:
        raise ValueError(f"plant intent must declare {PLANT_INTENT_CONTRACT}")

    structure, planned_recipes = plan_plant_four_views(intent)
    baseline_recipes = {
        view: upgrade_plant_wood_recipe(planned_recipes[view], structure, view=view)
        for view in CARDINAL_VIEWS
    }
    output_root.mkdir(parents=True, exist_ok=True)
    structure_path = output_root / "canonical_structure.json"
    structure_path.write_text(json.dumps(_structure_payload(structure), indent=2) + "\n", encoding="utf-8")

    expected_topology = topology_signature(structure.branches)
    expected_ids = [entry[0] for entry in expected_topology]

    baseline_frames, baseline_graph, baseline_visual = _render_recipe_set(baseline_recipes, expected_ids)
    baseline_aggregate = aggregate_critic_reports(baseline_visual)
    repair_plan = propose_repair(baseline_aggregate)

    baseline_board_path = output_root / "plant_planner_baseline_four_views.png"
    _four_view_board(baseline_frames).save(baseline_board_path)

    repaired_attempted = bool(repair_plan.get("changed"))
    repaired_recipes: dict[str, dict] | None = None
    repaired_frames: dict[str, Image.Image] | None = None
    repaired_graph: dict[str, dict] | None = None
    repaired_visual: dict[str, dict] | None = None
    repaired_aggregate: dict | None = None
    repair_accepted = False
    repair_selection = None

    if repaired_attempted:
        repaired_recipes = {
            view: apply_repair_plan(baseline_recipes[view], repair_plan)
            for view in CARDINAL_VIEWS
        }
        repaired_frames, repaired_graph, repaired_visual = _render_recipe_set(repaired_recipes, expected_ids)
        repaired_aggregate = aggregate_critic_reports(repaired_visual)
        repaired_board_path = output_root / "plant_planner_repaired_four_views.png"
        _four_view_board(repaired_frames).save(repaired_board_path)
        repair_selection = evaluate_repair_selection(baseline_visual, repaired_visual)
        repair_accepted = repair_selection["accepted"]
    else:
        repaired_board_path = None

    if repair_accepted:
        selected_recipes = repaired_recipes
        selected_frames = repaired_frames
        selected_graph = repaired_graph
        selected_visual = repaired_visual
        selected_aggregate = repaired_aggregate
        selected_stage = "repaired"
    else:
        selected_recipes = baseline_recipes
        selected_frames = baseline_frames
        selected_graph = baseline_graph
        selected_visual = baseline_visual
        selected_aggregate = baseline_aggregate
        selected_stage = "baseline"

    assert selected_recipes is not None
    assert selected_frames is not None
    assert selected_graph is not None
    assert selected_visual is not None
    assert selected_aggregate is not None

    view_reports: dict[str, dict] = {}
    for view in CARDINAL_VIEWS:
        recipe = selected_recipes[view]
        frame = selected_frames[view]
        metadata = selected_graph[view]
        recipe_path = output_root / f"{recipe['id']}.json"
        recipe_path.write_text(json.dumps(recipe, indent=2) + "\n", encoding="utf-8")
        png_path = output_root / f"{recipe['id']}.png"
        frame.save(png_path)
        bounds = frame.getchannel("A").getbbox()
        view_reports[view] = {
            "recipe": str(recipe_path),
            "png": str(png_path),
            "pixelSha256": _sha(frame),
            "bounds": list(bounds) if bounds else None,
            "nodeCount": metadata.get("nodeCount"),
            "critic": metadata.get("critic", {}),
            "visualCritic": selected_visual[view],
            "planner": recipe.get("planner", {}),
        }

    if len({report["pixelSha256"] for report in view_reports.values()}) < 3:
        raise ValueError("cardinal projections collapsed into visually identical outputs")

    board = _four_view_board(selected_frames)
    board_path = output_root / "plant_planner_four_views.png"
    board.save(board_path)

    branch_counts = {
        str(order): sum(1 for branch in structure.branches if branch.order == order)
        for order in sorted({branch.order for branch in structure.branches})
    }
    report = {
        "contract": WORKER_CONTRACT,
        "plannerContract": ART_PLANNER_CONTRACT,
        "intentContract": PLANT_INTENT_CONTRACT,
        "structureContract": PLANT_STRUCTURE_CONTRACT,
        "branchGeometryContract": BRANCH_GEOMETRY_CONTRACT,
        "visualCriticContract": PLANT_VISUAL_CRITIC_CONTRACT,
        "repairLoopContract": PLANT_REPAIR_CONTRACT,
        "intent": str(intent_path),
        "intentSha256": hashlib.sha256(raw).hexdigest(),
        "structure": str(structure_path),
        "branchCount": len(structure.branches),
        "branchCountByOrder": branch_counts,
        "terminalCount": len(structure.terminal_points),
        "flowerBearingCount": len(structure.flower_bearing_points),
        "visibleWoodTarget": structure.profile.get("visibleWood"),
        "topologySignature": [list(entry) for entry in expected_topology],
        "visualCritic": {
            "baseline": baseline_aggregate,
            "repairPlan": repair_plan,
            "repaired": repaired_aggregate,
            "repairAttempted": repaired_attempted,
            "repairAccepted": repair_accepted,
            "selectionDecision": repair_selection,
            "selectedStage": selected_stage,
            "selected": selected_aggregate,
        },
        "views": view_reports,
        "baselineBoard": str(baseline_board_path),
        "repairedBoard": str(repaired_board_path) if repaired_board_path else None,
        "board": str(board_path),
        "status": "review_ready",
        "criticPassed": bool(selected_aggregate.get("passed")),
        "artApproved": False,
        "runtimePromotion": False,
    }
    report_path = output_root / "plant_planner_report.json"
    report_path.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    return {**report, "report": str(report_path)}

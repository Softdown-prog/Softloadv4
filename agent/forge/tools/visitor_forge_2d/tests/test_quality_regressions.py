import copy
import json
import subprocess
import sys
from pathlib import Path

import pytest
from PIL import Image, ImageDraw

from visitor_forge_2d.core.image_processing import local_contrast
from visitor_forge_2d.core.plant_repair_policy import evaluate_repair_selection
from visitor_forge_2d.core.plant_structure import CARDINAL_VIEWS
from visitor_forge_2d.graph_worker import run_graph_workers
from visitor_forge_2d.cli import build_parser


def _reports(scores=(80, 80, 80, 80)):
    return {view: {"score": score, "passed": True,
                   "gates": {"continuity": True, "clipping": True}}
            for view, score in zip(CARDINAL_VIEWS, scores)}


def test_repair_cannot_hide_one_worse_view_behind_a_better_average():
    before = _reports()
    after = _reports((100, 100, 100, 70))
    decision = evaluate_repair_selection(before, after)
    assert decision["repairedMeanScore"] > decision["baselineMeanScore"]
    assert not decision["accepted"]
    assert "east:score_regression" in decision["reasons"]


def test_repair_cannot_introduce_clipping_even_with_higher_scores():
    before, after = _reports(), _reports((90, 90, 90, 90))
    after["north"]["gates"]["clipping"] = False
    assert "north:new_failure:clipping" in evaluate_repair_selection(before, after)["reasons"]


def test_repair_accepts_real_improvement_or_resolved_gate_at_equal_score():
    before, after = _reports(), _reports((81, 81, 81, 81))
    assert evaluate_repair_selection(before, after)["accepted"]
    after = _reports()
    before["west"]["gates"]["continuity"] = False
    assert evaluate_repair_selection(before, after)["accepted"]
    assert not evaluate_repair_selection(after, after)["accepted"]


def test_repair_requires_complete_matching_views_and_finite_scores():
    before, after = _reports(), _reports()
    after.pop("east")
    with pytest.raises(ValueError, match="four cardinal"):
        evaluate_repair_selection(before, after)
    after = _reports((90, 90, 90, float("nan")))
    with pytest.raises(ValueError, match="finite"):
        evaluate_repair_selection(before, after)


def _colored_asset(hidden):
    image = Image.new("RGBA", (40, 40), (*hidden, 0))
    draw = ImageDraw.Draw(image)
    draw.rectangle((9, 9, 30, 30), fill=(90, 130, 70, 255))
    draw.rectangle((8, 9, 8, 30), fill=(90, 130, 70, 80))
    draw.rectangle((18, 12, 20, 26), fill=(115, 140, 85, 255))
    return image


@pytest.mark.parametrize("contrast", [1.0, 1.15])
def test_finishing_ignores_hidden_rgb_and_preserves_alpha(contrast):
    black = _colored_asset((0, 0, 0))
    magenta = _colored_asset((255, 0, 255))
    first = local_contrast(black, global_contrast=contrast)
    second = local_contrast(magenta, global_contrast=contrast)
    assert first.tobytes() == second.tobytes()
    assert first.getchannel("A").tobytes() == black.getchannel("A").tobytes()
    assert black.tobytes() != magenta.tobytes()  # genuinely different hidden source data
    assert first.getpixel((18, 16)) != black.getpixel((18, 16))  # still enhances interior detail


def test_local_contrast_does_not_create_a_halo_on_flat_opaque_edges():
    image = Image.new("RGBA", (32, 32))
    ImageDraw.Draw(image).rectangle((8, 8, 23, 23), fill=(90, 130, 70, 255))
    result = local_contrast(image)
    assert result.getpixel((8, 16)) == image.getpixel((8, 16))
    assert result.getchannel("A").tobytes() == image.getchannel("A").tobytes()


def _simple_graph():
    return {"contract": "CH_2D_GRAPH_RECIPE_V2", "id": "plain_shape", "canvas": [64, 64],
            "anchor": [32, 56], "camera": {"contract": "CH_CAMERA_V1", "tile": [128, 64], "yawDeg": 45, "elevationDeg": 30},
            "graph": {"nodes": [{"id": "base", "type": "canvas", "params": {"color": [90, 130, 70, 255]}},
                                {"id": "output", "type": "output", "inputs": {"image": "base"}}]}}


def test_generic_v2_graph_can_export_without_inventing_field_distribution(tmp_path):
    source = tmp_path / "shape.json"
    source.write_text(json.dumps(_simple_graph()))
    result = run_graph_workers(source, tmp_path / "output")
    assert result["status"] == "review_ready"
    assert result["audit"]["critic"]["fieldAwareDistribution"] is False
    assert not result["artApproved"] and not result["runtimePromotion"]
    process = subprocess.run([sys.executable, "-m", "visitor_forge_2d", "draw-graph", "--recipe", str(source),
                              "--output", str(tmp_path / "cli")], capture_output=True, text=True)
    assert process.returncode == 0, process.stderr
    assert json.loads(process.stdout)["recipeSha256"] == result["recipeSha256"]


def test_planner_and_graph_are_accessible_in_the_public_parser():
    assert build_parser().parse_args(["plan-plant", "--intent", "intent.json", "--output", "out"]).func.__name__ == "command_plan_plant"
    assert build_parser().parse_args(["draw-graph", "--recipe", "graph.json", "--output", "out"]).func.__name__ == "command_draw_graph"


def test_missing_authored_direction_fails_before_writing_partial_review(tmp_path):
    from argparse import Namespace
    from visitor_forge_2d.cli import command_review_concept_directions
    root = Path(__file__).resolve().parents[1]
    output = tmp_path / 'review'
    args = Namespace(tool_root=str(root), asset_root=str(tmp_path / 'parts'), output=str(output), background=None)
    with pytest.raises(ValueError, match='west_master'):
        command_review_concept_directions(args)
    assert not output.exists() and not (tmp_path / 'parts').exists()


def test_graph_validation_rejects_missing_ports_and_malformed_parameters():
    from visitor_forge_2d.core.field_graph import validate_recipe
    data = _simple_graph()
    data['graph']['nodes'].insert(1, {'id': 'broken', 'type': 'vector_path'})
    with pytest.raises(ValueError, match='inputs.image'):
        validate_recipe(data)
    data = _simple_graph()
    data['graph']['nodes'][0]['params'] = []
    with pytest.raises(ValueError, match='params must be an object'):
        validate_recipe(data)
    data = _simple_graph()
    data['graph']['nodes'][1]['inputs']['image'] = []
    with pytest.raises(ValueError, match='unavailable node'):
        validate_recipe(data)


def test_mapped_brush_spacing_applies_to_actual_centers_not_original_candidates():
    from visitor_forge_2d.core.field_brush_engine import FieldBrushEngineV1
    mappings = {axis: {'base': 32, 'inputs': {sensor: [[0, 0], [64, -64]]}}
                for axis, sensor in [('offset_x', 'x'), ('offset_y', 'y')]}
    stamps, stats = FieldBrushEngineV1(41).scatter(
        Image.new('RGBA', (64, 64)), ['foliage/leaf_oval_01.png'], 12,
        density_field=Image.new('L', (64, 64), 255), bounds=[8, 8, 56, 56],
        min_distance=8, mappings=mappings, max_attempts=80)
    assert len(stamps) == 1
    assert stats['requested'] == 12 and stats['saturated']
    assert stamps[0].x == pytest.approx(32) and stamps[0].y == pytest.approx(32)


@pytest.mark.parametrize('restriction', ['bounds', 'density', 'avoid'])
def test_mapped_brush_cannot_escape_authored_bounds_or_fields(restriction):
    from visitor_forge_2d.core.field_brush_engine import FieldBrushEngineV1
    density = Image.new('L', (64, 64), 255)
    avoid = Image.new('L', (64, 64), 0)
    if restriction == 'density':
        ImageDraw.Draw(density).rectangle((40, 0, 63, 63), fill=0)
    if restriction == 'avoid':
        ImageDraw.Draw(avoid).rectangle((40, 0, 63, 63), fill=255)
    canvas = Image.new('RGBA', (64, 64))
    stamps, stats = FieldBrushEngineV1(51).scatter(
        canvas, ['foliage/leaf_oval_01.png'], 5, density_field=density, avoid_field=avoid,
        bounds=[8, 8, 56, 56], mappings={'offset_x': {'base': 50 if restriction == 'bounds' else 35}},
        max_attempts=80)
    assert not stamps and stats['saturated']
    assert canvas.getchannel('A').getbbox() is None


def test_explicit_graph_seeds_preserve_pixels_when_nodes_are_inserted():
    import copy
    from visitor_forge_2d.core.field_graph import execute, freeze_node_seeds
    recipe={
        'contract':'CH_2D_GRAPH_RECIPE_V2','id':'seed_insertion_regression',
        'seed':91,'canvas':[64,64],'anchor':[32,60],
        'camera':{'contract':'CH_CAMERA_V1','projection':'orthographic_dimetric','tile':[128,64],'yawDeg':45,'elevationDeg':30},
        'graph':{'seed':91,'nodes':[
            {'id':'base','type':'canvas'},
            {'id':'density','type':'field_radial_density','params':{'lobes':[{'center':[32,32],'radius':[25,25],'weight':1}]}},
            {'id':'flowers','type':'field_flower_clusters','inputs':{'image':'base','density':'density'},'params':{'count':4,'bounds':[12,12,52,52],'radiusX':[5,7],'radiusY':[4,6],'seedOffset':17}},
            {'id':'out','type':'output','inputs':{'image':'flowers'}},
        ]}}
    before,_=execute(recipe)
    frozen=copy.deepcopy(recipe); freeze_node_seeds(frozen)
    same,_=execute(frozen)
    assert before.tobytes()==same.tobytes()
    frozen['graph']['nodes'].insert(1,{'id':'unrelated','type':'canvas'})
    after,_=execute(frozen)
    assert after.tobytes()==before.tobytes()
    frozen['graph']['nodes'][3]['seed']=True
    with pytest.raises(ValueError,match='seed must be an integer'):
        execute(frozen)

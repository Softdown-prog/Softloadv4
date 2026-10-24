import hashlib
import json
from pathlib import Path

from PIL import Image

from visitor_forge_2d.core.structured_broadleaf_scenery import render
from visitor_forge_2d.workers import run_workers, validate_recipe


def _recipe_path() -> Path:
    return Path(__file__).resolve().parents[1] / "examples" / "park_tree_green_canopy_01.json"


def test_structured_broadleaf_is_deterministic_and_not_single_blob() -> None:
    recipe = json.loads(_recipe_path().read_text(encoding="utf-8"))
    assert validate_recipe(recipe) == "structured_broadleaf"

    first, metadata = render(recipe, "south")
    second, repeated = render(recipe, "south")

    assert first.tobytes() == second.tobytes()
    assert metadata["bounds"] == repeated["bounds"]
    assert metadata["authoringMode"] == "crisp_clustered_depth_groups_v5"
    critic = metadata["critic"]
    assert critic["singleCanopyBlob"] is False
    assert critic["randomFinalGrain"] is False
    assert critic["detachedEdgeStamps"] is False
    assert critic["punchedGapCutters"] is False
    assert critic["foregroundBranchOverlay"] is False
    assert critic["opaqueLeafDetail"] is True
    assert critic["depthBands"] == 3
    assert critic["branchDerivedMassCount"] >= 10
    assert critic["macroMassCount"] >= 30
    assert critic["explicitLeafCount"] >= 180


def test_structured_broadleaf_four_views_are_distinct_and_rgba() -> None:
    recipe = json.loads(_recipe_path().read_text(encoding="utf-8"))
    hashes = set()
    for view in ("south", "west", "north", "east"):
        frame, metadata = render(recipe, view)
        assert frame.mode == "RGBA"
        assert list(frame.size) == recipe["canvas"]
        assert frame.getchannel("A").getbbox() == tuple(metadata["bounds"])
        hashes.add(hashlib.sha256(frame.tobytes()).hexdigest())
    assert len(hashes) == 4


def test_structured_broadleaf_worker_exports_review_and_critic(tmp_path: Path) -> None:
    result = run_workers(_recipe_path(), tmp_path)
    assert result["kind"] == "structured_broadleaf"
    assert result["status"] == "review_ready"
    critic = result["audit"]["critic"]
    assert critic["singleCanopyBlob"] is False
    assert critic["randomFinalGrain"] is False
    assert critic["detachedEdgeStamps"] is False
    assert critic["punchedGapCutters"] is False
    assert critic["foregroundBranchOverlay"] is False
    assert critic["opaqueLeafDetail"] is True

    with Image.open(result["png"]) as image:
        assert image.mode == "RGBA"
        assert list(image.size) == [256, 320]
    with Image.open(result["isometricReview"]) as review:
        assert review.size == (768, 480)

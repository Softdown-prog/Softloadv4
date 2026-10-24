"""Export wrapper for CH_2D_GRAPH_RECIPE_V1."""
from __future__ import annotations
import hashlib, json
from pathlib import Path
from . import node_graph
from . import organic_scenery as organic

CONTRACT = node_graph.GRAPH_CONTRACT

def render(recipe: dict):
    frame, metadata = node_graph.execute(recipe)
    bounds = frame.getchannel("A").getbbox()
    if bounds is None:
        raise ValueError("graph render is fully transparent")
    metadata = dict(metadata); metadata["bounds"] = list(bounds)
    return frame, metadata

def export(recipe_path: Path, output_dir: Path) -> dict:
    raw = recipe_path.read_bytes(); recipe = json.loads(raw)
    node_graph.validate_recipe(recipe); output_dir.mkdir(parents=True, exist_ok=True)
    frame, metadata = render(recipe); stem = recipe["id"]
    png = output_dir / f"{stem}.png"; frame.save(png)
    review = output_dir / f"{stem}_review.png"; iso = output_dir / f"{stem}_isometric_review.png"
    organic.review_board(frame).save(review)
    organic.isometric_board(frame, recipe["anchor"], "A7 Node Graph V1 / CH_CAMERA_V1").save(iso)
    report = output_dir / f"{stem}.json"
    metadata.update({"recipe": str(recipe_path), "recipeSha256": hashlib.sha256(raw).hexdigest(), "png": str(png), "review": str(review), "isometricReview": str(iso), "runtimePromotion": False, "artApproved": False})
    report.write_text(json.dumps(metadata, indent=2) + "\n", encoding="utf-8")
    return {"png": str(png), "review": str(review), "isometricReview": str(iso), "metadata": str(report)}

"""Production worker for A7 Node Graph V1 and field-aware V2 recipes."""
from __future__ import annotations
import hashlib, json
from pathlib import Path
from PIL import Image
from .core import field_graph, field_scenery, graph_scenery, node_graph


def run_graph_workers(recipe_path: Path, output_root: Path) -> dict:
    raw = recipe_path.read_bytes(); recipe = json.loads(raw)
    contract = recipe.get("contract")
    if contract == node_graph.GRAPH_CONTRACT:
        node_graph.validate_recipe(recipe)
        exporter = graph_scenery.export
        kind = "node_graph_v1"
    elif contract == field_graph.FIELD_GRAPH_CONTRACT:
        field_graph.validate_recipe(recipe)
        exporter = field_scenery.export
        kind = "node_graph_v2_fields"
    else:
        raise ValueError(f"unsupported graph recipe contract: {contract}")

    folder = output_root / recipe["id"]
    result = exporter(recipe_path, folder)
    with Image.open(result["png"]) as image:
        image.load()
        if image.mode != "RGBA" or list(image.size) != recipe["canvas"]:
            raise ValueError("graph export must be RGBA at authored canvas size")
        bounds = image.getchannel("A").getbbox()
    if bounds is None:
        raise ValueError("graph export cannot be fully transparent")
    metadata = json.loads(Path(result["metadata"]).read_text(encoding="utf-8"))
    if metadata.get("anchor") != recipe["anchor"]:
        raise ValueError("graph metadata anchor mismatch")
    if metadata.get("camera", {}).get("contract") != "CH_CAMERA_V1":
        raise ValueError("graph export lost CH_CAMERA_V1")
    critic = metadata.get("critic", {})
    if kind == "node_graph_v1" and critic.get("bitmapBrushTips") is not True:
        raise ValueError("V1 graph export did not use Brush Engine bitmap tips")
    if kind == "node_graph_v2_fields":
        expected_fields = any(node["type"] in {"field_mapped_scatter", "field_cluster_scatter", "field_flower_clusters"}
                              for node in recipe["graph"]["nodes"])
        if critic.get("fieldAwareDistribution") is not expected_fields:
            raise ValueError("V2 export field distribution metadata differs from the authored graph")

    report = {
        "status": "review_ready", "id": recipe["id"], "kind": kind,
        "workers": ["recipe", "node_graph", "draw_engine", "alpha_anchor", "camera_review", "provenance"],
        "recipe": str(recipe_path), "recipeSha256": hashlib.sha256(raw).hexdigest(),
        "png": result["png"], "review": result["review"], "isometricReview": result["isometricReview"],
        "pngSha256": hashlib.sha256(Path(result["png"]).read_bytes()).hexdigest(),
        "audit": {"bounds": list(bounds), "alpha": "RGBA", "critic": critic, "nodeCount": metadata.get("nodeCount"), "contract": metadata.get("contract")},
        "artApproved": False, "runtimePromotion": False,
    }
    report_path = folder / "worker_report.json"
    report_path.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    return {**report, "report": str(report_path)}

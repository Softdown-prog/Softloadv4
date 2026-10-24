"""Hash-locked request runner for Visitor Forge 2D workers.

A request pins one or more versioned recipe files by SHA-256 before invoking
the existing run_workers pipeline. This prevents a worker request from silently
rendering different recipe bytes than the request reviewed.
"""
from __future__ import annotations

import argparse
import hashlib
import hmac
import json
import re
from pathlib import Path

from .workers import run_workers

CONTRACT = "CH_2D_WORKER_REQUEST_V1"
_SAFE_ID = re.compile(r"[a-z0-9][a-z0-9_-]*\Z")
_SHA256 = re.compile(r"[0-9a-f]{64}\Z")


def _safe_recipe_path(raw: object) -> Path:
    if not isinstance(raw, str) or not raw:
        raise ValueError("worker request recipe path must be a non-empty string")
    path = Path(raw)
    if path.is_absolute() or ".." in path.parts:
        raise ValueError("worker request recipe path must stay inside the repository")
    if path.suffix.lower() != ".json":
        raise ValueError("worker request recipe path must point to a JSON recipe")
    return path


def run_request(request_path: Path, output_root: Path, repo_root: Path | None = None) -> dict:
    raw_request = request_path.read_bytes()
    request = json.loads(raw_request)
    if not isinstance(request, dict) or request.get("contract") != CONTRACT:
        raise ValueError(f"worker request requires {CONTRACT}")
    request_id = request.get("id")
    if not isinstance(request_id, str) or not _SAFE_ID.fullmatch(request_id):
        raise ValueError("worker request id must use lowercase letters, digits, _ or -")
    items = request.get("recipes")
    if not isinstance(items, list) or not items:
        raise ValueError("worker request recipes must be a non-empty list")

    root = (repo_root or Path.cwd()).resolve()
    results = []
    for index, item in enumerate(items):
        if not isinstance(item, dict) or set(item) != {"path", "sha256"}:
            raise ValueError(f"recipes[{index}] must contain only path and sha256")
        recipe_rel = _safe_recipe_path(item["path"])
        expected = item["sha256"]
        if not isinstance(expected, str) or not _SHA256.fullmatch(expected):
            raise ValueError(f"recipes[{index}].sha256 must be a lowercase SHA-256")

        recipe_path = (root / recipe_rel).resolve()
        try:
            recipe_path.relative_to(root)
        except ValueError as exc:
            raise ValueError("worker request recipe escaped repository root") from exc
        recipe_raw = recipe_path.read_bytes()
        actual = hashlib.sha256(recipe_raw).hexdigest()
        if not hmac.compare_digest(actual, expected):
            raise ValueError(
                f"recipe hash mismatch for {recipe_rel}: expected {expected}, got {actual}"
            )

        result = run_workers(recipe_path, output_root / request_id)
        if not hmac.compare_digest(result["recipeSha256"], expected):
            raise ValueError(f"worker provenance hash drifted for {recipe_rel}")
        results.append({
            "path": str(recipe_rel),
            "sha256": actual,
            "workerReport": result["report"],
            "png": result["png"],
            "review": result["review"],
            "isometricReview": result.get("isometricReview"),
        })

    report = {
        "status": "review_ready",
        "contract": CONTRACT,
        "id": request_id,
        "request": str(request_path),
        "requestSha256": hashlib.sha256(raw_request).hexdigest(),
        "recipeCount": len(results),
        "recipes": results,
        "artApproved": False,
        "runtimePromotion": False,
    }
    report_dir = output_root / request_id
    report_dir.mkdir(parents=True, exist_ok=True)
    report_path = report_dir / "worker_request_report.json"
    report_path.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    return {**report, "report": str(report_path)}


def main() -> int:
    parser = argparse.ArgumentParser(description="Run hash-locked Visitor Forge 2D worker request")
    parser.add_argument("--request", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--repo-root", default=".")
    args = parser.parse_args()
    result = run_request(Path(args.request), Path(args.output), Path(args.repo_root))
    print(json.dumps(result, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

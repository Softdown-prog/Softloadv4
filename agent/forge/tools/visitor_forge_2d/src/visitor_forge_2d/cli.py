from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path

from PIL import Image

from .character import (
    STYLE_CONTRACT,
    generate_v1_south_assets,
    validate_v1_character,
)
from .character.review import frame_measurements, gameplay_review, map_scale_review
from .character.concept_rig import build_concept_rig
from .character.gait_warp import render_directional_gait
from .character.preview_audit import audit_preview
from .core.shape_recipe import export_palette_family, export_shape_recipe
from .workers import run_workers
from .graph_worker import run_graph_workers
from .plant_planner_worker import run_plant_planner
from .art_author import CONTRACT as ART_BRIEF_CONTRACT, run_art_author
from .animation import package_animation
from .pixel_character import render_pixel_character
from .core import LayerComposer, alpha_safe_resize, export_frame, load_character_definition, load_pose


def _load_poses(paths: list[str]) -> list:
    return [load_pose(path) for path in paths]


def _part_manifest(generated: list[Path]) -> tuple[Path, dict]:
    manifest_path = generated[0].parent / "generated_parts.json"
    return manifest_path, json.loads(manifest_path.read_text(encoding="utf-8"))


def command_validate(args: argparse.Namespace) -> int:
    definition = load_character_definition(args.definition)
    poses = _load_poses(args.pose)
    validate_v1_character(definition, poses)
    summary = {
        "status": "ok",
        "characterId": definition.character_id,
        "direction": definition.direction,
        "workingSize": list(definition.canvas.working_size),
        "outputSize": list(definition.canvas.output_size),
        "anchor": definition.canvas.anchor.as_list(),
        "parts": [part.part_id for part in definition.parts],
        "poses": [pose.pose_id for pose in poses],
        "forgeContractVersion": definition.forge_contract_version,
    }
    print(json.dumps(summary, indent=2))
    return 0


def command_build_assets(args: argparse.Namespace) -> int:
    written = generate_v1_south_assets(args.asset_root, overwrite=getattr(args, "overwrite_parts", False))
    manifest_path, manifest = _part_manifest(written)
    summary = {
        "status": "ok",
        "styleContract": STYLE_CONTRACT,
        "assetRoot": str(Path(args.asset_root)),
        "outputs": [str(path) for path in written],
        "partManifest": str(manifest_path),
        "preservedParts": manifest["preservedOverrides"],
    }
    print(json.dumps(summary, indent=2))
    return 0


def command_build_concept_rig(args: argparse.Namespace) -> int:
    result = build_concept_rig(args.master, args.asset_root, args.definition_output,
                               direction=args.direction)
    print(json.dumps({"status": "ok", **result}, indent=2))
    return 0


def command_render_directional_gait(args: argparse.Namespace) -> int:
    result = render_directional_gait(Path(args.tool_root), Path(args.recipe),
                                     Path(args.output))
    print(json.dumps({"status": "ok", "output": args.output, **result}, indent=2))
    return 0


def command_audit_preview(args: argparse.Namespace) -> int:
    result = audit_preview(Path(args.manifest), Path(args.repo_root))
    print(json.dumps(result, indent=2))
    return 0 if result["status"] == "ok" else 1


def command_draw_recipe(args: argparse.Namespace) -> int:
    if args.all_variants:
        if not args.palette:
            raise ValueError("--all-variants requires --palette")
        result = export_palette_family(Path(args.recipe), Path(args.output), Path(args.palette))
    else:
        result = export_shape_recipe(Path(args.recipe), Path(args.output),
                                     palette_path=Path(args.palette) if args.palette else None,
                                     variant=args.variant, seed=args.seed)
    print(json.dumps({"status": "ok", **result}, indent=2))
    return 0


def command_run_workers(args: argparse.Namespace) -> int:
    result = run_workers(Path(args.recipe), Path(args.output))
    print(json.dumps(result, indent=2))
    return 0


def command_author_art(args: argparse.Namespace) -> int:
    if args.brief:
        brief = json.loads(Path(args.brief).read_text(encoding="utf-8"))
    else:
        brief = {"contract": ART_BRIEF_CONTRACT, "id": args.id, "prompt": args.prompt}
    result = run_art_author(brief, Path(args.output))
    print(json.dumps(result, indent=2, ensure_ascii=False))
    return 0


def command_pack_animation(args: argparse.Namespace) -> int:
    result = package_animation(Path(args.recipe), Path(args.output))
    print(json.dumps(result, indent=2, ensure_ascii=False))
    return 0


def command_render_pixel_character(args: argparse.Namespace) -> int:
    result = render_pixel_character(Path(args.recipe), Path(args.output))
    print(json.dumps(result, indent=2, ensure_ascii=False))
    return 0


def _compose_and_export(
    definition_path: str,
    pose_paths: list[str],
    asset_root: str,
    output: str,
    art_root: str | None = None,
) -> tuple[list[Image.Image], list[Path], list[str]]:
    definition = load_character_definition(definition_path)
    poses = _load_poses(pose_paths)
    validate_v1_character(definition, poses)

    composer = LayerComposer(asset_root, art_root=art_root)
    output_dir = Path(output)
    working_frames: list[Image.Image] = []
    produced: list[Path] = []
    authored_layers: set[str] = set()

    for pose in poses:
        image = composer.compose(definition, pose)
        authored_layers.update(composer.authored_layers)
        working_frames.append(image)
        png_path, json_path = export_frame(
            image, definition, pose, output_dir,
            source_parts=composer.source_provenance.copy(),
        )
        produced.extend([png_path, json_path])

    return working_frames, produced, sorted(authored_layers)


def command_render(args: argparse.Namespace) -> int:
    _, produced, authored_layers = _compose_and_export(
        args.definition,
        args.pose,
        args.asset_root,
        args.output,
        getattr(args, "art_root", None),
    )
    print(json.dumps({"status": "ok", "outputs": [str(path) for path in produced],
                      "authoredLayers": authored_layers}, indent=2))
    return 0


def _horizontal_sheet(images: list[Image.Image], *, gap: int = 12) -> Image.Image:
    if not images:
        raise ValueError("At least one image is required for a contact sheet")
    width = sum(image.width for image in images) + gap * (len(images) - 1)
    height = max(image.height for image in images)
    sheet = Image.new("RGBA", (width, height), (0, 0, 0, 0))
    cursor = 0
    for image in images:
        rgba = image.convert("RGBA")
        sheet.alpha_composite(rgba, (cursor, (height - rgba.height) // 2))
        cursor += rgba.width + gap
    return sheet


def command_prototype(args: argparse.Namespace) -> int:
    generated = generate_v1_south_assets(args.asset_root, overwrite=getattr(args, "overwrite_parts", False))
    manifest_path, manifest = _part_manifest(generated)
    working_frames, produced, authored_layers = _compose_and_export(
        args.definition,
        args.pose,
        args.asset_root,
        args.output,
        getattr(args, "art_root", None),
    )

    output_dir = Path(args.output)
    output_dir.mkdir(parents=True, exist_ok=True)

    review_frames = [alpha_safe_resize(frame, (256, 256)) for frame in working_frames]
    review_sheet = _horizontal_sheet(review_frames, gap=16)
    definition = load_character_definition(args.definition)
    strip_name = f"{definition.character_id}_{definition.direction}"
    review_path = output_dir / f"{strip_name}_review_strip.png"
    review_sheet.save(review_path, format="PNG", optimize=False)

    gameplay_frames: list[Image.Image] = []
    for pose_path in args.pose:
        pose = load_pose(pose_path)
        frame_path = output_dir / f"{definition.character_id}_{pose.pose_id}.png"
        with Image.open(frame_path) as frame:
            gameplay_frames.append(frame.convert("RGBA"))
    gameplay_sheet = _horizontal_sheet(gameplay_frames, gap=8)
    gameplay_path = output_dir / f"{strip_name}_gameplay_strip.png"
    gameplay_sheet.save(gameplay_path, format="PNG", optimize=False)

    background = None
    if getattr(args, "background", None):
        with Image.open(args.background) as terrain:
            background = terrain.convert("RGBA")
    in_world_path = output_dir / f"{strip_name}_in_world_review.png"
    gameplay_review(gameplay_frames, background).save(in_world_path, format="PNG", optimize=False)

    concept_review = None
    concept_source = None
    if getattr(args, "concept", None):
        idle_id = f"{definition.direction}_idle"
        idle_index = next((index for index, path in enumerate(args.pose)
                           if load_pose(path).pose_id == idle_id), None)
        if idle_index is None:
            raise ValueError(f"Concept comparison requires a {idle_id} pose")
        concept_path = Path(args.concept)
        with Image.open(concept_path) as source:
            source.load()
            if source.mode != "RGBA" or source.size != definition.canvas.output_size:
                raise ValueError("Concept must be an RGBA PNG at the definition's output size")
            concept = source.copy()
        if concept.getchannel("A").getbbox() is None:
            raise ValueError("Concept must contain a visible character")
        concept_review = output_dir / f"{strip_name}_concept_comparison.png"
        gameplay_review([gameplay_frames[idle_index], concept], background).save(
            concept_review, format="PNG", optimize=False,
        )
        concept_source = {
            "path": str(concept_path),
            "sha256": hashlib.sha256(concept_path.read_bytes()).hexdigest(),
            "bounds": list(concept.getchannel("A").getbbox()),
        }

    measurements = frame_measurements(
        gameplay_frames,
        (definition.canvas.anchor.x, definition.canvas.anchor.y),
    )
    metrics_path = output_dir / f"{strip_name}_review_metrics.json"
    metrics_path.write_text(json.dumps(measurements, indent=2) + "\n", encoding="utf-8")

    summary = {
        "status": "ok",
        "styleContract": (STYLE_CONTRACT if definition.forge_contract_version == "CH_VISITOR_FORGE_2D_V1"
                          else definition.forge_contract_version),
        "generatedParts": [str(path) for path in generated],
        "partManifest": str(manifest_path),
        "preservedParts": manifest["preservedOverrides"],
        "authoredLayers": authored_layers,
        "artRoot": getattr(args, "art_root", None),
        "outputs": [str(path) for path in produced],
        "reviewStrip": str(review_path),
        "gameplayStrip": str(gameplay_path),
        "inWorldReview": str(in_world_path),
        "reviewMeasurements": str(metrics_path),
        "conceptComparison": str(concept_review) if concept_review else None,
        "conceptSource": concept_source,
        "runtimePromotion": False,
        "nextGate": "visual review at gameplay scale before EAST/WEST/NORTH",
    }
    print(json.dumps(summary, indent=2))
    return 0


def command_review_concept_directions(args: argparse.Namespace) -> int:
    """Build and review four views of one fixed character without runtime promotion."""
    tool_root = Path(args.tool_root)
    asset_root = Path(args.asset_root)
    output = Path(args.output)
    direction_order = ("south", "east", "north", "west")
    sources = [tool_root / "art" / "concepts" / f"visitor_male_01_{direction}_master.png"
               for direction in direction_order]
    sources += [tool_root / "poses" / "concept" / f"{direction}_{name}.json"
                for direction in direction_order for name in ("idle", "walk_a", "walk_b")]
    missing = [str(path) for path in sources if not path.is_file()]
    if missing:
        raise ValueError("Four-view concept review is missing authored sources: " + ", ".join(missing))
    output.mkdir(parents=True, exist_ok=True)
    background = None
    if args.background:
        with Image.open(args.background) as source:
            background = source.convert("RGBA")

    panels = []
    manifest = {"contract": "CH_VISITOR_2D_DIRECTIONAL_REVIEW_V1",
                "characterId": "visitor_male_01", "directions": {},
                "artApproved": False, "runtimePromotion": False}
    for direction in direction_order:
        master = tool_root / "art" / "concepts" / f"visitor_male_01_{direction}_master.png"
        folder = output / direction
        definition_path = folder / "definition.json"
        rig = build_concept_rig(master, asset_root, definition_path, direction)
        poses = [tool_root / "poses" / "concept" / f"{direction}_{name}.json"
                 for name in ("idle", "walk_a", "walk_b")]
        definition = load_character_definition(definition_path)
        validate_v1_character(definition, _load_poses([str(path) for path in poses]))
        _, produced, _ = _compose_and_export(
            str(definition_path), [str(path) for path in poses], str(asset_root), str(folder),
        )
        frames = []
        for name in ("idle", "walk_a", "walk_b"):
            with Image.open(folder / f"visitor_male_01_{direction}_{name}.png") as frame:
                frames.append(frame.convert("RGBA"))
        measurements = frame_measurements(frames, (64, 116))
        panel = gameplay_review(frames, background)
        panel_path = folder / f"visitor_male_01_{direction}_in_world_review.png"
        panel.save(panel_path, format="PNG", optimize=False)
        panels.append(panel)
        manifest["directions"][direction] = {
            "masterSha256": rig["masterSha256"],
            "definition": str(definition_path),
            "frames": [str(path) for path in produced],
            "reviewPanel": str(panel_path),
            "measurements": measurements,
        }

    board = Image.new("RGBA", (panels[0].width, sum(p.height for p in panels)))
    cursor = 0
    for panel in panels:
        board.alpha_composite(panel, (0, cursor))
        cursor += panel.height
    board_path = output / "visitor_male_01_four_directions_walk_review.png"
    board.save(board_path, format="PNG", optimize=False)
    manifest_path = output / "visitor_male_01_directional_review.json"
    manifest["board"] = str(board_path)
    manifest_path.write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"status": "ok", "board": str(board_path),
                      "manifest": str(manifest_path), "runtimePromotion": False}, indent=2))
    return 0


def command_review_map_scale(args: argparse.Namespace) -> int:
    frame_path, capture_path = Path(args.frame), Path(args.capture)
    with Image.open(frame_path) as source:
        if source.mode != "RGBA":
            raise ValueError("Visitor frame must be RGBA")
        frame = source.copy()
    with Image.open(capture_path) as source:
        capture = source.convert("RGBA")
    board, metrics = map_scale_review(
        frame, capture, tuple(args.crop), tuple(args.foot), args.display_height,
    )
    destination = Path(args.output)
    destination.parent.mkdir(parents=True, exist_ok=True)
    board.save(destination, format="PNG", optimize=False)
    metrics["frameSha256"] = hashlib.sha256(frame_path.read_bytes()).hexdigest()
    metrics["captureSha256"] = hashlib.sha256(capture_path.read_bytes()).hexdigest()
    metadata = destination.with_suffix(".json")
    metadata.write_text(json.dumps(metrics, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"status": "ok", "comparison": str(destination),
                      "metrics": str(metadata), "runtimePromotion": False}, indent=2))
    return 0


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="ch-visitor-forge-2d",
        description="City Horizon procedural 2D visitor composer",
    )
    subparsers = parser.add_subparsers(dest="command", required=True)

    graph = subparsers.add_parser("draw-graph", help="Render a reusable Draw Engine V1/V2 graph and audit its package")
    graph.add_argument("--recipe", required=True)
    graph.add_argument("--output", required=True)
    graph.set_defaults(func=command_draw_graph)
    plant = subparsers.add_parser("plan-plant", help="Compile, render and compare one plant intent in four coherent views")
    plant.add_argument("--intent", required=True)
    plant.add_argument("--output", required=True)
    plant.set_defaults(func=command_plan_plant)

    validate = subparsers.add_parser("validate", help="validate V1 character/pose contracts")
    validate.add_argument("--definition", required=True)
    validate.add_argument("--pose", action="append", required=True)
    validate.set_defaults(func=command_validate)

    build_assets = subparsers.add_parser(
        "build-assets",
        help="generate the deterministic V1 SOUTH 2D source-part library",
    )
    build_assets.add_argument("--asset-root", required=True)
    build_assets.add_argument("--overwrite-parts", action="store_true", help="Replace even manually edited source PNGs")
    build_assets.set_defaults(func=command_build_assets)

    concept_rig = subparsers.add_parser(
        "build-concept-rig", help="derive one experimental directional cutout rig from a 512px concept master",
    )
    concept_rig.add_argument("--master", required=True)
    concept_rig.add_argument("--direction", choices=("south", "east", "north", "west"), default="south")
    concept_rig.add_argument("--asset-root", required=True)
    concept_rig.add_argument("--definition-output", required=True)
    concept_rig.set_defaults(func=command_build_concept_rig)

    gait = subparsers.add_parser(
        "render-directional-gait",
        help="render short EAST/NORTH/WEST walk frames from intact 512px masters",
    )
    gait.add_argument("--tool-root", required=True)
    gait.add_argument("--recipe", required=True)
    gait.add_argument("--output", required=True)
    gait.set_defaults(func=command_render_directional_gait)

    audit = subparsers.add_parser(
        "audit-preview", help="check a four-direction preview manifest and its twelve PNGs",
    )
    audit.add_argument("--manifest", required=True, help="Preview catalogue JSON")
    audit.add_argument("--repo-root", default=".", help="Repository root for paths inside the catalogue")
    audit.set_defaults(func=command_audit_preview)

    draw = subparsers.add_parser("draw-recipe", help="draw a layered 2D prop from a JSON shape recipe")
    draw.add_argument("--recipe", required=True, help="CH_2D_SHAPE_RECIPE_V1 JSON file")
    draw.add_argument("--output", required=True, help="Output directory for PNG and metadata")
    draw.add_argument("--palette", help="Optional CH_2D_PALETTE_V1 colors shared across recipes")
    draw_variant = draw.add_mutually_exclusive_group()
    draw_variant.add_argument("--variant", help="Named palette variant")
    draw_variant.add_argument("--seed", type=int, help="Deterministically select a palette variant")
    draw_variant.add_argument("--all-variants", action="store_true", help="Render all colorways and one gameplay-size board")
    draw.set_defaults(func=command_draw_recipe)

    pixel_character = subparsers.add_parser(
        "render-pixel-character",
        help="render a deterministic four-direction pixel character with idle and 4-frame walk",
    )
    pixel_character.add_argument("--recipe", required=True, help="A7_FORGE_2D_PIXEL_CHARACTER_V1 JSON file")
    pixel_character.add_argument("--output", required=True, help="Output directory")
    pixel_character.set_defaults(func=command_render_pixel_character)

    animation = subparsers.add_parser(
        "pack-animation",
        help="validate Forge 2D frames and export spritesheet, manifest and GIF preview",
    )
    animation.add_argument("--recipe", required=True, help="A7_FORGE_2D_ANIMATION_V1 JSON file")
    animation.add_argument("--output", required=True, help="Output directory")
    animation.set_defaults(func=command_pack_animation)

    workers = subparsers.add_parser(
        "run-workers", help="validate, render and audit a procedural 2D recipe",
    )
    workers.add_argument("--recipe", required=True, help="Shape or organic scenery JSON")
    workers.add_argument("--output", required=True, help="Root for isolated review outputs")
    workers.set_defaults(func=command_run_workers)

    author = subparsers.add_parser(
        "author-art", help="author a reproducible recipe from a bounded 2D art brief and render review artifacts",
    )
    source = author.add_mutually_exclusive_group(required=True)
    source.add_argument("--brief", help="CH_2D_ART_BRIEF_V1 JSON file")
    source.add_argument("--prompt", help="Controlled-language prompt for a supported family")
    author.add_argument("--id", help="Required with --prompt; safe candidate ID")
    author.add_argument("--output", required=True, help="Root for authored recipe, PNG and review boards")
    author.set_defaults(func=command_author_art)

    render = subparsers.add_parser("render", help="compose and export one or more V1 poses")
    render.add_argument("--definition", required=True)
    render.add_argument("--pose", action="append", required=True)
    render.add_argument("--asset-root", required=True)
    render.add_argument("--art-root", help="Optional versioned RGBA part overrides")
    render.add_argument("--output", required=True)
    render.set_defaults(func=command_render)

    prototype = subparsers.add_parser(
        "prototype",
        help="generate V1 parts, render poses and produce visual-gate strips",
    )
    prototype.add_argument("--definition", required=True)
    prototype.add_argument("--pose", action="append", required=True)
    prototype.add_argument("--asset-root", required=True)
    prototype.add_argument("--art-root", help="Optional versioned RGBA part overrides")
    prototype.add_argument("--overwrite-parts", action="store_true", help="Replace even manually edited source PNGs")
    prototype.add_argument("--output", required=True)
    prototype.add_argument("--background", help="Optional terrain PNG for a native-size review strip")
    prototype.add_argument("--concept", help="Optional 128px RGBA SOUTH concept for idle comparison; never exported as an animated frame")
    prototype.set_defaults(func=command_prototype)

    directional_review = subparsers.add_parser(
        "review-concept-directions", help="build one character's 4 views and 12-frame gameplay board",
    )
    directional_review.add_argument("--tool-root", required=True)
    directional_review.add_argument("--asset-root", required=True)
    directional_review.add_argument("--output", required=True)
    directional_review.add_argument("--background", help="Optional terrain PNG for the review board")
    directional_review.set_defaults(func=command_review_concept_directions)

    map_scale = subparsers.add_parser(
        "review-map-scale", help="compare native and candidate visitor sizes on one real map crop",
    )
    map_scale.add_argument("--frame", required=True, help="128x128 visitor RGBA frame")
    map_scale.add_argument("--capture", required=True, help="MapForge or engine screenshot")
    map_scale.add_argument("--crop", type=int, nargs=4, required=True, metavar=("X0", "Y0", "X1", "Y1"))
    map_scale.add_argument("--foot", type=int, nargs=2, required=True, metavar=("X", "Y"))
    map_scale.add_argument("--display-height", type=int, required=True, help="Candidate body height in map pixels")
    map_scale.add_argument("--output", required=True, help="Review PNG path; JSON metadata saved alongside")
    map_scale.set_defaults(func=command_review_map_scale)

    return parser


def command_draw_graph(args: argparse.Namespace) -> int:
    print(json.dumps(run_graph_workers(Path(args.recipe), Path(args.output)), indent=2))
    return 0


def command_plan_plant(args: argparse.Namespace) -> int:
    print(json.dumps(run_plant_planner(Path(args.intent), Path(args.output)), indent=2))
    return 0


def main() -> int:
    parser = build_parser()
    args = parser.parse_args()
    return int(args.func(args))


if __name__ == "__main__":
    raise SystemExit(main())

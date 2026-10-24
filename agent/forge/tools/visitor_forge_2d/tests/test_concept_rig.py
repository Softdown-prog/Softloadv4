import hashlib
from pathlib import Path

from visitor_forge_2d.character import validate_v1_character
from visitor_forge_2d.character.concept_rig import build_concept_rig
from visitor_forge_2d.character.review import frame_measurements
from visitor_forge_2d.core import LayerComposer, alpha_safe_resize, load_character_definition, load_pose


TOOL_ROOT = Path(__file__).resolve().parents[1]


def test_concept_rig_keeps_identity_and_foot_anchor(tmp_path: Path) -> None:
    assets = tmp_path / "parts"
    # Only these authored masters are included in this standalone repository.
    # WEST's implementation is exercised separately with a diagnostic fixture.
    for direction in ("south", "east", "north"):
        definition_path = tmp_path / f"{direction}.json"
        master = TOOL_ROOT / f"art/concepts/visitor_male_01_{direction}_master.png"
        result = build_concept_rig(master, assets, definition_path, direction)
        assert result["masterSha256"] == hashlib.sha256(master.read_bytes()).hexdigest()
        assert len(result["parts"]) == 16  # 15 animated body parts and a fixed shadow
        assert all(Path(path).is_file() for path in result["parts"])

        definition = load_character_definition(definition_path)
        assert definition.character_id == "visitor_male_01"
        poses = [load_pose(TOOL_ROOT / f"poses/concept/{direction}_{name}.json")
                 for name in ("idle", "walk_a", "walk_b")]
        validate_v1_character(definition, poses)
        composer = LayerComposer(assets)
        frames = [alpha_safe_resize(composer.compose(definition, pose), (128, 128))
                  for pose in poses]
        metrics = frame_measurements(frames, (64, 116))
        assert metrics["footRowRangePx"] <= 1
        assert all(0.025 <= change <= 0.12
                   for change in metrics["changedSilhouetteFractionFromIdle"])


def test_west_partition_reconstructs_a_diagnostic_master(tmp_path: Path) -> None:
    # This fixture tests WEST's partition algorithm; it is not authored WEST art.
    from PIL import Image, ImageDraw
    master = Image.new('RGBA', (512, 512))
    draw = ImageDraw.Draw(master)
    draw.ellipse((200, 90, 280, 170), fill=(220, 170, 120, 255))
    draw.rectangle((208, 180, 272, 336), fill=(65, 120, 175, 255))
    draw.rectangle((190, 180, 205, 310), fill=(65, 120, 175, 255))
    draw.rectangle((290, 180, 305, 300), fill=(65, 120, 175, 255))
    draw.rectangle((211, 336, 236, 463), fill=(65, 70, 90, 255))
    draw.rectangle((247, 336, 271, 463), fill=(65, 70, 90, 255))
    draw.rectangle((211, 415, 236, 463), fill=(90, 60, 30, 255))
    draw.rectangle((254, 415, 278, 463), fill=(90, 60, 30, 255))
    source = tmp_path / 'diagnostic_master.png'
    master.save(source)
    result = build_concept_rig(source, tmp_path / 'parts', tmp_path / 'west.json', 'west')
    assert result['masterSha256'] == hashlib.sha256(source.read_bytes()).hexdigest()
    assert len(result['parts']) == 16
    definition = load_character_definition(tmp_path / 'west.json')
    assert definition.direction == 'west'
    for name in ('idle', 'walk_a', 'walk_b'):
        pose = load_pose(TOOL_ROOT / f'poses/concept/west_{name}.json')
        frame = LayerComposer(tmp_path / 'parts').compose(definition, pose)
        assert frame.mode == 'RGBA' and frame.getchannel('A').getbbox() is not None

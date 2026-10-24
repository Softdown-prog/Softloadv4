from pathlib import Path

from PIL import Image

from visitor_forge_2d.character import generate_v1_south_assets, validate_v1_character
from visitor_forge_2d.core import LayerComposer, load_character_definition, load_pose


TOOL_ROOT = Path(__file__).resolve().parents[1]
DEFINITION = TOOL_ROOT / "definitions" / "visitor_male_01.south.json"
POSES = [
    TOOL_ROOT / "poses" / "south_idle.json",
    TOOL_ROOT / "poses" / "south_walk_a.json",
    TOOL_ROOT / "poses" / "south_walk_b.json",
]


def test_procedural_south_parts_and_composition(tmp_path: Path) -> None:
    asset_root = tmp_path / "assets"
    written = generate_v1_south_assets(asset_root)

    assert len(written) == 16
    assert all(path.is_file() for path in written)

    for path in written:
        image = Image.open(path)
        assert image.mode == "RGBA"
        assert image.getchannel("A").getbbox() is not None

    definition = load_character_definition(DEFINITION)
    poses = [load_pose(path) for path in POSES]
    validate_v1_character(definition, poses)

    composer = LayerComposer(asset_root)
    for pose in poses:
        frame = composer.compose(definition, pose)
        assert frame.mode == "RGBA"
        assert frame.size == definition.canvas.working_size
        assert frame.getchannel("A").getbbox() is not None

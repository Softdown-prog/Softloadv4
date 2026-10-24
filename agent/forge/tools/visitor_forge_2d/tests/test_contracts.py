from __future__ import annotations

import unittest
from pathlib import Path

from visitor_forge_2d.character import validate_v1_character
from visitor_forge_2d.core import load_character_definition, load_pose


ROOT = Path(__file__).resolve().parents[1]


class VisitorForgeContractTests(unittest.TestCase):
    def test_v1_south_contract(self) -> None:
        definition = load_character_definition(ROOT / "definitions/visitor_male_01.south.json")
        poses = [
            load_pose(ROOT / "poses/south_idle.json"),
            load_pose(ROOT / "poses/south_walk_a.json"),
            load_pose(ROOT / "poses/south_walk_b.json"),
        ]
        validate_v1_character(definition, poses)
        self.assertEqual(definition.canvas.output_size, (128, 128))
        self.assertEqual(definition.canvas.anchor.as_list(), [64.0, 116.0])
        self.assertEqual({pose.pose_id for pose in poses}, {"south_idle", "south_walk_a", "south_walk_b"})


if __name__ == "__main__":
    unittest.main()

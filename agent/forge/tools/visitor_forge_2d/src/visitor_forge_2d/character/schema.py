from __future__ import annotations

from visitor_forge_2d.core.model import CharacterDefinition, PoseSpec

# V1 deliberately uses a small cutout-style skeleton. Splitting upper/lower
# limbs gives the 2D renderer enough articulation for a believable two-frame
# walk without requiring mesh deformation or a 3D rig.
REQUIRED_V1_PARTS = {
    "head",
    "hair",
    "torso",
    "upper_arm_left",
    "lower_arm_left",
    "hand_left",
    "upper_arm_right",
    "lower_arm_right",
    "hand_right",
    "upper_leg_left",
    "lower_leg_left",
    "shoe_left",
    "upper_leg_right",
    "lower_leg_right",
    "shoe_right",
}

REQUIRED_V1_POSES = {"south_idle", "south_walk_a", "south_walk_b"}
CONCEPT_RIG_CONTRACT = "CH_VISITOR_FORGE_2D_DIRECTIONAL_CUTOUT_STUDY_V1"


def validate_v1_character(
    definition: CharacterDefinition,
    poses: list[PoseSpec] | tuple[PoseSpec, ...],
) -> None:
    """Validate the intentionally narrow first visual gate.

    This does not certify art quality. It certifies only that the files respect
    the production contract needed to compare the three SOUTH frames fairly.
    """
    is_concept_rig = definition.forge_contract_version == CONCEPT_RIG_CONTRACT
    expected_direction = definition.direction if is_concept_rig else "south"
    if not is_concept_rig and definition.direction != "south":
        raise ValueError("Visitor Forge 2D V1 accepts SOUTH only")

    part_ids = {part.part_id for part in definition.parts}
    missing_parts = sorted(REQUIRED_V1_PARTS - part_ids)
    if missing_parts:
        raise ValueError(f"V1 character is missing required parts: {missing_parts}")

    pose_ids = {pose.pose_id for pose in poses}
    if len(pose_ids) != len(poses):
        raise ValueError("Duplicate pose ID would overwrite an exported frame")
    required_poses = ({f"{expected_direction}_{name}" for name in ("idle", "walk_a", "walk_b")}
                      if is_concept_rig else REQUIRED_V1_POSES)
    missing_poses = sorted(required_poses - pose_ids)
    if missing_poses:
        raise ValueError(f"V1 character is missing required poses: {missing_poses}")

    for pose in poses:
        if pose.direction != expected_direction:
            raise ValueError(f"V1 pose {pose.pose_id} is not {expected_direction.upper()}")

    # The anchor belongs to the character definition, not to a pose. Frames
    # therefore cannot accidentally move the gameplay anchor through metadata.
    anchor = definition.canvas.anchor
    width, height = definition.canvas.output_size
    if not (0 <= anchor.x <= width and 0 <= anchor.y <= height):
        raise ValueError(f"Gameplay anchor lies outside output canvas: {anchor}")

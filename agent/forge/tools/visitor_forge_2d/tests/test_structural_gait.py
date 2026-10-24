from pathlib import Path

import pytest
from PIL import Image, ImageDraw, ImageChops

from visitor_forge_2d.character.structural_gait import (
    validate_structural_pose,
    warp_structural_master,
)


def _neutral() -> dict:
    return {
        "left": {"hip": [238, 280], "knee": [230, 350], "ankle": [222, 417]},
        "right": {"hip": [278, 280], "knee": [278, 348], "ankle": [283, 409]},
    }


def _target() -> dict:
    return {
        "left": {"hip": [238, 280], "knee": [240, 351], "ankle": [242, 419]},
        "right": {"hip": [278, 280], "knee": [271, 345], "ankle": [268, 404]},
    }


def _master() -> Image.Image:
    image = Image.new("RGBA", (512, 512))
    draw = ImageDraw.Draw(image)
    draw.ellipse((220, 70, 292, 145), fill=(180, 120, 92, 255))
    draw.rectangle((212, 145, 302, 279), fill=(68, 126, 173, 255))
    draw.polygon(((228, 280), (249, 280), (246, 420), (212, 452)), fill=(74, 78, 91, 255))
    draw.polygon(((263, 280), (284, 280), (302, 447), (274, 420)), fill=(74, 78, 91, 255))
    return image


def test_structural_pose_reports_joint_deltas_and_segment_ratios() -> None:
    report = validate_structural_pose(_neutral(), _target())
    assert report["contract"] == "CH_VISITOR_STRUCTURAL_GAIT_V1"
    assert report["legs"]["left"]["delta"]["hip"] == [0.0, 0.0]
    assert 0.72 <= report["legs"]["left"]["segmentLengthRatios"][0] <= 1.28


def test_structural_warp_preserves_locked_upper_identity() -> None:
    master = _master()
    warped, _ = warp_structural_master(master, _neutral(), _target())
    assert ImageChops.difference(master.crop((0, 0, 512, 280)),
                                 warped.crop((0, 0, 512, 280))).getbbox() is None
    assert ImageChops.difference(master.crop((0, 300, 512, 512)),
                                 warped.crop((0, 300, 512, 512))).getbbox() is not None


def test_structural_pose_rejects_mutant_leg_extension() -> None:
    target = _target()
    target["left"]["ankle"] = [120, 470]
    with pytest.raises(ValueError, match="ankle exceeds"):
        validate_structural_pose(_neutral(), target)


def test_structural_pose_rejects_large_hip_motion() -> None:
    target = _target()
    target["right"]["hip"] = [290, 280]
    with pytest.raises(ValueError, match="hip exceeds"):
        validate_structural_pose(_neutral(), target)

"""Mechanical identity-preservation checks for Visitor Forge animation frames.

The identity lock is intentionally conservative: it compares only small visual
regions that are expected to remain stable while limbs animate. It does not
approve art and it must not be used as a substitute for gameplay-scale review.
"""

from __future__ import annotations

from collections.abc import Mapping, Sequence

from PIL import Image, ImageChops


IDENTITY_LOCK_CONTRACT = "CH_VISITOR_IDENTITY_LOCK_V1"
IDENTITY_LOCK_ZONES_V1: dict[str, tuple[int, int, int, int]] = {
    # Conservative gameplay-canvas regions. They intentionally avoid the
    # shoulders/outer arms and the lower body so a short walk remains free to
    # animate while the character's face/head and torso core stay unchanged.
    "head": (40, 14, 88, 50),
    "torso_core": (52, 50, 76, 70),
}


def identity_lock_measurements(
    frames: Sequence[Image.Image],
    zones: Mapping[str, tuple[int, int, int, int]] | None = None,
    *,
    pixel_delta_tolerance: int = 4,
    max_changed_fraction: float = 0.005,
) -> dict:
    """Compare walk frames with idle inside identity-locked visual regions.

    Hidden RGB under fully transparent pixels is ignored by comparing images
    after compositing them over the same neutral background. Changed-pixel
    fractions are measured only where either frame has visible alpha.
    """
    if len(frames) < 2:
        raise ValueError("Identity lock requires idle plus at least one animated frame")
    size = frames[0].size
    if any(frame.size != size for frame in frames):
        raise ValueError("Every identity-lock frame must use the same canvas")
    if not 0 <= pixel_delta_tolerance <= 255:
        raise ValueError("pixel_delta_tolerance must be between 0 and 255")
    if not 0.0 <= max_changed_fraction <= 1.0:
        raise ValueError("max_changed_fraction must be between 0 and 1")

    active_zones = dict(zones or IDENTITY_LOCK_ZONES_V1)
    if not active_zones:
        raise ValueError("Identity lock requires at least one locked zone")
    for name, box in active_zones.items():
        if len(box) != 4:
            raise ValueError(f"Identity zone {name!r} must contain four coordinates")
        left, top, right, bottom = box
        if not (0 <= left < right <= size[0] and 0 <= top < bottom <= size[1]):
            raise ValueError(f"Identity zone {name!r} lies outside canvas {size}")

    rgba_frames = [frame.convert("RGBA") for frame in frames]
    backdrop = Image.new("RGBA", size, (76, 116, 48, 255))
    visible_frames = [Image.alpha_composite(backdrop, frame).convert("RGB")
                      for frame in rgba_frames]
    base = rgba_frames[0]
    base_visible = visible_frames[0]
    comparisons: list[dict] = []
    overall_pass = True

    for frame_index in range(1, len(rgba_frames)):
        candidate = rgba_frames[frame_index]
        candidate_visible = visible_frames[frame_index]
        zone_results: dict[str, dict] = {}
        frame_pass = True
        for name, box in active_zones.items():
            base_alpha = base.getchannel("A").crop(box)
            candidate_alpha = candidate.getchannel("A").crop(box)
            alpha_union = ImageChops.lighter(base_alpha, candidate_alpha)
            visible_mask = alpha_union.point(lambda value: 255 if value > 0 else 0)
            visible_pixels = sum(value != 0 for value in visible_mask.tobytes())
            if visible_pixels == 0:
                raise ValueError(f"Identity zone {name!r} contains no visible character pixels")

            diff = ImageChops.difference(base_visible.crop(box), candidate_visible.crop(box))
            diff_pixels = list(diff.getdata())
            mask_pixels = visible_mask.tobytes()
            changed_pixels = 0
            channel_delta = 0
            for mask_value, pixel in zip(mask_pixels, diff_pixels):
                if mask_value == 0:
                    continue
                channel_delta += sum(pixel)
                if max(pixel) > pixel_delta_tolerance:
                    changed_pixels += 1
            changed_fraction = changed_pixels / visible_pixels
            mean_channel_delta = channel_delta / (visible_pixels * 3)
            passed = changed_fraction <= max_changed_fraction
            frame_pass = frame_pass and passed
            zone_results[name] = {
                "box": list(box),
                "visiblePixels": visible_pixels,
                "changedPixels": changed_pixels,
                "changedFraction": round(changed_fraction, 6),
                "meanChannelDelta": round(mean_channel_delta, 4),
                "passed": passed,
            }

        overall_pass = overall_pass and frame_pass
        comparisons.append({
            "frameIndex": frame_index,
            "zones": zone_results,
            "passed": frame_pass,
        })

    return {
        "contract": IDENTITY_LOCK_CONTRACT,
        "canvasSize": list(size),
        "zones": {name: list(box) for name, box in active_zones.items()},
        "pixelDeltaTolerance": pixel_delta_tolerance,
        "maxChangedFraction": max_changed_fraction,
        "comparisons": comparisons,
        "passed": overall_pass,
        "artApproved": False,
        "runtimePromotion": False,
    }


def assert_identity_lock(frames: Sequence[Image.Image], **kwargs: object) -> dict:
    """Return identity metrics or reject a frame set that breaks the lock."""
    report = identity_lock_measurements(frames, **kwargs)
    if not report["passed"]:
        failures = []
        for comparison in report["comparisons"]:
            for name, zone in comparison["zones"].items():
                if not zone["passed"]:
                    failures.append(
                        f"frame {comparison['frameIndex']} {name} changed "
                        f"{zone['changedFraction']:.4f}"
                    )
        raise ValueError("Identity lock failed: " + ", ".join(failures))
    return report

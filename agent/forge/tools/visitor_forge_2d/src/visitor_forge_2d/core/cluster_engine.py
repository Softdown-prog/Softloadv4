"""A7 Cluster Engine V1: hierarchical compound brush composition."""
from __future__ import annotations

import math
import random
from typing import Sequence

from PIL import Image

from .brush_engine_v3 import BRUSH_V3_CONTRACT, BrushEngineV3
from .distribution_engine import DISTRIBUTION_CONTRACT, DistributionEngineV1

CLUSTER_CONTRACT = "A7_CLUSTER_ENGINE_V1"
_MAX_DEPTH = 5


def _pair(value: Sequence[float] | float, default: float = 1.0) -> tuple[float, float]:
    if isinstance(value, (int, float)):
        number = float(value)
        return number, number
    if len(value) != 2:
        return default, default
    return float(value[0]), float(value[1])


def _transform_offset(
    offset: Sequence[float],
    *,
    scale: float,
    rotation_deg: float,
    mirror_x: bool,
) -> tuple[float, float]:
    if not isinstance(offset, Sequence) or len(offset) != 2:
        raise ValueError("cluster member offset must be [x, y]")
    ox, oy = float(offset[0]), float(offset[1])
    if mirror_x:
        ox = -ox
    ox *= scale
    oy *= scale
    angle = math.radians(rotation_deg)
    return (
        ox * math.cos(angle) - oy * math.sin(angle),
        ox * math.sin(angle) + oy * math.cos(angle),
    )


class ClusterEngineV1:
    """Render hierarchical clusters of bitmap brush tips deterministically."""

    contract = CLUSTER_CONTRACT

    def __init__(self, seed: int = 1):
        self.seed = int(seed)
        self.rng = random.Random(self.seed)
        self.brush = BrushEngineV3(self.seed + 104729)

    @staticmethod
    def _validate_cluster(cluster: dict, depth: int = 0) -> None:
        if depth > _MAX_DEPTH:
            raise ValueError("cluster nesting exceeds maximum depth")
        if not isinstance(cluster, dict):
            raise ValueError("cluster must be an object")
        members = cluster.get("members")
        if not isinstance(members, list) or not members:
            raise ValueError("cluster requires a non-empty members list")
        for member in members:
            if not isinstance(member, dict):
                raise ValueError("cluster members must be objects")
            kind = member.get("type", "brush")
            offset = member.get("offset", [0, 0])
            if not isinstance(offset, Sequence) or len(offset) != 2:
                raise ValueError("cluster member offset must be [x, y]")
            if kind == "brush":
                brushes = member.get("brushes", [])
                if not isinstance(brushes, list) or not brushes:
                    raise ValueError("brush cluster member requires brushes")
            elif kind == "cluster":
                ClusterEngineV1._validate_cluster(member.get("cluster"), depth + 1)
            else:
                raise ValueError(f"unsupported cluster member type: {kind}")

    def _member_transform(
        self,
        member: dict,
        *,
        parent_scale: float,
        parent_rotation_deg: float,
        parent_mirror_x: bool,
    ) -> tuple[float, float, bool]:
        scale_range = _pair(member.get("scale", [1.0, 1.0]))
        rotation_range = _pair(member.get("rotationDeg", [0.0, 0.0]), 0.0)
        local_scale = max(0.05, self.rng.uniform(*scale_range))
        local_rotation = self.rng.uniform(*rotation_range)
        local_mirror = self.rng.random() < max(0.0, min(1.0, float(member.get("mirrorXProbability", 0.0))))
        return (
            parent_scale * local_scale,
            parent_rotation_deg + (-local_rotation if parent_mirror_x else local_rotation),
            bool(parent_mirror_x) ^ bool(local_mirror),
        )

    def stamp_cluster(
        self,
        canvas: Image.Image,
        cluster: dict,
        x: float,
        y: float,
        *,
        scale: float = 1.0,
        rotation_deg: float = 0.0,
        mirror_x: bool = False,
        _depth: int = 0,
    ) -> dict:
        if canvas.mode != "RGBA":
            raise ValueError("Cluster Engine V1 canvas must be RGBA")
        self._validate_cluster(cluster, _depth)
        leaf_stamps = 0
        nested_clusters = 1

        for member in cluster["members"]:
            dx, dy = _transform_offset(
                member.get("offset", [0, 0]),
                scale=scale,
                rotation_deg=rotation_deg,
                mirror_x=mirror_x,
            )
            world_x, world_y = float(x) + dx, float(y) + dy
            child_scale, child_rotation, child_mirror = self._member_transform(
                member,
                parent_scale=scale,
                parent_rotation_deg=rotation_deg,
                parent_mirror_x=mirror_x,
            )
            kind = member.get("type", "brush")

            if kind == "brush":
                brush_name = self.rng.choice(tuple(member["brushes"]))
                stamp = self.brush.random_stamp(
                    world_x,
                    world_y,
                    scale=[child_scale, child_scale],
                    aspect=member.get("aspect", [0.85, 1.15]),
                    rotation_deg=[0.0, 0.0],
                    base_rotation_deg=child_rotation,
                    opacity=member.get("opacity", [240, 255]),
                    tints=member.get("tints", ["#FFFFFF"]),
                    mirror_x_probability=1.0 if child_mirror else 0.0,
                    mirror_y_probability=float(member.get("mirrorYProbability", 0.0)),
                    hue_jitter_deg=float(member.get("hueJitterDeg", 0.0)),
                    saturation=member.get("saturation", [0.95, 1.05]),
                    value=member.get("value", [0.95, 1.05]),
                )
                self.brush.stamp(canvas, brush_name, stamp)
                leaf_stamps += 1
            else:
                child_stats = self.stamp_cluster(
                    canvas,
                    member["cluster"],
                    world_x,
                    world_y,
                    scale=child_scale,
                    rotation_deg=child_rotation,
                    mirror_x=child_mirror,
                    _depth=_depth + 1,
                )
                leaf_stamps += int(child_stats["leafStampCount"])
                nested_clusters += int(child_stats["clusterNodeCount"])

        return {
            "contract": CLUSTER_CONTRACT,
            "brushContract": BRUSH_V3_CONTRACT,
            "leafStampCount": leaf_stamps,
            "clusterNodeCount": nested_clusters,
        }

    def scatter_clusters(
        self,
        canvas: Image.Image,
        cluster: dict,
        regions: Sequence[dict],
        count: int,
        *,
        min_distance: float,
        scale: Sequence[float] = (1.0, 1.0),
        rotation_deg: Sequence[float] = (0.0, 360.0),
        mirror_x_probability: float = 0.5,
        max_attempts: int | None = None,
    ) -> dict:
        self._validate_cluster(cluster)
        distribution = DistributionEngineV1(self.seed + 130363)
        centers, attempts = distribution.sample_spaced(
            regions,
            int(count),
            min_distance=float(min_distance),
            max_attempts=max_attempts,
        )
        scale_range = _pair(scale)
        rotation_range = _pair(rotation_deg, 0.0)
        total_leaf_stamps = 0
        total_cluster_nodes = 0

        for x, y in centers:
            parent_scale = max(0.05, self.rng.uniform(*scale_range))
            parent_rotation = self.rng.uniform(*rotation_range)
            parent_mirror = self.rng.random() < max(0.0, min(1.0, float(mirror_x_probability)))
            stats = self.stamp_cluster(
                canvas,
                cluster,
                x,
                y,
                scale=parent_scale,
                rotation_deg=parent_rotation,
                mirror_x=parent_mirror,
            )
            total_leaf_stamps += int(stats["leafStampCount"])
            total_cluster_nodes += int(stats["clusterNodeCount"])

        return {
            "contract": CLUSTER_CONTRACT,
            "brushContract": BRUSH_V3_CONTRACT,
            "distributionContract": DISTRIBUTION_CONTRACT,
            "requestedClusters": int(count),
            "clusterCount": len(centers),
            "clusterNodeCount": total_cluster_nodes,
            "leafStampCount": total_leaf_stamps,
            "attempts": attempts,
            "minDistance": float(min_distance),
            "saturated": len(centers) < int(count),
            "hierarchical": True,
        }

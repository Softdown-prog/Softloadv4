from pathlib import Path

import pytest

from visitor_forge_2d.component_gallery import (
    DEFAULT_GALLERY,
    get_component,
    instantiate_component,
    load_component_gallery,
    search_components,
)


def test_gallery_reaches_minimum_target_with_704_unique_items() -> None:
    gallery = load_component_gallery(DEFAULT_GALLERY)
    assert gallery["targetCount"] == 700
    assert gallery["currentCount"] == 704
    assert gallery["status"] == "target_reached"
    assert gallery["generation"]["familyCount"] == 44
    assert gallery["generation"]["shardCount"] == 2
    assert len(gallery["items"]) == 704
    assert len({item["id"] for item in gallery["items"]}) == 704


def test_every_family_expands_to_16_components() -> None:
    gallery = load_component_gallery(DEFAULT_GALLERY)
    counts = {}
    for item in gallery["items"]:
        counts[item["family"]] = counts.get(item["family"], 0) + 1
    assert set(counts) == set(gallery["familyDefinitions"])
    assert all(count == 16 for count in counts.values())


def test_hardware_marine_street_signage_and_new_decor_families_are_searchable() -> None:
    assert len(search_components(family="washer_nut")) == 16
    assert len(search_components(family="dock_bumper")) == 16
    assert len(search_components(family="bench_support")) == 16
    assert len(search_components(family="sign_panel")) == 16
    assert len(search_components(family="marine_anchor")) == 16
    assert len(search_components(family="flower_cluster")) == 16
    assert len(search_components(family="awning_canopy")) == 16
    assert len(search_components(family="decorative_finial")) == 16
    marine = search_components(category="marine")
    assert {item["family"] for item in marine} >= {
        "marine_fitting", "ladder_segment", "oar_paddle", "boat_rib",
        "dock_bumper", "marine_anchor", "buoy_float",
    }


def test_component_instantiation_keeps_material_guardrails() -> None:
    item = get_component("oar_paddle_oar_md_000")
    assert item["sizePx"] == [42, 5]
    node = instantiate_component(item["id"], x=12, y=18, scale=1.5, material="wood")
    assert node["sizePx"] == [63.0, 7.5]
    assert node["transform"]["translate"] == [12, 18]
    with pytest.raises(ValueError, match="not supported"):
        instantiate_component(item["id"], material="stone")


def test_new_batch_component_can_be_instantiated() -> None:
    item = get_component("marine_anchor_anchor_md_090")
    assert item["family"] == "marine_anchor"
    assert item["orientationDeg"] == 90
    node = instantiate_component(item["id"], x=5, y=7, material="metal")
    assert node["transform"]["translate"] == [5, 7]
    assert node["material"] == "metal"

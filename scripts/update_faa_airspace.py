#!/usr/bin/env python3
"""Refresh Breez's Florida preview snapshot from the FAA's public datasets."""

import gzip
import json
from datetime import datetime, timezone
from pathlib import Path
from urllib.request import Request, urlopen


DATASETS = (
    (
        "uas_security",
        "https://udds-faa.opendata.arcgis.com/api/v3/datasets/0270b9d8a5d34217856cc03aaf833309_0",
    ),
    (
        "special_use",
        "https://adds-faa.opendata.arcgis.com/api/v3/datasets/dd0d1b726e504137ab3c41b21835d05b_0",
    ),
)
FLORIDA_EXTENT = (-87.7, 24.3, -79.8, 31.1)
MAX_BYTES = 64 * 1024 * 1024
TARGET = Path(__file__).resolve().parents[1] / "app" / "data" / "faa-airspace.json.gz"


def polygons_in_florida(geometry):
    coordinates = geometry["coordinates"]
    if geometry["type"] == "Polygon":
        coordinates = [coordinates]
    elif geometry["type"] != "MultiPolygon":
        raise ValueError(f"Unexpected FAA geometry {geometry['type']}")

    west, south, east, north = FLORIDA_EXTENT
    for polygon in coordinates:
        lons, lats = zip(*(point[:2] for point in polygon[0]))
        if min(lons) <= east and max(lons) >= west and min(lats) <= north and max(lats) >= south:
            yield [[point[:2] for point in ring] for ring in polygon]


def convert(source, feature):
    props = feature["properties"]
    if source == "special_use":
        if (props["TYPE_CODE"] not in {"P", "R"} or props["COUNTRY"] != "UNITED STATES"
                or str(props["EXCLUSION"]) == "1"):
            return None
        name = props["NAME"]
        kind = "prohibited" if props["TYPE_CODE"] == "P" else "restricted"
        lower = "Surface" if props["LOWER_CODE"] == "SFC" else " ".join(
            part for part in (props["LOWER_VAL"], props["LOWER_UOM"], props["LOWER_CODE"]) if part
        )
        upper = " ".join(
            part for part in (props["UPPER_VAL"], props["UPPER_UOM"], props["UPPER_CODE"]) if part
        )
        schedule = props["TIMESOFUSE"] or ""
    else:
        name = props["Facility"] or props["Base"]
        kind = source
        lower, upper = props["Floor"], props["Ceiling"]
        schedule = ""

    polygons = list(polygons_in_florida(feature["geometry"]))
    if not polygons:
        return None
    return {
        "id": f"{source}-{props['OBJECTID']}",
        "name": (name or "").strip() or f"FAA airspace record {props['OBJECTID']}",
        "kind": kind,
        "lower": lower or "",
        "upper": upper or "",
        "schedule": schedule,
        "polygons": polygons,
    }


def main():
    areas = []
    for source, url in DATASETS:
        request = Request(
            url + "/downloads/data?format=geojson&spatialRefId=4326&where=1%3D1",
            headers={"User-Agent": "Breez/1.0"},
        )
        with urlopen(request, timeout=45) as response:
            raw = response.read(MAX_BYTES + 1)
        if len(raw) > MAX_BYTES:
            raise ValueError(f"{source}: FAA response exceeded size limit")
        payload = json.loads(raw)
        if payload["type"] != "FeatureCollection" or (
            payload["crs"]["properties"]["name"] != "urn:ogc:def:crs:OGC:1.3:CRS84"
        ):
            raise ValueError(f"{source}: expected a longitude/latitude FAA GeoJSON collection")
        selected = [area for feature in payload["features"] if (area := convert(source, feature))]
        if not selected:
            raise ValueError(f"{source}: FAA dataset returned no Florida areas")
        areas.extend(selected)
        print(f"{source}: {len(selected)} published areas")

    TARGET.parent.mkdir(parents=True, exist_ok=True)
    contents = {"retrieved_at": datetime.now(timezone.utc).replace(microsecond=0).isoformat(), "areas": areas}
    raw = (json.dumps(contents, ensure_ascii=False, separators=(",", ":")) + "\n").encode("utf-8")
    TARGET.write_bytes(gzip.compress(raw, mtime=0))


if __name__ == "__main__":
    main()

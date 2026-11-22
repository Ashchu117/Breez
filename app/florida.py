"""Florida coverage for the demo, using the same boundary as place search."""

import json
from functools import cache
from pathlib import Path

from app.mission_contracts import Coordinates


BOUNDARY_FILE = Path(__file__).parent / "static" / "florida-boundary.json"


@cache
def florida_polygons() -> list:
    return json.loads(BOUNDARY_FILE.read_text(encoding="utf-8"))["coordinates"]


def inside_ring(point: Coordinates, ring: list[list[float]]) -> bool:
    inside = False
    previous_lon, previous_lat = ring[-1]
    for lon, lat in ring:
        if (lat > point.lat) != (previous_lat > point.lat):
            crossing = lon + (previous_lon - lon) * (point.lat - lat) / (previous_lat - lat)
            if point.lon < crossing:
                inside = not inside
        previous_lon, previous_lat = lon, lat
    return inside


def is_in_florida(point: Coordinates) -> bool:
    return any(
        inside_ring(point, outer) and not any(inside_ring(point, hole) for hole in holes)
        for outer, *holes in florida_polygons()
    )
